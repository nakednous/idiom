/**
 * @file State cases — the pair, the swap, the count, the clears and the
 *       restores, as call transcripts over the fake backend.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, state, pipe } from '../../src/index.js';
import { createFake, namesOf } from '../fake.js';

/** The target bound at the last draw: the pair's routing. */
const bindAtDraw = (calls) => {
  const at = calls.findLastIndex((call) => call[0] === 'draw');
  for (let i = at; i >= 0; i--) if (calls[i][0] === 'bindTarget') return calls[i][1];
  return 'none';
};

/** Every setUniforms call's values, in order, the empty ones dropped. */
const valuesOf = (calls) => calls.filter((call) => call[0] === 'setUniforms').map((call) => call[2]).filter(Boolean);

test('state: a pair, a count, and sides that are the verb\'s to move', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const s = state(ctx, { width: 64, height: 32, format: 'a format token', minMag: 'a sampling token' });
  assert.equal(s.count, 0);
  assert.notEqual(s.read, s.write);
  assert.equal(s.read.width, 64);
  assert.equal(s.read.height, 32);
  // the sides and the count are the verb's: an assignment is a loud failure,
  // never the silent drift between a pair and a counter
  assert.throws(() => { s.read = s.write; }, TypeError);
  assert.throws(() => { s.count = 7; }, TypeError);
  assert.notEqual(s.read, s.write);
  assert.equal(s.count, 0);
  const specs = fake.calls.filter((call) => call[0] === 'createTarget').map((call) => call[1]);
  assert.equal(specs.length, 2);
  for (const spec of specs) {
    assert.equal(spec.depth, 'none', 'one colour texture per side');
    assert.equal(spec.format, 'a format token');
    assert.equal(spec.minMag, 'a sampling token');
    assert.equal(spec.samples, 1);
  }
});

test('state.pass: the read side is the input, the write side the target, then the swap', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = fake.program(['uScene'], ['uScene']);
  const s = state(ctx, { width: 64, height: 32 });
  const firstRead = s.read, firstWrite = s.write;

  fake.calls.length = 0;
  s.pass(prog, { uWeight: 1 });
  assert.equal(valuesOf(fake.calls).find((values) => values.uScene).uScene, firstRead.color, 'the input is the read side at the call');
  assert.equal(bindAtDraw(fake.calls), firstWrite, 'the draw lands in the write side');
  assert.equal(s.count, 1);
  assert.equal(s.read, firstWrite, 'the side just written is the read side now');
  assert.equal(s.write, firstRead);

  fake.calls.length = 0;
  s.pass(prog, { uWeight: 0.5 });
  assert.equal(valuesOf(fake.calls).find((values) => values.uScene).uScene, firstWrite.color);
  assert.equal(s.count, 2);
  assert.equal(s.read, firstRead, 'the pair alternates');
});

test('state.pass: the target and the viewport it found are restored', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = fake.program(['uScene'], ['uScene']);
  const s = state(ctx, { width: 64, height: 32 });
  const outer = fake.token('outer target');
  fake.world.bound = outer;
  fake.world.viewport = [1, 2, 3, 4];
  fake.calls.length = 0;
  s.pass(prog);
  assert.equal(fake.world.bound, outer);
  assert.deepEqual(fake.world.viewport, [1, 2, 3, 4]);
  assert.deepEqual(namesOf(fake.calls).slice(0, 2), ['setViewport', 'bindTarget'], 'the viewport is read before the binding moves');
  assert.equal(fake.calls.at(-2)[1], outer, 'the target it found is handed back');
  assert.deepEqual(fake.calls.at(-1)[1], [1, 2, 3, 4], 'and its viewport');
});

test('state.swap: exchanges the sides and leaves the count alone', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const s = state(ctx, { width: 8, height: 8 });
  const a = s.read, b = s.write;
  s.swap();
  assert.equal(s.read, b);
  assert.equal(s.write, a);
  assert.equal(s.count, 0);
});

test('state.reset: clears both sides to its own colour, zeroes the count, restores the context', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = fake.program(['uScene'], ['uScene']);
  const s = state(ctx, { width: 8, height: 8, clear: [1, 0, 0, 1] });
  s.pass(prog);
  const clear = fake.token('outer clear colour');
  fake.world.state = clear;
  fake.calls.length = 0;
  s.reset();
  const clears = fake.calls.filter((call) => call[0] === 'clear');
  assert.equal(clears.length, 2, 'both sides are cleared');
  assert.deepEqual(clears[0][1], [1, 0, 0, 1], 'to the state\'s own colour, through the backend');
  assert.equal(s.count, 0);
  assert.equal(fake.world.state, clear, 'the context keeps its own clear state');
});

test('state.resize and dispose: the count zeroes, the pair is defined again, the attachments go', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = fake.program(['uScene'], ['uScene']);
  const s = state(ctx, { width: 8, height: 8 });
  s.pass(prog);
  const after = s.read;
  fake.calls.length = 0;
  s.resize(16, 12);
  assert.equal(s.count, 0);
  assert.equal(s.read.width, 16);
  assert.equal(s.write.height, 12);
  assert.equal(s.read, after, 'a resize does not swap: the sides are a pass\'s');
  assert.equal(fake.calls.filter((call) => call[0] === 'clear').length, 2, 'reallocated storage is defined too');
  fake.calls.length = 0;
  s.dispose();
  assert.equal(namesOf(fake.calls).filter((name) => name === 'destroyTarget').length, 2);
});

test('state.pass: a program that did not bind advances nothing', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const s = state(ctx, { width: 8, height: 8 });
  const a = s.read, b = s.write;
  const outer = fake.token('outer target');
  fake.world.bound = outer;
  fake.world.state = { depth: true };
  s.pass(null);                                   // program(ctx, frag) returns null on a compile error
  assert.equal(s.count, 0, 'the count is a pass\'s, and no pass ran');
  assert.equal(s.read, a);
  assert.equal(s.write, b);
  assert.equal(fake.world.bound, outer, 'the caller\'s target is back');
  assert.deepEqual(fake.world.state, { depth: true }, 'and the state it found');
});

test('state: the pair is defined as it is made', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const outer = fake.token('outer target');
  fake.world.bound = outer;
  fake.calls.length = 0;
  const s = state(ctx, { width: 8, height: 8 });
  assert.equal(s.count, 0, 'a fresh state has run no pass');
  assert.equal(fake.calls.filter((call) => call[0] === 'clear').length, 2, 'both sides are cleared as they are made');
  assert.equal(fake.world.bound, outer, 'and the caller keeps its target');
});

test('a state composes: pipe reads the state\'s read side and leaves the pair alone', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const s = state(ctx, { width: 16, height: 8 });
  s.pass(fake.program(['uScene'], ['uScene']));
  const read = s.read, count = s.count;
  const stage = fake.program(['uSource'], ['uSource']);
  fake.calls.length = 0;
  const out = pipe(ctx, s.read.color, [stage], { display: false, key: 'chain' });
  assert.ok(out, 'the chain produced a target');
  assert.equal(valuesOf(fake.calls).filter((values) => values.uSource).at(-1).uSource, read.color);
  assert.equal(s.read, read, 'the chain does not swap another verb\'s pair');
  assert.equal(s.count, count);
});
