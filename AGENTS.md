# idiom — the bridges' shared composite layer (repo ~/books/vcnotebook/idiom, branch main)
Design: `~/books/design/vcnotebook/stack/idiom.md`. Stack rules:
`~/books/design/vcnotebook/AGENTS.md`. The interface (`src/interface.js`) is the specification and the
conformance suite its executable half: a backend records the composite call sequence, and both bridges'
exports are checked against it. The package is published-internal — no application imports it and there
is no API site; the bridges re-export what they document. Depends on tree, and a backend comes from each
bridge; it never touches a GPU API.
Commands: npm test (the conformance suite) · npm run build (one ES build, `dist/index.js`).
