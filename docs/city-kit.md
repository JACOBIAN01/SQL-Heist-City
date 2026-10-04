# City kit (Quaternius Downtown City MegaKit)

The city, banks and streets are built from the free **Downtown City MegaKit [Standard]** by Quaternius (CC0, itch.io: `quaternius.itch.io/downtown-city-megakit`). This page records what the kit contains, what it does *not* contain, and the design rules that follow, so Phases 6–9 are planned around it. Facts below were measured on the downloaded kit (153 glTF pieces).

## What is in the kit
| Group | Pieces | Notes |
|---|---|---|
| Streets | 2-lane, 4-lane, curves, T and 4-way intersections, plain asphalt tiles, road **decals** (arrows, crosswalks, stripes) | segments are 6 m wide × 6/12/18 m long; intersection 24.7 m; all roughly 2–900 triangles |
| Sidewalks | straight, corner (flat/round), no-curb, planter | 3 m modules |
| Facade pieces | brick, metal, trim/concrete walls; window variants; columns; corners; cornices; ground-floor shop fronts; door frames and doors | **2 m wide × 3 m tall** (some 4 m wide); median 48 triangles, windows 200–1100 |
| Roofs | flat 2×2 / 4×4, slate roofs with cornices and dormers | |
| Interior | `Floor_2x2/4x4`, thin `InteriorWall_*` planes, marble floor texture, stairs with metal rails, entrance steps | enough for a plain bank lobby; no furniture, counters or vault |
| Pre-built buildings | 3 (`Building_Small_1`, `Medium_2`, `Large_2`) | **18k–45k triangles and 12–13 materials each: too heavy to place 25 of them** |
| Props | AC unit, bollard, drain, manhole, planter | few |
| "Fake interior" materials | 5 interior-mapping textures for windows | makes a window look like it has a room behind it for ~free |

The Standard (free) kit has ~150 of the Source kit's 300+ pieces. The Source version is paid; we do not depend on it.

## What is *not* in the kit
- **Vehicles.** The separate Quaternius *Cars* pack is FBX/Blend on Google Drive, which cannot be fetched by script. Phase 8.7 either uses a hand-downloaded pack (the user drops files in `tools/city/inbox/`) or simple procedural cars.
- **Street furniture and nature:** lamps, hydrants, benches, trees, signs. Build tiny procedural props (a pole and a box), or add a Quaternius props pack later.
- **Bank-specific interior:** counters, vault door, safe-deposit wall, elevator. Built from boxes/planes in code and registered like any other piece.
- **Textures are huge:** 21 materials, 142 MB of PNG (base colour + normal + ORM each). They must be shrunk before shipping (see budgets).

## Design rules that follow

### 1. Gameplay never depends on art
The server must not read art meshes. A **`CityLayout`** (in `shared/`, seeded) is the single source of truth: roads, blocks, lots, building footprints and floor counts, bank/safehouse sites, interior room graphs. Two consumers:
- **Server and client physics:** a layout turns into the existing `GameMap` (axis-aligned boxes: walls, floors, stairs steps, kerbs) used by `stepBody` and `resolveShot`. What you collide with is the *logical* shell, not window frames.
- **Client art only:** the layout is turned into a list of *placements* (`piece id, position, rotation`) from a facade grammar. Changing art never changes gameplay.

Same seed ⇒ same layout ⇒ identical colliders on both sides (tested like the question variants).

### 2. One grid everywhere
Kit pieces sit on a **2 m × 3 m** module. So: positions in layouts are multiples of 1 m, building footprints multiples of 2 m, storeys 3 m high. A **block pitch of 64 m** (a 52 m block + 12 m two-lane street) equals the AOI cell size, so *one chunk = one block = one network cell*. Default city 5×5 blocks (320 m, configurable 4–8). World coordinates stay inside ±650 m, which is what the Phase 6 wire format (int16 × 2 cm) covers.

### 3. Only banks are enterable
Every other building is a solid shell with a fake-interior window texture: cheap and fits "empty city". Only the 5 banks (and safehouses) get real interiors (floors, walls, stairs from kit pieces; counters/vault from code). That keeps colliders and triangles low and makes banks the destinations the game wants.

### 4. Rendering budget (hard numbers)
| Item | Budget | How |
|---|---|---|
| Draw calls | < 200 total | merge each chunk's pieces **per material** at load; ≤ 6 materials after atlasing; players ≈ 3 calls each (visible ≤ 30) |
| Triangles | < 400k on screen | choose the light window/column variants; far chunks drawn as box impostors with a facade texture; characters get a ~1.5k-triangle LOD beyond 25 m |
| Texture download | ≤ 3 MB | merge the kit's 21 materials into ≤ 6 texture sets (brick, trim/concrete, glass+fake interiors, roof, asphalt+decals, interior floor/wall); base colour 512–1024 px WebP; drop ORM/normal where they do not show |
| Total first load | < 8 MB | characters ~1 MB + kit ≤ 3 MB + code ~0.3 MB |

### 5. Colliders must stay cheap
A bank with several floors is roughly 20–40 boxes; 25 buildings ≈ 500–1000 boxes. `stepBody` currently tests every box. Phase 6 adds a **static collision grid** (boxes indexed by 8 m cell) so a body or ray only tests nearby boxes. This is also what makes bigger maps possible.

### 6. Build pipeline (Phase 8.1)
Like `tools/characters/`, an offline `tools/city/` script: pick ~60 light pieces → atlas textures → WebP → one `kit.glb` plus `kit.json` (piece id → size on the 2 m grid, material, triangle count). The game loads one file, not 150. The raw 223 MB download stays out of git.

## Phase impact (summary; the plan itself is in Phases.md)
| Phase | Change because of the kit |
|---|---|
| 6 | spatial grid indexes static colliders too; AOI cell = chunk pitch (64 m); wire format sized for a 650 m world |
| 7 | the first bank is defined in the **layout format** (logical shell → colliders, kit pieces → art), not as ad-hoc boxes; interactions (vault, loot, stairs) attach to layout nodes |
| 8 | new 8.1 kit pipeline; 8.2 seeded `CityLayout`; 8.3 facade grammar + chunk meshes; 8.4 streaming + LOD; vehicles need a hand-downloaded or procedural source |
| 9 | banks 2–5 are new layouts using the same pieces and grammar |

## Licence
CC0 1.0 (public domain). Credit given in `credits.md` anyway.
