/**
 * @file Pass cases — program, fullscreen, filter, image, pipe and releasePipe,
 *       as call transcripts over the fake backend.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, renderTarget, program, fullscreen, filter, image, pipe, releasePipe } from '../../src/index.js';
import { passOf } from '../../src/pass.js';
import { createFake, namesOf } from '../fake.js';

/** The target bound at the last draw: the composite's own routing. */
const bindAtDraw = (calls) => {
  const at = calls.findLastIndex((call) => call[0] === 'draw');
  for (let i = at; i >= 0; i--) if (calls[i][0] === 'bindTarget') return calls[i][1];
  return 'none';
};

/** Every setUniforms call's values, in order. */
const uniformsOf = (calls) => calls.filter((call) => call[0] === 'setUniforms').map((call) => call[2]);

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('program compiles a fragment shader; fullscreen makes the quad once', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = program(ctx, 'frag source');
  assert.deepEqual(fake.calls[0], ['createProgram', prog.id, 'frag source']);
  fake.calls.length = 0;
  const quad = fullscreen(ctx);
  assert.equal(fullscreen(ctx), quad, 'the geometry is cached on the context');
  assert.deepEqual(namesOf(fake.calls), ['createBuffer']);
  assert.deepEqual(quad.arrays.aPosition.data, [-1, -1, 1, -1, -1, 1, 1, 1]);
  assert.deepEqual(quad.arrays.aTexCoord.data, [0, 0, 1, 0, 0, 1, 1, 1]);
});

test('filter: the bag, the input by declaration, the two derived uniforms, then the draw', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const input = renderTarget(ctx, { width: 64, height: 32 });
  const prog = fake.program(['uScene', 'uResolution', 'uTexelSize'], ['uScene']);
  const prior = { id: 'prior state' };
  fake.world.state = prior;
  fake.world.viewport = [0, 0, 320, 240];
  fake.calls.length = 0;

  assert.equal(filter(ctx, prog, { uWeight: 1 }, input), prog);
  assert.deepEqual(namesOf(fake.calls), ['setState', 'setUniforms', 'samplersOf', 'uniformsOf', 'setViewport', 'setUniforms', 'createBuffer', 'draw', 'setState']);
  assert.deepEqual(fake.calls[0][1], { depth: false }, 'the depth test is off for the pass');
  assert.deepEqual(uniformsOf(fake.calls)[0], { uWeight: 1 }, 'the bag first');
  assert.deepEqual(uniformsOf(fake.calls)[1], {
    uScene: input.color,
    uResolution: [320, 240],
    uTexelSize: [1 / 64, 1 / 32],
  });
  assert.equal(fake.calls.at(-1)[1], prior, 'the state it found is back');
});

test('filter: the names a program declares are read once, and the bag wins', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const input = renderTarget(ctx, { width: 8, height: 8 });
  const other = { id: 'another texture' };
  const prog = fake.program(['uScene'], ['uScene']);
  filter(ctx, prog, null, input);
  fake.calls.length = 0;
  filter(ctx, prog, { uScene: other }, input);
  assert.deepEqual(namesOf(fake.calls), ['setState', 'setUniforms', 'draw', 'setState']);
  assert.deepEqual(uniformsOf(fake.calls)[0], { uScene: other }, 'the bag\'s value is not overwritten');
  assert.equal(fake.calls.filter((call) => call[0] === 'samplersOf').length, 0, 'read once per program');
});

test('filter: a stage that reads no texture is handed none', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const input = renderTarget(ctx, { width: 8, height: 8 });
  const prog = fake.program(['uCells'], []);
  fullscreen(ctx);
  fake.calls.length = 0;
  filter(ctx, prog, { uCells: 8 }, input);
  assert.deepEqual(namesOf(fake.calls), ['setState', 'setUniforms', 'samplersOf', 'uniformsOf', 'draw', 'setState']);
  assert.deepEqual(uniformsOf(fake.calls), [{ uCells: 8 }]);
});

