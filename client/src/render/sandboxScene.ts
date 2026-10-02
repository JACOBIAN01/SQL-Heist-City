import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { computeViewport } from './viewport';

/** Phase 0 placeholder scene: proves Three.js renders. Replaced in Phase 5. */
export function startSandboxScene(container: HTMLElement): () => void {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x0b0d10);
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(2.5, 2, 3.5);
  camera.lookAt(0, 0, 0);

  scene.add(new HemisphereLight(0xbfd4ff, 0x20242b, 0.6));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xd4a017 }));
  scene.add(cube);

  const resize = (): void => {
    const v = computeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    renderer.setPixelRatio(v.pixelRatio);
    renderer.setSize(v.width, v.height);
    camera.aspect = v.aspect;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  renderer.setAnimationLoop((timeMs) => {
    cube.rotation.set(timeMs * 0.0004, timeMs * 0.0007, 0);
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    renderer.dispose();
    renderer.domElement.remove();
  };
}
