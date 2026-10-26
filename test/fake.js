/**
 * @file A recording backend — the interface's test double. Every member appends
 *       its call to a transcript and the state reads back what the composites
 *       set; nothing here draws, allocates pixels or knows a GPU API.
 */

'use strict';

import { mat4Mul } from '@nakednous/tree';

/** The conventions a WebGL backend would state; the fake's are its own, pinned. */
export const CONVENTIONS = Object.freeze({
  ndcZMin: -1,
  uvOrientation: 'bottom-up',
  framebufferY: 'up',
  format: 'rgba8',
});

/** The names a transcript carries, in order. */
export const namesOf = (calls) => calls.map((call) => call[0]);

/** Snapshot the small arrays a uniform bag may hold, so a scratch array is a value here. */
function snapshot(values) {
  if (!values) return null;
  const out = {};
  for (const name of Object.keys(values)) {
    const value = values[name];
    out[name] = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : value;
  }
  return out;
}

/**
 * A backend that records every call.
 * @param {{ width?:number, height?:number }} [opts]  The canvas the world starts with.
 * @returns {{ backend:object, calls:Array, world:object, program:function,
 *             textures:function, buffers:function }}
 *          `backend` implements the interface; `calls` is the transcript;
 *          `world` is the API state the verbs read and set — `bound`, `viewport`,
 *          `state`, `program` — and may be seeded before a call.
 * @example
 * const { backend, calls } = createFake()
 * const ctx = createContext(backend)
 * renderTarget(ctx)
 * namesOf(calls)   // ['createTarget']
 */
