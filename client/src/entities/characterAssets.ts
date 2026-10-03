import {
  SRGBColorSpace,
  TextureLoader,
  type AnimationClip,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { thresholdsFor, type AnimationThresholds } from './animation';
import type { CharacterFactory } from './CharacterRig';
import { PALETTES } from './CharacterModel';
import { GltfCharacter } from './GltfCharacter';

export interface CharacterAssets {
  /** Body templates (male, female) to clone per player. */
  readonly bodies: readonly Object3D[];
  readonly clips: ReadonlyMap<string, AnimationClip>;
  /** Lighter skin tone for each body, swapped in for some players. */
  readonly lightSkins: readonly Texture[];
}

const SHOES = 0x1d1d20;

/** Downloads the shared character files (~1 MB) once; every player is cloned from them. */
export async function loadCharacterAssets(baseUrl = '/characters/'): Promise<CharacterAssets> {
  const gltf = new GLTFLoader();
  const textures = new TextureLoader();
  const skin = async (file: string): Promise<Texture> => {
    const texture = await textures.loadAsync(baseUrl + file);
    texture.flipY = false; // glTF UV convention
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  const [male, female, animations, maleSkin, femaleSkin] = await Promise.all([
    gltf.loadAsync(`${baseUrl}male.glb`),
    gltf.loadAsync(`${baseUrl}female.glb`),
    gltf.loadAsync(`${baseUrl}animations.glb`),
    skin('skin_male_light.webp'),
    skin('skin_female_light.webp'),
  ]);
  return {
    bodies: [male.scene, female.scene],
    clips: new Map(animations.animations.map((clip) => [clip.name, clip])),
    lightSkins: [maleSkin, femaleSkin],
  };
}

/**
 * Pattern: Factory — Why: callers ask for "a character for player N" and get
 * a differently dressed human without knowing about files, clones or palettes.
 */
export function gltfCharacterFactory(
  assets: CharacterAssets,
  thresholds: AnimationThresholds = thresholdsFor(4.2, 6.8),
): CharacterFactory {
  return (seed) => {
    const index = Math.abs(Math.trunc(seed));
    const body = index % assets.bodies.length;
    const palette = PALETTES[index % PALETTES.length] ?? PALETTES[0];
    const lighter = Math.floor(index / assets.bodies.length) % 2 === 1;
    const template = assets.bodies[body];
    if (!template || !palette) throw new Error('character assets are empty');
    const light = assets.lightSkins[body];
    return new GltfCharacter(
      template,
      assets.clips,
      {
        shirt: palette.shirt,
        trousers: palette.trousers,
        shoes: SHOES,
        ...(lighter && light ? { skin: light } : {}),
      },
      thresholds,
    );
  };
}
