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
 * buffers   createBuffer · updateBuffer
 * picking   readPixels
 * textures  createTexture · uploadTexture · destroyTexture · textureSize
 * state     setViewport · setState
 * context   dispose
 * ```
 *
 * The members that read or set a piece of API state — `bindTarget`,
 * `setViewport`, `setState` — return what was in effect before the call, and
 * take no value (or `undefined`) to ask only. A composite restores what it
 * found by handing that token back, so no member exists only to read state.
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
  'createBuffer', 'updateBuffer',
  'readPixels',
  'createTexture', 'uploadTexture', 'destroyTexture', 'textureSize',
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
