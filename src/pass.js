/**
 * @file Passes — `program`, `fullscreen`, `filter`, `image`, `pipe`.
 * @module idiom/pass
 * @license AGPL-3.0-only
 *
 * Fullscreen passes over the context record: `program` compiles a fragment
 * shader into a pass program, `filter` runs one over the bound target, `image`
 * draws a texture, and `pipe` chains passes through two cached targets.
 *
 * ```
 * program(ctx, frag)                  // a pass program; vTexCoord in, the input by declaration
 * filter(ctx, prog, uniforms, input)  // run one pass
 * image(ctx, tex, opts)               // { x, y, width, height, tint, mask, blend }
 * pipe(ctx, source, passes, opts)     // the chain; releasePipe(ctx) frees its targets
 * ```
 *
 * @details
 * The pass-through vertex stage and the quad's attribute names (`aPosition`,
 * `aTexCoord`, `vTexCoord`) are the backend's: it compiles `program(ctx, frag)`
 * and creates the geometry `fullscreen(ctx)` returns. `filter` fills
 * `uResolution` (the current viewport) and `uTexelSize` ([1 / w, 1 / h] of the
 * input) only when the program declares them, and binds `input` to every
 * sampler the program declares and the bag leaves unset — so a stage names its
 * own input and a stage that reads no texture is handed none. `image` goes
 * through the backend's own flat program with a rect in target pixels, origin
 * bottom-left, default cover; orientation is settled at upload, so there is no
 * flip option. A value a verb uploads applies to its own draw, which follows at
 * once — a backend may batch the uploads until then.
 */

'use strict';

import { mat4FromTRS } from '@nakednous/tree';
import { renderTarget } from './target.js';

/** `image`'s `mask` for the red channel alone. */
export const RED = [true, false, false, false];
/** `image`'s `mask` for the green channel alone. */
export const GREEN = [false, true, false, false];
/** `image`'s `mask` for the blue channel alone. */
export const BLUE = [false, false, true, false];
/** `image`'s `mask` for the alpha channel alone. */
export const ALPHA = [false, false, false, true];
/** `image`'s `mask` for colour without alpha. */
export const RGB = [true, true, true, false];

/** `image`'s `blend`: src alpha over one-minus-src alpha. */
export const NORMAL = 'NORMAL';
/** `image`'s `blend`: one over one, additive. */
export const ADD = 'ADD';
/** `image`'s `blend`: dst colour over zero, multiplicative. */
export const MULTIPLY = 'MULTIPLY';

// Two triangles in NDC whose aTexCoord has v = 0 at the bottom; the backend's
// vertex stage and flat program are written to these names.
const QUAD = {
  aPosition: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, 1, 1] },
  aTexCoord: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 1, 1] },
  indices: [0, 1, 2, 2, 1, 3],
};

const WHITE = [1, 1, 1, 1];
const _rect = new Float32Array(16);
const _res = [0, 0];
const _texel = [0, 0];
const _values = {};   // filter's derived uniforms, reused per pass and consumed at its draw

/**
 * A fullscreen-pass program from a fragment shader alone: the backend supplies
 * the pass-through vertex stage, so a shader here is one stage, in the API's own
 * language.
 * @param {object} ctx  The context record.
 * @param {string} frag  The fragment source, `vTexCoord` in; the input by declaration.
 * @returns {object|null} The backend's program record, or null where it failed.
 * @example
 * const ctx = createContext(createFake().backend)
 * const gradient = program(ctx, 'frag source')
 * filter(ctx, gradient)
 */
export function program(ctx, frag) {
  return ctx.backend.createProgram(ctx, frag);
}

/**
 * The covering geometry: two triangles in NDC, aTexCoord with v = 0 at the
 * bottom. Created once per context and cached on the record.
 * @param {object} ctx  The context record.
 * @returns {object} The backend's buffer record.
 * @example
 * const ctx = createContext(createFake().backend)
 * const quad = fullscreen(ctx)   // aPosition, aTexCoord, indices
 */
