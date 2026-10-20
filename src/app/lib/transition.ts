// Page transitions built on the View Transitions API. Only the motion idea is borrowed from system UIs; nothing here is
// copied from anyone's artwork.
//
//   open   a tile's cover grows into the class page's hero; the rest of the grid dims, scales to 0.97 and fades out
//   close  the hero shrinks back into its tile (or, if the tile is off screen, the page fades and slides down)
//   slide  previous/next class: a short horizontal slide, no zoom
//   fade   any other in-app navigation: a short cross-fade
//
// Rules this file keeps:
//  - the one dynamic name (`class-hero`) is on at most one element at a time and is removed when the transition ends;
//  - the header and the bottom bar get their own names so they stay still (their animations are switched off in CSS);
//  - a new transition first skips the one in flight, so nothing can stack or get stuck, and a timer skips it if it ever hangs;
//  - with prefers-reduced-motion there is no zoom, no stagger and no scaling: a 100ms cross-fade only;
//  - without View Transitions the update just happens and the pages fade in on their own (see `getEntrance`).
import { flushSync } from 'react-dom';
import { motionMode } from './motion';

export type TransitionKind = 'open' | 'close' | 'slide-next' | 'slide-prev' | 'fade';
/** How a page should enter: 'zoom' staggers its text in, 'slide'/'none' rely on the transition, 'fade' fades itself (no View Transitions). */
export type Entrance = 'zoom' | 'slide' | 'none' | 'fade';

const HERO = 'class-hero';
let entrance: Entrance = 'fade';
let active: ViewTransition | null = null;

export const getEntrance = () => entrance;
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// A hidden tab can't show (or finish) a transition, so it just updates.
export const canMorph = () => typeof document !== 'undefined' && typeof document.startViewTransition === 'function' && document.visibilityState === 'visible';

const inViewport = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};

/** The element a class's tile (or plan row thumbnail) zooms from and back into. */
export const zoomSourceFor = (courseId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-zoom-card][data-course="${CSS.escape(courseId)}"] [data-zoom-source]`);

export interface TransitionOptions {
  kind: TransitionKind;
  /** the element that grows or shrinks (the tile cover going in, the hero going out) */
  from?: Element | null;
  /** after the update, the element the hero lands on (the page hero going in, the tile cover going out) */
  findTo?: () => Element | null;
  /** runs right after the update has been committed to the page, before the end state is captured: set the scroll position here */
  scroll?: () => void;
  /** runs once everything is finished (move focus) */
  after?: () => void;
}

/** Runs `update` (which must change the page) inside a transition. Returns once started; `after` runs when it is over. */
export function transition(update: () => void, o: TransitionOptions) {
  const rm = reducedMotion();
  // The page is committed synchronously and only then scrolled, so the scroll position is applied to the new page (a scroll
  // set before the commit lands on the old page's height and is clamped), and no timer is needed to retry it.
  const commit = () => { flushSync(update); o.scroll?.(); };
  // "off" changes the page with nothing animating; "simple" changes it and lets the pages fade in on their own (no snapshots,
  // no zoom). Only "full" (or the reduced-motion cross-fade) uses View Transitions.
  if (motionMode !== 'full' && !rm) {
    entrance = motionMode === 'off' ? 'none' : 'fade';
    commit();
    entrance = 'fade';
    o.after?.();
    return;
  }
  if (!canMorph()) {
    entrance = rm ? 'none' : 'fade';
    commit();
    entrance = 'fade';
    o.after?.();
    return;
  }

  active?.skipTransition(); // finish the one in flight first; never stack
  const html = document.documentElement;
  const named: HTMLElement[] = [];
  const name = (el: Element | null | undefined, n: string) => {
    if (!(el instanceof HTMLElement)) return;
    el.style.viewTransitionName = n;
    named.push(el);
  };
  const chrome = () => { name(document.querySelector('header'), 'site-header'); name(document.querySelector('nav.mobile-nav'), 'site-nav'); };

  let kind: string = rm ? 'rm' : o.kind;
  const fromVisible = !!o.from && inViewport(o.from);
  if (!rm && o.kind === 'close' && !fromVisible) kind = 'close-away';
  html.dataset.vt = kind;
  chrome();
  if (!rm && fromVisible && (o.kind === 'open' || o.kind === 'close')) name(o.from, HERO);

  const t0 = performance.now();
  const t = document.startViewTransition(() => {
    entrance = rm || o.kind === 'fade' ? 'none' : o.kind === 'open' || o.kind === 'close' ? 'zoom' : 'slide';
    commit();
    chrome(); // the header or bar may have been re-created by the update
    if (!rm && fromVisible && o.findTo) {
      const to = o.findTo();
      if (to && inViewport(to)) name(to, HERO);
      else if (o.kind === 'close') html.dataset.vt = 'close-away';
    }
  });
  active = t;
  t.ready.catch(() => {}); // a skipped or aborted transition is not an error here: the update still ran
  t.updateCallbackDone.catch(() => {});
  const timer = window.setTimeout(() => { if (active === t) t.skipTransition(); }, 1200);
  const done = () => {
    window.clearTimeout(timer);
    for (const el of named) el.style.removeProperty('view-transition-name');
    named.length = 0;
    // belt and braces: nothing may keep a name once the transition is over
    document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]').forEach(el => el.style.removeProperty('view-transition-name'));
    const current = active === t; // false when a newer transition skipped this one: it then owns focus and the page state
    if (current) { active = null; delete html.dataset.vt; entrance = 'fade'; }
    try { performance.measure(`vt:${o.kind}`, { start: t0, end: performance.now() }); } catch { /* measuring is optional */ }
    if (current) o.after?.();
  };
  t.finished.then(done, done);
}
