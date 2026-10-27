/**
 * @file The line pipe — a gizmo's cached arrays, the wide line's expansion, the
 *       HUD's ortho, and the draw the backend performs.
 * @module idiom/pipe
 * @license AGPL-3.0-only
 *
 * A gizmo is a tree generator's output drawn immediately: the generators write
 * into arrays the layer keeps per name per context, the geometry is re-uploaded
 * in place each frame, and the draw is the backend's (§7 #113's slot rule).
 *
 * ```
 * const g = gizmo(ctx, 'axes', { color: true })     // one cache a context, per name
 * fill(ctx, g, (a) => tree.axesLines(a, { size: 100 }))   // run a generator, grow, re-upload
 * beginHUD(ctx, { vp }) · endHUD(ctx)               // an ortho over the viewport, logical pixels
 * drawLines(ctx, g, { M, color, width, depth, dpr })      // the backend's programs and draws
 * drawLines(ctx, g, { M, identify })                // and the labels it places, handed to a sink
 * ```
 *
 * **The width.** `width` counts logical pixels — a hero's number, independent of
 * the display — and `dpr` is the ratio the bridge states, so `width * dpr` is the
 * device pixels a wide line's quads are built for. At or below one device pixel
 * the line list itself draws (`lineProgram`); above it, each segment expands into
 * a screen-space quad (`wideLineProgram`), four vertices and six indices a
 * segment, the generators untouched.
 *
 * **The HUD.** `beginHUD` saves the installed camera and the depth state, and
 * installs an orthographic projection over the viewport `opts.vp` names — the
 * bridge's space mapping, in logical pixels, y down — with an identity view.
 * `endHUD` restores both. A gizmo that takes a screen position runs inside the
 * pair; `inHUD` wraps one call so a figure need not nest them.
 *
 * **Labels.** A generator may write anchors into `arrays.labels` — `{ x, y, z,
 * text }` in the frame the draw is in — and a draw that is handed `opts.identify`
 * hands each of them out as `identify(id, text, x, y, z)`: the anchor already in
 * world space, under the draw's own model matrix, and the id `<cache name>:<index>`,
 * stated once here so both bridges' labels answer the same names a frame. The
 * layer never learns what a label is: it forwards, and the bridge wires the sink
 * to its DOM. The items are the cache's, rewritten a draw, and they travel to the
 * backend on the draw's spec (`spec.labels`, `spec.identify`), so a label is
 * emitted by the draw that places it (§7 #130).
 *
 * **What the backend draws.** The programs are the backend's (`lineProgram`,
 * `wideLineProgram`, `paneProgram`) because their shader sources are per API, and
 * so is the draw: `drawGizmo(ctx, kind, geometry, spec)` translates the layer's
 * semantic spec — model matrix, colour, whether the arrays carry colour, the
 * width in device pixels, the viewport, a texture, the depth, a partial count —
 * into its own uniforms, its own topology and its own state (§7 #126).
 */

'use strict';

import { WEBGL, capacityOf, createArrays, growArrays, mat4MulPoint, mat4Ortho } from '@nakednous/tree';
import { buffer, writeBuffer } from './draw.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const WHITE = [1, 1, 1, 1];
const _P = new Float32Array(16);
const _vp = [0, 0, 0, 0];
const _anchor = [0, 0, 0];

/**
 * A gizmo's cache for one context: its arrays, its geometry, the wide cache.
 * @details The cache's `name` is also its labels' namespace — an id is
 * `<name>:<index>` — so a subject that labels its items is a cache of its own.
 * @param {object} ctx  The context record.
 * @param {string} name  The gizmo's name — one cache a name a context.
 * @param {{ color?:boolean, texcoord?:boolean, labels?:boolean }} [opts]  The attributes its generator writes.
 * @returns {object} The cache entry: `{ name, arrays, buffer, capacity, wide }`.
 * @example
 * const g = gizmo(ctx, 'grid', { color: true })
 */
export function gizmo(ctx, name, opts) {
  if (!ctx.gizmos) ctx.gizmos = Object.create(null);
  let g = ctx.gizmos[name];
  if (!g) {
    g = { name, arrays: createArrays(64, opts), buffer: null, capacity: 0, wide: null, ids: null, placed: null };
    ctx.gizmos[name] = g;
  }
  return g;
}