export function fullscreen(ctx) {
  if (!ctx.quad) ctx.quad = ctx.backend.createBuffer(ctx, QUAD);
  return ctx.quad;
}

/** The uniform names a program declares, read once per program. */
function _declared(ctx, prog) {
  let names = ctx.uniforms.get(prog);
  if (names) return names;
  names = new Set(ctx.backend.uniformsOf(prog) || []);
  ctx.uniforms.set(prog, names);
  return names;
}

/** The sampler names a program declares, read once per program. */
function _samplers(ctx, prog) {
  let names = ctx.samplers.get(prog);
  if (names) return names;
  names = ctx.backend.samplersOf(prog) || [];
  ctx.samplers.set(prog, names);
  return names;
}

/**
 * Run a fullscreen pass over the bound target. `uResolution` and `uTexelSize`
 * are filled when the program declares them, and `input` is bound to every
 * sampler the program declares that `uniforms` does not set.
 * @details The depth test is off for the pass and restored after; the pass
 * binds its program, uploads the bag, then the input and the two derived
 * uniforms, then draws the covering geometry. The bag wins wherever it sets a
 * name, so a second texture (`uDepth`, `uHistory`) travels in the bag.
 * @param {object} ctx  The context record.
 * @param {object} prog  A pass program from program(ctx, frag).
 * @param {object} [uniforms]  The pass's bag, by name; `null` when it has none.
 * @param {object} [input]  The image filtered: a texture, or a target (its
 *        `.color`). `uTexelSize` is its texel size, or — where the argument is
 *        absent — the bag's `uSource`.
 * @returns {object|null} The program bound, or null where nothing was drawn: a
 *        `program(ctx, frag)` that failed to compile is null, and a pass handed
 *        one runs nothing rather than half of something.
 * @example
 * const ctx = createContext(createFake().backend)
 * const scene = renderTarget(ctx)
 * filter(ctx, program(ctx, frag), null, scene)   // uScene takes the target's colour texture
 */
export function filter(ctx, prog, uniforms, input) {
  if (!prog) return null;
  const backend = ctx.backend;
  const prior = backend.setState(ctx, { depth: false });
  const tex = input && typeof input === 'object' && input.color ? input.color : input;
  backend.setUniforms(ctx, prog, uniforms);
  const values = _values;
  for (const name in values) delete values[name];
  let filled = false;
  for (const name of _samplers(ctx, prog)) {
    if (uniforms && uniforms[name] !== undefined) continue;      // the bag's own value wins
    if (tex) { values[name] = tex; filled = true; }
    else if (!ctx.warned.has(prog)) {
      ctx.warned.add(prog);
      console.error('[idiom] filter: the program declares the sampler `' + name +
        '` and neither `uniforms` nor `input` sets it — it reads whatever texture unit it holds.');
    }
  }
  const declared = _declared(ctx, prog);
  if (declared.has('uResolution') || declared.has('uTexelSize')) {
    const vp = backend.setViewport(ctx);
    if (declared.has('uResolution')) { _res[0] = vp[2]; _res[1] = vp[3]; values.uResolution = _res; filled = true; }
    if (declared.has('uTexelSize')) {
      const src = tex || (uniforms && uniforms.uSource);
      const size = (src && ctx.sizes.get(src)) || null;
      _texel[0] = 1 / (size ? size[0] : vp[2]); _texel[1] = 1 / (size ? size[1] : vp[3]);
      values.uTexelSize = _texel; filled = true;
    }
  }
  if (filled) backend.setUniforms(ctx, prog, values);
  ctx.prog = prog;
  backend.draw(ctx, prog, fullscreen(ctx));
  backend.setState(ctx, prior);
  return prog;
}

/**
 * The matrix taking the fullscreen quad ([−1, 1]²) to a pixel rect of the
 * viewport, in NDC.
 * @param {Float32Array} out  16 elements.
 * @param {number} x  The rect's left, target px.
 * @param {number} y  The rect's bottom, target px.
 * @param {number} w  The rect's width.
 * @param {number} h  The rect's height.
 * @param {number} vw  The viewport width.
 * @param {number} vh  The viewport height.
 * @returns {Float32Array} out
 * @ignore
 */
