// Illustrated covers: an original SVG composition generated in code from a seed (the course code and topic), so the same
// class always gets the same cover and no image files are needed. Pure functions only; the Cover component draws the result.
//
// A cover is a gradient from a deeper tone to the area's own color, plus 3 to 5 simple shapes (circles, rounded rectangles,
// rings, waves, dots) whose positions, sizes and rotation come from the seed. The big flat area icon is drawn on top in
// white. Shapes that reach the icon's zone are always dark, and the lightest tone of the gradient is the area color itself
// (3:1 or better against white), so the white icon keeps 3:1 or better on every cover.

export const COVER_W = 400;
export const COVER_H = 300;
/** The part of the cover the icon covers (centered). Shapes that touch it are drawn dark so the white icon stays readable. */
export const ICON_ZONE = { x0: 118, y0: 68, x1: 282, y1: 232 };

export type CoverShape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; opacity: number }
  | { kind: 'rrect'; cx: number; cy: number; w: number; h: number; rx: number; rot: number; fill: string; opacity: number }
  | { kind: 'ring'; cx: number; cy: number; r: number; sw: number; stroke: string; opacity: number }
  | { kind: 'wave'; d: string; fill: string; opacity: number }
  | { kind: 'dots'; dots: { x: number; y: number }[]; r: number; fill: string; opacity: number };

export interface CoverSpec {
  deep: string;
  light: string;
  /** gradient direction in degrees */
  angle: number;
  flipX: boolean;
  flipY: boolean;
  /** the whole composition is scaled out from the center by this much (1 or more), so it never moves in toward the icon */
  zoom: number;
  shapes: CoverShape[];
}

