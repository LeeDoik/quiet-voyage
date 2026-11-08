# Terrain textures

Photo textures from [Poly Haven](https://polyhaven.com), CC0 (public domain), 1K source maps
repacked for the island terrain shader (`public/src/terrain-material.js`). `-512` files are the
low-quality tier.

| File | Source asset | Author |
|---|---|---|
| `grass-*` | [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel |
| `rock-*` | [rock_face_03](https://polyhaven.com/a/rock_face_03) | Dario Barresi, Rico Cilliers |
| `sand-*` | [coast_sand_01](https://polyhaven.com/a/coast_sand_01) | Rob Tuytel |
| `shore-*` | [coast_sand_rocks_02](https://polyhaven.com/a/coast_sand_rocks_02) | Rob Tuytel |

- `*-albedo.jpg`: diffuse colour multiplied by the ambient-occlusion map (sRGB).
- `*-normal.jpg`: R, G = OpenGL normal X, Y; B = roughness (linear).
