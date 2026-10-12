import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';
import {
  BANK_LAYOUTS,
  type BankLayout,
  type FixtureSpec,
  type GameMap,
  type PlacedBank,
} from '@heist/shared';
import { mergeByMaterial } from '../../render/mergeByMaterial';
import type { BankMaterials } from './bankMaterials';

/** Glass and velvet rope: the two fixture materials that are not part of the surface set. */
export interface FixtureMaterials {
  readonly glass: MeshStandardMaterial;
  readonly rope: MeshStandardMaterial;
}

export function createFixtureMaterials(): FixtureMaterials {
  return {
    // Faint, pale and double sided: a teller screen you can see through but not miss.
    glass: new MeshStandardMaterial({
      name: 'bank-glass',
      color: 0xbfe0ea,
      transparent: true,
      opacity: 0.22,
      roughness: 0.05,
      metalness: 0.1,
      side: DoubleSide,
      depthWrite: false,
      emissive: 0xbfe0ea,
      emissiveIntensity: 0.15,
    }),
    rope: new MeshStandardMaterial({
      name: 'bank-rope',
      color: 0x8c1420,
      roughness: 0.9,
      emissive: 0x8c1420,
      emissiveIntensity: 0.25,
    }),
  };
}

/** Counter-top screens: posts every 1.5 m, glass from 0.35 m above the counter up to 2 m, a brass rail. */
const SCREEN_TOP = 2.0;
const SCREEN_GAP = 0.35;
const POST_EVERY = 1.5;
/** Queue posts: every 1.2 m, a metre tall. */
const QUEUE_EVERY = 1.2;
const QUEUE_HEIGHT = 1.0;

/**
 * A run of fixtures laid out in its own frame: along x, `width` long, centred
 * on the origin, front toward +z. The caller turns it into place.
 */
function tellerScreen(spec: FixtureSpec, m: BankMaterials & FixtureMaterials): Group {
  const base = spec.base ?? 1.1;
  const g = new Group();
  const posts = Math.max(2, Math.round(spec.width / POST_EVERY) + 1);
  const pitch = spec.width / (posts - 1);
  for (let i = 0; i < posts; i++) {
    const post = new Mesh(new BoxGeometry(0.06, SCREEN_TOP - base, 0.06), m.brass);
    post.position.set(-spec.width / 2 + i * pitch, (base + SCREEN_TOP) / 2, 0);
    g.add(post);
  }
  const rail = (y: number) => {
    const r = new Mesh(new BoxGeometry(spec.width, 0.05, 0.07), m.brass);
    r.position.set(0, y, 0);
    g.add(r);
  };
  rail(SCREEN_TOP);
  rail(base + SCREEN_GAP);
  for (let i = 0; i + 1 < posts; i++) {
    const pane = new Mesh(
      new BoxGeometry(pitch - 0.06, SCREEN_TOP - base - SCREEN_GAP, 0.012),
      m.glass,
    );
    pane.position.set(-spec.width / 2 + (i + 0.5) * pitch, (base + SCREEN_GAP + SCREEN_TOP) / 2, 0);
    pane.renderOrder = 5;
    g.add(pane);
  }
  // A brass tray at each window, flush with the counter, to pass notes through.
  for (let i = 0; i + 1 < posts; i++) {
    const tray = new Mesh(new BoxGeometry(0.4, 0.025, 0.3), m.brass);
    tray.position.set(-spec.width / 2 + (i + 0.5) * pitch, base + 0.013, 0.1);
    g.add(tray);
  }
  return g;
}

function queuePosts(spec: FixtureSpec, m: BankMaterials & FixtureMaterials): Group {
  const g = new Group();
  const posts = Math.max(2, Math.round(spec.width / QUEUE_EVERY) + 1);
  const pitch = spec.width / (posts - 1);
  const xs = Array.from({ length: posts }, (_, i) => -spec.width / 2 + i * pitch);
  for (const x of xs) {
    const base = new Mesh(new CylinderGeometry(0.17, 0.19, 0.04, 16), m.brass);
    base.position.set(x, 0.02, 0);
    const pole = new Mesh(new CylinderGeometry(0.025, 0.025, QUEUE_HEIGHT, 10), m.brass);
    pole.position.set(x, QUEUE_HEIGHT / 2, 0);
    const top = new Mesh(new SphereGeometry(0.05, 10, 8), m.brass);
    top.position.set(x, QUEUE_HEIGHT + 0.03, 0);
    g.add(base, pole, top);
  }
  // Rope between posts, drooping in the middle (two slanted pieces, no curve to compute).
  for (let i = 0; i + 1 < posts; i++) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    const sag = 0.1;
    for (const [from, to, y0, y1] of [
      [a, (a + b) / 2, QUEUE_HEIGHT - 0.05, QUEUE_HEIGHT - 0.05 - sag],
      [(a + b) / 2, b, QUEUE_HEIGHT - 0.05 - sag, QUEUE_HEIGHT - 0.05],
    ] as const) {
      const len = Math.hypot(to - from, y1 - y0);
      const rope = new Mesh(new CylinderGeometry(0.018, 0.018, len, 6), m.rope);
      rope.rotation.z = Math.PI / 2 + Math.atan2(y1 - y0, to - from);
      rope.position.set((from + to) / 2, (y0 + y1) / 2, 0);
      g.add(rope);
    }
  }
  return g;
}

const BUILDERS = {
  tellerScreen,
  queuePosts,
} as const satisfies Record<
  FixtureSpec['kind'],
  (spec: FixtureSpec, m: BankMaterials & FixtureMaterials) => Object3D
>;

/** Which way to turn a run built along x so it lies along the spec's axis. */
const yawOf = (f: FixtureSpec) => (f.facing === '+x' || f.facing === '-x' ? Math.PI / 2 : 0);

/**
 * Dresses every bank's fixtures: the glass teller screens and the brass queue
 * posts with their ropes. Built in code (the interior kit has no such pieces)
 * and art only: nothing here collides.
 * Pattern: Strategy (one builder per fixture kind) — Why: a new fitting is one
 * more builder and one more kind in the layout.
 */
export function buildBankFixtures(
  map: GameMap,
  materials: BankMaterials,
  fixtureMaterials: FixtureMaterials = createFixtureMaterials(),
  layouts: ReadonlyMap<number, BankLayout> = BANK_LAYOUTS,
): Group {
  const root = new Group();
  root.name = 'bank-fixtures';
  const m = { ...materials, ...fixtureMaterials };
  for (const site of map.banks ?? []) {
    const layout = layouts.get(site.tier);
    if (layout) root.add(bankFixtures(layout, site, m));
  }
  return root;
}

function bankFixtures(
  layout: BankLayout,
  site: PlacedBank,
  m: BankMaterials & FixtureMaterials,
): Group {
  const bank = new Group();
  bank.name = `bank-fixtures-${layout.id}`;
  // One merged mesh per material per storey, tagged so BankLod can leave out floors nobody sees.
  for (let storey = 0; storey < layout.storeys; storey++) {
    const parts = new Group();
    for (const f of (layout.fixtures ?? []).filter((x) => x.storey === storey)) {
      const piece = BUILDERS[f.kind](f, m);
      piece.name = f.kind;
      piece.position.set(site.x + f.x, storey * layout.storeyHeight, site.z + f.z);
      piece.rotation.y = yawOf(f);
      parts.add(piece);
    }
    if (parts.children.length === 0) continue;
    const merged = mergeByMaterial(parts, `storey-${storey}`);
    merged.userData = { bankTier: site.tier, storey };
    bank.add(merged);
  }
  return bank;
}
