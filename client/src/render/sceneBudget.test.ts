import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { sceneBudget } from './sceneBudget';

describe('sceneBudget', () => {
  it('counts the triangles in view per top-level part, and which of them cast shadows', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const box = () => new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const city = new Group();
    city.name = 'city-art';
    const caster = box();
    caster.castShadow = true;
    const behind = box();
    behind.position.z = 30; // behind the camera
    const hidden = box();
    hidden.visible = false;
    city.add(caster, box(), behind, hidden);
    const lone = box();
    scene.add(city, lone);
    const rows = sceneBudget(scene, camera);
    expect(rows[0]).toEqual({ part: 'city-art', meshes: 2, triangles: 24, shadowTriangles: 12 });
    expect(rows[1]).toMatchObject({ part: 'Mesh', meshes: 1, triangles: 12 });
  });
});