// xmur3 string hash and mulberry32 generator: small, well-known, deterministic.
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(a: number) {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map(i => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0')).join('');
}

type Rng = () => number;
type Box = { x0: number; y0: number; x1: number; y1: number };
const between = (r: Rng, a: number, b: number) => a + (b - a) * r();
const pick = <T,>(r: Rng, xs: T[]) => xs[Math.floor(r() * xs.length) % xs.length];
const touchesZone = (b: Box) => b.x0 < ICON_ZONE.x1 && b.x1 > ICON_ZONE.x0 && b.y0 < ICON_ZONE.y1 && b.y1 > ICON_ZONE.y0;

// A wave: a sine ribbon across the width, filled down to the bottom edge.
function wavePath(y: number, amp: number, len: number, phase: number): string {
  let d = `M -20 ${COVER_H + 20} L -20 ${y}`;
  for (let x = -20 - phase; x < COVER_W + len; x += len) {
    d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`;
  }
  return d + ` L ${COVER_W + len} ${COVER_H + 20} Z`;
}

// Each template returns shapes with their bounding boxes; the caller colors them by whether they reach the icon zone.
type Raw = { box: Box; make: (fill: string, opacity: number) => CoverShape; wantsLight?: boolean };
const circle = (cx: number, cy: number, r: number): Raw => ({ box: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, make: (fill, opacity) => ({ kind: 'circle', cx, cy, r, fill, opacity }) });
const rrect = (cx: number, cy: number, w: number, h: number, rot: number): Raw => {
  const e = Math.hypot(w, h) / 2;
  return { box: { x0: cx - e, y0: cy - e, x1: cx + e, y1: cy + e }, make: (fill, opacity) => ({ kind: 'rrect', cx, cy, w, h, rx: Math.min(w, h) * 0.3, rot, fill, opacity }) };
};
const ring = (cx: number, cy: number, r: number, sw: number): Raw => ({ box: { x0: cx - r - sw / 2, y0: cy - r - sw / 2, x1: cx + r + sw / 2, y1: cy + r + sw / 2 }, make: (stroke, opacity) => ({ kind: 'ring', cx, cy, r, sw, stroke, opacity }) });
const wave = (y: number, amp: number, len: number, phase: number): Raw => ({ box: { x0: 0, y0: y - amp, x1: COVER_W, y1: COVER_H }, make: (fill, opacity) => ({ kind: 'wave', d: wavePath(y, amp, len, phase), fill, opacity }) });
const dotGrid = (x: number, y: number, cols: number, rows: number, gap: number, r: number): Raw => {
  const dots: { x: number; y: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) dots.push({ x: x + i * gap, y: y + j * gap });
  return { box: { x0: x - r, y0: y - r, x1: x + (cols - 1) * gap + r, y1: y + (rows - 1) * gap + r }, make: (fill, opacity) => ({ kind: 'dots', dots, r, fill, opacity }) };
};

const TEMPLATES: ((r: Rng) => Raw[])[] = [
  // sunrise: a big disc, two waves, a dot grid
  r => [circle(between(r, 60, 340), between(r, 200, 310), between(r, 95, 150)), wave(between(r, 195, 235), between(r, 12, 28), between(r, 110, 200), between(r, 0, 100)), wave(between(r, 245, 270), between(r, 10, 20), between(r, 90, 160), between(r, 0, 100)), dotGrid(between(r, 250, 320), between(r, 22, 50), 4, 3, between(r, 18, 24), 3.4)],
  // stack: three tilted rounded rectangles
  r => [rrect(between(r, 90, 160), between(r, 70, 120), between(r, 180, 260), between(r, 60, 100), between(r, -32, 32)), rrect(between(r, 230, 310), between(r, 160, 220), between(r, 170, 250), between(r, 55, 95), between(r, -32, 32)), rrect(between(r, 150, 250), between(r, 250, 300), between(r, 200, 300), between(r, 50, 80), between(r, -20, 20)), circle(between(r, 300, 370), between(r, 40, 90), between(r, 26, 44))],
  // orbits: big rings around an off-canvas center
  r => { const cx = between(r, -20, 420), cy = between(r, -40, 340); const R = between(r, 80, 150); return [ring(cx, cy, R, between(r, 14, 26)), ring(cx, cy, R + between(r, 50, 80), between(r, 10, 20)), circle(between(r, 40, 360), between(r, 30, 270), between(r, 18, 34)), dotGrid(between(r, 20, 300), between(r, 230, 270), 5, 2, between(r, 16, 22), 3)]; },
  // confetti: five discs of different sizes pushed to the corners
  r => [circle(between(r, 20, 90), between(r, 20, 90), between(r, 50, 90)), circle(between(r, 310, 390), between(r, 200, 290), between(r, 60, 110)), circle(between(r, 300, 380), between(r, 20, 70), between(r, 16, 32)), circle(between(r, 20, 100), between(r, 230, 290), between(r, 22, 40)), dotGrid(between(r, 140, 240), between(r, 14, 30), 6, 1, between(r, 16, 22), 3.4)],
  // bands: two long tilted bands, a disc, dots
  r => [rrect(between(r, 100, 300), between(r, 60, 130), 620, between(r, 50, 90), between(r, -40, -14)), rrect(between(r, 100, 300), between(r, 190, 270), 620, between(r, 40, 80), between(r, -40, -14)), circle(between(r, 280, 360), between(r, 30, 80), between(r, 28, 50)), dotGrid(between(r, 20, 60), between(r, 200, 240), 3, 3, between(r, 16, 22), 3.2)],
  // ripples: concentric rings in a corner and a wave
  r => { const cx = pick(r, [between(r, -10, 70), between(r, 330, 410)]); const cy = pick(r, [between(r, -10, 60), between(r, 240, 310)]); return [ring(cx, cy, between(r, 60, 80), 12), ring(cx, cy, between(r, 110, 140), 12), ring(cx, cy, between(r, 170, 210), 12), wave(between(r, 240, 262), between(r, 10, 22), between(r, 100, 170), between(r, 0, 100)), circle(between(r, 150, 260), between(r, 30, 60), between(r, 12, 22))]; },
  // arches: stacked half rings along the bottom and a disc up top
  r => { const cx = between(r, 120, 280); return [ring(cx, 330, between(r, 90, 120), 26), ring(cx, 330, between(r, 150, 185), 22), ring(cx, 330, between(r, 215, 250), 18), circle(between(r, 30, 370), between(r, 30, 80), between(r, 26, 54))]; },
  // blocks: three squares of different sizes and dots
  r => [rrect(between(r, 60, 120), between(r, 60, 120), between(r, 90, 140), between(r, 90, 140), between(r, -12, 12)), rrect(between(r, 270, 340), between(r, 80, 150), between(r, 60, 100), between(r, 60, 100), between(r, -25, 25)), rrect(between(r, 250, 330), between(r, 220, 280), between(r, 110, 170), between(r, 70, 110), between(r, -15, 15)), dotGrid(between(r, 30, 80), between(r, 215, 250), 4, 3, between(r, 16, 22), 3.4)],
];

export function buildCover(seed: string, hue: string): CoverSpec {
  const r = mulberry32(hashSeed(seed));
  const deep = mixHex(hue, '#000000', between(r, 0.3, 0.46));
  const angle = between(r, 15, 75);
  const flipX = r() < 0.5, flipY = r() < 0.5;
  const zoom = between(r, 1, 1.35);
  // mood: how many of the shapes outside the icon zone are light rather than dark
  const lightShare = pick(r, [0.9, 0.55, 0.15]);
  let raws = TEMPLATES[Math.floor(r() * TEMPLATES.length) % TEMPLATES.length](r);
  // 3 to 5 shapes
  if (raws.length > 5) raws = raws.slice(0, 5);
  const shapes: CoverShape[] = raws.map(raw => {
    const reaches = touchesZone(raw.box);
    // shapes under the icon are always dark; the others may be light or dark
    const light = !reaches && r() < lightShare;
    const fill = light ? '#FFFFFF' : mixHex(deep, '#000000', between(r, 0, 0.25));
    const opacity = light ? between(r, 0.24, 0.4) : between(r, 0.34, 0.55);
    return raw.make(fill, opacity);
  });
  return { deep, light: hue, angle, flipX, flipY, zoom, shapes };
}
