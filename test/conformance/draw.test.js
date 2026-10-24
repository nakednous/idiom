/**
 * @file The draw policy — the arrays shape under the shaders' names, the six
 *       declared transforms and the in-place write, as call transcripts over
 *       the fake backend. The cases follow the twin's draw and geometry tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEBGL, mat3NormalFromMat4, mat4FromTRS, mat4Mul, mat4Ortho } from '@nakednous/tree';
import {
  createContext, buffer, updateBuffer, writeBuffer, install, draw, TRANSFORMS, declaredTransforms,
} from '../../src/index.js';
import { createFake, namesOf } from '../fake.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** The last uniform bag the transcript carries. */
const lastBag = (calls) => calls.filter((call) => call[0] === 'setUniforms').at(-1)[2];

const A_SIX = TRANSFORMS.slice();
const A_TWO = ['uModelViewProjectionMatrix', 'uNormalMatrix'];

function matrices() {
  const V = mat4FromTRS(new Float32Array(16), 0, 0, -120, 0, 0, 0, 1, 1, 1, 1);
  const P = mat4Ortho(new Float32Array(16), -80, 80, -60, 60, 1, 400, WEBGL);
  const M = mat4FromTRS(new Float32Array(16), 12, -8, 0, 0, 0, 0.3826834323650898, 0.9238795325112867, 2, 1, 1);
  return { V, P, M };
}

/** A context bound to program `prog`, with V and P installed as the backend states them. */
function drawn(declares) {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const { V, P, M } = matrices();
  fake.backend.setCamera(ctx, V, P);
  const prog = fake.program(declares, []);
  ctx.prog = prog;
  const geo = buffer(ctx, { aPosition: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, 1, 1] } });
  return { fake, ctx, prog, geo, V, P, M };
}

test('the six names, and which of them a program declares', () => {
  assert.deepEqual(TRANSFORMS, [
    'uModelMatrix', 'uViewMatrix', 'uModelViewMatrix',
    'uProjectionMatrix', 'uModelViewProjectionMatrix', 'uNormalMatrix',
  ]);
  assert.deepEqual(declaredTransforms(A_SIX), {
    model: true, view: true, mv: true, proj: true, mvp: true, normal: true, any: true,
  });
  assert.deepEqual(declaredTransforms(['uModelViewProjectionMatrix', 'uColor']), {
    model: false, view: false, mv: false, proj: false, mvp: true, normal: false, any: true,
  });
  assert.deepEqual(declaredTransforms(new Set(A_SIX)), declaredTransforms(A_SIX), 'a Set reads as the list');
  assert.equal(declaredTransforms([]).any, false);
  assert.equal(declaredTransforms(null).any, false);
});

test('draw uploads the declared transforms: M, V, V·M, P, P·V·M and the normal', () => {
  const { fake, ctx, geo, V, P, M } = drawn(A_SIX);
  fake.calls.length = 0;
  draw(ctx, geo, M);
  const MV = mat4Mul(new Float32Array(16), V, M);
  const MVP = mat4Mul(new Float32Array(16), P, MV);
  assert.deepEqual(lastBag(fake.calls), {
    uModelMatrix: Array.from(M),
    uViewMatrix: Array.from(V),
    uModelViewMatrix: Array.from(MV),
    uProjectionMatrix: Array.from(P),
    uModelViewProjectionMatrix: Array.from(MVP),
    uNormalMatrix: Array.from(mat3NormalFromMat4(new Float32Array(9), MV)),
  });
  assert.deepEqual(namesOf(fake.calls), ['uniformsOf', 'setUniforms', 'draw'], 'the names once, the bag, the draw');
});

test('a draw with no model matrix uploads the installed camera\'s V and P · V', () => {
  const { fake, ctx, geo, V, P } = drawn(A_SIX);
  fake.calls.length = 0;
  draw(ctx, geo);
  const bag = lastBag(fake.calls);
  assert.deepEqual(bag.uModelMatrix, Array.from(IDENTITY));
  assert.deepEqual(bag.uViewMatrix, Array.from(V));
  assert.deepEqual(bag.uModelViewMatrix, Array.from(V));
  assert.deepEqual(bag.uModelViewProjectionMatrix, Array.from(mat4Mul(new Float32Array(16), P, V)));
  assert.deepEqual(bag.uNormalMatrix, Array.from(mat3NormalFromMat4(new Float32Array(9), V)));
});

