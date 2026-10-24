/**
 * @file The draw policy — a mesh's arrays under the shaders' names, the six
 * declared transforms, and a draw.
 * @module idiom/draw
 * @license AGPL-3.0-only
 *
 * `buffer` turns the arrays shape a mesh, a generator or a primitive answers
 * into the geometry a draw takes; `install` uploads the transforms a program
 * declares; `draw` installs them and calls the backend's own draw. `bind` stays
 * the bridge's — which program is bound is the record's `.prog` — and so does
 * the vertex layout: a bridge states it on the program it makes (§7 #112).
 *
 * ```
 * const geo = buffer(ctx, mesh)          // { position, normal, texcoord, indices, … }
 * updateBuffer(ctx, geo, mesh)           // the same shape, refreshed
 * writeBuffer(ctx, geo, mesh)            // in place, for a stream
 * install(ctx, prog, M)                  // the transforms, only where declared
 * draw(ctx, geo, M)                      // install, then the backend's draw
 * ```
 *
 * **The names.** The keys the arrays shape fixes are renamed: position →
 * aPosition, normal → aNormal, tangent → aTangent, texcoord → aTexCoord, color
 * → aColor, joints → aJoints (uploaded unnormalised), weights → aWeights. A key
 * of its own keeps its name — a custom attribute meets a shader by the layout a
 * bridge states, and a renamed one is written the way the reference writes it:
 * `buffer(ctx, { ...mesh, aUV: mesh.texcoord, texcoord: undefined })`. `indices`
 * and any other key holding numbers pass through; a key that holds none — a
 * mesh's `bounds`, a generator's `count` and `labels` — is skipped, so any mesh
 * goes in whole. The creation options are the backend's: `{ interleave, usage }`
 * where its API has them, none on twgl.
 *
 * **The transforms.** These six uniforms a program declares are uploaded from
 * the model matrix and the camera the backend installed, each only where the
 * program declares it, read off `uniformsOf` once per program:
 *
 * ```
 * uModelMatrix                 M
 * uViewMatrix                  V
 * uModelViewMatrix             V · M
 * uProjectionMatrix            P
 * uModelViewProjectionMatrix   P · V · M
 * uNormalMatrix                (V · M)⁻ᵀ, 3×3
 * ```
 *
 * `MV` and `MVP` are computed into the record's scratch, the normal into its
 * nine floats, and the six travel through the generic `setUniforms` as one bag
 * per program — a mat3 as nine floats, the backend padding them. A program that
 * declares none gets none: a fullscreen pass declares none, and a shadow
 * capture that declares `uModelMatrix` and its own light matrix gets
 * `uModelMatrix` and nothing this layer would mistake for the light's. A value
 * applies to the draw that follows, so it is uploaded once per draw; nothing is
 * allocated once a program has drawn.
 */

'use strict';

import { mat3NormalFromMat4, mat4Mul } from '@nakednous/tree';
import { declaredUniforms } from './pass.js';

/** The transform names a program may declare, in the order this layer fills them. */
export const TRANSFORMS = ['uModelMatrix', 'uViewMatrix', 'uModelViewMatrix', 'uProjectionMatrix', 'uModelViewProjectionMatrix', 'uNormalMatrix'];

/** The key each transform's flag takes. @ignore */
const KEYS = ['model', 'view', 'mv', 'proj', 'mvp', 'normal'];

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const _isMat4 = (m) => m != null && typeof m === 'object' && typeof m.length === 'number' && m.length >= 16;

/**
 * Which of the six transforms a program declares.
 * @param {string[]|Set<string>|null} names  The names a program declares —
 *        `uniformsOf`'s answer, or the context's cached set.
 * @returns {{ model:boolean, view:boolean, mv:boolean, proj:boolean, mvp:boolean, normal:boolean, any:boolean }}
 * @example
 * declaredTransforms(['uModelViewProjectionMatrix', 'uColor'])
 * // { model:false, view:false, mv:false, proj:false, mvp:true, normal:false, any:true }
 */
