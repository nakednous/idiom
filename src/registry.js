/**
 * @file The context record — the layer's own state for one GPU context, keyed by
 * the bridge that made it.
 * @module idiom/registry
 * @license AGPL-3.0-only
 *
 * A bridge owns the map from its handle (`gl`, a device) to a record of its
 * own, and that record nests this layer's. Nothing here holds the handle: a
 * verb takes the record, so a key never reaches `idiom` and a bridged context
 * stays the bridge's.
 *
 * ```
 * const ctx = createContext(backend)   // once, in the bridge's own registry
 * renderTarget(ctx, { width: 256 })    // every composite verb takes ctx
 * disposeContext(ctx)                  // the bridge's dispose calls this first
 * ```
 *
 * The record holds the layer's bookkeeping, not API objects: the targets it
 * made, the `pipe` pairs it cached, the fullscreen geometry, the declared
 * uniform and sampler names of each program, the texture sizes `uTexelSize`
 * reads, the program a bind left bound, and the camera the backend's
 * `setCamera` installs. The API objects belong to the backend and are freed
 * through it.
 */

'use strict';

import { checkBackend } from './interface.js';

/** A mat4 set to the identity, in place. */
const _identity = (m) => {
  m.fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

/**
 * The context record for one backend.
 * @details The camera fields are the contract's: `setCamera` states `V`, `P`
 * and `P · V` on the record, and the draw policy reads them; `MV`, `MVP` and
 * `N` are the layer's scratch, written in place, so a draw allocates nothing.
 * They start as the identity, so a draw before any camera is installed reads a
 * defined record.
 * @param {object} backend  A backend implementing the interface.
 * @returns {object} The record every composite verb takes.
 * @example
 * const { backend } = createFake()
 * const ctx = createContext(backend)
 */
export function createContext(backend) {
  const missing = checkBackend(backend);
  for (const message of missing) console.error('[idiom] createContext: ' + message);
  return {
    backend,
    targets: new Set(),             // every target made here, in creation order
    pipes: Object.create(null),     // key → { ping, pong }, pipe's cached pairs
    sizes: new WeakMap(),           // texture → [width, height], for uTexelSize
    quad: null,                     // the fullscreen geometry, made on first use
    uniforms: new WeakMap(),        // program → Set of the uniform names it declares
    samplers: new WeakMap(),        // program → the sampler names it declares
    warned: new WeakSet(),          // programs whose unset sampler was logged
    prog: null,                     // the program a bind left bound
    V: _identity(new Float32Array(16)),    // the installed view
    P: _identity(new Float32Array(16)),    // the installed projection
    PV: _identity(new Float32Array(16)),   // P · V, for a draw with no model matrix
    MV: new Float32Array(16),              // scratch: V · M
    MVP: new Float32Array(16),             // scratch: P · V · M
    N: new Float32Array(9),                // scratch: (V · M)⁻ᵀ, three columns
    disposed: false,
  };
}

/**
 * Free this layer's part of a context: every target it made, the pipes it
 * cached, the fullscreen geometry and the backend's own objects. A bridge calls
 * this before it frees its own, so a composite never outlives the record it
 * takes.
 * @param {object} ctx  The context record.
 * @example
 * const ctx = createContext(createFake().backend)
 * renderTarget(ctx).dispose()
 * disposeContext(ctx)
 */
export function disposeContext(ctx) {
  if (!ctx || ctx.disposed) return;
  ctx.disposed = true;
  for (const target of [...ctx.targets]) {
    if (typeof target.dispose === 'function') target.dispose();
  }
  ctx.targets.clear();
  ctx.pipes = Object.create(null);
  ctx.backend.dispose(ctx);
  ctx.quad = null;
  ctx.prog = null;
}
