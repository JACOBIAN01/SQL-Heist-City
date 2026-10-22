import { describe, expect, it } from 'vitest';
import { Scene, InstancedMesh } from 'three';
import { DEFAULT_ATMOSPHERE_SETTINGS, mapById, type CityLayout } from '@heist/shared';
import { CrowdModel } from './CrowdModel';
import { CrowdRenderer } from './CrowdRenderer';

const city = mapById('city')?.city as CityLayout;
const crowdSettings = () => DEFAULT_ATMOSPHERE_SETTINGS.crowd;

describe('CrowdRenderer', () => {
  it('draws the whole crowd in two draw calls, near people with a body and far ones as boxes', () => {
    const scene = new Scene();
    const renderer = new CrowdRenderer(
      scene,
      new CrowdModel(city, crowdSettings, 'x'),
      crowdSettings,
    );
    expect(scene.children.filter((c) => c instanceof InstancedMesh)).toHaveLength(2);
    renderer.update({ x: 0, z: 0 }, 0.016);
    const { near, far } = renderer.drawn;
    expect(near + far).toBeGreaterThan(0);
    expect(near + far).toBeLessThanOrEqual(300);
    // The meshes show exactly what was placed.
    const counts = scene.children.map((c) => (c as InstancedMesh).count).sort();
    expect(counts).toEqual([near, far].sort());
  });

  it('only places people within the draw radius, and fewer people when the radius is small', () => {
    const scene = new Scene();
    const small = () => ({ ...crowdSettings(), drawRadius: 20 });
    const model = new CrowdModel(city, crowdSettings, 'x');
    const r = new CrowdRenderer(scene, model, small);
    r.update({ x: 0, z: 0 }, 0.016);
    const few = r.drawn.near + r.drawn.far;
    const wide = new CrowdRenderer(new Scene(), model, () => ({
      ...crowdSettings(),
      drawRadius: 400,
    }));
    wide.update({ x: 0, z: 0 }, 0.016);
    expect(few).toBeLessThan(wide.drawn.near + wide.drawn.far);
  });

  it('is cheap in triangles: a person is a few boxes, a far one a single box', () => {
    const scene = new Scene();
    new CrowdRenderer(scene, new CrowdModel(city, crowdSettings, 'x'), crowdSettings);
    const tris = scene.children
      .map((c) => ((c as InstancedMesh).geometry.index?.count ?? 0) / 3)
      .sort((a, b) => a - b);
    expect(tris[0]).toBe(12); // one box
    expect(tris[1]).toBe(36); // three boxes
  });

  it('removes itself from the scene', () => {
    const scene = new Scene();
    const r = new CrowdRenderer(scene, new CrowdModel(city, crowdSettings, 'x'), crowdSettings);
    r.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