test('filter: the declared samplers a stage declares and nobody sets are logged once per program', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = fake.program([], ['uScene', 'uDepth']);
  fullscreen(ctx);
  const errors = [];
  const real = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    filter(ctx, prog, null);
    filter(ctx, prog, null);
  } finally { console.error = real; }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /uScene/);
});

test('filter: uTexelSize reads the bag\'s uSource when no input is given', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const tex = { id: 'source texture' };
  ctx.sizes.set(tex, [8, 4]);
  const prog = fake.program(['uTexelSize'], []);
  fullscreen(ctx);
  fake.calls.length = 0;
  filter(ctx, prog, { uSource: tex });
  assert.deepEqual(uniformsOf(fake.calls).at(-1), { uTexelSize: [1 / 8, 1 / 4] });
});

test('filter: a program that did not bind draws nothing and touches no state', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  fake.calls.length = 0;
  assert.equal(filter(ctx, null, null), null);
  assert.equal(fake.calls.length, 0);
});

test('image: the flat program on the rect, the state asked for, and the state it found', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const tex = { id: 'shown texture' };
  const prior = { id: 'prior state' };
  fake.world.state = prior;
  fullscreen(ctx);
  fake.calls.length = 0;
  image(ctx, tex, { x: 20, y: 20, width: 160, height: 120 });
  assert.deepEqual(namesOf(fake.calls), ['setViewport', 'setState', 'imageProgram', 'setUniforms', 'draw', 'setState']);
  assert.deepEqual(fake.calls[1][1], { depth: false });
  const values = uniformsOf(fake.calls)[0];
  assert.equal(values.uTexture, tex);
  assert.equal(values.uUseTexture, true);
  assert.deepEqual(values.uColor, [1, 1, 1, 1]);
  const m = values.uModelViewProjectionMatrix;
  assert.equal(m[0], 160 / 640);
  assert.equal(m[5], 120 / 480);
  near(m[12], 2 * 100 / 640 - 1);
  near(m[13], 2 * 80 / 480 - 1);
  assert.equal(fake.calls.at(-1)[1], prior, 'the state it found is back');
});

test('image: cover is the identity, and mask and blend travel only when asked', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const tex = { id: 'shown texture' };
  fullscreen(ctx);
  fake.calls.length = 0;
  image(ctx, tex, { mask: [true, true, true, false], blend: 'ADD' });
  assert.deepEqual(fake.calls[1][1], { depth: false, mask: [true, true, true, false], blend: 'ADD' });
  const m = uniformsOf(fake.calls)[0].uModelViewProjectionMatrix;
  assert.deepEqual(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('pipe: a three-stage chain alternates the pair, each stage reading the one before', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const source = renderTarget(ctx, { width: 100, height: 50 });
  const stages = [fake.program([], ['uSource']), fake.program(['uResolution'], ['uSource']), fake.program([], ['uSource'])];
  fullscreen(ctx);
  fake.calls.length = 0;
  const out = pipe(ctx, source, stages, { display: false });
  const created = fake.calls.filter((call) => call[0] === 'createTarget');
  assert.equal(created.length, 2);
  assert.deepEqual(created[0][1].width, 100);
  assert.deepEqual(created[0][1].height, 50);
  assert.equal(created[0][1].depth, 'none');
  const ping = fake.targets().at(-2), pong = fake.targets().at(-1);
  assert.equal(out, ping, 'three stages end on the first target');
  assert.equal(bindAtDraw(fake.calls), ping);
  const filled = uniformsOf(fake.calls).filter(Boolean);
  assert.deepEqual(filled.filter((values) => values.uSource).map((values) => values.uSource), [source.color, ping.color, pong.color]);
  assert.deepEqual(filled.filter((values) => values.uResolution)[0].uResolution, [100, 50], 'a stage resolves to the chain\'s size');
  assert.equal(fake.calls.some((call) => call[0] === 'imageProgram'), false, 'display: false shows nothing');
});

test('pipe: the display shows the result on the target the chain found', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const source = renderTarget(ctx, { width: 32, height: 16 });
  const outer = fake.token('outer target');
  fake.world.bound = outer;
  fake.world.viewport = [1, 2, 3, 4];
  fullscreen(ctx);
  fake.calls.length = 0;
  pipe(ctx, source, [fake.program([], ['uSource'])]);
  assert.equal(fake.calls.some((call) => call[0] === 'imageProgram'), true);
  assert.equal(fake.world.bound, outer, 'the chain leaves the target it found');
  assert.deepEqual(fake.world.viewport, [1, 2, 3, 4], 'and its viewport');
  const restoreAt = fake.calls.findLastIndex((call) => call[0] === 'bindTarget');
  assert.equal(fake.calls[restoreAt][1], outer, 'the restore hands back the token it was given');
  assert.ok(restoreAt < fake.calls.findIndex((call) => call[0] === 'imageProgram'), 'the display runs on the outer target');
  assert.equal(bindAtDraw(fake.calls), outer);
});

