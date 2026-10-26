# `@nakednous/idiom`

The composite layer `webgl.tree` and `webgpu.tree` share: render targets, passes — `fullscreen`,
`filter`, `image`, `pipe` — `state`'s owned pair, the textures' policy — `texture`, `upload`,
`cubemap` — the picking protocol — `readPixel`, `pick` — and the draw policy — `buffer`, `updateBuffer`, `writeBuffer`, the six declared transforms
and `draw` — over a per-API backend interface.

**Internal, experimental.** Not a public API: no application imports it directly, there is no API
site, and the bridges re-export what they document. Its only dependency is `@nakednous/tree`; a
backend is supplied by each bridge (twgl in `webgl.tree`, `webgpu-utils` in `webgpu.tree`), so this
package never touches a GPU API itself.

The interface is the specification and the conformance suite is its executable half: a recording fake
backend asserts the composite call sequence of every verb, an export/arity manifest pins the surface,
the restore contracts pin what each verb leaves as it found it, and the dependency line is a test.

```
createContext(backend) · disposeContext(ctx)
renderTarget(ctx, opts) · SCREEN
program(ctx, frag) · fullscreen(ctx) · filter(ctx, prog, uniforms, input)
image(ctx, tex, opts) · pipe(ctx, source, passes, opts) · releasePipe(ctx, key)
state(ctx, opts)
texture(ctx, source, opts) · upload(ctx, tex, source) · cubemap(ctx, faces, opts) · CUBE_FACES
readPixel(ctx, target, x, y) · pick(ctx, x, y, drawFn, opts)
buffer(ctx, arrays, opts) · updateBuffer(ctx, geo, arrays, opts) · writeBuffer(ctx, geo, arrays)
install(ctx, prog, M) · draw(ctx, geo, M, opts) · TRANSFORMS · declaredTransforms(names)
```

Status: `0.0.x`, experimental — targets, passes, `pipe`, `state`, the textures' policy and the draw
policy and the picking protocol, proven against the fake and by both bridges; the space mappings,
gizmos/HUD and the camera install are later stages. Gates: `npm test`, `npm run build`.
