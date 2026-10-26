/**
 * @file Texture cases — the three verbs over the recording backend: what each
 *       hands the backend, the size it records, and what it refuses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, texture, upload, cubemap, CUBE_FACES } from '../../src/index.js';
import { sizeOf } from '../../src/texture.js';
import { createFake, namesOf } from '../fake.js';

const pixels = (w = 4, h = 2) => ({ data: new Uint8Array(w * h * 4), width: w, height: h });

test('texture: the source and its options go to the backend, and the size is recorded', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const source = pixels(4, 2);
  const tex = texture(ctx, source, { minMag: 1 });
  assert.deepEqual(namesOf(fake.calls), ['createTexture']);
  assert.equal(fake.calls[0][1], source, 'the source reaches the backend whole');
  assert.deepEqual(ctx.sizes.get(tex), [4, 2], 'a pass may ask for its texel size');
  assert.deepEqual(sizeOf(ctx, tex), [4, 2], 'and reads it through the member');
});

test('texture: a source with no size — a descriptor — is passed and not sized', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const descriptor = { viewDimension: 'cube' };
  const tex = texture(ctx, descriptor);
  assert.equal(fake.calls[0][1], descriptor);
  assert.equal(ctx.sizes.get(tex), undefined, 'a descriptor states no size here, and the backend owns it');
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    assert.equal(texture(ctx, null), null);
  } finally {
    console.error = original;
  }
  assert.match(logged[0], /a source is required/);
});

test('upload: the texture is refreshed and its size follows the source', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const tex = texture(ctx, pixels(4, 2));
  fake.calls.length = 0;
  const video = { videoWidth: 16, videoHeight: 9 };
  assert.equal(upload(ctx, tex, video), tex);
  assert.deepEqual(namesOf(fake.calls), ['uploadTexture']);
  assert.deepEqual(ctx.sizes.get(tex), [16, 9]);
  assert.equal(upload(ctx, null, video), null);
});

test('cubemap: six faces reach the backend in the cube\'s order, and the map is sized once', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const faces = [pixels(8, 8), pixels(8, 8), pixels(8, 8), pixels(8, 8), pixels(8, 8), pixels(8, 8)];
  const map = cubemap(ctx, faces, { mipmaps: true });
  assert.deepEqual(namesOf(fake.calls), ['createCubeTexture']);
  assert.equal(fake.calls[0][1], 6, 'six faces, one member');
  assert.deepEqual(CUBE_FACES, ['+X', '-X', '+Y', '-Y', '+Z', '-Z'], 'the order is the cube\'s, not the API\'s');
  assert.deepEqual(ctx.sizes.get(map), [8, 8], 'a cube map is a square, one size');
});

test('cubemap refuses what it cannot build, before the backend sees it', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    assert.equal(cubemap(ctx, [pixels(8, 8), pixels(8, 8)]), null);
  } finally {
    console.error = original;
  }
  assert.deepEqual(namesOf(fake.calls), [], 'five faces never reach the backend');
  assert.match(logged[0], /six faces are required/);
});
