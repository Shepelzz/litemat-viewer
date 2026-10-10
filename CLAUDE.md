# litematica-viewer

Static web app: drop a `.litematic` file → toon-shaded, ink-outlined 3D illustration. 100% client-side, no backend.

## Commands
- `npm run dev` — dev server on :5173
- `npm run build` — production build to `dist/` (relative paths, `base: './'`)
- `npm run preview` — serve `dist/` on :4173
- `python3 tools/build_colors.py <mc-version>` — regenerate `src/colors.json`

## Pipeline (src/)
1. `litematic.js` — gzip → NBT parser → unpack Litematica bit-packed `BlockStates` (index = y*sx*sz + z*sx + x,
   values span across longs). Merges multiple regions (handles negative `Size`), crops empty space.
2. `convert.js` — shared model state `M`, block classification (`classify()` → kind), per-kind geometry rules
   (stairs → sloped wedges incl. inner/outer corners, slabs, panes, fences, walls, trapdoors, doors, leaves → blobs, …),
   colour lookup (`colors.json` + name fallbacks), automatic ground cut (`computeCut`).
3. `greedy.js` — greedy meshing of full cubes (merges coplanar same-colour faces).
4. `main.js` — three.js scene: MeshToonMaterial (3-step gradient), shadows, ortho camera, OrbitControls,
   post-process outline pass (depth + normal edges, line weight scales with on-screen block size), UI + progress.
5. `progress.js` — `step(frac,label)` yields to the browser every ~45 ms so the progress bar repaints.

## Conventions
- three.js is pinned to 0.147.0 (legacy colour management; colours are authored as displayed). Upgrading needs
  `renderer.outputColorSpace` / `THREE.ColorManagement` review or colours will shift.
- Add support for a new block shape: add a kind in `classify()` and a `case` in `convert()`;
  use `box()` / `rbox()` (facing-relative) helpers for cuboids.
- Keep everything client-side: files must never be uploaded anywhere.
