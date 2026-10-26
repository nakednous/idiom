/**
 * @file The backend contract — what a bridge implements for its GPU API, and
 * `checkBackend`, which names what one lacks.
 * @module idiom/interface
 * @license AGPL-3.0-only
 *
 * A backend is the bridge's own object: its own handle on a context or a
 * device, its own calls, its own conventions. `idiom` never touches a GPU API;
 * it calls the members below, and each call's arguments and return value are
 * this file's contract. A bridge attaches one backend to one context record and
 * implements every member — the parts `idiom` does not use yet are still the
 * contract, so a later verb needs no interface change.
 *
 * ```
 * targets   createTarget · destroyTarget · bindTarget · clear
 * programs  createProgram · imageProgram · uniformsOf · samplersOf · setUniforms
 * draws     setCamera · draw · drawInstanced
 * buffers   createBuffer · updateBuffer · writeBuffer
 * picking   readPixels
 * textures  createTexture · uploadTexture · createCubeTexture · destroyTexture · textureSize
 * state     setViewport · setState
 * context   dispose
 * ```
 *
 * Binding. `bindTarget(ctx, target)` is the layer's own: the composites call
 * it, and an application binds a target with its API's own call — twgl's
 * `bindFramebufferInfo`, the twin's pass. No `beginPass`, `screen` or `clear`
 * verb is published; `SCREEN` is what `bindTarget` takes for the canvas.
 *
 * Programs. `createProgram(ctx, source, opts)` compiles a source into a program
 * record; `opts` is the backend's own — a WebGPU backend takes the vertex
 * layout its pipeline bakes (`buffers`) and its entry names, twgl takes none,
 * and a geometry's layout is the application's statement through its bridge's
 * `program`. `imageProgram(ctx)` is the flat texture program `image` draws
 * with, the mirror of `createProgram`, its vertex stage the backend's.
 * `uniformsOf(prog)` and `samplersOf(prog)` name what a program declares;
 * `setUniforms(ctx, prog, values)` uploads a bag by name, and a value applies to
 * the draw that follows.
 *
 * Records. A target is the backend's own record: it carries `resize(w, h)` and
 * `resolve()`, which this layer calls and decorates, and `dispose()` is the
 * layer's. A program record is identified by `.program` — the API's program
 * object or module — and a `pipe` entry is a bag iff it carries a `uniforms`
 * key, `{ program, uniforms }`; every other entry is a program record itself.
 * `setCamera(ctx, V, P)` leaves `V`, `P` and `P · V` stated on the record, where
 * the draw policy reads them; `MV`, `MVP` and the normal matrix are the
 * record's scratch.
 *
 * Buffers. `createBuffer(ctx, arrays, opts)` and `updateBuffer(ctx, geometry,
 * arrays, opts)` take an optional creation-options argument, the API's own —
 * `{ interleave, usage }` on the twin, none on twgl. `writeBuffer(ctx, geometry,
 * arrays)` is the in-place write: it rewrites the geometry's own buffers, and a
 * queue write is ordered with submissions rather than inside a command buffer,
 * so a stream's draw owns a slot of its frame.
 *
 * State. The members that read or set a piece of API state — `bindTarget`,
 * `setViewport`, `setState` — return what was in effect before the call, and
 * take no value (or `undefined`) to ask only. A composite restores what it
 * found by handing that token back, so no member exists only to read state.
 *
 * Picking. `readPixels(ctx, target, x, y, width, height, opts)` answers a
 * `Promise` of RGBA bytes for a block of a target's own pixels, row 0 in the
 * backend's `framebufferY` orientation; `opts` is the backend's own, the
 * reference's `sync` among them. The layer's `pick` reads one pixel of a 1 × 1
 * target through it (§7 #125).
 *
 * Textures. `createTexture(ctx, source, opts)` takes a source or the backend's
 * own descriptor and `uploadTexture(ctx, tex, source)` refreshes one;
 * `createCubeTexture(ctx, faces, opts)` takes six sources in the cube's order
 * (+X −X +Y −Y +Z −Z) — a face target on GL, a layer on WebGPU, which is why it
 * is its own member rather than a flag on the other (§7 #123) — and
 * `textureSize(ctx, tex)` answers the record's size, which a pass reads for
 * `uTexelSize`.
 *
 * Conventions are fields on the backend object, written once per API:
 *
 * ```
 * ndcZMin       -1 (WebGL) or 0 (WebGPU)
 * uvOrientation 'bottom-up' or 'top-down' — the image's v axis at v = 0
 * framebufferY  'up' or 'down' — the target's row 0
 * format        the preferred colour format's name, or the backend's own token
 * ```
 *
 * `checkBackend(backend)` returns one message per member or convention a
 * backend lacks; the context record logs them once, as it is made.
 */

'use strict';

/** The members every backend implements, in contract order. */
export const MEMBERS = [
  'createTarget', 'destroyTarget', 'bindTarget', 'clear',
  'createProgram', 'imageProgram', 'uniformsOf', 'samplersOf', 'setUniforms',
  'setCamera', 'draw', 'drawInstanced',
  'createBuffer', 'updateBuffer', 'writeBuffer',
  'readPixels',
  'createTexture', 'uploadTexture', 'createCubeTexture', 'destroyTexture', 'textureSize',
  'setViewport', 'setState',
  'dispose',
];

/** The per-API conventions every backend states. */
export const CONVENTIONS = ['ndcZMin', 'uvOrientation', 'framebufferY', 'format'];

/**
 * The members and conventions a backend lacks, named one per message.
 * @param {object} backend  A backend object.
 * @returns {string[]} Empty for a complete backend.
 * @example
 * const { backend } = createFake()
 * delete backend.draw
 * checkBackend(backend)   // ['a backend lacks `draw`']
 */
export function checkBackend(backend) {
  const missing = [];
  if (!backend || typeof backend !== 'object') return ['a backend is an object with the interface\'s members'];
  for (const name of MEMBERS) {
    if (typeof backend[name] !== 'function') missing.push('a backend lacks `' + name + '`');
  }
  for (const name of CONVENTIONS) {
    if (backend[name] === undefined) missing.push('a backend states no `' + name + '` convention');
  }
  return missing;
}
