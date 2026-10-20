// How much the site animates. Chosen once per page load:
//   ?motion=full    zoom open and close, staggered text, tile hover scale and glow, sliding area icons
//   ?motion=simple  no zoom and no scaling: pages and tiles just fade in, tiles get a ring on hover
//   ?motion=off     nothing animates
// With no parameter every device gets "full", phones included, so the zoom open and close is the same everywhere. (Touch devices
// used to default to "simple", which is why phones skipped it.) The operating system's reduced-motion setting is handled
// separately (a 100ms cross-fade only) and always wins over "full".
export type MotionMode = 'full' | 'simple' | 'off';

function detect(): MotionMode {
  if (typeof window === 'undefined') return 'full';
  const asked = new URLSearchParams(window.location.search).get('motion');
  if (asked === 'full' || asked === 'simple' || asked === 'off') return asked;
  return 'full';
}

export const motionMode: MotionMode = detect();
if (typeof document !== 'undefined') document.documentElement.dataset.motion = motionMode; // a hook for the stylesheet
