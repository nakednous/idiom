/**
 * @file The surface manifest — every export and its arity, and the interface as
 *       the backend contract. A backend cannot quietly move either.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as idiom from '../../src/index.js';
import { MEMBERS, CONVENTIONS, checkBackend } from '../../src/interface.js';
import { createFake } from '../fake.js';

const ARITY = {
  createContext: 1, disposeContext: 1,
  renderTarget: 2, SCREEN: null,
  program: 2, fullscreen: 1, filter: 4, image: 3, pipe: 4, releasePipe: 2,
  state: 2,
  CUBE_FACES: null, texture: 3, upload: 3, cubemap: 3,
  readPixel: 5, pick: 5,
  gizmo: 3, fill: 4, expand: 2, drawLines: 3, drawPane: 3, beginHUD: 2, endHUD: 1, inHUD: 3,
  TRANSFORMS: null, declaredTransforms: 1,
  buffer: 3, updateBuffer: 4, writeBuffer: 3, install: 3, draw: 4,
  RED: null, GREEN: null, BLUE: null, ALPHA: null, RGB: null,
  NORMAL: null, ADD: null, MULTIPLY: null,
};

test('the export list is exactly the surface, and every verb keeps its arity', () => {
  assert.deepEqual(Object.keys(idiom).sort(), Object.keys(ARITY).sort());
  for (const [name, arity] of Object.entries(ARITY)) {
    if (typeof arity === 'number') assert.equal(idiom[name].length, arity, name + '\'s arity');
  }
});

test('the constants are values', () => {
  assert.equal(idiom.SCREEN, null);
  assert.deepEqual(idiom.RED, [true, false, false, false]);
  assert.deepEqual(idiom.GREEN, [false, true, false, false]);
  assert.deepEqual(idiom.BLUE, [false, false, true, false]);
  assert.deepEqual(idiom.ALPHA, [false, false, false, true]);
  assert.deepEqual(idiom.RGB, [true, true, true, false]);
  assert.deepEqual([idiom.NORMAL, idiom.ADD, idiom.MULTIPLY], ['NORMAL', 'ADD', 'MULTIPLY']);
});

test('the interface list is complete, unique and the fake implements it', () => {
  assert.equal(new Set(MEMBERS).size, MEMBERS.length, 'no member is named twice');
  for (const name of ['createTarget', 'destroyTarget', 'bindTarget', 'clear', 'createProgram', 'imageProgram',
    'uniformsOf', 'samplersOf', 'setUniforms', 'setCamera', 'draw', 'drawInstanced', 'createBuffer',
    'updateBuffer', 'writeBuffer', 'readPixels', 'createTexture', 'uploadTexture', 'createCubeTexture',
    'destroyTexture', 'textureSize', 'setViewport', 'setState', 'drawGizmo', 'dispose']) assert.ok(MEMBERS.includes(name), name);
  assert.equal(MEMBERS.length, 25);
  assert.deepEqual(CONVENTIONS, ['ndcZMin', 'uvOrientation', 'framebufferY', 'format']);
  assert.deepEqual(checkBackend(createFake().backend), []);
});

test('checkBackend names every missing member and convention, one per message', () => {
  const { backend } = createFake();
  const broken = { ...backend };
  delete broken.draw;
  delete broken.setState;
  delete broken.ndcZMin;
  const messages = checkBackend(broken);
  assert.equal(messages.length, 3);
  assert.ok(messages.some((m) => m.includes('`draw`')));
  assert.ok(messages.some((m) => m.includes('`setState`')));
  assert.ok(messages.some((m) => m.includes('`ndcZMin`')));
  assert.deepEqual(checkBackend(null), ['a backend is an object with the interface\'s members']);
});

test('a context names what its backend lacks, once', () => {
  const { backend } = createFake();
  delete backend.setUniforms;
  const errors = [];
  const real = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    idiom.createContext(backend);
  } finally { console.error = real; }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /setUniforms/);
});
