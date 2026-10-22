/**
 * @file Target cases — the shapes resolved into the spec the backend receives,
 *       and the record's resize, resolve and dispose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, renderTarget, SCREEN } from '../../src/index.js';
import { targetSpec } from '../../src/target.js';
import { createFake, namesOf } from '../fake.js';

test('the default is one colour attachment and a depth renderbuffer', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const target = renderTarget(ctx);
  assert.deepEqual(namesOf(fake.calls), ['createTarget']);
  const spec = fake.calls[0][1];
  assert.equal(spec.color, true);
  assert.deepEqual(spec.names, []);
  assert.equal(spec.depth, 'renderbuffer');
  assert.equal(spec.samples, 1);
  assert.equal(target.width, 640, 'the canvas is the backend\'s default size');
  assert.equal(target.height, 480);
  assert.ok(target.color, 'the record carries the colour texture');
  assert.deepEqual(ctx.sizes.get(target.color), [640, 480]);
});

test('the five shapes: depth only, a depth texture, colour only, a g-buffer, float', () => {
  const depth = targetSpec({ depth: true });
  assert.equal(depth.color, false);
  assert.equal(depth.depth, 'texture');

  const both = targetSpec({ depthTexture: true });
  assert.equal(both.color, true);
  assert.equal(both.depth, 'texture');

  const colour = targetSpec({ depth: false });
  assert.equal(colour.color, true);
  assert.equal(colour.depth, 'none');

  const buffer = targetSpec({ color: ['albedo', 'normal', 'position'] });
  assert.deepEqual(buffer.names, ['albedo', 'normal', 'position']);

  const half = targetSpec({ float: true });
  assert.equal(half.float, true);
  assert.equal(half.format, undefined);
});

test('the caller\'s tokens are carried through unread, per attachment too', () => {
  const spec = targetSpec({ format: 'the-float-token', minMag: 'the-nearest-token', wrap: 'the-repeat-token' });
  assert.equal(spec.format, 'the-float-token');
  assert.equal(spec.minMag, 'the-nearest-token');
  assert.equal(spec.wrap, 'the-repeat-token');
  const per = targetSpec({ color: { position: 'half', albedo: 'byte' } });
  assert.deepEqual(per.names, ['position', 'albedo']);
  assert.deepEqual(per.perColor, { position: 'half', albedo: 'byte' });
  assert.equal(per.format, undefined);
});

test('samples floor to a whole count, and 1 or less is single-sampled', () => {
  assert.equal(targetSpec({ samples: 4 }).samples, 4);
  assert.equal(targetSpec({ samples: 4.7 }).samples, 4);
  assert.equal(targetSpec({ samples: 1 }).samples, 1);
  assert.equal(targetSpec({ samples: 0 }).samples, 1);
});

test('the record is the backend\'s, extended: named attachments and the screen', () => {
  const { backend } = createFake();
  const ctx = createContext(backend);
  const target = renderTarget(ctx, { color: ['albedo', 'normal'], depth: false });
  assert.ok(target.albedo && target.normal, 'one property per named attachment');
  assert.equal(target.depth, null);
  assert.equal(SCREEN, null);
  assert.deepEqual(ctx.sizes.get(target.normal), [640, 480]);
});

test('resize moves the record and its textures\' sizes; resolve fills the textures', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const target = renderTarget(ctx, { width: 8, height: 4, samples: 4 });
  fake.calls.length = 0;
  target.resize(16, 12);
  assert.deepEqual(fake.calls, [['target.resize', target.id, 16, 12]]);
  assert.equal(target.width, 16);
  assert.equal(target.height, 12);
  assert.deepEqual(ctx.sizes.get(target.color), [16, 12]);
  fake.calls.length = 0;
  assert.equal(target.resolve(), target, 'resolve returns the record');
  assert.deepEqual(namesOf(fake.calls), ['target.resolve']);
});

test('dispose frees the backend\'s objects once and forgets the sizes', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const target = renderTarget(ctx, { width: 8, height: 4 });
  const colour = target.color;
  assert.equal(ctx.targets.has(target), true);
  fake.calls.length = 0;
  target.dispose();
  assert.deepEqual(fake.calls, [['destroyTarget', target.id]]);
  assert.equal(ctx.targets.size, 0);
  assert.equal(ctx.sizes.has(colour), false);
  fake.calls.length = 0;
  target.dispose();
  assert.equal(fake.calls.length, 0, 'a second dispose frees nothing');
});
