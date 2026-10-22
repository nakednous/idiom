/**
 * @file State — `state(ctx, opts)`: a target pair holding one value across
 * frames.
 * @module idiom/state
 * @license AGPL-3.0-only
 *
 * `pipe` is a pure function of its source: an image chain, each working target
 * cleared before its pass, the pair alternated inside the call. A state is not
 * that — the pair's contents *are* the data. `state(ctx, opts)` owns two render
 * targets, hands out the side the last pass wrote and the side the next one
 * writes, and runs a fullscreen pass from one into the other:
 *
 * ```
 * const mean = state(ctx, { width: 256, height: 192, format: token })
 * mean.pass(accum, { uWeight: 1 / (mean.count + 1) })   // read → write, then swap
 * image(ctx, mean.read.color)                           // the value, shown
 * ```
 *
 * `state()` clears both sides once, when it makes them: fresh storage is
 * undefined, and the first pass would otherwise read a history that is not
 * there. After that nothing is cleared but by `reset()` — the pair holds the
 * value, and a clear would zero the data. `reset()` also zeroes the count the
 * blend's weight is made of. A pass that draws *geometry* into the state binds
 * `.write` itself and calls `swap()`; a pass that reads the state while writing
 * elsewhere — a caustics map, a display — reads `.read.color` as a plain
 * texture.
 */

'use strict';

import { renderTarget } from './target.js';
import { filter } from './pass.js';

const ZERO = [0, 0, 0, 0];

/**
 * A pair of render targets holding one value across frames: `.read` is the side
 * the last pass wrote, `.write` the side the next one writes, and `pass` runs a
 * fullscreen pass from the first into the second and swaps them.
 * @details The caller owns the object — a simulation is held, not re-run per
 * frame — and the pair starts *defined*: `state()` resets it once as it makes
 * it, so the first pass never reads storage nothing has written. Nothing is
 * cleared after that except by `reset()`: the pair's contents are the data.
 * `pass` restores the target and the viewport it found, so a pass or a reset
 * fired from a panel or a pointer callback cannot leave the frame drawing into
 * the state.
 * @param {object} ctx  The context record.
 * @param {{ width?:number, height?:number, format?:*, float?:boolean,
 *           minMag?:*, wrap?:*, clear?:number[] }} [opts]
 *        `renderTarget`'s sampling and format options, and only those: one
 *        colour texture per side, no depth, no multisampling. `clear` is the
 *        colour `reset()` clears both sides to (default transparent black).
 * @returns {object} The state: `read` · `write` · `count` — read-only, because
 *        a pair and a counter that can be assigned apart are the drift this
 *        verb exists to prevent — and `pass(prog, uniforms)` · `swap()` ·
 *        `reset()` · `resize(w, h)` · `dispose()`.
 * @example
 * const ctx = createContext(createFake().backend)
 * const mean = state(ctx, { width: 256, height: 192 })
 * mean.pass(accum, { uWeight: 1 / (mean.count + 1) })
 * image(ctx, mean.read.color)
 */
export function state(ctx, opts) {
  const o = opts || {};
  const clear = o.clear || ZERO;
  // one colour texture per side: renderTarget's sampling and format options only
  const spec = { width: o.width, height: o.height, format: o.format, float: o.float, minMag: o.minMag, wrap: o.wrap };
  const A = renderTarget(ctx, spec);
  const B = renderTarget(ctx, spec);
  const backend = ctx.backend;

  let read = A, write = B, count = 0;

  const pair = {
    /**
     * Run a fullscreen pass from the read side into the write side, then swap.
     * A program that did not bind — `program(ctx, frag)` returns null on a
     * compile error — draws nothing, and then neither the pair nor the count
     * moves: the frame is not advanced by a pass that did not run.
     * @param {object} prog  A pass program from program(ctx, frag).
     * @param {object} [uniforms]  The pass's bag, by name.
     * @returns {object} The state.
     */
    pass(prog, uniforms) {
      const vp = backend.setViewport(ctx);
      const outer = backend.bindTarget(ctx, write);            // the write side, and the viewport it sets
      const ran = filter(ctx, prog, uniforms, read.color);     // the input is the read side, by declaration
      if (ran) {                                               // a pass that did not run is not one:
        const t = read; read = write; write = t;               // the pair and the count stay where they were
        count += 1;
      }
      backend.bindTarget(ctx, outer);
      backend.setViewport(ctx, vp);
      return pair;
    },
    /**
     * Exchange the two sides on your own terms — what a pass that draws geometry
     * into the state calls after binding `.write` itself. The count is a pass's,
     * so this leaves it alone.
     * @returns {object} The state.
     */
    swap() {
      const t = read; read = write; write = t;
      return pair;
    },
    /**
     * Clear both sides to the state's own colour and zero the count — what
     * `state()` itself runs as it makes the pair, so a state always starts
     * defined, and what a figure's own reset calls when the value is a value *of*
     * something that has changed. The context's clear colour and its bound
     * target are its own again afterwards.
     * @returns {object} The state.
     */
    reset() {
      const vp = backend.setViewport(ctx);
      const outer = backend.bindTarget(ctx);
      for (const t of [A, B]) { backend.bindTarget(ctx, t); backend.clear(ctx, clear); }
      backend.bindTarget(ctx, outer);
      backend.setViewport(ctx, vp);
      count = 0;
      return pair;
    },
    /**
     * Resize both sides, zero the count and clear them — the frames a mean was
     * taken of were taken at another size, and reallocated storage is as
     * undefined as new storage: the pair starts defined for the same reason a
     * fresh state does.
     * @param {number} width
     * @param {number} height
     * @returns {object} The state.
     */
    resize(width, height) {
      A.resize(width, height);
      B.resize(width, height);
      pair.reset();          // zeroes the count too
      return pair;
    },
    /**
     * Delete both sides' attachments and framebuffers.
     * @returns {object} The state.
     */
    dispose() {
      A.dispose();
      B.dispose();
      return pair;
    },
  };

  // read, write and count are the verb's: the swap is pass's, and a count that
  // could be assigned beside the pair is exactly the drift this verb prevents
  Object.defineProperties(pair, {
    read: { get: () => read, enumerable: true },
    write: { get: () => write, enumerable: true },
    count: { get: () => count, enumerable: true },
  });

  // a defined start: the pair is cleared as it is made, so the first pass reads a
  // history that exists (zero) rather than storage the driver has not written
  pair.reset();
  return pair;
}