/** The arrays shape a cache's geometry uploads, under the draw policy's attribute names. @ignore */
function _arraysOf(g) {
  const a = { aPosition: g.arrays.position };
  if (g.arrays.color) a.aColor = g.arrays.color;
  if (g.arrays.texcoord) a.aTexCoord = g.arrays.texcoord;
  return a;
}

/**
 * Run a generator into a cache, growing it when the count outruns the capacity,
 * and (re)upload the geometry — a rebuild when the capacity changed, an in-place
 * write otherwise, so a gizmo allocates nothing once warm.
 *
 * `opts` are the backend's creation options, and they are what makes a cache
 * usable by a backend whose pipelines bake their vertex layout: `{ program }`
 * states the program the geometry must match, `{ interleave: false }` one buffer
 * an attribute, `{ stream: true }` a geometry written a draw (a WebGPU stream's
 * slot, whose write and draw have to agree — the backend's business, §7 #127).
 * They are remembered on the cache, so a rebuild after growth keeps them.
 * @param {object} ctx  The context record.
 * @param {object} g  A cache entry from `gizmo`.
 * @param {function(object):number} gen  `gen(arrays)` writes and returns the vertex count.
 * @param {object} [opts]  The backend's creation options; the cache's own where omitted.
 * @returns {number} The vertices written.
 * @example
 * fill(ctx, g, (a) => tree.gridLines(a, { size: 100 }))
 * fill(ctx, g, (a) => tree.axesLines(a, { size: 100 }), { program: lineProg, stream: true })
 */
export function fill(ctx, g, gen, opts) {
  if (opts) g.opts = opts;
  const creation = opts || g.opts;
  let n = gen(g.arrays);
  if (n > capacityOf(g.arrays)) { growArrays(g.arrays, n); gen(g.arrays); }
  if (!g.buffer || g.capacity !== capacityOf(g.arrays)) {
    g.buffer = buffer(ctx, _arraysOf(g), creation);
    g.capacity = capacityOf(g.arrays);
  } else if (g.arrays.count > 0) {
    writeBuffer(ctx, g.buffer, _arraysOf(g));
  }
  return g.arrays.count;
}

/**
 * Expand a line list into the wide line's quads: four vertices a segment — both
 * endpoints, which end each sits at, its side, and the endpoint's colour where
 * the arrays carry one — and six indices. Cached beside the raw geometry, grown
 * like it; the indices are built once a capacity.
 * @param {object} ctx  The context record.
 * @param {object} g  A cache entry whose line list is filled.
 * @returns {{ buffer:object, segments:number }} The wide cache's geometry and its segment count.
 */
export function expand(ctx, g) {
  const segs = (g.arrays.count / 2) | 0;
  let w = g.wide;
  if (!w || w.capacity < segs) {
    const cap = Math.max(segs, w ? w.capacity * 2 : 16);
    w = {
      A: new Float32Array(12 * cap), B: new Float32Array(12 * cap),
      T: new Float32Array(4 * cap), S: new Float32Array(4 * cap),
      color: g.arrays.color ? new Float32Array(16 * cap) : null,
      indices: new Uint32Array(6 * cap), buffer: null, capacity: cap, segments: 0,
    };
    for (let i = 0; i < cap; i++) {
      const v = 4 * i;
      w.T[v] = 0; w.T[v + 1] = 0; w.T[v + 2] = 1; w.T[v + 3] = 1;
      w.S[v] = -1; w.S[v + 1] = 1; w.S[v + 2] = -1; w.S[v + 3] = 1;
      const k = 6 * i;
      w.indices[k] = v; w.indices[k + 1] = v + 1; w.indices[k + 2] = v + 2;
      w.indices[k + 3] = v + 1; w.indices[k + 4] = v + 3; w.indices[k + 5] = v + 2;
    }
    g.wide = w;
  }
  const p = g.arrays.position.data, c = g.arrays.color ? g.arrays.color.data : null;
  for (let i = 0; i < segs; i++) {
    const a = 6 * i, b = a + 3;
    for (let v = 0; v < 4; v++) {
      const o = 12 * i + 3 * v;
      w.A[o] = p[a]; w.A[o + 1] = p[a + 1]; w.A[o + 2] = p[a + 2];
      w.B[o] = p[b]; w.B[o + 1] = p[b + 1]; w.B[o + 2] = p[b + 2];
      if (c) {
        // a colour is four floats a vertex, where a position is three: the vertex's
        // index, not the position's offset, is what the colour array is read at
        const q = 16 * i + 4 * v, src = 8 * i + (v < 2 ? 0 : 4);
        w.color[q] = c[src]; w.color[q + 1] = c[src + 1]; w.color[q + 2] = c[src + 2]; w.color[q + 3] = c[src + 3];
      }
    }
  }
  const specs = {
    aA: { numComponents: 3, data: w.A }, aB: { numComponents: 3, data: w.B },
    aT: { numComponents: 1, data: w.T }, aSide: { numComponents: 1, data: w.S },
    indices: { numComponents: 3, data: w.indices },
  };
  if (w.color) specs.aColor = { numComponents: 4, data: w.color };
  const moves = { aA: specs.aA, aB: specs.aB };
  if (w.color) moves.aColor = specs.aColor;
  if (!w.buffer) w.buffer = buffer(ctx, specs, g.opts && g.opts.wide);
  else if (segs > 0) writeBuffer(ctx, w.buffer, moves);
  w.segments = segs;
  return { buffer: w.buffer, segments: segs };
}

