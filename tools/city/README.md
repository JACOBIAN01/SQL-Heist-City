# City kit build

Turns the free **Downtown City MegaKit [Standard]** by Quaternius (CC0) into the small files the game loads from `client/public/city/`. Run it only when the piece list or textures change; it is not part of `npm run ci` and its dependencies are not installed by the repo. Design and budgets: `docs/city-kit.md`.

```
cd tools/city && npm install
# unzip the kit download into inbox/ (git-ignored), then:
node build-kit.mjs inbox/downtown ../../client/public/city
```

The input directory is the unzipped kit: it has `Exports/glTF (Godot)/` and `Textures/`.

## What it does
- **Pieces:** keeps the ~65 light pieces listed in `PIECES`, leaving out the pre-built buildings (18k–45k triangles each). Each piece becomes one node in `kit.glb`, at the origin, with at most two primitives: `kit` (opaque) and `decal` (road markings). Glass panes are dropped, so a window shows its fake interior.
- **Texture array:** every tiling texture becomes one 512 px layer of a texture array. The layers are stacked top to bottom in `kit-layers.webp`. Each opaque vertex carries a `_LAYER` byte that says which layer it samples. Because each layer wraps on its own, there's no atlas bleeding, and a whole chunk draws with one material. The kit's tinted variants (pale brick, dark trim, green trim) become their own pre-tinted layers. AO from the ORM maps is baked into the colour, and normal/ORM maps are not shipped.
- **Decals:** `kit-decals.webp` (1024 px, with alpha).
- **Size:** positions and normals are quantised (`KHR_mesh_quantization`, which three.js reads natively). UVs stay as floats because they tile far outside 0–1.
- **Manifest:** `kit.json` records each piece's bounds, triangle count, layers and whether it has decals, so the city grammar can place pieces without opening the glb.

Piece frame: y is up, the base is at y = 0, the facade face is at z = 0 and the wall runs into −z. Street surfaces are at y = −0.15, with the kerb and sidewalk top at y = 0.

Preview every piece: `npm run dev:client`, then open `http://localhost:5173/kit.html` (or `kit.html?piece=Brick_Plain_3`).

## Cars
```
node build-cars.mjs inbox/cars/OBJ ../../client/public/vehicles/cars.glb
```
Input: the **OBJ** folder of Quaternius' free *Cars* pack (CC0, hand-downloaded into `inbox/cars/`). Output: `cars.glb` (seven cars, 379 KB) and `cars.json` (sizes, wheel positions).
- **Colours and lamps:** the `.mtl` colours are baked into the vertices, so every car shares one material. Lamp materials (head/tail/police lights) get a `_GLOW` vertex flag.
- **No normals:** the cars are flat-shaded, so no normals are stored; the game uses `flatShading`, and the corners weld into shared vertices, about a fifth of the size.
- **Orientation:** cars are turned to face −z.
- **Parts:** each car node holds `<id>_body`, `<id>_wheel_fl`, `<id>_wheel_fr` and `<id>_wheels_back`. The wheel origins are their axles. Part names carry the id because loaders rename duplicate node names.

## Interior furniture
```
node build-interior.mjs inbox/interior/Interior ../../client/public/interior/interior.glb
```
Input: the `Interior` folder of Quaternius' free **Ultimate House Interior** pack (CC0, OBJ + MTL, hand-downloaded into `inbox/interior/`). Output: `interior.glb` (64 pieces, ~26k triangles, ~415 KB) and `interior.json` (each piece's bounds, triangles and whether it has lamps). Used for the bank interiors (Phase 11); the game loads it only when a bank interior is drawn.
- **Pieces:** the ~60 listed in `PIECES` (columns, doors, windows, curtains, lights, chairs, couches, tables, drawers, shelves, plants, carpets, bins, washroom fittings). The pack's kitchens, beds and cutlery are left out.
- **Scale:** the pack is about twice life size, so pieces are halved (doors come out 2.1 m, chairs 0.9 m). A few get their own scale: tables 0.65 (desk height), carpets and the mirror 1, the chandelier 0.8.
- **Frame:** base at y = 0, centred on x and z, front facing +z (the pack's own convention, checked by eye in the preview). Ceiling lights hang from y = 0. Single doors keep their hinge at x = 0, so they can swing.
- **Colours and lamps:** `.mtl` colours are baked into the vertices (one material for everything). The `Light` material gets a `_GLOW` flag, so lamps shine at night like the cars' (`client/src/render/bakedColourMaterial.ts`).
- **Size:** no normals (flat-shaded), welded, positions quantised.

Preview: `http://localhost:5173/kit.html?set=interior` (or `&piece=Couch_Large1`).

