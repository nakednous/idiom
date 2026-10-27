/**
 * @file Pipe cases — a gizmo's cache, the wide line's expansion, the width
 *       policy the backend is handed, and the HUD's ortho.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, gizmo, fill, expand, drawLines, drawPane, beginHUD, endHUD, inHUD } from '../../src/index.js';
import { createFake, namesOf } from '../fake.js';

/** A generator that writes n line-list vertices into arrays and answers the count. */
const lines = (n) => (a) => {
  for (let i = 0; i < n; i++) {
    a.position.data[3 * i] = i;
    a.position.data[3 * i + 1] = 0;
    a.position.data[3 * i + 2] = 0;
  }
  a.count = n;
  return n;
};

test('gizmo: one cache a name a context, and fill reuses its geometry in place', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const g = gizmo(ctx, 'axes', { color: true });
  assert.equal(gizmo(ctx, 'axes'), g, 'the same cache for the same name');
  assert.notEqual(gizmo(ctx, 'grid'), g, 'a cache a name');

  fill(ctx, g, lines(4));
  const first = g.buffer;
  assert.ok(first, 'a geometry is made');
  fake.calls.length = 0;
  fill(ctx, g, lines(4));
  assert.equal(g.buffer, first, 'the second fill writes in place');
  assert.deepEqual(namesOf(fake.calls), ['writeBuffer'], 'no rebuild, one in-place write');

  fake.calls.length = 0;
  fill(ctx, g, lines(200));
  assert.notEqual(g.buffer, first, 'a count past the capacity rebuilds');
  assert.deepEqual(namesOf(fake.calls), ['createBuffer']);
  assert.equal(g.capacity, 200);
});

test('fill: the creation options reach the backend, and a rebuild keeps them', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const g = gizmo(ctx, 'rig', { color: true });
  const creation = { program: { id: 'line' }, interleave: false, stream: true };
  fill(ctx, g, lines(4), creation);
  const first = fake.calls.find((c) => c[0] === 'createBuffer');
  assert.ok(first, 'a geometry is made');
  fake.calls.length = 0;
  fill(ctx, g, lines(200));                                   // past the cache's 64: a rebuild, no opts passed
  const rebuild = fake.calls.find((c) => c[0] === 'createBuffer');
  assert.ok(rebuild, 'the rebuild creates one');
  assert.deepEqual(rebuild[2], creation, 'with the options the cache remembers');
});

test('expand: four vertices and six indices a segment, the endpoints and their colours', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const g = gizmo(ctx, 'hermite', { color: true });
  const PALETTE = [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 0, 1]];   // a colour a vertex
  fill(ctx, g, (a) => {
    for (let i = 0; i < 4; i++) {                    // two segments
      a.position.data[3 * i] = i; a.position.data[3 * i + 1] = 0; a.position.data[3 * i + 2] = 0;
      for (let k = 0; k < 4; k++) a.color.data[4 * i + k] = PALETTE[i][k];
    }
    a.count = 4;
    return 4;
  });
  const w = expand(ctx, g);
  assert.equal(w.segments, 2, 'two segments from four vertices');
  assert.ok(w.buffer, 'the wide geometry exists');
  assert.deepEqual(Array.from(g.wide.A.slice(0, 3)), [0, 0, 0], 'the first segment starts at the first endpoint');
  assert.deepEqual(Array.from(g.wide.B.slice(0, 3)), [1, 0, 0], 'and ends at the second');
  assert.deepEqual(Array.from(g.wide.T.slice(0, 4)), [0, 0, 1, 1], 'which end each vertex sits at');
  assert.deepEqual(Array.from(g.wide.S.slice(0, 4)), [-1, 1, -1, 1], 'and its side');
  assert.deepEqual(Array.from(g.wide.indices.slice(0, 6)), [0, 1, 2, 1, 3, 2], 'two triangles a segment');
  // every vertex of a segment's quad carries its own endpoint's colour: the first
  // two vertices the segment's start, the last two its end — a colour is four floats
  // a vertex where a position is three, so a quad's block is read by the vertex
  assert.deepEqual(Array.from(g.wide.color.slice(0, 16)),
    [...PALETTE[0], ...PALETTE[0], ...PALETTE[1], ...PALETTE[1]], 'the first segment, red to green');
  assert.deepEqual(Array.from(g.wide.color.slice(16, 32)),
    [...PALETTE[2], ...PALETTE[2], ...PALETTE[3], ...PALETTE[3]], 'the second, blue to yellow');
});

