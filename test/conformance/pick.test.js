/**
 * @file Pick cases — the protocol over the recording backend: the cached 1 × 1
 *       target, the narrowed camera, what paint writes, the restore, and the
 *       decode of the pixel the backend answers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, pick, readPixel, renderTarget } from '../../src/index.js';
import { idToRgba, rgbaToId } from '@nakednous/tree';
import { createFake, namesOf } from '../fake.js';

const VP = [0, 300, 400, -300];
const rgba = (id) => Array.from(idToRgba([0, 0, 0, 1], id)).map((v) => Math.round(v * 255));

function idProgram(fake) {
  return fake.program(['uColor', 'uModelViewProjectionMatrix']);
}

test('pick: the cached 1 × 1 target, the narrowed camera, and the id paint writes', async () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const prog = idProgram(fake);
  fake.calls.length = 0;
  const id = await pick(ctx, 40, 60, (paint) => { paint(7); }, { vp: VP, program: prog });

  const creates = fake.calls.filter((c) => c[0] === 'createTarget');
  assert.equal(creates.length, 1, 'one 1 × 1 target, made once');
  assert.deepEqual([creates[0][1].width, creates[0][1].height], [1, 1]);
  assert.equal(id, 7, 'paint(7) reaches the readback and decodes');

  // the narrow projection: P was copied and mat4Pick'd, then put back
  const cameras = fake.calls.filter((c) => c[0] === 'setCamera');
  assert.equal(cameras.length, 2, 'installed narrowed, restored whole');
  assert.notDeepEqual(Array.from(cameras[0][2]), Array.from(cameras[1][2]));
  assert.deepEqual(Array.from(ctx.P), Array.from(cameras[1][2]), 'the record holds the camera it found');

  // paint went through setUniforms, on the id program, as the id's colour
  const painted = fake.calls.filter((c) => c[0] === 'setUniforms' && c[2].uColor);
  assert.deepEqual(painted.at(-1)[2].uColor, Array.from(idToRgba([0, 0, 0, 1], 7)));
});

test('pick: the target, viewport, depth state and program come back as they were', async () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const scene = renderTarget(ctx, { width: 8, height: 8 });
  const prog = idProgram(fake);
  ctx.backend.bindTarget(ctx, scene);
  ctx.prog = prog;
  const before = fake.world.state;
  fake.calls.length = 0;
  await pick(ctx, 2, 3, (paint) => paint(1), { vp: VP, program: prog });
  const names = namesOf(fake.calls);
  assert.equal(names[0], 'createTarget', 'the 1 × 1 target is made on the first pick');
  assert.ok(names.indexOf('clear') > names.indexOf('bindTarget'), 'cleared after the pick target is bound');
  assert.deepEqual(names.slice(-5, -1), ['setCamera', 'bindTarget', 'setViewport', 'setState'], 'the restore, in order, then the read');
  assert.equal(names.at(-1), 'readPixels');
  assert.equal(ctx.prog, prog, 'the bound program is the caller\'s again');
  assert.equal(fake.world.state, before, 'the depth state is the one it found');
  assert.equal(fake.world.bound, scene, 'the bound target is the caller\'s again');
});

test('pick: the id program is the backend\'s flat one by default, and uUseTexture is zeroed where declared', async () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  fake.calls.length = 0;
  await pick(ctx, 0, 0, (paint) => paint(2), { vp: VP });
  const flat = fake.calls.find((c) => c[0] === 'imageProgram');
  assert.ok(flat, 'the flat program is asked for');
  const zeroed = fake.calls.filter((c) => c[0] === 'setUniforms' && c[2].uUseTexture === 0);
  assert.equal(zeroed.length, 1, 'a program that declares uUseTexture gets 0');
});

test('pick and readPixel refuse what they cannot do, with a message and no draw', async () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    assert.equal(await pick(ctx, 0, 0, () => {}, {}), 0);          // no vp
    assert.equal(await pick(ctx, 0, 0, null, { vp: VP }), 0);      // no drawFn
    const px = await readPixel(ctx, null, 0, 0);                    // SCREEN: the backend's to answer
    assert.equal(px.length, 4);
    assert.deepEqual(fake.calls.at(-1).slice(1, 3), [null, 0], 'a null target reaches the backend as it came');
  } finally {
    console.error = original;
  }
  assert.match(logged.join('\n'), /opts\.vp/);
  assert.match(logged.join('\n'), /drawFn/);
  assert.deepEqual(namesOf(fake.calls), ['readPixels'], 'only the SCREEN read reached it — no pick drew');
});

test('readPixel asks the backend for one pixel of the target it is handed', async () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const target = renderTarget(ctx, { width: 4, height: 4 });
  fake.calls.length = 0;
  const px = await readPixel(ctx, target, 2, 3, { sync: true });
  assert.deepEqual(namesOf(fake.calls), ['readPixels']);
  assert.deepEqual(fake.calls[0].slice(2, 7), [2, 3, 1, 1, true]);
  assert.equal(px.length, 4);
  assert.equal(rgba(7).length, 4, 'the codec answers four bytes');
});
