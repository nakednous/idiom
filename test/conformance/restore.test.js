/**
 * @file Restore contracts — what a composite leaves as it found it: the bound
 *       target, the viewport, the state, and the clear colour (which stays the
 *       backend's, through `clear` alone).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, disposeContext, renderTarget, filter, image, pipe, state } from '../../src/index.js';
import { createFake, namesOf } from '../fake.js';

const SEEDED = () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const outer = fake.token('outer target');
  fake.world.bound = outer;
  fake.world.viewport = [1, 2, 3, 4];
  fake.world.state = { id: 'outer state' };
  return { fake, ctx, outer };
};

test('filter: the state it found is back, and the binding never moved', () => {
  const { fake, ctx, outer } = SEEDED();
  const before = fake.world.state;
  const input = renderTarget(ctx, { width: 8, height: 8 });
  const prog = fake.program(['uScene'], ['uScene']);
  fake.calls.length = 0;
  filter(ctx, prog, null, input);
  assert.equal(fake.world.bound, outer, 'the bound target is still the caller\'s');
  assert.deepEqual(fake.world.viewport, [1, 2, 3, 4], 'and its viewport');
  assert.equal(fake.world.state, before, 'and its state');
  assert.equal(fake.calls.some((call) => call[0] === 'bindTarget'), false, 'no binding was moved to restore');
});

test('image: the state is back and the binding is untouched', () => {
  const { fake, ctx, outer } = SEEDED();
  const before = fake.world.state;
  fake.calls.length = 0;
  image(ctx, { id: 'texture' }, { blend: 'MULTIPLY', mask: [true, false, false, false] });
  assert.equal(fake.world.bound, outer);
  assert.equal(fake.world.state, before);
  assert.equal(fake.calls.some((call) => call[0] === 'bindTarget'), false);
});

test('state.pass and state.reset: the target, the viewport and the state are the caller\'s again', () => {
  const { fake, ctx, outer } = SEEDED();
  const s = state(ctx, { width: 8, height: 8 });
  const prog = fake.program(['uScene'], ['uScene']);
  const outerState = fake.world.state;
  for (const verb of [() => s.pass(prog), () => s.reset()]) {
    fake.calls.length = 0;
    verb();
    assert.equal(fake.world.bound, outer, 'the target it found is handed back');
    assert.deepEqual(fake.world.viewport, [1, 2, 3, 4], 'and its viewport');
    assert.equal(fake.world.state, outerState, 'and its clear state');
    assert.equal(fake.calls.at(-2)[1], outer);
    assert.deepEqual(fake.calls.at(-1)[1], [1, 2, 3, 4]);
  }
});

test('pipe: the chain restores the target and the viewport before it displays', () => {
  const { fake, ctx, outer } = SEEDED();
  const source = renderTarget(ctx, { width: 16, height: 8 });
  fake.calls.length = 0;
  pipe(ctx, source, [fake.program([], ['uSource'])]);
  assert.equal(fake.world.bound, outer);
  assert.deepEqual(fake.world.viewport, [1, 2, 3, 4]);
  const restoreAt = fake.calls.findLastIndex((call) => call[0] === 'bindTarget');
  assert.equal(fake.calls[restoreAt][1], outer);
  assert.ok(restoreAt < fake.calls.findIndex((call) => call[0] === 'imageProgram'));
});

test('the clear colour stays the backend\'s: the only clear is `clear`', () => {
  const { fake, ctx } = SEEDED();
  const s = state(ctx, { width: 8, height: 8, clear: [0.1, 0.2, 0.3, 1] });
  fake.calls.length = 0;
  s.reset();
  const colourCalls = fake.calls.filter((call) => call[0].toLowerCase().includes('clear'));
  assert.deepEqual(colourCalls.map((call) => call[0]), ['clear', 'clear']);
  assert.deepEqual(colourCalls[0][1], [0.1, 0.2, 0.3, 1]);
});

test('disposeContext frees the layer\'s targets first, then the backend\'s own objects, once', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const a = renderTarget(ctx, { width: 8, height: 8 });
  const b = renderTarget(ctx, { width: 8, height: 8 });
  const s = state(ctx, { width: 8, height: 8 });
  s.dispose();
  fake.calls.length = 0;
  disposeContext(ctx);
  assert.deepEqual(namesOf(fake.calls), ['destroyTarget', 'destroyTarget', 'dispose']);
  assert.equal(ctx.targets.size, 0);
  assert.deepEqual(Object.keys(ctx.pipes), []);
  fake.calls.length = 0;
  disposeContext(ctx);
  assert.equal(fake.calls.length, 0, 'a second dispose is a no-op');
});