test('the record states the camera the backend installed: V, P and P · V', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  assert.deepEqual(Array.from(ctx.V), Array.from(IDENTITY), 'a record before any camera reads the identity');
  const { V, P } = matrices();
  fake.backend.setCamera(ctx, V, P);
  assert.deepEqual(Array.from(ctx.V), Array.from(V));
  assert.deepEqual(Array.from(ctx.P), Array.from(P));
  assert.deepEqual(Array.from(ctx.PV), Array.from(mat4Mul(new Float32Array(16), P, V)));
});

test('a program that declares two of them gets two, and no name the program does not have', () => {
  const { fake, ctx, geo, V, P, M } = drawn(A_TWO);
  fake.calls.length = 0;
  draw(ctx, geo, M);
  const MV = mat4Mul(new Float32Array(16), V, M);
  assert.deepEqual(lastBag(fake.calls), {
    uModelViewProjectionMatrix: Array.from(mat4Mul(new Float32Array(16), P, MV)),
    uNormalMatrix: Array.from(mat3NormalFromMat4(new Float32Array(9), MV)),
  });
});

test('a program that declares none gets none: no uniform upload for the transforms', () => {
  const { fake, ctx, geo, M } = drawn([]);
  fake.calls.length = 0;
  draw(ctx, geo, M);
  assert.deepEqual(namesOf(fake.calls), ['uniformsOf', 'draw'], 'nothing declared, nothing asked');
});

test('the bag a bridge set first is superseded: a draw\'s own transform wins', () => {
  const { fake, ctx, prog, geo, M } = drawn(A_SIX);
  fake.backend.setUniforms(ctx, prog, { uModelMatrix: IDENTITY, uColor: [1, 0, 0, 1] });   // the bridge's bind
  fake.calls.length = 0;
  draw(ctx, geo, M);
  assert.deepEqual(lastBag(fake.calls).uModelMatrix, Array.from(M), 'the draw\'s value is uploaded after the bag');
});

test('each draw installs its own transforms: two draws, two model matrices, two uploads', () => {
  const { fake, ctx, geo, V, P, M } = drawn(A_TWO);
  const M2 = mat4FromTRS(new Float32Array(16), -20, 10, 0, 0, 0, 0, 1, 1, 1, 1);
  fake.calls.length = 0;
  draw(ctx, geo, M);
  const first = lastBag(fake.calls).uModelViewProjectionMatrix;
  draw(ctx, geo, M2);
  const second = lastBag(fake.calls).uModelViewProjectionMatrix;
  assert.deepEqual(first, Array.from(mat4Mul(new Float32Array(16), P, mat4Mul(new Float32Array(16), V, M))));
  assert.deepEqual(second, Array.from(mat4Mul(new Float32Array(16), P, mat4Mul(new Float32Array(16), V, M2))));
  assert.notDeepEqual(first, second);
  assert.equal(fake.calls.filter((call) => call[0] === 'setUniforms').length, 2);
});

test('without a bound program a draw says so and draws nothing', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const geo = buffer(ctx, { aPosition: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, 1, 1] } });
  fake.calls.length = 0;
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    assert.equal(draw(ctx, geo, null), null);
  } finally { console.error = original; }
  assert.match(logged[0], /no program bound/);
  assert.deepEqual(namesOf(fake.calls), [], 'no geometry was drawn');
});

