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
 * reads, and the program it bound last. The API objects belong to the backend
 * and are freed through it.
 */

'use strict';

import { checkBackend } from './interface.js';

/**
 * The context record for one backend.
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
    prog: null,                     // the program the layer bound last
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