/**
 * Resolve a filled cache's labelled items for one draw: each label's id, the
 * cache's name and the label's index, and its anchor taken to world space under
 * `M`. The items belong to the cache and are rewritten a draw, so a sink copies
 * what it keeps; nothing is allocated once the cache is warm.
 * @param {object} g  A cache entry whose generator writes labels.
 * @param {ArrayLike<number|null} [M]  The draw's model matrix, or null for the identity.
 * @returns {object[]|null} The items, or null where the cache carries no labels.
 * @ignore
 */
function _placeLabels(g, M) {
  const src = g.arrays && g.arrays.labels;
  if (!src || !src.length) return null;
  const out = g.placed || (g.placed = []);
  const ids = g.ids || (g.ids = []);
  out.length = src.length;
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    let item = out[i];
    if (!item) item = out[i] = { id: '', text: '', x: 0, y: 0, z: 0 };
    if (M) {
      mat4MulPoint(_anchor, M, l.x, l.y, l.z);
      item.x = _anchor[0]; item.y = _anchor[1]; item.z = _anchor[2];
    } else {
      item.x = l.x; item.y = l.y; item.z = l.z;
    }
    item.text = l.text;
    item.id = ids[i] || (ids[i] = g.name + ':' + i);
  }
  return out;
}

/**
 * Draw a filled cache as lines under `opts.M` — the raw list at or below one
 * device pixel of width, the expanded quads above it. The backend picks the
 * program and translates the spec; the depth test is off for `depth: false` and
 * restored after.
 * @details The quads are measured in the viewport the width's device pixels are
 * in, so a caller states `vp` only where it draws into a sub-viewport; the
 * backend's own viewport is the default, and the HUD's logical one is not the
 * same space.
 *
 * `opts.identify` is a sink, and the draw places the labels it filled: each is
 * handed to it as `identify(id, text, x, y, z)`, the anchor in world space and
 * the id `<cache name>:<index>` (§7 #130).
 * @param {object} ctx  The context record.
 * @param {object} g  A cache entry, filled.
 * @param {{ M?:ArrayLike<number>, color?:number[], width?:number, depth?:boolean, dpr?:number,
 *           vp?:number[], identify?:function }} [opts]
 * @returns {object|null} The backend's answer, or null where nothing was drawn.
 * @example
 * fill(ctx, g, (a) => tree.axesLines(a, { size: 100 }))
 * drawLines(ctx, g, { width: 2, dpr: 2, identify: (id, text, x, y, z) => console.log(id, text) })
 */
export function drawLines(ctx, g, opts) {
  if (!ctx || !ctx.backend || !g || !g.arrays || !g.arrays.count) return null;
  const o = opts || {};
  const identify = typeof o.identify === 'function' ? o.identify : null;
  const labels = identify ? _placeLabels(g, o.M) : null;
  const px = (typeof o.width === 'number' ? o.width : 1) * (typeof o.dpr === 'number' ? o.dpr : 1);
  const wide = px > 1;
  if (wide) {
    const w = expand(ctx, g);
    return ctx.backend.drawGizmo(ctx, 'wide', w.buffer, {
      M: o.M || IDENTITY, color: o.color || WHITE, useColor: !!g.arrays.color,
      width: px, vp: o.vp || null, depth: o.depth !== false, count: 6 * w.segments,
      labels, identify,
    });
  }
  return ctx.backend.drawGizmo(ctx, 'line', g.buffer, {
    M: o.M || IDENTITY, color: o.color || WHITE, useColor: !!g.arrays.color,
    depth: o.depth !== false, count: g.arrays.count,
    labels, identify,
  });
}