export function declaredTransforms(names) {
  const cached = names != null && typeof names.has === 'function' ? names : null;
  const list = Array.isArray(names) ? names : null;
  const d = {};
  let any = false;
  for (let i = 0; i < TRANSFORMS.length; i++) {
    const declared = cached ? cached.has(TRANSFORMS[i]) : (list ? list.indexOf(TRANSFORMS[i]) >= 0 : false);
    d[KEYS[i]] = declared;
    if (declared) any = true;
  }
  d.any = any;
  return d;
}

// The declared transforms per program, and the bag each program's draws write
// into: one of each, so a draw allocates nothing.
const _declaredBy = new WeakMap();
const _bagOf = new WeakMap();

function _declared(ctx, prog) {
  let flags = _declaredBy.get(prog);
  if (!flags) {
    flags = declaredTransforms(declaredUniforms(ctx, prog));
    _declaredBy.set(prog, flags);
  }
  return flags;
}

function _bag(prog) {
  let values = _bagOf.get(prog);
  if (!values) { values = {}; _bagOf.set(prog, values); }
  return values;
}

// The arrays shape's keys as the attribute names the shaders use; a key of its
// own keeps its name.
const ATTRIBUTES = {
  position: 'aPosition', normal: 'aNormal', tangent: 'aTangent', texcoord: 'aTexCoord', color: 'aColor',
  joints: 'aJoints', weights: 'aWeights',
};

// Numbers to upload: a typed array, a list of numbers, or either under `data`.
const _isNumbers = (a) => ArrayBuffer.isView(a) || (Array.isArray(a) && typeof a[0] === 'number');
const _isAttribute = (a) => a != null && (_isNumbers(a) || _isNumbers(a.data));

/** The arrays shape under the shaders' attribute names, numbers only. @ignore */
function _named(arrays) {
  const named = {};
  if (!arrays) return named;
  for (const key in arrays) {
    let a = arrays[key];
    if (!_isAttribute(a)) continue;                        // a mesh's bounds, a generator's count and labels
    if (key === 'joints') a = a.data ? { ...a, normalize: false } : { numComponents: 4, data: a, normalize: false };
    named[ATTRIBUTES[key] || key] = a;
  }
  return named;
}

/**
 * A geometry from a mesh — the arrays shape `host.loadMesh` returns, a
 * `loadModel` part carries, `tree.platonic` returns, and a primitive is — under
 * the attribute names the shaders use.
 * @param {object} ctx  The context record.
 * @param {object} arrays  The arrays shape: `{ position, indices?, normal?, … }`,
 *        each a `{ numComponents, data }` or a typed array the backend sizes.
 * @param {object} [opts]  The backend's creation options, `{ interleave, usage }`
 *        where its API takes them — a stream's non-interleaved, writable slots.
 * @returns {object|null} The geometry a draw takes: the backend's record.
 * @example
 * const solid = buffer(ctx, tree.platonic(tree.HEXAHEDRON, { radius: 50 }))
 */
export function buffer(ctx, arrays, opts) {
  if (!ctx || !ctx.backend) return null;
  return ctx.backend.createBuffer(ctx, _named(arrays), opts);
}

/**
 * Refresh a geometry from the arrays shape it was made with — the same keys, a
 * count that changed or values edited. The record keeps its identity and is
 * drawn as before; a layout a pipeline baked expects the shape's attributes and
 * their order to stay the same.
 * @param {object} ctx  The context record.
 * @param {object} geometry  A record `buffer` answered.
 * @param {object} arrays  The arrays shape, as `buffer` takes it.
 * @param {object} [opts]  The backend's creation options, as `buffer` takes them.
 * @returns {object|null} geometry.
 * @example
 * updateBuffer(ctx, grid, { ...gridMatrices, position: { numComponents: 3, data } })
 */
export function updateBuffer(ctx, geometry, arrays, opts) {
  if (!ctx || !ctx.backend) return null;
  if (!geometry) {
    console.error('[idiom] updateBuffer: a geometry from buffer(ctx, arrays) is required.');
    return null;
  }
  return ctx.backend.updateBuffer(ctx, geometry, _named(arrays), opts);
}

