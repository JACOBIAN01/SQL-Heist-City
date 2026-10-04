import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Object3D,
} from 'three';
import type { AnchorKind, GameMap, MapBoxKind } from '@heist/shared';

const ANCHOR_COLOR: Readonly<Record<AnchorKind, number>> = {
  elevator: 0x33d6c4,
  vault_console: 0xf2b134,
  safehouse: 0x6bd36b,
};

const KIND_COLOR: Readonly<Record<MapBoxKind, number>> = {
  wall: 0x3a3f47,
  building: 0x5d6571,
  interior: 0x8b8f96,
  crate: 0x8a6a3b,
  step: 0x6d737c,
  cover: 0x4b5058,
};

/** Tiled asphalt-with-grid texture: gives the eye something to judge speed by. */
function groundTexture(tiles: number): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#5a6069';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(tiles, tiles);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Builds renderable geometry from the shared map: one InstancedMesh per box
 * kind (a handful of draw calls however many boxes) plus a ground plane.
 */
export function buildMapObject(map: GameMap): Object3D {
  const root = new Mesh();
  const side = map.halfSize * 2;

  const ground = new Mesh(
    new PlaneGeometry(side, side),
    new MeshStandardMaterial({ map: groundTexture(side / 4), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const byKind = new Map<MapBoxKind, GameMap['boxes'][number][]>();
  for (const b of map.boxes) byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), b]);

  const unit = new BoxGeometry(1, 1, 1);
  const matrix = new Matrix4();
  for (const [kind, boxes] of byKind) {
    const mesh = new InstancedMesh(
      unit,
      new MeshStandardMaterial({ color: new Color(KIND_COLOR[kind]), roughness: 0.85 }),
      boxes.length,
    );
    boxes.forEach((b, i) => {
      matrix.makeScale(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      matrix.setPosition((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `map-${kind}`;
    root.add(mesh);
  }

  // A glowing pad on the floor wherever F does something.
  for (const a of map.anchors ?? []) {
    const color = ANCHOR_COLOR[a.kind];
    const pad = new Mesh(
      new CylinderGeometry(a.radius * 0.6, a.radius * 0.6, 0.06, 24),
      new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }),
    );
    pad.position.set(a.x, a.y + 0.03, a.z);
    pad.name = `anchor-${a.id}`;
    root.add(pad);
  }
  return root;
}