/**
 * Draw a filled cache as triangles through the backend's pane program.
 * @details The draw counts the cache's own vertices — a geometry is sized to the
 * cache's capacity, and a pane writes six of it — so a backend that takes the
 * geometry's element count draws the shape, not the room it has.
 * @param {object} ctx  The context record.
 * @param {object} g  A cache entry with texcoords, filled.
 * @param {{ M?:ArrayLike<number>, color?:number[], texture?:object, depth?:boolean }} [opts]
 * @returns {object|null} The backend's answer.
 * @example
 * drawPane(ctx, g, { texture: tex })
 */
export function drawPane(ctx, g, opts) {
  if (!ctx || !ctx.backend || !g || !g.arrays || !g.arrays.count) return null;
  const o = opts || {};
  return ctx.backend.drawGizmo(ctx, 'pane', g.buffer, {
    M: o.M || IDENTITY, color: o.color || WHITE, texture: o.texture || null, depth: o.depth !== false,
    count: g.arrays.count,
  });
}

/**
 * Begin HUD mode: save the camera and the depth state, install an orthographic
 * projection over `opts.vp` — the bridge's viewport, logical pixels, y down — with
 * an identity view, and turn the depth test off.
 * @param {object} ctx  The context record.
 * @param {{ vp:number[] }} opts  `vp` is `[x, y, w, h]`, signed, in logical pixels.
 * @returns {object|null} The saved HUD state, or null where it was already on.
 * @example
 * beginHUD(ctx, { vp: canvasViewport(ctx) })
 * cross(ctx, { x: 200, y: 150, size: 40 })
 * endHUD(ctx)
 */
export function beginHUD(ctx, opts) {
  if (!ctx || !ctx.backend) return null;
  if (ctx.hud) return null;
  const vp = opts && opts.vp;
  if (!vp) {
    console.error('[idiom] beginHUD: `opts.vp` is the viewport in logical pixels — a bridge\'s `canvasViewport(ctx)` — and is required.');
    return null;
  }
  ctx.hud = { V: new Float32Array(ctx.V), P: new Float32Array(ctx.P), depth: ctx.backend.setState(ctx) };
  ctx.backend.setState(ctx, { depth: false });
  _vp[0] = vp[0]; _vp[1] = vp[1]; _vp[2] = vp[2]; _vp[3] = vp[3];
  const P = mat4Ortho(_P, vp[0], vp[0] + vp[2], vp[1], vp[1] + vp[3], -1, 1, ctx.backend.ndcZMin);
  ctx.backend.setCamera(ctx, IDENTITY, P);
  return ctx.hud;
}

/**
 * End HUD mode: the camera and the depth state come back.
 * @param {object} ctx  The context record.
 * @returns {object|null} The camera it restored, or null where HUD mode was off.
 * @example
 * endHUD(ctx)
 */
export function endHUD(ctx) {
  if (!ctx || !ctx.backend || !ctx.hud) return null;
  const hud = ctx.hud;
  ctx.backend.setCamera(ctx, hud.V, hud.P);
  ctx.backend.setState(ctx, hud.depth);
  ctx.hud = null;
  return ctx;
}

/**
 * Run `fn` inside HUD mode, wrapping it only where HUD mode is not already on.
 * @param {object} ctx  The context record.
 * @param {{ vp:number[] }} opts  As `beginHUD` takes them.
 * @param {function():any} fn  The draw.
 * @returns {any} `fn`'s answer.
 * @example
 * inHUD(ctx, { vp }, () => cross(ctx, { x: 40, y: 40 }))
 */
export function inHUD(ctx, opts, fn) {
  const wrap = !ctx.hud;
  if (wrap) beginHUD(ctx, opts);
  try {
    return fn();
  } finally {
    if (wrap) endHUD(ctx);
  }
}

/** The ortho projection the HUD installs, for a caller that builds its own. @ignore */
export function hudProjection(out, vp, ndcZMin) {
  return mat4Ortho(out, vp[0], vp[0] + vp[2], vp[1], vp[1] + vp[3], -1, 1, ndcZMin === undefined ? WEBGL : ndcZMin);
}
