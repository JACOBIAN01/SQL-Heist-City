/**
 * The furniture pieces a bank layout may place, with their life-size bounds
 * (m, in the piece's own frame: front facing +z, base at y = 0) as
 * tools/city/build-interior.mjs builds them. The server needs only these
 * numbers (solid pieces become colliders); a test keeps them equal to
 * client/public/interior/interior.json.
 */
export interface FurniturePiece {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Hangs from the ceiling (lights) instead of standing on the floor. */
  readonly hangs?: boolean;
}

export const FURNITURE_PIECES = {
  Column_Round1: { min: [-0.35, 0, -0.368], max: [0.35, 0.886, 0.368] },
  Column_Round2: { min: [-0.35, 0, -0.368], max: [0.35, 2, 0.368] },
  Column_Round3: { min: [-0.35, 0, -0.368], max: [0.35, 2.714, 0.368] },
  Column_SquareBig: { min: [-0.227, 0, -0.227], max: [0.227, 2.079, 0.227] },
  Column_SquareSmall: { min: [-0.227, 0, -0.227], max: [0.227, 1.224, 0.227] },
  Door_1: { min: [-0.868, 0, -0.105], max: [0, 2.094, 0.105] },
  Door_3: { min: [-0.868, 0, -0.104], max: [0, 2.094, 0.104] },
  Door_7: { min: [-0.87, 0, -0.105], max: [0, 2.099, 0.105] },
  Door_Double: { min: [-0.871, 0, -0.107], max: [0.871, 2.094, 0.107] },
  Window_Large1: { min: [-0.458, 0, -0.035], max: [0.458, 0.849, 0.035] },
  Window_Small1: { min: [-0.232, 0, -0.035], max: [0.232, 0.619, 0.035] },
  Curtains_Double: { min: [-0.867, 0, -0.119], max: [0.867, 2.172, 0.119] },
  Curtains_Single: { min: [-0.408, 0, -0.119], max: [0.408, 2.172, 0.119] },
  Light_Ceiling1: { min: [-0.11, -0.411, -0.109], max: [0.11, 0, 0.109], hangs: true },
  Light_Ceiling2: { min: [-0.09, -0.506, -0.089], max: [0.09, 0, 0.089], hangs: true },
  Light_Ceiling3: { min: [-0.134, -0.339, -0.134], max: [0.134, 0, 0.134], hangs: true },
  Light_Ceiling5: { min: [-0.133, -0.068, -0.14], max: [0.133, 0, 0.14], hangs: true },
  Light_Ceiling6: { min: [-0.133, -0.064, -0.14], max: [0.133, 0, 0.14], hangs: true },
  Light_CeilingSingle: { min: [-0.066, -0.239, -0.069], max: [0.066, 0, 0.069], hangs: true },
  Light_Chandelier: { min: [-0.325, -0.415, -0.325], max: [0.325, 0, 0.325], hangs: true },
  Light_Cube: { min: [-0.141, -0.518, -0.141], max: [0.141, 0, 0.141], hangs: true },
  Light_Desk: { min: [-0.075, 0, -0.136], max: [0.075, 0.344, 0.136] },
  Light_Floor1: { min: [-0.07, 0, -0.074], max: [0.07, 0.802, 0.074] },
  Light_Stand1: { min: [-0.193, 0, -0.203], max: [0.193, 1.497, 0.203] },
  Light_Small: { min: [-0.039, -0.053, -0.041], max: [0.039, 0, 0.041], hangs: true },
  Chair_1: { min: [-0.19, 0, -0.206], max: [0.19, 0.884, 0.206] },
  Chair_2: { min: [-0.19, 0, -0.206], max: [0.19, 0.845, 0.206] },
  Chair_3: { min: [-0.19, 0, -0.209], max: [0.19, 0.847, 0.209] },
  Chair_4: { min: [-0.19, 0, -0.206], max: [0.19, 0.884, 0.206] },
  Stool: { min: [-0.169, 0, -0.178], max: [0.169, 0.686, 0.178] },
  Couch_Large1: { min: [-1.369, 0, -0.498], max: [1.369, 1.053, 0.498] },
  Couch_Medium1: { min: [-1.172, 0, -0.551], max: [1.172, 0.955, 0.551] },
  Couch_Small1: { min: [-0.721, 0, -0.551], max: [0.721, 0.955, 0.551] },
  Couch_Small2: { min: [-0.528, 0, -0.498], max: [0.528, 0.635, 0.498] },
  Couch_L: { min: [-1.404, 0, -1.082], max: [1.404, 1.131, 1.082] },
  Table_RoundLarge: { min: [-1.207, 0, -0.631], max: [1.207, 0.729, 0.631] },
  Table_RoundSmall: { min: [-0.631, 0, -0.631], max: [0.631, 0.746, 0.631] },
  Drawer_1: { min: [-0.699, 0, -0.28], max: [0.699, 0.676, 0.28] },
  Drawer_2: { min: [-1.009, 0, -0.28], max: [1.009, 0.652, 0.28] },
  Drawer_3: { min: [-1.038, 0, -0.334], max: [1.038, 0.789, 0.334] },
  Drawer_4: { min: [-0.699, 0, -0.28], max: [0.699, 1.035, 0.28] },
  Drawer_5: { min: [-0.699, 0, -0.288], max: [0.699, 0.666, 0.288] },
  Bookshelf: { min: [-0.58, 0, -0.189], max: [0.58, 2.219, 0.189] },
  Shelf_1: { min: [-0.177, 0, -0.163], max: [0.177, 1.583, 0.163] },
  Shelf_2: { min: [-0.28, 0, -0.189], max: [0.28, 2.219, 0.189] },
  Shelf_Large: { min: [-0.845, 0, -0.189], max: [0.845, 2.219, 0.189] },
  Shelf_Small1: { min: [-0.486, 0, -0.138], max: [0.486, 0.289, 0.138] },
  NightStand_1: { min: [-0.238, 0, -0.238], max: [0.238, 0.412, 0.238] },
  Kitchen_Cabinet1: { min: [-0.253, 0, -0.268], max: [0.253, 0.784, 0.268] },
  Kitchen_Fridge: { min: [-0.324, 0, -0.325], max: [0.324, 1.654, 0.325] },
  Kitchen_Sink: { min: [-0.253, 0, -0.28], max: [0.253, 0.962, 0.28] },
  Houseplant_3: { min: [-0.086, 0, -0.085], max: [0.086, 0.422, 0.085] },
  Houseplant_4: { min: [-0.085, 0, -0.085], max: [0.085, 0.464, 0.085] },
  Houseplant_6: { min: [-0.26, 0, -0.263], max: [0.26, 0.479, 0.263] },
  Houseplant_7: { min: [-0.292, 0, -0.305], max: [0.292, 0.441, 0.305] },
  Houseplant_8: { min: [-0.129, 0, -0.129], max: [0.129, 0.778, 0.129] },
  Carpet_1: { min: [-1.066, 0, -1.547], max: [1.066, 0.037, 1.547] },
  Carpet_2: { min: [-1.547, 0, -1.591], max: [1.547, 0.037, 1.591] },
  Carpet_Round: { min: [-1.246, 0, -1.266], max: [1.246, 0.016, 1.266] },
  Trashcan_Cylindric: { min: [-0.189, 0, -0.189], max: [0.189, 0.537, 0.189] },
  Trashcan_Small1: { min: [-0.126, 0, -0.077], max: [0.126, 0.356, 0.077] },
  Bathroom_Sink: { min: [-0.347, 0, -0.204], max: [0.347, 0.723, 0.204] },
  Bathroom_Toilet2: { min: [-0.278, 0, -0.385], max: [0.278, 0.504, 0.385] },
  Bathroom_Mirror1: { min: [-0.324, 0, -0.051], max: [0.324, 0.93, 0.051] },
} as const satisfies Readonly<Record<string, FurniturePiece>>;

export type FurniturePieceId = keyof typeof FURNITURE_PIECES;

export const isFurniturePiece = (id: string): id is FurniturePieceId => id in FURNITURE_PIECES;
