/**
 * @file Textures — the family's policy: a source or a descriptor, the six faces,
 * a refresh, and the size the passes read.
 * @module idiom/texture
 * @license AGPL-3.0-only
 *
 * ```
 * texture(ctx, source, opts)     // an element, a bitmap, { data, width, height }, or the backend's descriptor
 * upload(ctx, tex, source)       // refresh one from a video or a canvas
 * cubemap(ctx, faces, opts)      // six sources, in the cube's order
 * ```
 *
 * **What this layer states, and what it leaves.** It states the three verbs, the
 * six faces' order and count, and the size a texture has — recorded in the
 * context's `sizes`, the map `uTexelSize` and `pipe`'s working targets read, so a
 * texture made here is sized for every later pass. It leaves the API's own
 * creation to the backend: what a source becomes is the API's question (GL
 * uploads an element into a bound texture with its flip flag; WebGPU copies it
 * into a described texture with none), and so is which target a cube map is. The
 * orientation rule is the backend's statement, not a flip option here — GL's
 * textures are bottom-up, WebGPU's top-down, and neither is passed through this
 * module.
 *
 * The backend's members are `createTexture(ctx, source, opts)` (a source on
 * twgl, a descriptor on the twin — `opts` are its own, §7 #112),
 * `uploadTexture(ctx, tex, source)`, `createCubeTexture(ctx, faces, opts)` and
 * `textureSize(ctx, tex)`.
 */

'use strict';

/** The cube's face order — the order a source array goes in. */
export const CUBE_FACES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

/** A source's [width, height], where it has one. @ignore */
function _sizeOf(source) {
  if (!source) return null;
  if (typeof source.width === 'number' && typeof source.height === 'number') return [source.width, source.height];
  if (typeof source.naturalWidth === 'number' && source.naturalWidth) return [source.naturalWidth, source.naturalHeight];
  if (typeof source.videoWidth === 'number' && source.videoWidth) return [source.videoWidth, source.videoHeight];
  return null;
}

/** Record a texture's size for the passes that read a texel size. @ignore */
function _sized(ctx, tex, source) {
  const size = _sizeOf(source);
  if (size && ctx.sizes && tex) ctx.sizes.set(tex, size);
  return tex;
}

/**
 * Create a texture: an element, a bitmap, raw pixels, or whatever descriptor the
 * backend takes.
 * @param {object} ctx  The context record.
 * @param {object} source  An image-like source, `{ data, width, height, depth?, layers? }`,
 *        or the backend's own creation descriptor.
 * @param {object} [opts]  The backend's creation options (`minMag`, `wrap`,
 *        `mipmaps`, `flip`, `format`, `internalFormat`, `type` on twgl).
 * @returns {object|null} The backend's texture record.
 * @example
 * const tex = texture(ctx, { data: pixels, width: 2, height: 2 })
 */
export function texture(ctx, source, opts) {
  if (!ctx || !ctx.backend) return null;
  if (!source) {
    console.error('[idiom] texture: a source is required — an element, a bitmap, `{ data, width, height }`, or the backend\'s descriptor.');
    return null;
  }
  return _sized(ctx, ctx.backend.createTexture(ctx, source, opts), source);
}

/**
 * Refresh a texture from a source — a video or a canvas frame each frame.
 * @param {object} ctx  The context record.
 * @param {object} tex  A texture record.
 * @param {object} source  The new source.
 * @returns {object|null} tex.
 * @example
 * upload(ctx, tex, video)
 */
export function upload(ctx, tex, source) {
  if (!ctx || !ctx.backend) return null;
  if (!tex) {
    console.error('[idiom] upload: a texture is required.');
    return null;
  }
  ctx.backend.uploadTexture(ctx, tex, source);
  return _sized(ctx, tex, source);
}

/**
 * A cube map from six sources, in the cube's order: +X, −X, +Y, −Y, +Z, −Z.
 * @details The order is the cube's own, not the API's; a backend maps it to its
 * face targets (GL) or its layers (WebGPU). The six faces must agree in size and
 * are registered once, so `uTexelSize` over a cube map is its face's texel.
 * @param {object} ctx  The context record.
 * @param {object[]} faces  Six sources.
 * @param {object} [opts]  The backend's creation options.
 * @returns {object|null} The backend's texture record.
 * @example
 * const sky = cubemap(ctx, [px, nx, py, ny, pz, nz])
 */
export function cubemap(ctx, faces, opts) {
  if (!ctx || !ctx.backend) return null;
  if (!Array.isArray(faces) || faces.length !== CUBE_FACES.length) {
    console.error('[idiom] cubemap: six faces are required, in the cube\'s order (+X −X +Y −Y +Z −Z).');
    return null;
  }
  return _sized(ctx, ctx.backend.createCubeTexture(ctx, faces, opts), faces[0]);
}

/**
 * A texture's [width, height] — the member's answer, read here so a pass names
 * one path whatever made the texture.
 * @param {object} ctx  The context record.
 * @param {object} tex  A texture record.
 * @returns {number[]|null} Its size, or null where the backend knows none.
 * @ignore
 */
export function sizeOf(ctx, tex) {
  if (!ctx || !ctx.backend || !tex) return null;
  return ctx.backend.textureSize(ctx, tex) || null;
}
