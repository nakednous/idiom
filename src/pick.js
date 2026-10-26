/**
 * @file Picking — a pixel's colour read back, and the colour-id scene pick over
 * it.
 * @module idiom/pick
 * @license AGPL-3.0-only
 *
 * ```
 * readPixel(ctx, target, x, y) → Promise<Uint8Array>    // four bytes, a frame or more late
 * pick(ctx, x, y, drawFn, opts) → Promise<number>       // 0 a miss
 * ```
 *
 * **The protocol.** `readPixel` is the backend's `readPixels` for one pixel: a
 * copy of a texel, mapped back, the answer a promise. A target's pixels are its
 * own, in its own orientation (the backend's `framebufferY`): row 0 at the top on
 * WebGPU, at the bottom on GL. `target` is passed through as it comes — `SCREEN`
 * (null) is the drawing buffer, which GL can read and a WebGPU presentation
 * surface cannot, so it is the **backend** that says which reads it can answer
 * and the bridge's verb that states the refusal (§7 #125).
 *
 * `pick` draws the scene into a **cached 1 × 1 target** under the installed
 * projection narrowed onto the query pixel by tree's `mat4Pick`, calling the
 * caller's `drawFn(paint)`; `paint(id)` writes the id's colour into the program's
 * `uColor` where the program declares it, and the pixel read back decodes with
 * `rgbaToId`. Ids run 1 … 2²⁴ − 1, and 0 is a miss. The camera, the bound
 * target, the viewport, the depth state and the bound program are restored in a
 * `finally`, so a `drawFn` that throws still leaves the record as it found it.
 *
 * **What the caller states.** Three things the layer cannot know:
 *
 * - `opts.vp` — the viewport the coordinates are in, `[x, y, w, h]` signed, in
 *   logical pixels: the bridge's space mapping (`canvasViewport`). It is an
 *   argument rather than a member because a device's canvas size and a drawing
 *   buffer's are two different questions, and the bridges answer them.
 * - `opts.program` — the id program. The backend's flat program serves a
 *   covering quad; a scene of meshes passes its own, because a WebGPU pipeline
 *   bakes the vertex layout and a GL id program may displace or skin (§7 #112).
 * - `opts.sync` — read the pixel in the same call, stalling the GPU. The read
 *   happens **while the pick target is still bound**, and the option is the
 *   backend's: the reference answers in the same tick, a backend without the
 *   form answers a frame later and the promise is the same (§7 #125).
 */

'use strict';

import { idToRgba, mat4Pick, rgbaToId } from '@nakednous/tree';
import { renderTarget } from './target.js';

const _rgba = [0, 0, 0, 1];
const _V = new Float32Array(16);
const _P = new Float32Array(16);
const _Ppick = new Float32Array(16);
const _declared = new WeakMap();
const _warned = new WeakSet();

/** What a program declares that a pick writes, read once per program. @ignore */
function _declares(ctx, prog) {
  let d = _declared.get(prog);
  if (!d) {
    const names = ctx.backend.uniformsOf(prog) || [];
    d = { color: names.indexOf('uColor') >= 0, texture: names.indexOf('uUseTexture') >= 0 };
    _declared.set(prog, d);
  }
  return d;
}

/** The 1 × 1 target a pick draws into, made once per context. @ignore */
function _pickTarget(ctx) {
  if (!ctx.pickTarget) ctx.pickTarget = renderTarget(ctx, { width: 1, height: 1 });
  return ctx.pickTarget;
}

/**
 * Read one pixel of a target back, asynchronously.
 * @param {object} ctx  The context record.
 * @param {object} target  A target from `renderTarget`, or `SCREEN` (null) for the drawing buffer
 *        where the API can read it — the backend answers which.
 * @param {number} x  The pixel's column in the target, from the left.
 * @param {number} y  Its row, in the target's own orientation (`framebufferY`).
 * @param {object} [opts]  The backend's read options — the reference's `sync` among them.
 * @returns {Promise<Uint8Array>} The four bytes, RGBA.
 * @example
 * readPixel(ctx, scene, 20, 20).then((px) => console.log(px[0], px[1], px[2]))
 */