export function createFake(opts) {
  const o = opts || {};
  const calls = [];
  const world = {
    width: o.width || 640,
    height: o.height || 480,
    bound: null,
    viewport: [0, 0, o.width || 640, o.height || 480],
    state: null,
    program: null,
    disposed: false,
  };
  const targets = [];
  const buffers = [];
  const textures = [];
  const declarations = new WeakMap();   // program → { uniforms, samplers }
  let seq = 0;

  const texture = (owner, width, height) => {
    const tex = { id: 'texture' + (++seq), owner, width, height };
    textures.push(tex);
    return tex;
  };
  const target = (spec) => {
    const width = spec.width === undefined ? world.width : spec.width;
    const height = spec.height === undefined ? world.height : spec.height;
    const t = {
      id: 'target' + (++seq),
      width,
      height,
      color: null,
      depth: null,
      resolved: null,
      resize(w, h) { t.width = w; t.height = h; calls.push(['target.resize', t.id, w, h]); return t; },
      resolve() { calls.push(['target.resolve', t.id]); return t; },
    };
    if (spec.color) t.color = texture(t.id, width, height);
    if (spec.depth === 'texture') t.depth = texture(t.id, width, height);
    for (const name of spec.names) t[name] = texture(t.id, width, height);
    if (spec.samples > 1) t.resolved = { id: 'resolved' + (++seq), owner: t.id, width, height };
    targets.push(t);
    return t;
  };
  const program = (uniforms, samplers) => {
    const p = { id: 'program' + (++seq), program: { id: seq }, frag: null };
    declarations.set(p, { uniforms: uniforms || [], samplers: samplers || [] });
    return p;
  };

  const backend = {
    ...CONVENTIONS,
    createTarget(ctx, spec) {
      const t = target(spec);
      calls.push(['createTarget', spec, t.id]);
      return t;
    },
    destroyTarget(ctx, t) { calls.push(['destroyTarget', t.id]); },
    bindTarget(ctx, t) {
      calls.push(['bindTarget', t]);
      const prior = world.bound;
      if (t !== undefined) {
        world.bound = t;
        world.viewport = t === null ? [0, 0, world.width, world.height] : [0, 0, t.width, t.height];
      }
      return prior;
    },
    clear(ctx, color) { calls.push(['clear', color ? Array.from(color) : color]); },
    createProgram(ctx, frag) {
      const p = { id: 'program' + (++seq), program: { id: seq }, frag };
      declarations.set(p, { uniforms: [], samplers: [] });
      calls.push(['createProgram', p.id, frag]);
      return p;
    },
    imageProgram(ctx) {
      if (!backend.image) {
        backend.image = { id: 'imageProgram', program: { id: 'image' }, frag: 'image' };
        declarations.set(backend.image, { uniforms: ['uTexture', 'uUseTexture', 'uColor', 'uModelViewProjectionMatrix'], samplers: ['uTexture'] });
      }
      calls.push(['imageProgram', backend.image.id]);
      return backend.image;
    },
    uniformsOf(p) { calls.push(['uniformsOf', p.id]); const d = declarations.get(p); return d ? d.uniforms.slice() : []; },
    samplersOf(p) { calls.push(['samplersOf', p.id]); const d = declarations.get(p); return d ? d.samplers.slice() : []; },
    setUniforms(ctx, p, values) {
      calls.push(['setUniforms', p.id, snapshot(values)]);
      world.program = p;
      if (values && values.uColor) world.painted = Array.from(values.uColor).map((v) => Math.round(v * 255));
    },
    setCamera(ctx, V, P) {
      calls.push(['setCamera', V, P]);
      // the interface's record shape: the install leaves V, P and P · V stated
      for (let i = 0; i < 16; i++) { ctx.V[i] = V[i]; ctx.P[i] = P[i]; }
      mat4Mul(ctx.PV, ctx.P, ctx.V);
    },
    draw(ctx, p, geometry) { calls.push(['draw', p.id, geometry.id]); },
    drawInstanced(ctx, p, geometry, count) { calls.push(['drawInstanced', p.id, geometry.id, count]); },
    createBuffer(ctx, arrays, opts) {
      const b = { id: 'buffer' + (++seq), arrays };
      buffers.push(b);
      calls.push(['createBuffer', b.id, opts || null]);
      return b;
    },
    updateBuffer(ctx, b, arrays, opts) {
      b.arrays = arrays;
      calls.push(['updateBuffer', b.id, opts || null]);
      return b;
    },
    writeBuffer(ctx, b, arrays) {
      b.arrays = arrays;
      calls.push(['writeBuffer', b.id, arrays]);
      return b;
    },
    readPixels(ctx, t, x, y, width, height, opts) {
      calls.push(['readPixels', t ? t.id : null, x, y, width, height, !!opts]);
      const painted = world.painted || [0, 0, 0, 255];      // what paint(id) last wrote into uColor
      return Promise.resolve(Uint8Array.from(painted));
    },
    createTexture(ctx, descriptor) { const tex = texture(null, (descriptor && descriptor.width) || 0, (descriptor && descriptor.height) || 0); calls.push(['createTexture', descriptor, tex.id]); return tex; },
    uploadTexture(ctx, tex, source) { calls.push(['uploadTexture', tex.id]); },
    createCubeTexture(ctx, faces, opts) { const tex = texture(null, 0, 0); calls.push(['createCubeTexture', faces.length, tex.id]); return tex; },
    destroyTexture(ctx, tex) { calls.push(['destroyTexture', tex.id]); },
    textureSize(ctx, tex) { return (ctx.sizes && ctx.sizes.get(tex)) || (tex.width ? [tex.width, tex.height] : null); },   // a query: it records nothing
    setViewport(ctx, rect) {
      calls.push(['setViewport', rect]);
      const prior = world.viewport;
      if (rect !== undefined) world.viewport = [rect[0], rect[1], rect[2], rect[3]];
      return prior;
    },
    setState(ctx, state) {
      calls.push(['setState', state]);
      const prior = world.state;
      if (state !== undefined) world.state = state;
      return prior;
    },
    dispose(ctx) { calls.push(['dispose']); world.disposed = true; },
  };

  return {
    backend,
    calls,
    world,
    /** A program record with the names it declares — what the backend compiled. */
    program,
    /** A target token for seeding a world, outside the transcript. */
    token: (id) => ({ id }),
    /** The textures the fake made, in creation order. */
    textures: () => textures.slice(),
    /** The buffers the fake made, in creation order. */
    buffers: () => buffers.slice(),
    /** The targets the fake made, in creation order. */
    targets: () => targets.slice(),
  };
}
