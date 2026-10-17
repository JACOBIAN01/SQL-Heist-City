/** Colour maths for checking the palettes: contrast (WCAG 2.x) and how a colour looks to someone colour-blind. */

export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const linear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const gamma = (l: number): number =>
  255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1 to 21. Text needs 4.5 (3 when large), icons and borders 3. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(parseHex(a)), luminance(parseHex(b))].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

export type Vision = 'deuteranopia' | 'protanopia' | 'tritanopia';

// Machado, Oliveira & Fernandes (2009), full severity, on linear RGB.
const MATRICES: Readonly<Record<Vision, readonly (readonly number[])[]>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** How a colour looks to someone with that kind of colour blindness. */
export function simulate(hex: string, vision: Vision): Rgb {
  const lin = parseHex(hex).map(linear);
  const m = MATRICES[vision];
  return m.map((row) =>
    Math.max(
      0,
      Math.min(
        255,
        gamma(
          Math.max(
            0,
            Math.min(
              1,
              row.reduce((s, k, i) => s + k * (lin[i] as number), 0),
            ),
          ),
        ),
      ),
    ),
  ) as unknown as Rgb;
}

// CIE Lab for a perceptual distance (ΔE, CIE76).
function lab([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** How different two colours look (CIE76 ΔE): under about 10 is hard to tell apart, over 30 is plain. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
