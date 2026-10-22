/**
 * @file Render targets — `renderTarget`'s shapes and lifecycle over the
 * backend's own target record.
 * @module idiom/target
 * @license AGPL-3.0-only
 *
 * `renderTarget` makes an offscreen target in one call; the backend creates the
 * API objects, and the record it returns carries them.
 *
 * ```
 * renderTarget(ctx)                             // canvas-sized, color + depth
 * renderTarget(ctx, { width, height })          // sized
 * renderTarget(ctx, { depth: true })            // a depth texture only — a shadow map
 * renderTarget(ctx, { depthTexture: true })     // color + a sampleable depth texture
 * renderTarget(ctx, { color: ['albedo', 'normal'] })   // a g-buffer
 * renderTarget(ctx, { depth: false })           // color only
 * renderTarget(ctx, { format, float, minMag, wrap, samples })
 * ```
 *
 * @details
 * The returned record is the backend's, extended here: `.width` / `.height`,
 * `.color` (attachment 0's texture), `.depth` (the depth texture when
 * sampleable), one property per named attachment, `resize(w, h)`, `resolve()`
 * and `dispose()`. The backend's own fields ride along untouched — a WebGL
 * backend's record still carries its framebuffer and attachments — so an
 * application never reaches for an API object through a second lookup.
 *
 * The options are resolved here and the record's shape is this module's; the
 * API objects are the backend's. `format`, `float`, `minMag`, `wrap` and a
 * per-attachment format are tokens this layer never reads: it passes each
 * through, and the backend resolves it. A multisampled target draws into the
 * backend's multisampled storage; `resolve()` fills the sampleable textures and
 * a pass that samples `.color` itself calls it first. `dispose()` frees the
 * backend's objects and forgets the target, once.
 */

'use strict';

/** The default on-screen target: what `bindTarget` takes for the canvas. */
export const SCREEN = null;

/**
 * Resolve `renderTarget`'s options into the target spec the backend receives.
 * @param {object} [opts]  The options as the caller gave them.
 * @returns {{ width:number|undefined, height:number|undefined, color:boolean,
 *             names:string[], perColor:object|null, format:*, float:boolean,
 *             depth:'none'|'renderbuffer'|'texture', samples:number,
 *             minMag:*, wrap:* }}
 *          The policy: which attachments exist and what each is, with the
 *          caller's format and sampling tokens carried through unread.
 * @ignore
 */
export function targetSpec(opts) {
  const o = opts || {};
  const byFormat = !!o.color && typeof o.color === 'object' && !Array.isArray(o.color);
  const named = Array.isArray(o.color) ? o.color.slice() : (byFormat ? Object.keys(o.color) : null);
  const depthOnly = o.depth === true && named === null && !o.depthTexture;
  const depthTexture = !!o.depthTexture || depthOnly;
  return {
    width: o.width,
    height: o.height,
    color: !depthOnly && o.color !== false,
    names: named || [],
    perColor: byFormat ? o.color : null,
    format: o.format,
    float: !!o.float,
    depth: o.depth === false ? 'none' : (depthTexture ? 'texture' : 'renderbuffer'),
    samples: o.samples > 1 ? Math.floor(o.samples) : 1,
    minMag: o.minMag,
    wrap: o.wrap,
  };
}

/** Record the sizes of a target's texture attachments, for `uTexelSize`. */
function _register(ctx, target, spec) {
  const w = target.width, h = target.height;
  if (spec.color && target.color) ctx.sizes.set(target.color, [w, h]);
  if (spec.depth === 'texture' && target.depth) ctx.sizes.set(target.depth, [w, h]);
  for (const name of spec.names) if (target[name]) ctx.sizes.set(target[name], [w, h]);
}

/** Forget them again. */
function _forget(ctx, target, spec) {
  if (target.color) ctx.sizes.delete(target.color);
  if (target.depth) ctx.sizes.delete(target.depth);
  for (const name of spec.names) if (target[name]) ctx.sizes.delete(target[name]);
}

/**
 * Create a render target: the backend's object, extended with this layer's
 * `resize`, `resolve` and `dispose`.
 * @param {object} ctx  The context record.
 * @param {{ width?:number, height?:number, depth?:boolean, depthTexture?:boolean,
 *           color?:string[]|Object<string, *>|false, format?:*, float?:boolean,
 *           minMag?:*, wrap?:*, samples?:number }} [opts]
 *        `format`, `float`, `minMag`, `wrap` and a per-attachment format are
 *        the backend's to interpret; the rest is the target's shape.
 * @returns {object} The target record.
 * @example
 * const ctx = createContext(createFake().backend)
 * const scene = renderTarget(ctx, { width: 320, height: 240 })
 * scene.color      // the colour texture
 * scene.resize(640, 480)
 * scene.dispose()  // the backend frees it
 */
export function renderTarget(ctx, opts) {
  const spec = targetSpec(opts);
  const backend = ctx.backend;
  const target = backend.createTarget(ctx, spec);
  const resize = target.resize;
  const resolve = target.resolve;

  _register(ctx, target, spec);
  target.resize = (width, height) => {
    if (resize) resize.call(target, width, height);
    _register(ctx, target, spec);
    return target;
  };
  target.resolve = () => {
    if (resolve) resolve.call(target);
    return target;
  };
  target.dispose = () => {
    if (!ctx.targets.has(target)) return target;
    ctx.targets.delete(target);
    _forget(ctx, target, spec);
    backend.destroyTarget(ctx, target);
    return target;
  };
  ctx.targets.add(target);
  return target;
}