test('drawLines: the width in logical pixels crosses to device pixels, and picks the program', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const g = gizmo(ctx, 'grid', { color: true });
  fill(ctx, g, lines(4));

  fake.calls.length = 0;
  drawLines(ctx, g, { width: 1, dpr: 2 });                 // two device pixels: the wide path
  let call = fake.calls.find((c) => c[0] === 'drawGizmo');
  assert.equal(call[1], 'wide');
  assert.equal(call[3].width, 2, 'the spec carries device pixels');
  assert.equal(call[3].count, 12, 'six indices a segment, two segments');

  fake.calls.length = 0;
  drawLines(ctx, g, { width: 0.5, dpr: 2 });               // one device pixel: the line list
  call = fake.calls.find((c) => c[0] === 'drawGizmo');
  assert.equal(call[1], 'line');
  assert.equal(call[3].count, 4);
  assert.equal(call[3].useColor, true, 'the arrays carry colour');

  fake.calls.length = 0;
  drawPane(ctx, gizmo(ctx, 'pane', { texcoord: true }));   // an empty cache draws nothing
  assert.equal(fake.calls.filter((c) => c[0] === 'drawGizmo').length, 0);
});

test('drawLines: a labelled cache hands each item out under the draw\'s model matrix', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const g = gizmo(ctx, 'rig', { color: true, labels: true });
  fill(ctx, g, (a) => {
    a.position.data[0] = 1; a.count = 2;
    a.labels.push({ x: 1, y: 2, z: 3, text: 'L0' }, { x: 0, y: 0, z: 0, text: 'L1' });
    return 2;
  });
  const sink = [];
  // a translation of (10, 20, 30): an anchor is world space, not the generator's frame
  const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];

  fake.calls.length = 0;
  drawLines(ctx, g, { M, width: 1, dpr: 1, identify: (id, text, x, y, z) => sink.push({ id, text, x, y, z }) });
  const call = fake.calls.find((c) => c[0] === 'drawGizmo');
  assert.equal(call[3].labels.length, 2, 'the spec carries the items the draw places');
  assert.equal(typeof call[3].identify, 'function', 'and the sink, for the backend to forward them to');
  assert.deepEqual(call[3].labels.map((l) => l.id), ['rig:0', 'rig:1'], 'an id is the cache\'s name and the label\'s index');
  assert.deepEqual(call[3].labels.map((l) => l.text), ['L0', 'L1']);
  assert.deepEqual(call[3].labels.map((l) => [l.x, l.y, l.z]), [[11, 22, 33], [10, 20, 30]], 'the anchor under M');

  // a second draw states the same ids over the same items — one label a frame, reused by id
  fake.calls.length = 0;
  drawLines(ctx, g, { identify: () => {} });
  assert.deepEqual(fake.calls.find((c) => c[0] === 'drawGizmo')[3].labels.map((l) => l.id), ['rig:0', 'rig:1']);

  // no sink, no items: a draw that is not asked for labels carries none
  fake.calls.length = 0;
  drawLines(ctx, g, {});
  const plain = fake.calls.find((c) => c[0] === 'drawGizmo');
  assert.equal(plain[3].labels, null);
  assert.equal(plain[3].identify, null);
});

test('drawPane: the draw counts the cache\'s vertices, not the room its geometry has', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const g = gizmo(ctx, 'pane', { texcoord: true });
  fill(ctx, g, (a) => {                                // six vertices of a 64-vertex cache: a quad
    a.count = 6;
    return 6;
  });
  assert.equal(g.capacity > 6, true, 'the geometry is sized to the cache, which is more than the pane writes');
  fake.calls.length = 0;
  drawPane(ctx, g, { color: [1, 1, 1, 1] });
  const call = fake.calls.find((c) => c[0] === 'drawGizmo');
  assert.equal(call[1], 'pane');
  assert.equal(call[3].count, 6, 'the pane\'s own six vertices');
});

test('the HUD: the viewport is required, the ortho goes in, the camera and depth come back', () => {
  const fake = createFake();
  const ctx = createContext(fake.backend);
  const beforeP = Array.from(ctx.P);
  const depth = fake.world.state;

  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    assert.equal(beginHUD(ctx, {}), null);                  // no vp
  } finally {
    console.error = original;
  }
  assert.match(logged[0], /opts\.vp/);

  const hud = beginHUD(ctx, { vp: [0, 300, 400, -300] });
  assert.ok(hud, 'the saved state is the answer');
  assert.notDeepEqual(Array.from(ctx.P), beforeP, 'an ortho is installed');
  assert.equal(ctx.backend.setState(ctx).depth, false, 'the depth test is off');

  endHUD(ctx);
  assert.deepEqual(Array.from(ctx.P), beforeP, 'the camera is back');
  assert.equal(fake.world.state, depth, 'and the depth state it found');

  let ran = false;
  inHUD(ctx, { vp: [0, 300, 400, -300] }, () => { ran = true; assert.ok(ctx.hud, 'inside, HUD mode is on'); });
  assert.equal(ran, true);
  assert.equal(ctx.hud, null, 'and it is off after');
});