export function rectMatrix(out, x, y, w, h, vw, vh) {
  const x0 = 2 * x / vw - 1, x1 = 2 * (x + w) / vw - 1;
  const y0 = 2 * y / vh - 1, y1 = 2 * (y + h) / vh - 1;
  return mat4FromTRS(out, (x0 + x1) / 2, (y0 + y1) / 2, 0, 0, 0, 0, 1, (x1 - x0) / 2, (y1 - y0) / 2, 1);
}

/**
 * Draw a texture to the bound target as an image.
 * @details The backend's flat program draws the covering quad under a matrix
 * that puts it on the rect; the depth test is off, the mask and the blend are
 * the ones asked for, and each is the context's again afterwards. The rect is
 * in target pixels, origin bottom-left; no flip option — orientation is settled
 * at upload.
 * @param {object} ctx  The context record.
 * @param {object} tex  The texture to draw.
 * @param {{ x?:number, y?:number, width?:number, height?:number, tint?:number[],
 *           mask?:boolean[], blend?:string }} [opts]
 *        The rect (default: cover), a tint multiplier (default white), a
 *        colorMask (RED, …), a blend (NORMAL · ADD · MULTIPLY; default: the
 *        state as it is).
 * @example
 * const ctx = createContext(createFake().backend)
 * const scene = renderTarget(ctx)
 * image(ctx, scene.color, { x: 20, y: 20, width: 160, height: 120 })
 */
export function image(ctx, tex, opts) {
  const o = opts || {};
  const backend = ctx.backend;
  const vp = backend.setViewport(ctx);
  const x = o.x || 0, y = o.y || 0, w = o.width || vp[2], h = o.height || vp[3];
  const state = { depth: false };
  if (o.mask) state.mask = o.mask;
  if (o.blend) state.blend = o.blend;
  const prior = backend.setState(ctx, state);
  const prog = backend.imageProgram(ctx);
  if (!prog) return;
  backend.setUniforms(ctx, prog, {
    uTexture: tex,
    uUseTexture: true,
    uColor: o.tint || WHITE,
    uModelViewProjectionMatrix: rectMatrix(_rect, x, y, w, h, vp[2], vp[3]),
  });
  ctx.prog = prog;
  backend.draw(ctx, prog, fullscreen(ctx));
  backend.setState(ctx, prior);
}

/**
 * A pipe pass entry: a program, or { program, uniforms } for per-pass uniforms.
 * @param {object} entry
 * @returns {{ program:object, uniforms:object|null }|null}
 * @ignore
 */
export function passOf(entry) {
  if (!entry) return null;
  if (entry.uniforms !== undefined) return entry.program ? { program: entry.program, uniforms: entry.uniforms } : null;
  if (entry.program) return { program: entry, uniforms: null };
  return null;
}

/** Clear the bound target to black — pipe's default clear, over the backend. */
const _clearBlack = (ctx) => { ctx.backend.clear(ctx, [0, 0, 0, 1]); };

/**
 * Run a source through a chain of fullscreen passes and show the result on the
 * bound target.
 * @details Ping-pongs between two targets cached under `key`; the binding and
 * the viewport the chain found are its own again afterwards.
 * @param {object} ctx  The context record.
 * @param {object} source  A texture, or a target (its .color).
 * @param {object|object[]} passes  One pass or an array; each a program from
 *        program(ctx, frag) or { program, uniforms }; falsy entries skipped.
 * @param {{ display?:boolean, allocate?:boolean, key?:string, ping?:object, pong?:object,
 *           clear?:boolean, clearFn?:function, clearDisplay?:boolean,
 *           clearDisplayFn?:function, draw?:function }} [opts]
 *        display (default true): image the result onto the bound target.
 *        allocate (default true): make the keyed ping / pong when missing. key
 *        (default 'default'): the cached pair. ping / pong: your own targets,
 *        never cached. clear / clearFn(ctx): clear a working target before its
 *        pass (default black). clearDisplay / clearDisplayFn(ctx): the same for
 *        the display. draw(ctx, tex, pass): how a pass renders its input
 *        (default: filter with the chain's texture as the pass's input).
 * @returns {object|null} The target holding the result, or null without passes.
 * @example
 * const ctx = createContext(createFake().backend)
 * const scene = renderTarget(ctx)
 * pipe(ctx, scene, [{ program: pixelate, uniforms: { uCells: 20 } }, invert])
 */
