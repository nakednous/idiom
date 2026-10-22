# `@nakednous/idiom`

The composite layer `webgl.tree` and `webgpu.tree` share: render targets, passes — `fullscreen`,
`filter`, `image`, `pipe` — and `state`'s owned pair, over a per-API backend interface.

**Internal, experimental.** Not a public API: no application imports it directly, there is no API
site, and the bridges re-export what they document. Its only dependency is `@nakednous/tree`; a
backend is supplied by each bridge (twgl in `webgl.tree`, `webgpu-utils` in `webgpu.tree`), so this
package never touches a GPU API itself.

The interface is the specification and the conformance suite is its executable half: a recording fake
backend asserts the composite call sequence of every verb, and an export manifest pins the surface.

Status: `0.0.x`, the package's first build. Nothing imports it yet.
