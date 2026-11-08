# Assets

Files made by the studio's own tools — Blender first. `assets/<name>.glb` is committed with
the game, served to the preview and copied by export; `assets/src/<name>.py` is the Blender
script that made it (re-running it replaces the file). Load with `loadAsset("<name>")` from
`src/assets.js`. Never downloaded, never copied from `references/`.

One exception, chosen for the photographic island ground: `textures/terrain/` holds CC0 photo
textures from Poly Haven, repacked; its README lists the sources and authors.
