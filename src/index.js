/**
 * @file idiom — the bridges' shared composite layer: targets, passes, `pipe`,
 * `state`, the draw policy.
 * @module idiom
 * @license AGPL-3.0-only
 *
 * A bridge owns a backend for its API and a record per context; this package
 * owns the composites both bridges would otherwise write twice. Every verb
 * takes the context record first, never a `gl` or a device, so a key stays the
 * bridge's:
 *
 * ```
 * const ctx = createContext(backend)          // in the bridge's own registry
 * const solid = buffer(ctx, mesh)             // the geometry a draw takes
 * bind(ctx, prog)                             // the bridge's own verb
 * draw(ctx, solid, M)                         // the declared transforms, then the draw
 * const target = renderTarget(ctx, opts)
 * const sky = cubemap(ctx, sixFaces)          // the textures' policy
 * pick(ctx, x, y, drawFn, { vp })             // the id under a pointer, a promise
 * filter(ctx, prog, uniforms, input)
 * const pair = state(ctx, opts)
 * disposeContext(ctx)                         // the bridge's dispose calls this first
 * ```
 *
 * A backend is the bridge's own object, implementing the interface this
 * package states: targets, programs, uniforms, buffers, draws, textures,
 * readback, viewport and state, and the API's four conventions. The package
 * ships a recording backend for its tests; it names no GPU API itself.
 */

'use strict';

export { createContext, disposeContext } from './registry.js';
export { renderTarget, SCREEN } from './target.js';
export {
  program, fullscreen, filter, image, pipe, releasePipe,
  RED, GREEN, BLUE, ALPHA, RGB, NORMAL, ADD, MULTIPLY,
} from './pass.js';
export {
  TRANSFORMS, declaredTransforms, buffer, updateBuffer, writeBuffer, install, draw,
} from './draw.js';
export { state } from './state.js';
export { CUBE_FACES, texture, upload, cubemap } from './texture.js';
export { readPixel, pick } from './pick.js';
export { gizmo, fill, expand, drawLines, drawPane, beginHUD, endHUD, inHUD } from './pipe.js';