export function readPixel(ctx, target, x, y, opts) {
  if (!ctx || !ctx.backend) return Promise.resolve(new Uint8Array(4));
  return ctx.backend.readPixels(ctx, target, x | 0, y | 0, 1, 1, opts);
}

/**
 * The id of the object under a screen-space pixel, 0 for a miss.
 * @param {object} ctx  The context record.
 * @param {number} x  The query pixel's column, logical pixels — a pointer offset as it comes.
 * @param {number} y  Its row, from the top.
 * @param {function(function(number):void):void} drawFn  Draws the scene into the pick target;
 *        call `paint(id)` before each object's draw.
 * @param {{ vp:number[], program?:object, target?:object, sync?:boolean }} opts
 *        vp: the viewport the coordinates are in, `[x, y, w, h]` signed, logical pixels —
 *        the bridge's `canvasViewport`. program: the id program. target: the 1 × 1 target
 *        to draw into (a cached one otherwise). sync: read back at once, where the backend has it.
 * @returns {Promise<number>} The id under the pixel, 0 for a miss.
 * @example
 * pick(ctx, 200, 150, (paint) => {
 *   paint(1); draw(ctx, box, M)
 * }, { vp: canvasViewport(ctx) }).then((id) => { picked = id })
 */
export function pick(ctx, x, y, drawFn, opts) {
  if (!ctx || !ctx.backend) return Promise.resolve(0);
  const o = opts || {};
  const backend = ctx.backend;
  if (typeof drawFn !== 'function') {
    console.error('[idiom] pick: `drawFn` draws the scene, calling paint(id) before each object.');
    return Promise.resolve(0);
  }
  if (!o.vp) {
    console.error('[idiom] pick: `opts.vp` is the viewport the coordinates are in — a bridge\'s `canvasViewport(ctx)` — and is required: the query pixel is a pointer\'s.');
    return Promise.resolve(0);
  }

  const target = o.target || _pickTarget(ctx);
  _V.set(ctx.V);
  _P.set(ctx.P);
  _Ppick.set(_P);
  mat4Pick(_Ppick, x, y, o.vp);

  const prevTarget = backend.bindTarget(ctx);
  const prevViewport = backend.setViewport(ctx);
  const prevState = backend.setState(ctx, { depth: true });
  const prevProg = ctx.prog;
  const prog = o.program || backend.imageProgram(ctx);
  const declares = _declares(ctx, prog);
  if (!declares.color && !_warned.has(prog)) {
    _warned.add(prog);
    console.error('[idiom] pick: the id program declares no `uColor`, so `paint(id)` sets no id.');
  }

  backend.bindTarget(ctx, target);
  backend.clear(ctx, [0, 0, 0, 1]);
  backend.setCamera(ctx, _V, _Ppick);
  ctx.prog = prog;
  if (declares.texture) backend.setUniforms(ctx, prog, { uUseTexture: 0 });
  const paint = (id) => {
    if (declares.color) backend.setUniforms(ctx, prog, { uColor: idToRgba(_rgba, id) });
  };
  let read = null;
  try {
    drawFn(paint);
    // a synchronous read has to happen while the pick target is still bound
    if (o.sync) read = backend.readPixels(ctx, target, 0, 0, 1, 1, { sync: true });
  } finally {
    backend.setCamera(ctx, _V, _P);
    backend.bindTarget(ctx, prevTarget);
    backend.setViewport(ctx, prevViewport);
    backend.setState(ctx, prevState);
    ctx.prog = prevProg;
  }
  return Promise.resolve(read || readPixel(ctx, target, 0, 0)).then((px) => rgbaToId(px[0], px[1], px[2]));
}