test('pipe: no passes shows the source as it is', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const source = renderTarget(ctx, { width: 32, height: 16 });
  fullscreen(ctx);
  fake.calls.length = 0;
  assert.equal(pipe(ctx, source, []), null);
  assert.equal(fake.calls.some((call) => call[0] === 'imageProgram'), true);
  assert.equal(fake.calls.some((call) => call[0] === 'createTarget'), false, 'no pair is allocated');
});

test('a pipe entry: the program record itself, or a bag iff it carries a `uniforms` key', () => {
  const fake = createFake();
  const prog = fake.program(['uCells'], []);
  assert.deepEqual(passOf(prog), { program: prog, uniforms: null }, 'a bare program is the record, identified by .program');
  assert.deepEqual(passOf({ program: prog, uniforms: { uCells: 8 } }), { program: prog, uniforms: { uCells: 8 } });
  // the key is what makes a bag: an entry that carries it is never read as a program
  assert.equal(passOf({ program: prog, uniforms: undefined }).program, prog);
  assert.equal(passOf({ uniforms: { uCells: 8 } }), null, 'a bag needs a program');
  assert.equal(passOf({ program: undefined }), null);
  assert.equal(passOf(null), null);
  assert.equal(passOf('a program'), null);
});

test('pipe: a bag stage keeps its own uniforms and a bare program stage runs beside it', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const source = renderTarget(ctx, { width: 16, height: 8 });
  const pixelate = fake.program(['uCells'], []);
  const invert = fake.program([], ['uSource']);
  fullscreen(ctx);
  fake.calls.length = 0;
  pipe(ctx, source, [{ program: pixelate, uniforms: { uCells: 8 } }, invert], { display: false });
  const ping = fake.targets().at(-2);
  const bags = uniformsOf(fake.calls).filter(Boolean);
  assert.deepEqual(bags[0], { uCells: 8 }, 'the bag stage keeps its bag');
  assert.deepEqual(bags[1], { uSource: ping.color }, 'the bare stage reads the chain\'s texture');
  assert.equal(fake.calls.filter((call) => call[0] === 'draw').length, 2);
});

test('releasePipe frees the cached pair — a named key, the default, or every pair — and only its own', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const source = renderTarget(ctx, { width: 8, height: 8 });
  const stage = fake.program([], ['uSource']);
  pipe(ctx, source, [stage], { key: 'fx', display: false });
  pipe(ctx, source, [stage], { display: false });
  assert.deepEqual(Object.keys(ctx.pipes).sort(), ['default', 'fx']);
  fake.calls.length = 0;
  releasePipe(ctx, 'fx');
  assert.deepEqual(namesOf(fake.calls), ['destroyTarget', 'destroyTarget']);
  assert.deepEqual(Object.keys(ctx.pipes), ['default']);
  fake.calls.length = 0;
  releasePipe(ctx, true);
  assert.equal(namesOf(fake.calls).filter((name) => name === 'destroyTarget').length, 2);
  assert.deepEqual(Object.keys(ctx.pipes), []);
  fake.calls.length = 0;
  releasePipe(ctx, 'default');
  assert.equal(fake.calls.length, 0, 'an empty cache frees nothing');
});