export function pipe(ctx, source, passes, opts) {
  const backend = ctx.backend;
  const o = opts || {};
  const list = (Array.isArray(passes) ? passes : [passes]).map(passOf).filter(Boolean);
  const display = o.display ?? true;
  const allocate = o.allocate ?? true;
  const key = o.key ?? 'default';
  const clearFn = typeof o.clearFn === 'function' ? o.clearFn : _clearBlack;
  const clearDisplayFn = typeof o.clearDisplayFn === 'function' ? o.clearDisplayFn : clearFn;
  const drawPass = typeof o.draw === 'function' ? o.draw : (c, tex, pass) => filter(c, pass.program, pass.uniforms, tex);
  if (source && typeof source.resolve === 'function') source.resolve();   // a multisampled target fills its textures first
  const srcTex = source && source.color ? source.color : source;
  const vp = backend.setViewport(ctx);
  const outer = backend.bindTarget(ctx);
  const restore = () => { backend.bindTarget(ctx, outer); backend.setViewport(ctx, vp); };

  if (!list.length) {
    if (display && srcTex) { if (o.clearDisplay ?? true) clearDisplayFn(ctx); image(ctx, srcTex); }
    return null;
  }
  const size = (source && source.width) ? [source.width, source.height] : (ctx.sizes.get(srcTex) || [vp[2], vp[3]]);
  const hasPing = Object.prototype.hasOwnProperty.call(o, 'ping');
  const hasPong = Object.prototype.hasOwnProperty.call(o, 'pong');
  const store = ctx.pipes[key] || (ctx.pipes[key] = {});
  let ping = hasPing ? o.ping : store.ping;
  let pong = hasPong ? o.pong : store.pong;
  if (allocate) {
    if (!ping && !hasPing) ping = renderTarget(ctx, { width: size[0], height: size[1], depth: false });
    if (!pong && !hasPong) pong = renderTarget(ctx, { width: size[0], height: size[1], depth: false });
    if (!hasPing) store.ping = ping;
    if (!hasPong) store.pong = pong;
  }
  if (!ping || !pong) {
    if (display && srcTex) { restore(); if (o.clearDisplay ?? true) clearDisplayFn(ctx); drawPass(ctx, srcTex, list[0]); }
    return null;
  }
  for (const t of [ping, pong]) if (t.width !== size[0] || t.height !== size[1]) t.resize(size[0], size[1]);

  let readTex = srcTex, out = null;
  for (let i = 0; i < list.length; i++) {
    const dst = i % 2 === 0 ? ping : pong;
    backend.bindTarget(ctx, dst);
    if (o.clear ?? true) clearFn(ctx);
    drawPass(ctx, readTex, list[i]);
    readTex = dst.color;
    out = dst;
  }
  restore();
  if (display && readTex) { if (o.clearDisplay ?? true) clearDisplayFn(ctx); image(ctx, readTex); }
  return out;
}

/**
 * Free the targets pipe cached: the default pair, a named key, or every pair
 * with true. Targets you supplied yourself are left alone.
 * @param {object} ctx  The context record.
 * @param {string|boolean} [key]
 * @example
 * const ctx = createContext(createFake().backend)
 * pipe(ctx, renderTarget(ctx), pixelate, { key: 'fx' })
 * releasePipe(ctx, 'fx')
 */
export function releasePipe(ctx, key) {
  const free = (k) => {
    const pair = ctx.pipes[k];
    if (!pair) return;
    if (pair.ping) pair.ping.dispose();
    if (pair.pong) pair.pong.dispose();
    delete ctx.pipes[k];
  };
  if (key === true) { for (const k of Object.keys(ctx.pipes)) free(k); return; }
  free(typeof key === 'string' ? key : 'default');
}
