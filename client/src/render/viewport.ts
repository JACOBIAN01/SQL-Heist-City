/**
 * Device pixel ratio above 2 costs a lot of fill-rate on integrated GPUs for
 * little visible gain, so we cap it to protect the 60 fps budget (rules.md §4).
 */
export const MAX_PIXEL_RATIO = 2;

export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
  aspect: number;
}

export function computeViewport(width: number, height: number, devicePixelRatio: number): Viewport {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  return {
    width: safeWidth,
    height: safeHeight,
    pixelRatio: Math.min(Math.max(devicePixelRatio, 1), MAX_PIXEL_RATIO),
    aspect: safeWidth / safeHeight,
  };
}