test('install is a program\'s: the declared names are read once and one bag is reused', () => {
  const { fake, ctx, prog, V, P, M } = drawn(A_SIX);
  const seen = [];
  const backend = ctx.backend;
  const original = backend.setUniforms;
  backend.setUniforms = (c, p, values) => { seen.push(values); return original.call(backend, c, p, values); };
  fake.calls.length = 0;
  try {
    install(ctx, prog, M);
    assert.deepEqual(Object.keys(seen[0]), TRANSFORMS);
    install(ctx, prog, M);
  } finally { backend.setUniforms = original; }
  assert.equal(seen[0], seen[1], 'the bag is the program\'s own, not a new object a draw');
  assert.equal(fake.calls.filter((call) => call[0] === 'uniformsOf').length, 1, 'the names once per program');
  assert.deepEqual(Array.from(ctx.MV), Array.from(mat4Mul(new Float32Array(16), V, M)), 'MV is the record\'s scratch');
});

test('install asks only for the names a program has, and never allocates a bag per draw', () => {
  const { fake, ctx, prog } = drawn([]);
  const seen = [];
  const backend = ctx.backend;
  const original = backend.setUniforms;
  backend.setUniforms = (c, p, values) => { seen.push(Object.keys(values)); return original.call(backend, c, p, values); };
  try {
    install(ctx, prog, matrices().M);
  } finally { backend.setUniforms = original; }
  assert.deepEqual(seen, []);
});

test('buffer renames the arrays shape under the shaders\' names, and skips what holds no numbers', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const mesh = {
    position: { numComponents: 3, data: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]) },
    normal: { numComponents: 3, data: new Float32Array(9) },
    texcoord: { numComponents: 2, data: new Float32Array(6) },
    indices: { numComponents: 3, data: new Uint16Array([0, 1, 2]) },
    aHeat: { numComponents: 1, data: new Float32Array(3) },
    bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    count: 3,
    labels: ['a', 'b', 'c'],
  };
  const geo = buffer(ctx, mesh);
  assert.deepEqual(Object.keys(geo.arrays), ['aPosition', 'aNormal', 'aTexCoord', 'indices', 'aHeat']);
  assert.deepEqual(fake.calls.at(-1), ['createBuffer', geo.id, null]);
  const renamed = buffer(ctx, { position: mesh.position, aUV: mesh.texcoord });
  assert.deepEqual(Object.keys(renamed.arrays), ['aPosition', 'aUV'], 'a key of its own keeps its name');
});

test('joints upload unnormalised, as an index is', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const position = { numComponents: 3, data: new Float32Array(9) };
  const bare = buffer(ctx, { position, joints: new Uint16Array(8) });
  assert.equal(bare.arrays.aJoints.normalize, false);
  assert.equal(bare.arrays.aJoints.numComponents, 4);
  const shaped = buffer(ctx, { position, joints: { numComponents: 4, data: new Uint16Array(8), normalize: true } });
  assert.equal(shaped.arrays.aJoints.normalize, false, 'the key decides, not the caller');
  assert.equal(shaped.arrays.aJoints.numComponents, 4);
});

test('the creation options ride through buffer and updateBuffer, and the record keeps its identity', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const arrays = { position: { numComponents: 3, data: new Float32Array(9) } };
  const stream = { interleave: false, usage: 8 };
  const geo = buffer(ctx, arrays, stream);
  assert.deepEqual(fake.calls.at(-1), ['createBuffer', geo.id, stream]);
  fake.calls.length = 0;
  assert.equal(updateBuffer(ctx, geo, arrays, stream), geo);
  assert.deepEqual(fake.calls.at(-1), ['updateBuffer', geo.id, stream]);
});

test('writeBuffer rewrites the geometry in place: no new buffer, the arrays under the shaders\' names', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const geo = buffer(ctx, { position: { numComponents: 3, data: new Float32Array(9) } });
  const made = fake.buffers().length;
  fake.calls.length = 0;
  const writing = { position: { numComponents: 3, data: new Float32Array(9) }, color: { numComponents: 4, data: new Float32Array(12) } };
  assert.equal(writeBuffer(ctx, geo, writing), geo);
  assert.deepEqual(namesOf(fake.calls), ['writeBuffer'], 'the record is written, not made again');
  assert.deepEqual(fake.calls[0][1], geo.id);
  assert.deepEqual(Object.keys(fake.calls[0][2]), ['aPosition', 'aColor']);
  assert.equal(fake.buffers().length, made);
});