/**
 * Write a geometry's arrays into its own buffers, in place — the form a stream
 * uses: a queue write is ordered with submissions, not inside a command buffer,
 * so a draw that writes before it draws owns its slot (§7 #113).
 * @param {object} ctx  The context record.
 * @param {object} geometry  A record `buffer` answered.
 * @param {object} arrays  The arrays shape, as `buffer` takes it.
 * @returns {object|null} geometry.
 * @example
 * writeBuffer(ctx, slot.geometry, { position: { numComponents: 3, data } })
 */
export function writeBuffer(ctx, geometry, arrays) {
  if (!ctx || !ctx.backend) return null;
  if (!geometry) {
    console.error('[idiom] writeBuffer: a geometry from buffer(ctx, arrays) is required.');
    return null;
  }
  return ctx.backend.writeBuffer(ctx, geometry, _named(arrays));
}

/**
 * Upload the transforms a program declares, for a model matrix M (null for the
 * identity), from the camera the backend installed.
 * @details Each is computed into the record's scratch only when the program
 * declares it, and written into the program's own bag, so a draw allocates
 * nothing once warm. A program that declares none is not uploaded to.
 * @param {object} ctx  The context record.
 * @param {object} prog  A program record.
 * @param {ArrayLike<number>|null} M  A model mat4, or null for the identity.
 * @returns {object|null} prog.
 * @example
 * install(ctx, prog, M)
 */
export function install(ctx, prog, M) {
  if (!ctx || !ctx.backend || !prog) return null;
  const flags = _declared(ctx, prog);
  if (!flags.any) return prog;
  const V = ctx.V, P = ctx.P;
  const values = _bag(prog);
  let MV = null;                                   // V · M, once, for whichever names read it
  if (flags.model) values.uModelMatrix = M || IDENTITY;
  if (flags.view) values.uViewMatrix = V;
  if (flags.mv) { MV = M ? mat4Mul(ctx.MV, V, M) : V; values.uModelViewMatrix = MV; }
  if (flags.proj) values.uProjectionMatrix = P;
  if (flags.mvp) {
    if (!MV) MV = M ? mat4Mul(ctx.MV, V, M) : V;
    values.uModelViewProjectionMatrix = M ? mat4Mul(ctx.MVP, P, MV) : ctx.PV;
  }
  if (flags.normal) {
    if (!MV) MV = M ? mat4Mul(ctx.MV, V, M) : V;
    values.uNormalMatrix = mat3NormalFromMat4(ctx.N, MV);
  }
  ctx.backend.setUniforms(ctx, prog, values);
  return prog;
}

/**
 * Draw geometry with the program a bind left bound, installing the transforms it
 * declares.
 * @param {object} ctx  The context record.
 * @param {object} obj  A geometry from `buffer(ctx, arrays)`.
 * @param {ArrayLike<number>|object} [M]  A model mat4, omitted for the identity;
 *        an opts object here is read as the third argument's, `draw(ctx, obj, opts)`.
 * @param {object} [opts]  The backend's draw options, forwarded.
 * @returns {object|null} The backend's answer, or null where nothing was drawn.
 * @example
 * setCamera(ctx, cam)
 * bind(ctx, prog, { uColor: [1, 0.31, 0.85] })
 * draw(ctx, box, tree.mat4FromTRS(M, -80, 0, 0, 0, 0, 0, 1, 1, 1, 1))
 */
export function draw(ctx, obj, M, opts) {
  if (M != null && !_isMat4(M)) { opts = M; M = null; }   // draw(ctx, obj, opts)
  if (!ctx || !ctx.backend) return null;
  const prog = ctx.prog;
  if (!prog) {
    console.error('[idiom] draw: no program bound — a bridge\'s `bind` sets the record\'s program first.');
    return null;
  }
  if (!obj) {
    console.error('[idiom] draw: `obj` must be a geometry from buffer(ctx, arrays).');
    return null;
  }
  install(ctx, prog, M || null);
  return ctx.backend.draw(ctx, prog, obj, opts);
}
