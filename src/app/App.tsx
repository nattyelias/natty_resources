import { createContext, Fragment, useContext, useState, useEffect, useLayoutEffect, useRef, useMemo, useId } from 'react';

function useWindowWidth() {
  const [w, setW] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h, { passive: true });
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  'AI / Emerging Tech':           '#A174E6',
  'Fabrication & Making':         '#DB6A35',
  'Game Design':                  '#1C9E2F',
  'AR / VR':                      '#DF4BD4',
  '3D / Animation':               '#14958A',
  'Sound & Music / Visual Systems': '#B18300',
  'UX / Product Design':          '#769515',
  'Branding & Strategy':          '#E25B8E',
  'Accessibility':                '#A86F42',
};
// No area hue is blue: blue is kept for controls. Each is bright enough to read as the area's color on a solid circle and still 3:1 or better against white (the icon on it is white).

import coursesData from '../../data/courses.json';
import extraData from '../../data/courses-extra.json';
import verificationData from '../../data/verification.json';
import photosData from './data/class-photos.json';
import { semester } from './config/semester';
import { buildCover, COVER_W, COVER_H } from './lib/cover';
import { getEntrance, reducedMotion, transition, zoomSourceFor } from './lib/transition';
import { motionMode } from './lib/motion';
import { APP_NAME, DEFAULT_MODE, defaultConfig, termContext } from '../core/config.ts';
import { allCourses, coursesForMode, firstUpcomingSection, showInstructors, upcomingInstructors } from '../core/courses.ts';
import { readMode, writeMode } from '../core/mode.ts';
import { availability, isUpcoming, lastOffered, searchTermNote, seasonOf, termRank, upcomingTerms } from '../core/terms.ts';
import { creditRange, creditsLabel, creditsText, parseSaved, planAsText, planTermText, planWarnings, roleLabel, PLAN_YEARS, SEASONS, serializeSaved, STORAGE_KEY } from '../core/plans.ts';
import type { ExportItem, Plan, PlanItem, PlanRole, SavedState } from '../core/plans.ts';
import { verificationFor, verificationLabel } from '../core/verification.ts';
import type { Course, CourseData, Section as ClassSection, ViewMode } from '../core/types.ts';
import { ModeToggle } from './ModeToggle';

// Course and ClassSection (Section) come from src/core/types.ts.
// Photos live in src/data/class-photos.json (see public/class-photos/README.md), so a data refresh never touches them.
// A photo with no alt text is dropped, so a tile never shows an undescribed image.
const PHOTO_ENTRIES = photosData as Record<string, { photo?: string; photoAlt?: string; photoCredit?: string }>;
const withPhoto = (c: CourseData): Course => {
  const e = PHOTO_ENTRIES[c.id];
  if (e?.photo && !e.photoAlt?.trim()) { console.error(`class-photos.json: ${c.id} has a photo but no photoAlt, so the photo is ignored.`); return { ...c, photo: '', photoAlt: '', photoCredit: '' }; }
  return { ...c, photo: e?.photo ?? '', photoAlt: e?.photoAlt ?? '', photoCredit: e?.photoCredit ?? '' };
};
const photoUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
// All 102 classes: courses.json plus courses-extra.json (src/core). The class list on Home comes from coursesForMode below.
const COURSES: Course[] = allCourses(coursesData, extraData).map(withPhoto);

// What counts as past or upcoming, and the current and next term, come from src/core/config.ts.
const TERM_CONTEXT = termContext(defaultConfig);
const nextTermPosted = TERM_CONTEXT.nextTermPosted;

// Season markers (one shared component further down): only these two words ever appear.
type SeasonName = 'fall' | 'spring';
const SEASON_WORD: Record<SeasonName, string> = { fall: 'Fall', spring: 'Spring' };
const SEASON_COLOR: Record<SeasonName, string> = { fall: '#C27800', spring: '#E0558F' };

// The two modes. Each lists the classes for it, with the code to display (a 5000-level code in Grad, an under-5000 code in Undergrad).
const MODE_ENTRIES: Record<ViewMode, { course: Course; displayCode: string }[]> = {
  grad: coursesForMode(COURSES, 'grad', TERM_CONTEXT),
  undergrad: coursesForMode(COURSES, 'undergrad', TERM_CONTEXT),
};
const DISPLAY_CODES: Record<ViewMode, Map<string, string>> = {
  grad: new Map(MODE_ENTRIES.grad.map(e => [e.course.id, e.displayCode])),
  undergrad: new Map(MODE_ENTRIES.undergrad.map(e => [e.course.id, e.displayCode])),
};
const displayCodeOf = (c: Course, mode: ViewMode) => DISPLAY_CODES[mode].get(c.id) ?? c.code;
const ModeContext = createContext<ViewMode>(DEFAULT_MODE);
const useMode = () => useContext(ModeContext);
function useDisplayCode() { const mode = useMode(); return (c: Course) => displayCodeOf(c, mode); }
const VERIFICATION_CTX = { verification: verificationData };
const safeStorage = () => { try { return window.localStorage; } catch { return null; } }; // storage can be blocked; the core functions cope with null
const crossListCodesOf = (c: Course) => Object.values(c.sectionsByTerm ?? {}).flatMap(list => (list ?? []).map(sec => sec.crossListCode ?? ''));

const normalizeText = (v: string) => v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const compactText = (v: string) => v.replace(/\s+/g, '');
const SEARCH_INDEX = new Map(COURSES.map(c => {
  const text = normalizeText([
    c.title, c.code, DISPLAY_CODES.grad.get(c.id) ?? '', DISPLAY_CODES.undergrad.get(c.id) ?? '', c.category, c.categorySecondary, c.description,
    // the instructors of independent study classes are never shown, so they are not searchable either
    ...(showInstructors(c) ? [c.instructor, c.instructorFullName, upcomingInstructors(c, TERM_CONTEXT)] : []),
    c.crossListings, ...crossListCodesOf(c), c.searchKeywords, c.tools.join(' '),
  ].join(' '));
  return [c.id, `${text} ${compactText(text)}`];
}));
function matchesSearch(course: Course, query: string) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = SEARCH_INDEX.get(course.id) ?? '';
  return terms.every(t => haystack.includes(t));
}
const inCategories = (c: Course, selected: Set<string>) =>
  selected.size === 0 || selected.has(c.category) || (c.categorySecondary !== '' && selected.has(c.categorySecondary));
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

// ─── Page addresses and links ─────────────────────────────────────────────────
// Every page has its own address after the "#": #/ (home), #/class/<id>, #/profile, #/plan/<id>.
const NavContext = createContext<(hash: string, opts?: { replace?: boolean; from?: Element | null; scrollY?: number }) => void>(() => {});
const classHref = (c: Course) => `#/class/${encodeURIComponent(c.id)}`;
const planHref = (p: Pick<Plan, 'id'>) => `#/plan/${encodeURIComponent(p.id)}`;

// A real link (so Tab, Enter, right-click and "open in new tab" all work) that moves inside the app when clicked.
function AppLink({ to, children, ...rest }: { to: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const go = useContext(NavContext);
  return (
    <a href={to} {...rest} onClick={e => {
      rest.onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // a link inside a tile (or a plan row) zooms that tile's cover into the class page
      const card = (e.currentTarget as HTMLElement).closest('[data-zoom-card]');
      go(to, { from: card?.querySelector('[data-zoom-source]') ?? null });
    }}>{children}</a>
  );
}

// The Saved overview's last scroll position, so a Back button can put the list back where it was.
let savedOverviewY = 0;

// The one "back to a list" control: a round arrow button and a bold label in a single pill. It goes to `to` (and can restore a scroll
// position), or runs `onClick` for pages that step back through history.
function BackButton({ label, ariaLabel, to, onClick, restoreSavedScroll = false }: { label: string; ariaLabel: string; to?: string; onClick?: () => void; restoreSavedScroll?: boolean }) {
  const go = useContext(NavContext);
  const inner = (
    <>
      <span className="back-btn-arrow" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
      </span>
      <span aria-hidden="true">{label}</span>
    </>
  );
  if (to) {
    return (
      <a href={to} className="back-btn" aria-label={ariaLabel}
        onClick={e => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          go(to, restoreSavedScroll ? { scrollY: savedOverviewY } : undefined);
        }}>{inner}</a>
    );
  }
  return <button type="button" className="back-btn" aria-label={ariaLabel} onClick={onClick}>{inner}</button>;
}

const STATIC_FILTERS = [
  { key: 'crit', label: 'Critical Perspectives', test: (c: Course) => c.countsToward.includes('Critical Perspectives') },
  { key: 'runningNow', label: 'Running now', test: (c: Course) => availabilityOf(c).kind === 'next' },
  { key: 'notOffered', label: 'Not offered recently', test: (c: Course) => availabilityOf(c).kind === 'none' },
  { key: 'focus', label: 'Focus', test: (c: Course) => c.countsToward.includes('Focus') },
  { key: 'noPrereq', label: 'No prerequisites', test: (c: Course) => c.noRequiredPrereqs },
  { key: 'openToNonMajors', label: 'Open to non-majors', test: (c: Course) => c.openToNonMajors },
] as const;
// One chip per season that has an upcoming term (Spring today). The chip is the shared season marker, so its text is exactly "Spring" or
// "Fall", and it keeps the classes offered in an upcoming term of that season. Past terms are history and get no chip.
const UPCOMING_SEASONS = [...new Set(Object.entries(defaultConfig.termStatus).filter(([, status]) => status === 'upcoming').map(([term]) => term)
  .filter(term => COURSES.some(c => c.termsOffered.includes(term))).sort((x, y) => termRank(x) - termRank(y)).map(term => seasonOf(term)))] as SeasonName[];
type QuickKey = typeof STATIC_FILTERS[number]['key'] | `term:${string}`;
const TERM_FILTERS: { key: QuickKey; label: string; test: (c: Course) => boolean }[] =
  UPCOMING_SEASONS.map(season => ({ key: `term:${season}` as const, label: SEASON_WORD[season], test: (c: Course) => c.termsOffered.some(t => seasonOf(t) === season && isUpcoming(t, TERM_CONTEXT)) }));
const QUICK_FILTERS: { key: QuickKey; label: string; test: (c: Course) => boolean }[] = [...STATIC_FILTERS, ...TERM_FILTERS];
// The filter panel groups them under small labels. Counts toward chips wear their tag hue.
// Within a group, Availability and Counts toward match ANY chosen chip; Requirements must match ALL of them.
// Groups combine with AND, so each extra group narrows the list.
// A group the config hides is left out here, so the panel, the active count and the filtering all ignore its chips.
const FILTER_GROUPS: { label: string; mode: 'any' | 'all'; keys: QuickKey[] }[] = [
  { label: 'Availability', mode: 'any', keys: [...(semester.showRunningNow ? ['runningNow' as const] : []), ...TERM_FILTERS.map(f => f.key), ...(semester.showNotOfferedFilter ? ['notOffered' as const] : [])] },
  ...(semester.showCountsTowardFilter ? [{ label: 'Counts toward', mode: 'any' as const, keys: ['focus', 'crit'] as QuickKey[] }] : []),
  { label: 'Requirements', mode: 'all', keys: semester.showNonMajorFilter ? ['noPrereq', 'openToNonMajors'] : ['noPrereq'] },
];
const FILTER_KEYS_SHOWN = new Set<QuickKey>(FILTER_GROUPS.flatMap(g => g.keys));
const FILTER_TAG_KEY: Partial<Record<QuickKey, TagKey>> = { focus: 'focus', crit: 'crit' };
const passesQuick = (c: Course, active: Set<QuickKey>) => FILTER_GROUPS.every(g => {
  const on = g.keys.filter(k => active.has(k));
  if (!on.length) return true;
  const test = (k: QuickKey) => QUICK_FILTERS.find(f => f.key === k)!.test(c);
  return g.mode === 'any' ? on.some(test) : on.every(test);
});

// CU class search opens straight to results from the part of the address after "#".
// The term comes from one setting (semester.classSearchTermCode). While it is null the link has no term at all.
const classSearchLink = (c: Course) => {
  const title = narrowTitle(c);
  const keyword = title ? `${c.code.replace(/^ATLS /, '')} ${title}` : c.code;
  return `https://classes.colorado.edu/#keyword=${encodeURIComponent(keyword).replace(/%20/g, '+')}${
    semester.classSearchTermCode ? `&srcdb=${semester.classSearchTermCode}` : ''
  }`;
};
// Several classes share one course number (every 4519 topic, both 4529 topics, 3519's topics), so a
// search by number alone lists them all. For a shared number whose class is running in the searched
// term, the link adds the topic title. Tested in CU class search: "4519+Generative+AI" finds exactly
// that topic, but "ATLS+4519+Generative+AI" finds 0, so the subject prefix is dropped when a title is added.
const CODE_COUNTS = COURSES.reduce((m, c) => m.set(c.code, (m.get(c.code) ?? 0) + 1), new Map<string, number>());
const sharesNumber = (c: Course) => c.specialTopic || (CODE_COUNTS.get(c.code) ?? 0) > 1;
// CU spells a few titles differently from the spreadsheet. A string is CU's spelling; null means CU splits
// the class into several sections, so the title can't narrow it (the page tells the student what to look for).
const CU_SEARCH_TITLE: Record<string, string | null> = {
  'atls-4519-touchdesigner': 'Touch Designer',
  'atls-4519-pedagogy-1-and-2': null,
};
function narrowTitle(c: Course): string {
  if (!sharesNumber(c)) return '';
  const kind = availabilityOf(c).kind;
  if (kind !== 'next') return '';
  const override = CU_SEARCH_TITLE[c.id];
  if (override === null) return '';
  return (override ?? c.title.split(':').pop() ?? '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const availabilityOf = (c: Course) => availability(c, TERM_CONTEXT);
// The app says nothing about a class that is running this term. Availability is only worth a line when something is off
// (not posted, not offered recently, offered next term instead). semester.showRunningNow brings the old wording back.
const showsAvailability = (c: Course) => semester.showRunningNow || availabilityOf(c).kind === 'none';
// A class has an exception when something is off: it isn't running this term, or its requirement tag says to check with an advisor.
// Only these classes get the advisor card on their page.
const hasException = (c: Course) => showsAvailability(c) || countsTag(c) === 'Check with advisor';
const COURSE_IMAGES: Record<string, string> = Object.fromEntries(COURSES.filter(c => c.image).map(c => [c.id, c.image]));
const accentFor = (category: string) => CATEGORY_COLORS[category] ?? '#767676';

// Flat area icons: one style (24px grid, 1.75 rounded stroke, no fill), drawn in the area's hue on its tint.
const AREA_ICONS: Record<string, React.ReactNode> = {
  'AI / Emerging Tech': <><path d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7z" /><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></>,
  'Fabrication & Making': <><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="1.5" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></>,
  'Game Design': <><path d="M7 8h10a4 4 0 0 1 4 4v1.5a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 1.3A3 3 0 0 1 3 13.5V12a4 4 0 0 1 4-4z" /><path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01" /></>,
  'AR / VR': <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3.2l-1.6-2.5H9.8L8.2 17H5a2 2 0 0 1-2-2z" />,
  '3D / Animation': <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
  'Sound & Music / Visual Systems': <path d="M4 11v2M8 7v10M12 4v16M16 8v8M20 11v2" />,
  'UX / Product Design': <path d="M5 3l13 6.5-5.5 2L10.5 17z" />,
  'Branding & Strategy': <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  'Accessibility': <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="8" r="1" /><path d="M7.5 11h9M12 11v3.5M9.8 19l2.2-4.5 2.2 4.5" /></>,
};
const GENERIC_ICON = <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>;
// The icon circle on a card: a solid fill in the area hue with a white icon (3.4:1 or better), so neighbors of different areas differ at a glance.
// Classes with no area get a gray circle and a generic icon.
function AreaBadge({ category, size, icon: custom, eased = false }: { category: string; size: number; icon?: React.ReactNode; eased?: boolean }) {
  const hue = CATEGORY_COLORS[category];
  const icon = size * 0.5;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, minWidth: size, borderRadius: '50%', background: hue ?? '#767676', color: '#FFF', display: 'inline-grid', placeItems: 'center', flexShrink: 0, ...(eased ? { transition: 'width 0.3s cubic-bezier(0.22, 1, 0.36, 1), height 0.3s cubic-bezier(0.22, 1, 0.36, 1), min-width 0.3s cubic-bezier(0.22, 1, 0.36, 1)' } : {}) }}>
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" focusable="false" style={eased ? { width: '50%', height: '50%' } : undefined}>{custom ?? ((hue && AREA_ICONS[category]) || GENERIC_ICON)}</svg>
    </span>
  );
}
const COUNTS_SHORT: Record<string, string> = {
  'Focus Elective': 'Focus',
  'Critical Perspectives': 'Critical Perspectives',
  'How-To requirement': 'How-To',
  'Focus Elective + Critical Perspectives': 'Focus + Critical Perspectives',
};
const capCredit = (v: string) => v.replace(/\bcredits?\b/, m => m[0].toUpperCase() + m.slice(1));

// One wording for prerequisites everywhere: "None", "None listed" and an empty field all read "No prerequisites".
// Anything after a leading "None" (e.g. "None (motivation and curiosity); ...") is kept, not dropped.
const requiredPrereq = (c: Course) => {
  const v = c.prereqRequired.trim();
  if (!v || /^none( listed)?\.?$/i.test(v)) return 'No prerequisites';
  return v.replace(/^none\b/i, 'No prerequisites');
};
// A class with no requirement tag at all (the records in courses-extra.json carry none) has nothing to flag. A tag we do not recognise still says "Check with advisor".
const countsTag = (c: Course) => c.countsToward.trim() === '' ? '' : COUNTS_SHORT[c.countsToward] ?? 'Check with advisor';

// A color AND a shape per requirement tag, so the meaning survives grayscale and colorblindness,
// not just a color swatch. Each shape/color pair repeats everywhere the tag appears (cards, the
// class page, plans and the legend) so the mapping only has to be learned once.
type TagShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'exclaim';
// One hue per tag type, none of them blue (blue is for controls): a pale fill, a stronger outline (the marker uses it too)
// and dark text. Checked: text on its fill is 9.7:1 or better, and every outline is 4.4:1 or better against white.
type TagKey = 'focus' | 'crit' | 'both' | 'howto' | 'advisor';
const TAG_THEME: Record<TagKey, { fill: string; line: string; text: string; shape: TagShape }> = {
  focus:   { fill: '#E3F3EA', line: '#1B7F55', text: '#0A3B28', shape: 'circle' },
  crit:    { fill: '#FBE6EA', line: '#B3213F', text: '#5E0E20', shape: 'square' },
  both:    { fill: '#F0E6F6', line: '#8A3E94', text: '#3C1048', shape: 'diamond' },
  howto:   { fill: '#FCE9D6', line: '#B8620A', text: '#5A2E00', shape: 'triangle' },
  advisor: { fill: '#FFF1BA', line: '#8A6A00', text: '#4A3900', shape: 'exclaim' },
};
const TAG_KEY_BY_COUNTS: Record<string, TagKey> = {
  'Focus Elective': 'focus', 'Critical Perspectives': 'crit', 'Focus Elective + Critical Perspectives': 'both', 'How-To requirement': 'howto',
};
const tagKeyFor = (course: Course): TagKey => TAG_KEY_BY_COUNTS[course.countsToward] ?? 'advisor';
const tagStyleOf = (k: TagKey) => ({ color: TAG_THEME[k].line, shape: TAG_THEME[k].shape });
const tagStyleFor = (course: Course) => tagStyleOf(tagKeyFor(course));
// The pale-fill, strong-outline look of a tag, the same everywhere the tag appears.
const tagPill = (course: Course): React.CSSProperties => {
  const t = TAG_THEME[tagKeyFor(course)];
  return { background: t.fill, border: `1px solid ${t.line}`, color: t.text };
};

// Availability pills are neutral grays that differ in weight, so they never compete with the tag hues.
const AVAIL_PILL: Record<'next' | 'none', React.CSSProperties> = {
  next: { background: '#E4E4E4', border: '1px solid #5A5A5A', color: '#1A1A1A', fontWeight: 700 },
  none: { background: '#FFFFFF', border: '1px dashed #767676', color: '#444444', fontWeight: 400 },
};
function AvailabilityPill({ course, full = false }: { course: Course; full?: boolean }) {
  const a = availabilityOf(course);
  return <span style={{ ...AVAIL_PILL[a.kind], alignSelf: 'flex-start', display: 'inline-block', maxWidth: '100%', padding: '4px 12px', borderRadius: 999, fontSize: 16, lineHeight: 1.35, fontFamily: 'var(--font-sans)', overflowWrap: 'anywhere' }}>{full ? a.full : a.short}</span>;
}

function TagMarker({ shape, color, size = 12 }: { shape: TagShape; color: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, focusable: false } as const;
  if (shape === 'circle') return <svg {...common}><circle cx="6" cy="6" r="6" fill={color} /></svg>;
  if (shape === 'square') return <svg {...common}><rect width="12" height="12" rx="2" fill={color} /></svg>;
  if (shape === 'diamond') return <svg {...common}><polygon points="6,0 12,6 6,12 0,6" fill={color} /></svg>;
  if (shape === 'triangle') return <svg {...common}><polygon points="6,0 12,11 0,11" fill={color} /></svg>;
  return (
    <svg {...common}>
      <circle cx="6" cy="6" r="6" fill={color} />
      <rect x="5.1" y="2.4" width="1.8" height="4.4" rx="0.9" fill="#FFF" />
      <rect x="5.1" y="8.1" width="1.8" height="1.8" rx="0.9" fill="#FFF" />
    </svg>
  );
}

// The note behind "Check with advisor": the class's own counts_toward text if it says something
// specific about the disagreement, otherwise a generic reminder to ask an advisor.
function advisorNote(course: Course): string {
  const raw = course.countsToward.trim();
  if (!raw) return 'Sources disagree on this class. Confirm with your advisor.';
  const sentence = /[.!?]$/.test(raw) ? raw : `${raw}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function tagTooltip(course: Course): string {
  switch (course.countsToward) {
    case 'Focus Elective': return 'Counts as a Focus Elective.';
    case 'Critical Perspectives': return 'Counts toward Critical Perspectives.';
    case 'Focus Elective + Critical Perspectives': return 'Counts toward either.';
    case 'How-To requirement': return 'Counts toward the How-To requirement.';
    default: return advisorNote(course);
  }
}

// Only one tag tooltip open at a time, no matter which card, class page or plan it's on.
const TagTooltipContext = createContext<{ openId: string | null; setOpenId: (id: string | null) => void }>({ openId: null, setOpenId: () => {} });

function TagTooltipProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <TagTooltipContext.Provider value={{ openId, setOpenId }}>{children}</TagTooltipContext.Provider>;
}

// A requirement tag that is also a button: tapping it opens a small tooltip next to the tag
// (not the class page) explaining what it means. `style` carries the pill's own look. `marker`
// draws the tag's color+shape; set `showLabel` to false to drop the text on tight mobile cards
// and let the marker (plus the accessible name, unchanged) carry it instead.
function TagButton({ id, label, tooltip, marker, showLabel = true, showHelp = true, style }: {
  id: string; label: string; tooltip: string; marker: { color: string; shape: TagShape }; showLabel?: boolean; showHelp?: boolean; style: React.CSSProperties;
}) {
  const { openId, setOpenId } = useContext(TagTooltipContext);
  const open = openId === id;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <span style={{ position:'relative', zIndex:1, display:'inline-flex', maxWidth:'100%' }}>
      <button ref={btnRef} type="button" className="tag-pill" aria-label={`${label}: what does this mean?`} aria-haspopup="dialog" aria-expanded={open}
        onClick={e => { e.stopPropagation(); setRect(btnRef.current?.getBoundingClientRect() ?? null); setOpenId(open ? null : id); }}
        style={{ ...style, ['--tag-line' as string]: marker.color, display:'inline-flex', alignItems:'center', gap:showLabel ? 8 : 6, minHeight:44, cursor:'pointer', maxWidth:'100%' }}>
        <TagMarker shape={marker.shape} color={marker.color} />
        {showLabel && <span aria-hidden="true" style={{ overflowWrap:'anywhere' }}>{label}</span>}
        {showHelp && <span aria-hidden="true" style={{ display:'inline-grid', placeItems:'center', width:15, height:15, minWidth:15, borderRadius:'50%', border:'1px solid currentColor', fontSize:11, lineHeight:1, flexShrink:0 }}>?</span>}
      </button>
      {open && (
        <AnchoredPopover rect={rect} ariaLabel={label} width={240} onClose={() => setOpenId(null)}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
            <p style={{ margin:0, fontSize:16, lineHeight:1.5, color:'#000' }}>{tooltip}</p>
            <button onClick={() => setOpenId(null)} aria-label="Close"
              style={{ width:32, height:32, minWidth:32, flexShrink:0, margin:'-6px -6px 0 0', background:'none', border:0, color:'#000', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </AnchoredPopover>
      )}
    </span>
  );
}


// The search field: a magnifier at the left, a 12px radius, a light gray fill, and a darker border and ring on focus
// (all in the .search-field rules). It is a rounded rectangle on gray, so it never looks like a button or a chip.
function SearchField({ value, onChange, placeholder, id, inputRef, label = 'Search classes' }: {
  value: string; onChange: (v: string) => void; placeholder: string; id?: string; inputRef?: React.Ref<HTMLInputElement>; label?: string;
}) {
  return (
    <div className="search-field">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
      <input ref={inputRef} id={id} type="search" value={value} onChange={e => onChange(e.target.value)} aria-label={label}
        placeholder={placeholder} enterKeyHint="search" autoComplete="off" style={{ fontSize: 16, fontFamily: 'var(--font-sans)' }} />
    </div>
  );
}

function SearchBox({ value, onChange, isMobile, flush = false, bare = false }: { value: string; onChange: (v: string) => void; isMobile: boolean; flush?: boolean; bare?: boolean }) {
  return (
    <div style={bare ? { width:'100%' } : flush ? { flex:1, minWidth:0 } : { maxWidth:560, marginBottom:isMobile ? 20 : 24 }}>
      <SearchField id="search-input" value={value} onChange={onChange} placeholder={flush ? 'Search classes' : 'Search classes or instructors'} />
    </div>
  );
}

function ExternalIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>;
}

function formatDate(v: string) {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// "41 classes", announced when it changes, plus a way to clear everything that is filtering the list.
function ResultsBar({ count, anyActive, onClear, tight = false, flush = false, trailing, hideClear = false }: { count: number; anyActive: boolean; onClear: () => void; tight?: boolean; flush?: boolean; trailing?: React.ReactNode; hideClear?: boolean }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', columnGap:16, flex:trailing ? '1 1 auto' : undefined, margin:flush ? 0 : tight ? '4px 0 12px' : '8px 0 0' }}>
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', columnGap:16 }}>
        <p role="status" style={{ margin:0, minHeight:44, display:'flex', alignItems:'center', fontSize:16, lineHeight:1.5, color:'#000', fontWeight:600 }}>{count} {count === 1 ? 'class' : 'classes'}</p>
        {anyActive && !hideClear && (
          <button onClick={onClear} style={{ minHeight:44, padding:'0 4px', border:0, background:'none', color:'#000', fontSize:16, fontFamily:'var(--font-sans)', fontWeight:500, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' }}>Clear search and filters</button>
        )}
      </div>
      {trailing}
    </div>
  );
}

// A filter chip: outlined with no fill when off; a pale tint, a stronger border and a checkmark when on. A rounded
// rectangle, not a pill, so it never reads as a button. `hue` (a pale fill and a strong line) tints it by category or tag.
function FilterChip({ label, on, onClick, hue, dot, marker, season }: {
  label: string; on: boolean; onClick: () => void; hue?: { fill: string; line: string }; dot?: string; marker?: { color: string; shape: TagShape }; season?: { season: SeasonName; upcoming: boolean };
}) {
  const line = hue?.line ?? UI.ink;
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      style={{ ...outlinedChip, position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'left',
        ...(on ? { background: hue?.fill ?? '#ECECEC', border: `2px solid ${line}`, padding: '5px 13px', fontWeight: 600 } : {}) }}>
      {on && season && <span aria-hidden="true" style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', background: UI.ink, display: 'grid', placeItems: 'center' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>}
      {season && <SeasonMarker season={season.season} upcoming={season.upcoming} size={20} />}
      {on && !season && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
      {marker && <TagMarker shape={marker.shape} color={marker.color} />}
      {dot && !marker && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {!season && label}
    </button>
  );
}
const areaHue = (name: string) => { const c = CATEGORY_COLORS[name]; return c ? { fill: `${c}26`, line: c } : undefined; };

// One "Filters" button (with a count of the active ones) that opens a panel with the filters in labeled groups.
function FilterControl({ active, onToggle, onClear, count }: { active: Set<QuickKey>; onToggle: (k: QuickKey) => void; onClear: () => void; count: number }) {
  const [open, setOpen] = useState(false);
  const n = [...active].filter(k => FILTER_KEYS_SHOWN.has(k)).length; // only chips the panel shows, so a hidden one never counts
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={n ? `Filters, ${n} active` : 'Filters'} onClick={() => setOpen(true)}
        style={{ ...outlinedButton, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
        <span aria-hidden="true">Filters</span>
        {n > 0 && <span aria-hidden="true" style={{ minWidth: 24, height: 24, padding: '0 7px', borderRadius: 12, background: UI.ink, color: '#FFF', fontSize: 14, fontWeight: 700, display: 'grid', placeItems: 'center', boxSizing: 'border-box' }}>{n}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <Dialog title="Filters" onClose={() => setOpen(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {FILTER_GROUPS.map(g => (
                <section key={g.label} aria-label={g.label}>
                  <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#444' }}>{g.label}</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {g.keys.map(k => {
                      const f = QUICK_FILTERS.find(x => x.key === k)!;
                      const tk = FILTER_TAG_KEY[k];
                      return <FilterChip key={k} label={f.label} on={active.has(k)} onClick={() => onToggle(k)}
                        hue={tk ? { fill: TAG_THEME[tk].fill, line: TAG_THEME[tk].line } : undefined} marker={tk ? tagStyleOf(tk) : undefined}
                        season={k.startsWith('term:') ? { season: seasonOf(f.label) as SeasonName, upcoming: true } : undefined} />;
                    })}
                  </div>
                </section>
              ))}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, position: 'sticky', bottom: 0, background: '#fff', padding: '12px 0', boxShadow: '0 -1px 0 var(--line-soft)' }}>
                <button type="button" onClick={onClear} disabled={n === 0} style={{ ...outlinedButton, ...(n === 0 ? { opacity: 0.45, cursor: 'default' } : {}) }}>Clear all</button>
                <button type="button" onClick={() => setOpen(false)} style={filledButton}>Show {count} {count === 1 ? 'class' : 'classes'}</button>
              </div>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
}

// `condensed` (the pinned toolbar): one tight line, and the season key stays in the page for screen readers but is not drawn.
function QuickFilters({ active, onToggle, count, anyActive, onClear, onClearQuick, condensed = false }: { active: Set<QuickKey>; onToggle: (k: QuickKey) => void; count: number; anyActive: boolean; onClear: () => void; onClearQuick: () => void; condensed?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: condensed ? 'nowrap' : 'wrap', alignItems: 'center', columnGap: 16 }}>
      <FilterControl active={active} onToggle={onToggle} onClear={onClearQuick} count={count} />
      <ResultsBar count={count} anyActive={anyActive} onClear={onClear} flush />
    </div>
  );
}

// The small round "?" that opens "What the tags mean" without a big legend permanently on the page.
const FILTERS = ['All', ...Object.keys(CATEGORY_COLORS)];
// Two fixed rows — never reflow on selection change
const FILTER_ROW1 = FILTERS.slice(0, 6);  // All → 3D / Animation
const FILTER_ROW2 = FILTERS.slice(6);     // Sound & Music → Accessibility

// ─── Shared grid tokens (single source of truth for both pages) ───────────────
const TOPBAR_H = 64;
const SPACING = { pagePt: 48, pagePx: 48, pagePb: 80, headingMb: 36, filtersMb: 64 } as const;

// Shared grid shell — both pages render their cards inside this.
function CourseGrid({ helpOpen = false, children }: { helpOpen?: boolean; children: React.ReactNode }) {
  const vw = useWindowWidth();
  const isMobile = vw < 640;
  const cols = isMobile ? 1 : vw >= 1100 ? 4 : vw >= 800 ? 3 : 2;
  return (
    <motion.div
      layout
      style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${cols}, minmax(0, 1fr))`, columnGap: isMobile ? 0 : 24, rowGap: 24 }}
    >
      {children}
    </motion.div>
  );
}

// ─── Archive data ─────────────────────────────────────────────────────────────
const ARCHIVE_YEARS = [2024, 2025, 2026] as const;
type ArchiveYear = typeof ARCHIVE_YEARS[number];
interface Project { id: string; title: string; student: string; description: string; }
// Real student projects, by course code then year. Classes with none hide the archive.
const PROJECTS: Record<string, Partial<Record<ArchiveYear, Project[]>>> = {};

// ─── Ease ──────────────────────────────────────────────────────────────────────
const EASE: [number,number,number,number] = [0.22, 1, 0.36, 1];

// ─── Shared helpers ───────────────────────────────────────────────────────────
function ImagePlaceholder({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="26" height="22" rx="2" stroke="#BDBDBD" strokeWidth="1.5" fill="none"/>
      <circle cx="11" cy="13" r="3" stroke="#BDBDBD" strokeWidth="1.5" fill="none"/>
      <path d="M3 22L10 16L16 21L22 14L29 22" stroke="#BDBDBD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return filled
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17l-7-3-7 3V4z"/></svg>
    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17l-7-3-7 3V4z"/></svg>;
}

// ─── Buttons shared by the plan screens ───────────────────────────────────────
// The shared tokens (values live in index.css as CSS variables). Three roles are defined once and reused:
// filledButton (primary actions), outlinedButton (secondary actions) and outlinedChip / selectedChip (filters).
const UI = {
  ink: 'var(--ink)', line: 'var(--line)', lineSoft: 'var(--line-soft)',
  radius: { button: 'var(--radius-button)', chip: 'var(--radius-chip)', field: 'var(--radius-field)' },
} as const;
const pillBase = { padding:'8px 20px', minHeight:44, borderRadius:UI.radius.button, fontSize:16, fontFamily:'var(--font-sans)', fontWeight:500, cursor:'pointer' } as const;
const filledButton = { ...pillBase, fontWeight:600, background:UI.ink, color:'#FFF', border:`1px solid ${UI.ink}` } as const;
const outlinedButton = { ...pillBase, background:'#FFF', color:UI.ink, border:`1px solid ${UI.ink}` } as const;
const outlinedChip = { minHeight:44, padding:'6px 14px', borderRadius:UI.radius.chip, background:'transparent', color:UI.ink, border:`1px solid ${UI.line}`, fontSize:16, fontFamily:'var(--font-sans)', fontWeight:400, cursor:'pointer' } as const;
const btnDark = filledButton;
const btnLight = outlinedButton;
const linkBtn = { display:'inline-flex', alignItems:'center', justifyContent:'center', textDecoration:'none' } as const;
const linkBtnDark = { ...btnDark, ...linkBtn } as const;
const linkBtnLight = { ...btnLight, ...linkBtn } as const;
// One style for every link that leaves the app (CU class search, the advisor's booking page, feedback, instructor pages).
// Squarer than the pill buttons, a white fill with a 2px dark outline and an arrow-leaving-a-box icon at the right, so it
// never reads as an in-app action. Filled and soft styles stay for actions inside the app.
const externalAction = { display:'inline-flex', alignItems:'center', gap:8, minHeight:44, padding:'0 16px', borderRadius:10, border:`2px solid ${UI.ink}`, background:'#FFF', color:UI.ink, fontSize:16, fontFamily:'var(--font-sans)', fontWeight:600, lineHeight:1.3, textDecoration:'none', cursor:'pointer', maxWidth:'100%' } as const;
function ExternalAction({ href, children, sr, style, leading, className = '' }: { href: string; children: React.ReactNode; sr: string; style?: React.CSSProperties; leading?: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`external-action ${className}`.trim()} style={{ ...externalAction, ...style }}>
      {leading}
      <span>{children}<span className="sr-only"> {sr}</span></span>
      <ExternalIcon size={18} />
    </a>
  );
}
const btnOff = { background:'#595959', border:'1px solid #595959', cursor:'default' } as const; // same `border` shorthand as the buttons it overrides, so React never mixes shorthand and longhand

// ─── Notification pill: shown after a class is saved, unsaved, added to a plan or removed from one ───
interface ToastAction { label: string; run: () => void }
interface ToastState { message: string; actions: ToastAction[]; note?: string; persist?: boolean; key: number }
const TOAST_MS = 6000;

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const isMobile = useWindowWidth() < 640;
  const modalOpen = useModalOpen(); // a dialog or sheet owns the bottom of the screen, so the pill waits until it closes
  const [held, setHeld] = useState(false); // hovered, focused or touched
  const left = useRef(TOAST_MS);
  useEffect(() => {
    if (held || modalOpen || toast.persist) return; // a notice that asks for a choice (a new version is ready) stays until answered
    const t0 = Date.now();
    const timer = setTimeout(onDismiss, left.current);
    return () => { clearTimeout(timer); left.current = Math.max(0, left.current - (Date.now() - t0)); };
  }, [held, modalOpen]);
  if (modalOpen) return null;
  const hold = { onMouseEnter: () => setHeld(true), onMouseLeave: () => setHeld(false), onFocus: () => setHeld(true), onBlur: () => setHeld(false), onTouchStart: () => setHeld(true), onTouchEnd: () => setTimeout(() => setHeld(false), 1500) };
  return (
    <div className="no-print" style={{ position:'fixed', zIndex:2200, left:0, right:0, bottom:isMobile ? `calc(${BAR_H} + 12px)` : 24, display:'flex', justifyContent:'center', pointerEvents:'none' }}>
      <div role="status" aria-live="polite" className="save-toast" {...hold}
        style={{ pointerEvents:'auto', boxSizing:'border-box', display:'flex', flexDirection:'column', justifyContent:'center', minHeight:48, maxWidth:isMobile ? '92%' : 560, padding:toast.note ? '8px 20px 10px' : toast.actions.length ? '0 8px 0 20px' : '0 20px', background:'#141414', color:'#FFF', borderRadius:toast.note ? 24 : 100, fontSize:16, lineHeight:1.3, fontFamily:'var(--font-sans)', boxShadow:'0 8px 24px rgba(0,0,0,0.28)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ minWidth:0, overflowWrap:'anywhere' }}>{toast.message}</span>
          {toast.actions.map(a => (
            <Fragment key={a.label}>
              <span aria-hidden="true">·</span>
              <button className="save-toast-btn" onClick={() => { a.run(); onDismiss(); }}
                style={{ flexShrink:0, minHeight:44, padding:'0 10px', background:'none', border:0, color:'#FFF', fontSize:16, fontFamily:'var(--font-sans)', fontWeight:600, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' }}>
                {a.label}
              </button>
            </Fragment>
          ))}
        </div>
        {toast.note && <div style={{ marginTop:toast.actions.length ? -4 : 2, fontSize:14, lineHeight:1.35, color:'rgba(255,255,255,0.8)' }}>{toast.note}</div>}
      </div>
    </div>
  );
}

// ─── One dialog for everything: a centered box on desktop, a bottom sheet on mobile ─
const dialogStack: object[] = [];

// Keeps Tab inside the open dialog/sheet, closes on Escape, and returns focus to whatever opened it.
function useDialogFocusTrap(panelRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openerRef = useRef(document.activeElement as HTMLElement | null); // read before autoFocus moves focus

  useEffect(() => {
    const token = {};
    const opener = openerRef.current;
    dialogStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      if (e.key === 'Escape') { closeRef.current(); return; }
      const panel = panelRef.current;
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')].filter(el => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus({ preventScroll: true });
    return () => {
      dialogStack.splice(dialogStack.indexOf(token), 1);
      window.removeEventListener('keydown', onKey);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
}

function Dialog({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const isMobile = useWindowWidth() < 640;
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(panelRef, onClose);

  const heading = <h2 className="no-print" style={{ margin:'0 44px 16px 0', fontSize:20, fontWeight:600, lineHeight:1.3, letterSpacing:'-0.01em', color:'#000' }}>{title}</h2>;

  if (isMobile) {
    return (
      <MobileSheet onClose={onClose} label={title} panelRef={panelRef}>
        {heading}
        {children}
      </MobileSheet>
    );
  }
  return createPortal(
    <motion.div className="dialog-backdrop" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.25 }} onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:2100, background:'rgba(0,0,0,0.22)', backdropFilter:'blur(5px)', WebkitBackdropFilter:'blur(5px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <motion.div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="dialog-panel"
        initial={{ opacity:0, scale:0.97, y:8 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.97, y:8 }} transition={{ duration:0.25, ease:EASE }}
        onClick={e => e.stopPropagation()}
        style={{ position:'relative', width:'100%', maxWidth:wide ? 720 : 440, maxHeight:'88vh', overflowY:'auto', background:'#FFF', borderRadius:16, padding:'28px 32px', boxShadow:'0 8px 40px rgba(0,0,0,0.12)', outline:'none' }}>
        <button onClick={onClose} aria-label="Close" className="no-print"
          style={{ position:'absolute', top:12, right:12, width:44, height:44, background:'none', border:'none', color:'#000', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        {heading}
        {children}
      </motion.div>
    </motion.div>,
    document.body
  );
}

// The semester picker's state: Spring or Fall, 2026 to 2028. A new plan starts on the next upcoming term. A plan whose saved term is
// not one of those (an old Summer term, or none) starts with no season chosen, and must get one before it can be saved.
// The one-time reminder that plans live on this device only: shown with the first plan a student makes on a device, then never again.
// (A device that already has plans counts as having seen it.)
const DEVICE_NOTE_KEY = 'focus-electives:device-note-seen';
let deviceNoteShownThisSession = false;
function takeDeviceNote(hasPlans: boolean): string | undefined {
  if (deviceNoteShownThisSession) return undefined;
  let seen = hasPlans;
  try { seen = seen || window.localStorage.getItem(DEVICE_NOTE_KEY) !== null; window.localStorage.setItem(DEVICE_NOTE_KEY, '1'); } catch { /* storage blocked: once per visit */ }
  deviceNoteShownThisSession = true;
  return seen ? undefined : 'Plans are saved on this device only.';
}

function usePlanTerm(initialTerm: string, mode: 'create' | 'rename' | 'semester') {
  const [nextSeason, nextYear] = semester.nextTermName.split(' ');
  const [initSeason, initYear] = initialTerm.split(' ');
  const keep = (SEASONS as readonly string[]).includes(initSeason) && (PLAN_YEARS as readonly number[]).includes(Number(initYear));
  const [season, setSeason] = useState<string>(keep ? initSeason : mode === 'create' ? nextSeason : '');
  const [year, setYear] = useState<number>(keep ? Number(initYear) : Number(nextYear));
  const needsTerm = mode !== 'rename';
  return { season, setSeason, year, setYear, term: season ? `${season} ${year}` : '', ok: !needsTerm || season !== '' };
}

const fieldLabel = { display:'block', marginBottom:8, fontSize:16, fontWeight:600, lineHeight:1.5, color:'#000' } as const;
const fieldBox = { width:'100%', minHeight:48, padding:'0 12px', border:'1px solid #000', borderRadius:8, fontSize:16, fontFamily:'var(--font-sans)', color:'#000', background:'#FFF', boxSizing:'border-box' } as const;


function MobilePlanFormPage({ mode, initialName = '', initialTerm = '', onSubmit, onClose }: {
  mode: 'create' | 'rename'; initialName?: string; initialTerm?: string;
  onSubmit: (name: string, term: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const { season, setSeason, year, setYear, term, ok } = usePlanTerm(initialTerm, mode);
  const showTerm = mode === 'create';
  const valid = name.trim() !== '' && ok;
  const title = mode === 'create' ? 'Create plan' : 'Rename plan';
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(panelRef, onClose);

  return createPortal(
    <motion.div
      ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
      initial={{ opacity:0, y:24 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:24 }} transition={{ duration:0.28, ease:EASE }}
      style={{ position:'fixed', inset:0, zIndex:2100, background:'#FFF', display:'flex', flexDirection:'column', outline:'none' }}
    >
      <form onSubmit={e => { e.preventDefault(); if (valid) onSubmit(name.trim(), term); }}
        style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        {/* Title, field and Create button all sit at the very top, so the software keyboard can never cover them. */}
        <div style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', minHeight:52, padding:'4px 4px 4px 0', borderBottom:'1px solid #E0E0E0' }}>
          <button type="button" onClick={onClose} style={{ minHeight:44, minWidth:44, padding:'0 12px', background:'none', border:0, color:'#000', fontSize:16, fontFamily:'var(--font-sans)', cursor:'pointer' }}>Cancel</button>
          <h1 style={{ margin:0, fontSize:17, fontWeight:600, color:'#000' }}>{title}</h1>
          <button type="submit" disabled={!valid} style={{ minHeight:44, minWidth:44, padding:'0 12px', background:'none', border:0, color:valid?'#000':'#999', fontSize:16, fontWeight:600, fontFamily:'var(--font-sans)', cursor:valid?'pointer':'default' }}>
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'20px 20px calc(24px + env(safe-area-inset-bottom, 0px))', display:'flex', flexDirection:'column', gap:20 }}>
          <div>
            <label htmlFor="plan-name" style={fieldLabel}>Plan name</label>
            <input id="plan-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring 2027" style={fieldBox}
              type="text" autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck enterKeyHint="done" />
          </div>
          {showTerm && (
            <fieldset style={{ margin:0, padding:0, border:0 }}>
              <legend style={{ ...fieldLabel, padding:0 }}>Semester</legend>
              <div style={{ display:'flex', gap:12 }}>
                <select aria-label="Season" required value={season} onChange={e => setSeason(e.target.value)} style={{ ...fieldBox, flex:1 }}>
                  {season === '' && <option value="" disabled>Choose a season</option>}
                  {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select aria-label="Year" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...fieldBox, width:120 }}>
                  {PLAN_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </fieldset>
          )}
        </div>
      </form>
    </motion.div>,
    document.body
  );
}

// ─── Create a plan / rename it / change its semester ─────────────────────────
function PlanFormDialog({ mode, initialName = '', initialTerm = '', onSubmit, onClose }: {
  mode: 'create' | 'rename' | 'semester'; initialName?: string; initialTerm?: string;
  onSubmit: (name: string, term: string) => void; onClose: () => void;
}) {
  const isMobile = useWindowWidth() < 640;
  const [name, setName] = useState(initialName);
  const { season, setSeason, year, setYear, term, ok } = usePlanTerm(initialTerm, mode);
  const showName = mode !== 'semester';
  const showTerm = mode !== 'rename';
  const valid = (!showName || name.trim() !== '') && ok;
  const title = mode === 'create' ? 'Create plan' : mode === 'rename' ? 'Rename plan' : 'Change semester';

  if (isMobile && (mode === 'create' || mode === 'rename')) {
    return <MobilePlanFormPage mode={mode} initialName={initialName} initialTerm={initialTerm} onSubmit={onSubmit} onClose={onClose} />;
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (valid) onSubmit(name.trim(), term); }} style={{ display:'flex', flexDirection:'column', gap:20 }}>
        {showName && (
          <div>
            <label htmlFor="plan-name" style={fieldLabel}>Plan name</label>
            <input id="plan-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring 2027" style={fieldBox}
              type="text" autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck enterKeyHint="done" />
          </div>
        )}
        {showTerm && (
          <fieldset style={{ margin:0, padding:0, border:0 }}>
            <legend style={{ ...fieldLabel, padding:0 }}>Semester</legend>
            <div style={{ display:'flex', gap:12 }}>
              <select aria-label="Season" required value={season} onChange={e => setSeason(e.target.value)} style={{ ...fieldBox, flex:1 }}>
                {season === '' && <option value="" disabled>Choose a season</option>}
                {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label="Year" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...fieldBox, width:120 }}>
                {PLAN_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </fieldset>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, flexWrap:'wrap' }}>
          <button type="button" onClick={onClose} style={btnLight}>Cancel</button>
          <button type="submit" disabled={!valid} style={{ ...btnDark, ...(valid ? {} : btnOff) }}>{mode === 'create' ? 'Create' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p style={{ margin:'0 0 24px', fontSize:16, lineHeight:1.5, color:'#000' }}>{message}</p>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, flexWrap:'wrap' }}>
        <button onClick={onClose} style={btnLight}>Cancel</button>
        <button autoFocus onClick={onConfirm} style={btnDark}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}

// ─── Rows in lists and pickers ────────────────────────────────────────────────
const listRow = { display:'flex', alignItems:'center', gap:12, width:'100%', minHeight:60, padding:'8px 0', background:'none', border:0, borderBottom:'1px solid #E0E0E0', textAlign:'left', cursor:'pointer', fontFamily:'var(--font-sans)', fontSize:16, color:'#000' } as const;

// ─── Menu for a saved class: which plans it is in, add to a plan, remove ─────
function AnchoredPopover({ rect, ariaLabel, width = 340, onClose, children }: { rect: DOMRect | null; ariaLabel: string; width?: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top:0, left:0, ready:false });
  const openerRef = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = rect ? rect.bottom + 8 : (window.innerHeight - h) / 2;
    if (rect && top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    const left = Math.max(8, Math.min(rect ? rect.right - w : (window.innerWidth - w) / 2, window.innerWidth - w - 8));
    setPos({ top, left, ready:true });
  }, [rect]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.save-toast')) closeRef.current(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      const panel = ref.current;
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')].filter(el => el.offsetParent !== null); // keep Tab inside while open
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (!panel.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    const startY = window.scrollY;
    const onScroll = () => { if (Math.abs(window.scrollY - startY) > 8) closeRef.current(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive:true });
    const opener = openerRef.current;
    ref.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-label={ariaLabel}
      style={{ position:'fixed', top:pos.top, left:pos.left, zIndex:2100, width, maxWidth:'calc(100vw - 16px)', boxSizing:'border-box', background:'#FFF', border:'1px solid #E0E0E0', borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,0.16)', padding:16, opacity:pos.ready ? 1 : 0, outline:'none' }}>
      {children}
    </div>,
    document.body
  );
}

// ─── The one Add to plan dialog: a circle checkbox per plan, changes apply at once ───
function AddToPlanDialog({ course, plans, onToggle, onCreate, onClose }: {
  course: Course; plans: Plan[]; onToggle: (planId: string) => void; onCreate: () => void; onClose: () => void;
}) {
  const row = { ...listRow, minHeight: 60, padding: '8px 4px' } as const;
  return (
    <Dialog title="Add to plan" onClose={onClose}>
      <div style={{ margin: '0 0 12px', minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{course.title}</div>
        <div style={{ fontSize: 16, lineHeight: 1.4, color: '#444' }}>{course.code}</div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid #E0E0E0' }}>
        {plans.map(plan => {
          const inPlan = plan.items.some(i => i.id === course.id);
          const n = plan.items.length;
          const sub = `${planTermText(plan) || 'No semester'} · ${n} ${n === 1 ? 'class' : 'classes'}`;
          // a class already in a plan can always be taken out; one that doesn't fit the plan's term can't be put in
          const fit = planTermFit(course, plan.term);
          const blocked = !inPlan && !fit.ok;
          const reasonId = `plan-reason-${plan.id}`;
          return (
            <li key={plan.id}>
              <button type="button" role="checkbox" aria-checked={inPlan} aria-disabled={blocked || undefined} aria-describedby={blocked ? reasonId : undefined} aria-label={`${plan.name}, ${sub}`}
                onClick={() => { if (!blocked) onToggle(plan.id); }} style={{ ...row, cursor: blocked ? 'not-allowed' : 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 700, lineHeight: 1.4, overflowWrap: 'anywhere', opacity: blocked ? 0.5 : 1 }}>{plan.name}</span>
                  <span style={{ fontSize: 16, lineHeight: 1.4, color: '#444', opacity: blocked ? 0.7 : 1 }}>{sub}</span>
                  {blocked && <span id={reasonId} style={{ fontSize: 15, lineHeight: 1.35, color: '#444', marginTop: 2 }}>{fit.reason}</span>}
                </span>
                <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', border: blocked ? '2px dashed #9A9A9A' : '2px solid #000', background: inPlan ? '#000' : blocked ? '#F0F0F0' : '#FFF', color: '#FFF', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{inPlan && <CheckIcon />}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onCreate} style={{ ...row, fontWeight: 600, borderBottom: 0 }}>
            <span aria-hidden="true" style={{ width: 24, display: 'grid', placeItems: 'center' }}><MobileNavIcon type="plus" /></span>
            Create plan
          </button>
        </li>
      </ul>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onClose} style={btnDark}>Done</button>
      </div>
    </Dialog>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────
function DotsIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>;
}


// The "..." menu on a plan: a dropdown on desktop, a bottom sheet on mobile.
function PlanMenu({ planName, onRename, onChangeSemester, onDelete, items: custom, label, up = false, tip, triggerStyle }: { planName: string; onRename?: () => void; onChangeSemester?: () => void; onDelete?: () => void; items?: [string, () => void, boolean][]; label?: string; up?: boolean; tip?: string; triggerStyle?: React.CSSProperties }) {
  const isMobile = useWindowWidth() < 640;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || isMobile) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [open, isMobile]);
  const items: [string, () => void, boolean][] = custom ?? [['Rename', onRename!, false], ['Change semester', onChangeSemester!, false], ['Delete', onDelete!, true]];
  const itemStyle = { display:'flex', alignItems:'center', width:'100%', minHeight:44, textAlign:'left', padding:'8px 16px', background:'none', border:'none', cursor:'pointer', fontSize:16, fontFamily:'var(--font-sans)', color:'#000' } as const;
  return (
    <div ref={ref} style={{ position:'relative', zIndex:1, flexShrink:0 }}
      onBlur={e => { if (open && !isMobile && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={triggerRef} aria-label={label ?? `Options for ${planName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={tip ? 'icon-tip icon-tip-end' : undefined} data-tip={tip}
        style={{ width:44, height:44, border:0, borderRadius:'50%', background:open ? '#EEE' : 'transparent', color:'#000', cursor:'pointer', display:'grid', placeItems:'center', position:'relative', ...triggerStyle }}>
        <DotsIcon />
      </button>
      {open && !isMobile && (
        <div role="menu" style={{ position:'absolute', ...(up ? { bottom:'calc(100% + 4px)' } : { top:'calc(100% + 4px)' }), right:0, background:'#FFF', border:'1px solid #E0E0E0', borderRadius:8, padding:'6px 0', zIndex:300, boxShadow:'0 4px 16px rgba(0,0,0,0.08)', minWidth:180 }}>
          {items.map(([label, run, danger]) => (
            <button key={label} role="menuitem" onClick={() => { setOpen(false); run(); }} style={{ ...itemStyle, color:danger ? '#B3261E' : '#000' }}>{label}</button>
          ))}
        </div>
      )}
      <AnimatePresence>
        {open && isMobile && (
          <Dialog title={planName} onClose={() => setOpen(false)}>
            {items.map(([label, run, danger]) => (
              <button key={label} onClick={() => { setOpen(false); run(); }} style={{ ...listRow, minHeight:56, color:danger ? '#B3261E' : '#000' }}>{label}</button>
            ))}
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Bookmark buttons (the App decides what a tap does) ──────────────────────
function BookmarkButton({ saved, title, onPress }: { saved: boolean; title: string; onPress: (el: HTMLElement) => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onPress(e.currentTarget); }} aria-pressed={saved}
      aria-label={saved ? `${title}: saved. Remove from saved` : `Save ${title}`}
      style={{ minWidth:44, minHeight:44, padding:0, border:0, background:'none', color:'#000', cursor:'pointer', display:'grid', placeItems:'center' }}>
      <BookmarkIcon filled={saved} />
    </button>
  );
}

function SaveButton({ isSaved, onPress }: { isSaved: boolean; onPress: (el: HTMLElement) => void }) {
  return (
    <button onClick={e => onPress(e.currentTarget)} aria-pressed={isSaved}
      style={{ padding:'9px 22px', minHeight:44, borderRadius:100, background:isSaved ? '#FFF' : '#000', color:isSaved ? '#000' : '#FFF', border:'1px solid #000', cursor:'pointer', fontSize:16, fontFamily:'var(--font-sans)', fontWeight:500, display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap' }}>
      <BookmarkIcon filled={isSaved} />
      {isSaved ? <>Saved <span aria-hidden="true">✓</span></> : 'Save'}
    </button>
  );
}

// ─── Profile dropdown ─────────────────────────────────────────────────────────
function ProfileDropdown({ onClose }: { onClose: ()=>void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div ref={ref} className="dropdown-enter" style={{ position:'absolute', top:'calc(100% + 10px)', right:0, width:240, background:'#FFF', border:'1px solid #E0E0E0', borderRadius:10, padding:'18px 20px 14px', zIndex:200, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize:16, fontWeight:600, letterSpacing:'-0.01em', marginBottom:2 }}>Natty Elias</div>
      <div style={{ fontSize:16, color:'#444', lineHeight:1.5, marginBottom:2 }}>MS Creative Technology & Design</div>
      <div style={{ fontSize:16, color:'#444' }}>ATLAS Institute, CU Boulder</div>
      <div style={{ height:1, background:'#E0E0E0', margin:'14px 0 12px' }} />
      <button style={{ background:'none', border:'none', padding:0, fontSize:16, color:'#000', cursor:'pointer', fontFamily:'var(--font-sans)', letterSpacing:'0.01em', textDecoration:'underline', textUnderlineOffset:3 }} onClick={onClose}>Log out</button>
    </div>
  );
}

function ProfileAvatar({ open, hovered, setHovered, setOpen }: { open:boolean; hovered:boolean; setHovered:(v:boolean)=>void; setOpen:(fn:(v:boolean)=>boolean)=>void }) {
  return (
    <div style={{ position:'relative' }}>
      <button onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onClick={()=>setOpen(o=>!o)}
        style={{ width:40, height:40, borderRadius:'50%', background:'#EDEDED', border:'none', cursor:'pointer', transform:hovered?'scale(1.08)':'scale(1)', transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)', display:'flex', alignItems:'center', justifyContent:'center' }} aria-label="Profile">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round"/></svg>
      </button>
      {open && <ProfileDropdown onClose={()=>setOpen(()=>false)} />}
    </div>
  );
}

// ─── Bookmark button with popover trigger ─────────────────────────────────────
const COURSES_BY_ID = new Map(COURSES.map(c => [c.id, c]));

// What the plan screens can do. The App owns the data and the dialogs.
interface PlanActions {
  create: () => void;
  setRole: (planId: string, courseId: string, role: PlanRole) => void;
  removeFromPlan: (planId: string, courseId: string) => void;
  rename: (plan: Plan) => void;
  changeSemester: (plan: Plan) => void;
  remove: (plan: Plan) => void;
  share: (plan: Plan) => void;
}

// ─── Course card ──────────────────────────────────────────────────────────────
// A card shows four things in order: the area icon, the title (2 lines at most), "ATLS 3040 · 3 credits" and the
// season icons. Requirement tags live on the class page, Plans and exports. The title link stretches over the whole card (.card-link::after), so the
// card is one tap target; only the bookmark sits above it. Photos live on the class page.
// Credits only when they are not the usual 3: "ATLS 3150", "ATLS 4339 · 1 credit", "ATLS 4519 · Special topic".
const cardMeta = (c: Course, code: string) => [code, c.specialTopic ? 'Special topic' : '', c.credits.trim() ? creditsLabel(c.credits) : ''].filter(Boolean).join(' · ');

// Availability as plain text with a small status dot: filled when it runs, half when it ran before, a ring when it doesn't.
function AvailabilityLine({ course }: { course: Course }) {
  const a = availabilityOf(course);
  const dot: React.CSSProperties = a.kind === 'none'
    ? { border: '2px solid #5A5A5A', background: 'transparent' }
    : { border: '2px solid #1A1A1A', background: '#1A1A1A' };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 16, lineHeight: 1.35, color: a.kind === 'none' ? '#444' : '#1A1A1A', fontWeight: a.kind === 'next' ? 600 : 400 }}>
      <span aria-hidden="true" style={{ ...dot, width: 10, height: 10, minWidth: 10, borderRadius: '50%', boxSizing: 'border-box', marginTop: 5 }} />
      <span style={{ overflowWrap: 'anywhere' }}>{a.short}</span>
    </div>
  );
}

// How far to trust a class's times: the line from verificationLabel (src/core/verification.ts), with a small status mark.
// Confirmed is a filled dot, differs is the amber exclamation mark, pending is a half dot, not checked is a ring.
function TrustLine({ course, align = 'center' }: { course: Course; align?: 'center' | 'start' }) {
  const t = verificationFor(course.id, VERIFICATION_CTX);
  const mark = t.status === 'confirmed' ? <span style={{ width: 10, height: 10, minWidth: 10, borderRadius: '50%', boxSizing: 'border-box', border: '2px solid #1A1A1A', background: '#1A1A1A' }} />
    : t.status === 'mismatch' ? <TagMarker shape="exclaim" color="#8A6A00" size={12} />
    : t.status === 'pending' ? <span style={{ width: 10, height: 10, minWidth: 10, borderRadius: '50%', boxSizing: 'border-box', border: '2px solid #5A5A5A', background: 'linear-gradient(90deg, #5A5A5A 50%, transparent 50%)' }} />
    : <span style={{ width: 10, height: 10, minWidth: 10, borderRadius: '50%', boxSizing: 'border-box', border: '2px solid #5A5A5A', background: 'transparent' }} />;
  return (
    <div data-trust={t.status} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: 6, fontSize: 13, lineHeight: 1.35, color: t.status === 'mismatch' ? '#4A3900' : '#444', fontWeight: t.status === 'mismatch' ? 600 : 400, textAlign: align === 'center' ? 'center' : 'left' }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 3, flexShrink: 0 }}>{mark}</span>
      <span style={{ overflowWrap: 'anywhere' }}>{verificationLabel(t.status, t.checkedAt)}</span>
    </div>
  );
}

// Season markers: ONE component, and its text is exactly "Spring" or "Fall" wherever it appears (cards, class page, filters).
// Filled = offered in an upcoming term. Outlined = it ran in that season before. A class that has never run gets the plain
// "Not offered recently" text from the core availability logic instead.
function SeasonGlyph({ kind, size = 28, filled = false }: { kind: SeasonName; size?: number; filled?: boolean }) {
  const color = SEASON_COLOR[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === 'fall' && <><path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" fill={filled ? color : 'none'} /><path d="M5 19l8-8" stroke={filled ? '#FFF' : color} /></>}
      {kind === 'spring' && <>{[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx="12" cy="6.3" rx="2.7" ry="3.6" transform={`rotate(${a} 12 12)`} fill={filled ? color : 'none'} />)}<circle cx="12" cy="12" r="1.4" fill={filled ? '#FFF' : 'none'} stroke={filled ? '#FFF' : color} /></>}
    </svg>
  );
}
function SeasonMarker({ season, upcoming, size = 22 }: { season: SeasonName; upcoming: boolean; size?: number }) {
  const word = SEASON_WORD[season];
  const meaning = upcoming ? 'offered in an upcoming term' : 'ran in this season before';
  return (
    <span role="img" aria-label={`${word}, ${meaning}`} title={`${word}: ${meaning}`} data-season={season} data-state={upcoming ? 'filled' : 'outlined'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 28, padding: '0 6px', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.1, whiteSpace: 'nowrap', color: '#333', fontWeight: upcoming ? 700 : 400 }}>
      <SeasonGlyph kind={season} size={size} filled={upcoming} />
      <span aria-hidden="true">{word}</span>
    </span>
  );
}
const SEASON_ORDER: SeasonName[] = ['fall', 'spring'];
// The seasons a class has run in (any term, so history counts), and whether each is offered in an upcoming term.
const seasonMarksFor = (c: Course): { season: SeasonName; upcoming: boolean }[] => SEASON_ORDER.flatMap(season => {
  const terms = c.termsOffered.filter(t => seasonOf(t) === season);
  return terms.length ? [{ season, upcoming: terms.some(t => isUpcoming(t, TERM_CONTEXT)) }] : [];
});
const seasonsOfClass = (c: Course): SeasonName[] => seasonMarksFor(c).map(m => m.season);
function SeasonMarks({ course }: { course: Course }) {
  const marks = seasonMarksFor(course);
  if (!marks.length) return <span style={{ padding: '0 6px', fontSize: 13, lineHeight: 1.3, color: '#444' }}>{availabilityOf(course).short}</span>;
  return <>{marks.map(m => <SeasonMarker key={m.season} {...m} />)}</>;
}
// The one rule for whether a class may go in a plan: a Spring plan takes classes that have run in a Spring term, a Fall plan those
// that have run in a Fall term (past terms count as history). A class that has never run fits neither. A plan with no term,
// or an old Summer term, takes anything, and so does everything when semester.enforcePlanTerms is off.
function planTermFit(course: Course, planTerm: string): { ok: boolean; reason: string; seasons: string[] } {
  const seasons = seasonsOfClass(course) as string[];
  const planSeason = seasonOf(planTerm);
  if (!semester.enforcePlanTerms || (planSeason !== 'spring' && planSeason !== 'fall') || seasons.includes(planSeason)) return { ok: true, reason: '', seasons };
  if (seasons.length === 0) return { ok: false, reason: 'Not offered recently. Ask an advisor.', seasons };
  return { ok: false, reason: `Runs in ${seasons.join(' and ')}. This plan is ${planTerm}.`, seasons };
}
// For the plan view: a short label for a class already in a plan that doesn't usually run in the plan's season.
const planMismatchLabel = (course: Course, planTerm: string) => {
  const fit = planTermFit(course, planTerm);
  return fit.ok ? '' : fit.seasons.length ? `Doesn't usually run in ${planTerm.split(' ')[0]}` : 'Not offered recently';
};
// The term to suggest for a new plan made from a class: its own season, else the next upcoming term.
function suggestedTermFor(course: Course) {
  const seasons = [...new Set(seasonsOfClass(course))];
  const [nextSeason, nextYear] = semester.nextTermName.split(' ');
  if (seasons.length !== 1) return semester.nextTermName;
  const want = seasons[0] === 'fall' ? 'Fall' : 'Spring';
  if (want === nextSeason) return semester.nextTermName;
  return want === 'Fall' ? `Fall ${nextYear}` : `Spring ${Number(nextYear) + 1}`;
}

// The area filter: a row of round icon buttons that scrolls sideways and never wraps. Each circle is the same AreaBadge
// the cards use, so a filter icon and its card icon are identical. `bleed` lets the row run to the screen edge on phones.
const AREA_SHORT: Record<string, string> = {
  'AI / Emerging Tech': 'AI', 'Fabrication & Making': 'Making', 'Game Design': 'Games', 'AR / VR': 'AR/VR', '3D / Animation': '3D',
  'Sound & Music / Visual Systems': 'Sound', 'UX / Product Design': 'UX', 'Branding & Strategy': 'Brand', 'Accessibility': 'Access',
};
const ALL_ICON = <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>;

function AreaChipRow({ categories, onToggle, onClear, bleed = 0, compact = false }: { categories: Set<string>; onToggle: (tag: string) => void; onClear: () => void; bleed?: number; compact?: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [tip, setTip] = useState<{ name: string; rect: DOMRect } | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const updateEdges = () => {
    const el = rowRef.current; if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, []);
  const reduceMotion = useReducedMotion();
  const eased = motionMode === 'full' && !reduceMotion;
  const picked = Object.keys(CATEGORY_COLORS).filter(n => categories.has(n));
  const fade = `linear-gradient(to right, #000, ${edges.right ? '#000 calc(100% - 40px), transparent' : '#000 100%, #000'})`;

  const item = (tag: string) => {
    const all = tag === 'All';
    const on = all ? categories.size === 0 : categories.has(tag);
    const full = all ? 'All areas' : tag;
    const hue = all ? '#767676' : CATEGORY_COLORS[tag];
    return (
      <button key={tag} type="button" className="area-btn" aria-label={`${full}, ${on ? 'selected' : 'not selected'}`}
        onClick={() => { if (press.current.fired) { press.current.fired = false; return; } onToggle(tag); }}
        onMouseEnter={e => setTip({ name: full, rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setTip(null)}
        onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setTip({ name: full, rect: e.currentTarget.getBoundingClientRect() }); }} onBlur={() => setTip(null)}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          if (e.pointerType !== 'touch') return;
          const el = e.currentTarget;
          press.current.fired = false;
          press.current.timer = setTimeout(() => { press.current.fired = true; setTip({ name: full, rect: el.getBoundingClientRect() }); setTimeout(() => setTip(null), 1800); }, 450);
        }}
        onPointerUp={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onPointerCancel={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        style={{ flexShrink: 0, minWidth: compact ? 44 : 68, minHeight: 44, padding: compact ? '4px' : '8px 4px 4px', justifyContent: 'center', border: 0, background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'var(--font-sans)', color: '#000' }}>
        <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', boxShadow: on ? (compact ? `0 0 0 2px #FFF, 0 0 0 4px ${hue}` : `0 0 0 3px #FFF, 0 0 0 6px ${hue}`) : 'none', transition: eased ? 'box-shadow 0.3s ease' : undefined }}>
          <AreaBadge category={all ? '' : tag} size={compact ? 36 : 56} icon={all ? ALL_ICON : undefined} eased={eased} />
          {on && (
            <span aria-hidden="true" style={{ position: 'absolute', right: compact ? -4 : -6, bottom: compact ? -4 : -6, width: compact ? 18 : 24, height: compact ? 18 : 24, borderRadius: '50%', background: '#1A1A1A', border: '2px solid #FFF', display: 'grid', placeItems: 'center', color: '#FFF' }}>
              <svg width={compact ? 9 : 12} height={compact ? 9 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" focusable="false"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
          )}
        </span>
        {semester.showAreaLabels && !compact && <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1.2, fontWeight: on ? 700 : 400, whiteSpace: 'nowrap', color: on ? '#000' : '#444' }}>{all ? 'All' : AREA_SHORT[tag]}</span>}
      </button>
    );
  };

  return (
    <div style={{ margin: compact ? 0 : '0 0 4px' }}>
      <div ref={rowRef} onScroll={updateEdges} role="group" aria-label="Focus areas" className="area-row"
        style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, overflowX: 'auto', padding: compact ? `6px ${4 + bleed}px 6px 0` : `10px ${4 + bleed}px 2px 0`, margin: `0 -${4 + bleed}px`, scrollbarWidth: bleed ? 'none' : 'thin', WebkitMaskImage: fade, maskImage: fade }}>
        <div style={{ position: 'sticky', left: 0, zIndex: 2, flexShrink: 0, display: 'flex', background: '#FFF', padding: `0 10px 0 ${4 + bleed}px`, boxShadow: edges.left ? '6px 0 6px -4px rgba(0,0,0,0.14)' : 'none' }}>{item('All')}</div>
        {Object.keys(CATEGORY_COLORS).map(item)}
      </div>
      {/* One reserved (24px) line for the Showing text and the Clear button, so nothing below it moves when they come and go. */}
      {/* When compact the line is not drawn but stays for screen readers, so the status and Clear are still there. */}
      <div className={compact ? 'sr-only' : undefined} style={compact ? undefined : { height: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14, lineHeight: '20px' }}>
        {picked.length > 0 ? <p role="status" style={{ margin: 0, color: '#444', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Showing: {picked.map(n => AREA_SHORT[n]).join(', ')}</p> : <span aria-hidden="true">&nbsp;</span>}
        {picked.length > 0 && !compact && (
          <button type="button" onClick={onClear} aria-label="Clear area filters, show all areas"
            style={{ flexShrink: 0, minHeight: 44, margin: '-10px 0', padding: '0 8px', border: 0, background: 'none', color: UI.ink, fontSize: 14, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3, fontFamily: 'var(--font-sans)', cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>
      {tip && createPortal(
        <div aria-hidden="true" style={{ position: 'fixed', zIndex: 3000, left: Math.min(Math.max(tip.rect.left + tip.rect.width / 2, 70), window.innerWidth - 70), top: tip.rect.top - 6, transform: 'translate(-50%, -100%)', background: '#1A1A1A', color: '#FFF', fontSize: 14, lineHeight: 1.3, padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{tip.name}</div>,
        document.body)}
    </div>
  );
}

// An image that fades in over 200ms once it has loaded, on a soft gray block until then (no fade with reduced motion).
function FadeImg({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) {
  const [loaded, setLoaded] = useState(false);
  const reduce = useReducedMotion();
  return <img src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', opacity: loaded ? 1 : 0, transition: reduce ? 'none' : 'opacity 200ms ease-out', ...style }} />;
}

// The illustrated cover for a class: an original SVG made in code from the course code and topic (see lib/cover.ts), in
// the primary area's color, with the area's flat icon drawn large in white. A class with no area gets a gray cover with
// the generic icon. It fills its box (slice), so the same cover works as a 4:3 tile image, a wide banner or a thumbnail.
// `decorative` hides it from screen readers (use it when the title sits right beside it); otherwise it is an image named
// "Illustrated cover for <title>".
function Cover({ course, decorative = true, style }: { course: Course; decorative?: boolean; style?: React.CSSProperties }) {
  const hue = CATEGORY_COLORS[course.category] ?? '#767676';
  const spec = useMemo(() => buildCover(`${course.code}|${course.id}`, hue), [course.code, course.id, hue]);
  const gid = useId();
  const rad = (spec.angle * Math.PI) / 180;
  const x2 = 0.5 + Math.cos(rad) * 0.5, y2 = 0.5 + Math.sin(rad) * 0.5;
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': `Illustrated cover for ${course.title}` };
  return (
    <svg viewBox={`0 0 ${COVER_W} ${COVER_H}`} preserveAspectRatio="xMidYMid slice" width="100%" height="100%" focusable="false" style={{ display: 'block', ...style }} {...a11y}>
      <defs>
        <linearGradient id={`cv${gid}`} x1={1 - x2} y1={1 - y2} x2={x2} y2={y2}>
          <stop offset="0" stopColor={spec.deep} /><stop offset="1" stopColor={spec.light} />
        </linearGradient>
      </defs>
      <rect width={COVER_W} height={COVER_H} fill={`url(#cv${gid})`} />
      <g transform={`translate(${spec.flipX ? COVER_W : 0} ${spec.flipY ? COVER_H : 0}) scale(${spec.flipX ? -1 : 1} ${spec.flipY ? -1 : 1}) translate(${COVER_W / 2} ${COVER_H / 2}) scale(${spec.zoom}) translate(${-COVER_W / 2} ${-COVER_H / 2})`}>
        {spec.shapes.map((sh, i) => {
          if (sh.kind === 'circle') return <circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} fill={sh.fill} opacity={sh.opacity} />;
          if (sh.kind === 'rrect') return <rect key={i} x={sh.cx - sh.w / 2} y={sh.cy - sh.h / 2} width={sh.w} height={sh.h} rx={sh.rx} fill={sh.fill} opacity={sh.opacity} transform={`rotate(${sh.rot} ${sh.cx} ${sh.cy})`} />;
          if (sh.kind === 'ring') return <circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} fill="none" stroke={sh.stroke} strokeWidth={sh.sw} opacity={sh.opacity} />;
          if (sh.kind === 'wave') return <path key={i} d={sh.d} fill={sh.fill} opacity={sh.opacity} />;
          return <g key={i} fill={sh.fill} opacity={sh.opacity}>{sh.dots.map((d, j) => <circle key={j} cx={d.x} cy={d.y} r={sh.r} />)}</g>;
        })}
      </g>
      <g data-cover-icon transform={`translate(${COVER_W / 2 - 55} ${COVER_H / 2 - 55}) scale(4.58)`} fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {(CATEGORY_COLORS[course.category] && AREA_ICONS[course.category]) || GENERIC_ICON}
      </g>
    </svg>
  );
}

// Small badges for a class's extra areas at the bottom-left of its cover (the cover itself is the primary area).
function CoverBadges({ course }: { course: Course }) {
  const extra = areasOf(course).slice(1);
  if (!extra.length) return null;
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', pointerEvents: 'none' }}>
      {extra.map((a, i) => (
        <span key={a} style={{ marginLeft: i ? -10 : 0, borderRadius: '50%', boxShadow: '0 0 0 2px #FFF', position: 'relative', zIndex: extra.length - i, display: 'inline-flex' }}>
          <AreaBadge category={a} size={36} />
        </span>
      ))}
    </div>
  );
}

// A class's focus areas, primary first: up to three.
const areasOf = (c: Course) => [c.category, c.categorySecondary].filter(Boolean).slice(0, 3);

// Small round area badges on the photo's bottom-left corner, overlapped slightly. The primary area is on top.
function PhotoBadges({ course }: { course: Course }) {
  const areas = areasOf(course);
  const list = areas.length ? areas : [''];
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', pointerEvents: 'none' }}>
      {list.map((a, i) => (
        <span key={a || 'none'} style={{ marginLeft: i ? -10 : 0, borderRadius: '50%', boxShadow: '0 0 0 2px #FFF', position: 'relative', zIndex: list.length - i, display: 'inline-flex' }}>
          <AreaBadge category={a} size={36} />
        </span>
      ))}
    </div>
  );
}

// ─── Class tile ───────────────────────────────────────────────────────────────
// Browse, Saved and the phone search all show classes as these channel-style tiles, from this one component. Centered:
// the area icon circle (or, with a photo, the 4:3 photo with small area badges), the title (2 lines, 3 at 320px), the
// course code, then one row with the season icons (with their words) and the bookmark. The title link stretches over the whole tile (.card-link::after), so the tile is one tap target; the season
// icons and the bookmark sit above it. Hover, focus and press feel (scale, blue ring, glow) lives in .tile in index.css.
function ClassTile({ course, saved, onBookmark, index, onSelect }: {
  course: Course; saved: boolean; onBookmark: (el: HTMLElement) => void; index: number; onSelect?: (course: Course) => void;
}) {
  const phone = useWindowWidth() < 640;
  const hasPhoto = !!course.photo;
  const code = useDisplayCode()(course);
  const first = firstUpcomingSection(course, TERM_CONTEXT);
  const instructor = showInstructors(course) ? upcomingInstructors(course, TERM_CONTEXT) : '';
  const detail: React.CSSProperties = { fontSize: 14, lineHeight: 1.3, color: '#444', overflowWrap: 'anywhere' };
  return (
    <motion.div layout={motionMode === 'full'} style={{ minWidth: 0 }}
      initial={motionMode === 'full' ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0, transition: { duration: motionMode === 'full' ? 0.35 : 0, ease: EASE, delay: Math.min(index, 12) * 0.025 } }} exit={motionMode === 'full' ? { opacity: 0, transition: { duration: 0.2 } } : undefined}>
      <article className="tile" data-zoom-card data-course={course.id} style={{ ['--card-hue' as string]: accentFor(course.category), ['--card-radius' as string]: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: phone ? 6 : 8, padding: 0 }}>
        {hasPhoto ? (
          <div data-zoom-source style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#E4E4E8', borderRadius: '23px 23px 0 0', overflow: 'hidden', flexShrink: 0 }}>
            <FadeImg src={photoUrl(course.photo)} alt={course.photoAlt} />
            <PhotoBadges course={course} />
          </div>
        ) : (
          <div data-zoom-source style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', borderRadius: '23px 23px 0 0', overflow: 'hidden', flexShrink: 0 }}>
            <Cover course={course} />
            <CoverBadges course={course} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: phone ? 6 : 8, width: '100%', minWidth: 0, padding: phone ? '6px 10px 6px' : '10px 14px 10px' }}>
          <h2 className="tile-title" style={{ margin: 0, fontSize: phone ? 16 : 18, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em', color: '#000', maxWidth: '100%' }}>
            <AppLink to={classHref(course)} className="card-link" onClick={onSelect ? e => { e.preventDefault(); onSelect(course); } : undefined}>{course.title}</AppLink>
          </h2>
          <div style={{ fontSize: 14, lineHeight: 1.3, color: '#444', overflowWrap: 'anywhere' }}>{cardMeta(course, code)}</div>
          {first && <div style={detail}>{sectionLine(first)}</div>}
          {first?.room && <div style={detail}>{first.room}</div>}
          {instructor && <div style={detail}>{instructor}</div>}
          <TrustLine course={course} />
          <div className="tile-ctl" role="group" aria-label={`${course.title}: when it has run, and save`} style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
            <SeasonMarks course={course} />
            <BookmarkButton saved={saved} title={course.title} onPress={onBookmark} />
          </div>
          {semester.showRunningNow && <AvailabilityLine course={course} />}
        </div>
      </article>
    </motion.div>
  );
}

// An empty state that lives inside the tile grid and spans every column, so the page keeps the same shape with or without results.
function TileEmpty({ message, hint, children }: { message: string; hint: string; children: React.ReactNode }) {
  return (
    <div role="status" style={{ gridColumn: '1 / -1', padding: '32px 16px', border: '1px dashed #C8C8C8', borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.3, color: '#000', overflowWrap: 'anywhere' }}>{message}</p>
      <p style={{ margin: '0 0 12px', fontSize: 16, lineHeight: 1.5, color: '#444', maxWidth: '46ch' }}>{hint}</p>
      {children}
    </div>
  );
}

// The tile grid: 2 columns on phones (14px gaps), 3 from 640px, 4 from 1024px, 5 from 1600px. Rows stretch to equal height.
function TileGrid({ children }: { children: React.ReactNode }) {
  const vw = useWindowWidth();
  const cols = vw < 640 ? 2 : vw < 1024 ? 3 : vw < 1600 ? 4 : 5;
  const gap = vw < 640 ? 14 : 20;
  return (
    <motion.div layout={motionMode === 'full'} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, alignItems: 'stretch' }}>
      {children}
    </motion.div>
  );
}

// ─── Inside a plan ────────────────────────────────────────────────────────────
const prerequisitesText = (c: Course) =>
  [requiredPrereq(c), c.prereqRecommended && `Recommended: ${c.prereqRecommended}`]
    .filter(Boolean).join('. ');

function planExport(plan: Plan) {
  const rows = plan.items.flatMap(i => { const course = COURSES_BY_ID.get(i.id); return course ? [{ role: i.role, course }] : []; });
  const toItem = (c: Course): ExportItem => ({ title: c.title, code: c.code, credits: c.credits, prerequisites: prerequisitesText(c), searchUrl: classSearchLink(c), classNumber: c.classNumber, availability: showsAvailability(c) ? availabilityOf(c).full : '', advisorNote: c.notOfferedRecently ? 'Ask your academic advisor whether it will run.' : '' });
  return {
    first: rows.filter(r => r.role === 'first').map(r => toItem(r.course)),
    backup: rows.filter(r => r.role === 'backup').map(r => toItem(r.course)),
  };
}

// A plain count for the top of a plan. Each class lands in one bucket, advisor first: a class that
// isn't scheduled recently, or whose sources disagree, needs the advisor; then running; then not posted.
function planSummary(courses: Course[]) {
  let running = 0, notPosted = 0, advisor = 0;
  for (const c of courses) {
    const kind = availabilityOf(c).kind;
    if (kind === 'none' || countsTag(c) === 'Check with advisor') advisor++;
    else running++; // offered in an upcoming term
  }
  return { running, notPosted, advisor };
}

// The one-line count under a plan or the saved list: how many are not posted and how many need an advisor.
function summaryParts(courses: Course[]) {
  if (courses.length === 0) return [];
  const { running, notPosted, advisor } = planSummary(courses);
  const all = semester.showRunningNow;
  return [
    all && `${running} running now`,
    (all || notPosted > 0) && (nextTermPosted ? `${notPosted} not scheduled for ${semester.nextTermName}` : `${notPosted} not posted yet`),
    (all || advisor > 0) && `${advisor} ${advisor === 1 ? 'needs' : 'need'} an advisor`,
  ].filter(Boolean) as string[];
}
function summaryLine(courses: Course[]) {
  const parts = summaryParts(courses);
  return parts.length ? <div style={{ fontSize:16, lineHeight:1.5, color:'#000', marginTop:4 }}>{parts.join(' · ')}</div> : null;
}

// What needs attention for a class in a plan, as one line. "Usually runs in fall" is left out: the season icons already say it.
const attentionOf = (course: Course, term: string) => planWarnings({
  prereqRequired: course.prereqRequired, prereqRecommended: course.prereqRecommended, consentRequired: course.consentRequired,
  extraCost: course.extraCost, needsAdvisor: countsTag(course) === 'Check with advisor', termsOffered: course.termsOffered,
}, term).filter(w => !w.startsWith('Usually runs in')).join('. ');

// A class in a plan as a channel tile: a glossy cover, the course code as the title, the class name beneath. Tapping it opens the
// class. Two small round buttons sit over the cover's bottom-right corner: search, and a menu (change first choice / backup, remove).
function PlanChannelTile({ course, role, term, onSetRole, onRemove }: { course: Course; role: PlanRole; term: string; onSetRole: (role: PlanRole) => void; onRemove: () => void }) {
  const code = useDisplayCode()(course);
  const needsCheck = attentionOf(course, term) !== '';
  const mismatch = planMismatchLabel(course, term);
  const menu: [string, () => void, boolean][] = [
    [role === 'first' ? 'Move to backups' : 'Make first choice', () => onSetRole(role === 'first' ? 'backup' : 'first'), false],
    ['Remove from plan', onRemove, true],
  ];
  const overlayBtn: React.CSSProperties = { ...iconBtn, border: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.28)' };
  return (
    <li data-course={course.id} style={{ listStyle: 'none', minWidth: 0, height: '100%' }}>
      <article className="channel" data-zoom-card data-course={course.id} style={{ ['--card-radius' as string]: '28px', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ position: 'relative' }}>
          <div className="channel-cover" data-zoom-source>
            <Cover course={course} />
            {needsCheck && (
              <span style={{ position: 'absolute', left: 8, top: 8, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px 2px 6px', borderRadius: 100, background: '#FFF6DC', border: '1px solid #8A6A00', color: '#000', fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                Check
              </span>
            )}
          </div>
          {role === 'backup' && <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, padding: '3px 10px', borderRadius: 100, background: '#FFF', border: '1px solid #000', color: '#000', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>Backup</span>}
          {/* above the tile's whole-card link, so tapping them never opens the class */}
          <div style={{ position: 'absolute', right: 4, bottom: 4, zIndex: 3, display: 'flex', gap: 2 }}>
            <a className="icon-tip icon-tip-end" data-tip="Search in CU class search" href={classSearchLink(course)} target="_blank" rel="noopener noreferrer" aria-label={`Search ${course.code} in CU class search (opens in a new tab)`} style={overlayBtn}><ExternalIcon size={20} /></a>
            <PlanMenu planName={course.title} label={`More for ${course.title}`} tip="More" items={menu} triggerStyle={{ background: '#FFF', boxShadow: '0 2px 8px rgba(0,0,0,0.28)' }} />
          </div>
        </div>
        <div style={{ padding: '10px 14px 14px', textAlign: 'center', minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.2, color: '#000' }}>
            <AppLink to={classHref(course)} className="card-link" aria-label={`${code}, ${course.title}${role === 'backup' ? ', backup' : ''}${needsCheck ? ', needs checking' : ''}${mismatch ? `, ${mismatch}` : ''}`}>{code}</AppLink>
          </h3>
          <div style={{ marginTop: 2, fontSize: 15, lineHeight: 1.3, color: '#444', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{course.title}</div>
          {mismatch && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 4, fontSize: 13, lineHeight: 1.3, color: '#000', fontWeight: 600 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
              <span>{mismatch}</span>
            </div>
          )}
        </div>
      </article>
    </li>
  );
}

// An empty channel slot: a pale dashed square with a plus. It opens the Add classes list.
function EmptyChannelSlot({ onClick }: { onClick: () => void }) {
  return (
    <li style={{ listStyle: 'none', minWidth: 0, height: '100%' }}>
      <button type="button" className="channel-slot" onClick={onClick} aria-label="Add a class"
        style={{ width: '100%', height: '100%', minHeight: 160, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, border: '2px dashed #C2C2CC', borderRadius: 28, background: '#F4F4F7', color: '#444', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
        <span aria-hidden="true">Add a class</span>
      </button>
    </li>
  );
}

function PlanView({ plan, actions, hasSaved }: { plan: Plan; actions: SavedActions; hasSaved: boolean }) {
  const width = useWindowWidth();
  const isMobile = width < 640;
  const rows = plan.items.flatMap(i => { const course = COURSES_BY_ID.get(i.id); return course ? [{ item: i, course }] : []; });
  const first = rows.filter(r => r.item.role === 'first');
  const backup = rows.filter(r => r.item.role === 'backup');
  const [copyNote, setCopyNote] = useState<string>('');
  const cols = isMobile ? 2 : width < 1024 ? 3 : 4;
  const wideTitle = width >= 1024;
  const hasAdvisorCard = rows.some(r => hasException(r.course));
  // empty slots after the last class: enough to finish the row, or two when the row is already full
  const lastRow = (backup.length ? backup.length : first.length) % cols;
  const slots = lastRow === 0 ? 2 : cols - lastRow;
  async function copyNumbers(list: typeof rows) {
    const numbers = list.map(r => r.course.classNumber).filter(Boolean);
    if (!numbers.length) return;
    const ok = await copyText(numbers.join('\n'));
    const missing = list.length - numbers.length;
    setCopyNote(ok
      ? `Copied ${numbers.length} class ${numbers.length === 1 ? 'number' : 'numbers'}, one per line.${missing ? ` ${missing} ${missing === 1 ? 'class has' : 'classes have'} no number yet.` : ''}`
      : "Couldn't copy automatically. The class numbers are listed on each class.");
  }
  const menuItems: [string, () => void, boolean][] = [
    ['Copy as text', async () => { const exp = planExport(plan); const ok = await copyText(planAsText(plan, exp.first, exp.backup, { url: semester.advisorBookingUrl })); setCopyNote(ok ? 'Copied. You can paste it into a message or a note.' : "Couldn't copy automatically. Opening the share window so you can select the text."); if (!ok) actions.share(plan); }, false],
    ['Share or print', () => actions.share(plan), false],
    ...(first.some(r => r.course.classNumber) ? [['Copy first-choice class numbers', () => copyNumbers(first), false] as [string, () => void, boolean]] : []),
    ...(backup.some(r => r.course.classNumber) ? [['Copy backup class numbers', () => copyNumbers(backup), false] as [string, () => void, boolean]] : []),
    ['Rename', () => actions.rename(plan), false],
    ['Change semester', () => actions.changeSemester(plan), false],
    ['Delete', () => actions.remove(plan), true],
  ];
  const tile = ({ item, course }: typeof rows[number]) => (
    <PlanChannelTile key={course.id} course={course} role={item.role} term={plan.term}
      onSetRole={role => actions.setRole(plan.id, course.id, role)} onRemove={() => actions.removeFromPlan(plan.id, course.id)} />
  );
  const addBtn = <button onClick={() => actions.addClasses(plan.id)} style={btnDark}>Add classes</button>;
  return (
    <div>
      <div style={{ marginBottom:12 }}><BackButton label="Saved" ariaLabel="Back to Saved" to="#/saved" restoreSavedScroll /></div>
      {/* Title row: the name (cut with an ellipsis before it can reach the card), its menu, and on wide screens the advisor card at the right. */}
      <div style={{ display:'flex', alignItems:wideTitle ? 'center' : 'flex-start', gap:8 }}>
        <h1 title={plan.name} style={{ margin:0, minWidth:0, flex:wideTitle ? '0 1 auto' : 1, fontSize:isMobile ? 32 : 40, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.15, color:'#000', ...(wideTitle ? { overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } : { overflowWrap:'anywhere' }) }}>{plan.name}</h1>
        <div style={{ flexShrink:0, margin:isMobile ? '-4px -8px 0 0' : '0 0 0 -4px' }}>
          <PlanMenu planName={plan.name} label={`Options for ${plan.name}`} items={menuItems} />
        </div>
        {wideTitle && hasAdvisorCard && <div style={{ marginLeft:'auto', flexShrink:0 }}><AdvisorBanner layout="inline" /></div>}
      </div>
      <div style={{ marginTop:8, fontFamily:'var(--font-sans)', fontSize:17, lineHeight:1.5, color:'#444' }}>
        {[planTermText(plan) || 'No semester', `${plan.items.length} ${plan.items.length === 1 ? 'class' : 'classes'}`, creditsText(first.map(r => r.course.credits)), ...summaryParts(rows.map(r => r.course))].join(' · ')}
      </div>
      {!wideTitle && hasAdvisorCard && <div style={{ marginTop:12 }}><AdvisorBanner layout="block" /></div>}
      {copyNote && <p role="status" style={{ margin:'8px 0 0', fontSize:16, lineHeight:1.5, color:'#000' }}>{copyNote}</p>}
      {rows.length === 0 ? (
        <div style={{ marginTop:20 }}>
          {hasSaved ? (
            <>
              <p style={{ margin:'0 0 16px', fontSize:16, lineHeight:1.5, color:'#000', maxWidth:'62ch' }}>Nothing here yet. Add classes from your saved list.</p>
              {addBtn}
            </>
          ) : (
            <>
              <p style={{ margin:'0 0 16px', fontSize:16, lineHeight:1.5, color:'#000', maxWidth:'62ch' }}>Save a class first</p>
              <AppLink to="#/" style={linkBtnDark}>Browse</AppLink>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginTop:16 }}>{addBtn}</div>
          <ul aria-label="Classes in this plan" style={{ margin:0, padding:'20px 0 0', display:'grid', gridTemplateColumns:`repeat(${cols}, minmax(0, 1fr))`, gap:16, alignItems:'stretch' }}>
            {first.map(tile)}
            {backup.length > 0 && <li style={{ gridColumn:'1 / -1', listStyle:'none', margin:'8px 0 -4px' }}><h2 style={{ margin:0, fontSize:15, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:'#444' }}>Backups</h2></li>}
            {backup.map(tile)}
            {Array.from({ length: slots }, (_, i) => <EmptyChannelSlot key={`slot-${i}`} onClick={() => actions.addClasses(plan.id)} />)}
          </ul>
        </>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:860, marginTop:isMobile ? 32 : 48 }}>
        {semester.showCalendar && <AppLink to="#/calendar" style={{ ...linkBtnLight, gap:8, alignSelf:'flex-start' }}><CalendarIcon />Calendar</AppLink>}
      </div>
    </div>
  );
}

// ─── Share or print ───────────────────────────────────────────────────────────
function PlanPrintable({ plan }: { plan: Plan }) {
  const { first, backup } = planExport(plan);
  const flat = plan.id === ALL_SAVED_ID;
  const section = (heading: string, items: ExportItem[]) => (
    <section style={{ marginTop:20 }}>
      <h3 style={{ margin:'0 0 8px', fontSize:20, fontWeight:600, lineHeight:1.3 }}>{heading}</h3>
      {items.length === 0 ? <p style={{ margin:0 }}>None yet.</p> : (
        <ol style={{ margin:0, paddingLeft:24, display:'flex', flexDirection:'column', gap:12 }}>
          {items.map(item => (
            <li key={item.code + item.title} style={{ lineHeight:1.5 }}>
              <div style={{ fontWeight:600 }}>{item.title}</div>
              <div>{item.code} · {creditsLabel(item.credits)}</div>
              {item.availability && <div>Availability: {item.availability}</div>}
              {item.advisorNote && <div>{item.advisorNote}</div>}
              {item.classNumber && <div>Class number: {item.classNumber}</div>}
              <div>Prerequisites: {item.prerequisites || 'No prerequisites'}</div>
              <div style={{ overflowWrap:'anywhere' }}>Class search: <a href={item.searchUrl} style={{ color:'#000' }}>{item.searchUrl}</a></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
  return (
    <div style={{ color:'#000', fontSize:16, lineHeight:1.5 }}>
      <h3 className="print-title" style={{ margin:0, fontSize:20, fontWeight:700, lineHeight:1.3, overflowWrap:'anywhere' }}>{plan.name}</h3>
      {plan.term && !plan.name.includes(plan.term) && <div>{plan.term}</div>}
      <div>{flat ? 'Total' : 'Total for first choices'}: {creditsText(first.map(i => i.credits))}</div>
      {section(flat ? 'Saved classes' : 'First choices', first)}
      {!flat && section('Backups', backup)}
      <p style={{ margin:'20px 0 0', overflowWrap:'anywhere' }}>Not sure if a class counts or will run? Book time with an advisor: <a href={semester.advisorBookingUrl} style={{ color:'#000' }}>{semester.advisorBookingUrl}</a></p>
    </div>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function SharePlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { first, backup } = planExport(plan);
  const text = planAsText(plan, first, backup, { url: semester.advisorBookingUrl }, { flat: plan.id === ALL_SAVED_ID });
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Dialog title="Share or print" onClose={onClose} wide>
      <div className="print-scroll" style={{ maxHeight:'44vh', overflowY:'auto', border:'1px solid #E0E0E0', borderRadius:8, padding:16, marginBottom:16 }}>
        <PlanPrintable plan={plan} />
      </div>
      <div className="no-print" style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
        <button onClick={() => window.print()} style={btnDark}>Print</button>
        <button onClick={async () => setStatus((await copyText(text)) ? 'copied' : 'failed')} style={btnLight}>Copy as text</button>
        {canShare && <button onClick={() => { navigator.share({ title: plan.name, text }).catch(() => {}); }} style={btnLight}>Share</button>}
      </div>
      <p role="status" className="no-print" style={{ margin:'12px 0 0', minHeight:24, fontSize:16, lineHeight:1.5, color:'#000' }}>
        {status === 'copied' ? 'Copied. You can paste it into a message or a note.' : status === 'failed' ? "Couldn't copy automatically. Select the text below and copy it." : ''}
      </p>
      {status === 'failed' && (
        <textarea readOnly value={text} aria-label="Plan as text" className="no-print" style={{ ...fieldBox, minHeight:180, padding:12, marginTop:8, fontFamily:'var(--font-sans)' }} />
      )}
    </Dialog>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
// A friendly week/day/month/schedule calendar. Class meeting days and times aren't in the data, so no class
// is placed on it; the only things it can ever show are blocks the student adds themselves. No holidays,
// term dates or imported events appear here.
type CalView = 'day' | 'week' | 'month' | 'schedule';
const CAL_VIEWS: { key: CalView; label: string; hotkey: string }[] = [
  { key: 'day', label: 'Day', hotkey: 'D' },
  { key: 'week', label: 'Week', hotkey: 'W' },
  { key: 'month', label: 'Month', hotkey: 'M' },
  { key: 'schedule', label: 'Schedule', hotkey: 'A' },
];
const CAL_VIEW_KEY = 'focus-electives:calendar-view';
const CAL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
// Weekends are off by default in Day, Week and Schedule and on in Month. The choice is remembered per view.
const CAL_WEEKENDS_KEY = 'focus-electives:calendar-weekends';
const CAL_WEEKENDS_DEFAULT: Record<CalView, boolean> = { day: false, week: false, month: true, schedule: false };
function calReadWeekends(): Record<CalView, boolean> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CAL_WEEKENDS_KEY) ?? '{}');
    const out = { ...CAL_WEEKENDS_DEFAULT };
    for (const k of Object.keys(out) as CalView[]) if (raw && typeof raw[k] === 'boolean') out[k] = raw[k];
    return out;
  } catch { return { ...CAL_WEEKENDS_DEFAULT }; }
}
const CAL_START = 8; // 8 AM
const CAL_END = 20; // 8 PM
const CAL_ROW = 56; // px per hour
const CAL_LINE = '1px solid #E4E4E4';
const CAL_TODAY_BG = '#D6E8FF'; // soft blue circle behind today's date
const NEW_PLAN_OPTION = '__new-plan__';

// A block the student added themselves. days: 0 = Monday ... 6 = Sunday. start/end: minutes after midnight.
interface CalBlock { id: string; title: string; days: number[]; start: number; end: number }

const calStartOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const calAddDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const calMonday = (d: Date) => calAddDays(d, -((d.getDay() + 6) % 7));
const calSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const calWeekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
// Move by months, keeping `day` (the day of the month wanted) where the month is long enough.
const calAddMonths = (d: Date, n: number, day = d.getDate()) => {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, last));
};
const calFmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', opts);
const calTimeText = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const calHourLabel = (h: number) => calTimeText(h * 60);

function calRangeLabel(view: CalView, anchor: Date, span = 5) {
  if (view === 'day') return calFmt(anchor, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (view === 'month') return calFmt(anchor, { month: 'long', year: 'numeric' });
  const mon = calMonday(anchor), fri = calAddDays(mon, span - 1);
  const end = mon.getMonth() === fri.getMonth() ? String(fri.getDate()) : calFmt(fri, { month: 'short', day: 'numeric' });
  return `${calFmt(mon, { month: 'short', day: 'numeric' })} – ${end}, ${fri.getFullYear()}`;
}

function calReadView(isMobile: boolean): CalView {
  try { const v = window.localStorage.getItem(CAL_VIEW_KEY); if (v === 'day' || v === 'week' || v === 'month' || v === 'schedule') return v; } catch { /* storage can be blocked */ }
  return isMobile ? 'day' : 'week';
}
// The Monday that Week and Schedule start from. With weekends hidden they are Monday to Friday, so when the date
// being shown is today and today is a Saturday or Sunday, they show the coming week. Day and Month are not affected.
function calWeekMonday(anchor: Date, today: Date, weekendsOn: boolean) {
  return !weekendsOn && calSameDay(anchor, today) && calWeekdayIndex(today) >= 5 ? calAddDays(calMonday(today), 7) : calMonday(anchor);
}

// Who overlaps whom, one weekday at a time: "blockId:day" -> titles of the blocks it overlaps on that day.
function calOverlaps(blocks: CalBlock[]) {
  const map = new Map<string, string[]>();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      if (!(a.start < b.end && b.start < a.end)) continue;
      for (const d of a.days.filter(x => b.days.includes(x))) {
        map.set(`${a.id}:${d}`, [...(map.get(`${a.id}:${d}`) ?? []), b.title]);
        map.set(`${b.id}:${d}`, [...(map.get(`${b.id}:${d}`) ?? []), a.title]);
      }
    }
  }
  return map;
}
const calOverlapText = (map: Map<string, string[]>, id: string, day: number) => {
  const names = map.get(`${id}:${day}`);
  return names && names.length ? `Overlaps with ${names.join(', ')}` : '';
};

// Side-by-side lanes for blocks that overlap on one day.
function calLayoutDay(list: CalBlock[]) {
  const sorted = [...list].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: { b: CalBlock; col: number; cols: number }[] = [];
  let cluster: { b: CalBlock; col: number; cols: number }[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    const cols = Math.max(1, ...cluster.map(c => c.col + 1));
    cluster.forEach(c => out.push({ ...c, cols }));
    cluster = []; clusterEnd = -1; laneEnds = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex(e => e <= b.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.end); } else laneEnds[lane] = b.end;
    cluster.push({ b, col: lane, cols: 1 });
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return out;
}

const calBlockName = (b: CalBlock, day: Date | null, overlap: string) =>
  `${b.title}, ${day ? `${calFmt(day, { weekday: 'long' })} ` : ''}${calTimeText(b.start)} to ${calTimeText(b.end)}${overlap ? `. ${overlap}` : ''}. Edit.`;

function CalBlockButton({ b, overlap, day, style, onEdit }: { b: CalBlock; overlap: string; day: Date | null; style?: React.CSSProperties; onEdit: (b: CalBlock) => void }) {
  return (
    <button type="button" className="cal-press" onClick={() => onEdit(b)} aria-label={calBlockName(b, day, overlap)}
      style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, overflow: 'hidden', textAlign: 'left', padding: '4px 6px', background: '#C9C9C9', color: '#000', border: '1px solid #767676', borderRadius: 8, fontSize: 14, lineHeight: 1.25, fontFamily: 'var(--font-sans)', cursor: 'pointer', ...style }}>
      <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{b.title}</span>
      {overlap && (
        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 4, fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          <span>{overlap}</span>
        </span>
      )}
    </button>
  );
}

// Week and Day: a time grid. The day headers and the time axis stay pinned while it scrolls; it opens at the
// current hour, with a thin "now" line across today's column.
function CalTimeGrid({ days, blocks, overlaps, today, now, isMobile, periodKey, label, onEdit }: {
  days: Date[]; blocks: CalBlock[]; overlaps: Map<string, string[]>; today: Date; now: Date; isMobile: boolean; periodKey: string; label: string; onEdit: (b: CalBlock) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const n = nowRef.current;
    const hasToday = days.some(d => calSameDay(d, calStartOfDay(n)));
    const minutes = n.getHours() * 60 + n.getMinutes();
    el.scrollTop = hasToday ? Math.max(0, ((minutes - CAL_START * 60) / 60) * CAL_ROW - CAL_ROW) : 0;
  }, [periodKey]);

  const axisW = isMobile ? 56 : 72;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMin - CAL_START * 60) / 60) * CAL_ROW;
  const showNow = nowMin >= CAL_START * 60 && nowMin <= CAL_END * 60;
  const hours = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);
  const cell = (extra: React.CSSProperties): React.CSSProperties => ({ background: '#FFF', ...extra });

  return (
    <div ref={scroller} role="region" aria-label={label} tabIndex={0} data-cal-scroll
      style={{ overflow: 'auto', maxHeight: isMobile ? '62vh' : 'min(640px, 72vh)', border: CAL_LINE, borderRadius: 12, background: '#FFF' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `${axisW}px repeat(${days.length}, minmax(${days.length > 1 ? 148 : 0}px, 1fr))`, gridTemplateRows: `64px repeat(${hours.length}, ${CAL_ROW}px) 32px`, position: 'relative' }}>
        <div style={cell({ position: 'sticky', top: 0, left: 0, zIndex: 4, borderBottom: CAL_LINE })} />
        {days.map(d => {
          const isToday = calSameDay(d, today);
          return (
            <div key={d.toISOString()} aria-current={isToday ? 'date' : undefined}
              style={cell({ position: 'sticky', top: 0, zIndex: 3, borderBottom: CAL_LINE, borderLeft: CAL_LINE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 16, lineHeight: 1.1, color: '#000' })}>
              <span style={{ fontWeight: 600 }}>{calFmt(d, { weekday: 'short' })}{isToday && <span className="sr-only"> (today)</span>}</span>
              <span style={{ minWidth: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center', background: isToday ? CAL_TODAY_BG : 'transparent', fontWeight: isToday ? 700 : 400, fontSize: 16 }}>{d.getDate()}</span>
            </div>
          );
        })}
        {hours.map((h, i) => (
          <Fragment key={h}>
            <div style={cell({ position: 'sticky', left: 0, zIndex: 2, gridRow: i + 2, gridColumn: 1, borderTop: CAL_LINE, padding: '4px 8px 0 0', textAlign: 'right', fontSize: 16, lineHeight: 1.2, color: '#444' })}>{calHourLabel(h)}</div>
            {days.map((d, c) => <div key={d.toISOString()} aria-hidden="true" style={{ gridRow: i + 2, gridColumn: c + 2, borderTop: CAL_LINE, borderLeft: CAL_LINE }} />)}
          </Fragment>
        ))}
        <div style={cell({ position: 'sticky', left: 0, zIndex: 2, gridRow: hours.length + 2, gridColumn: 1, borderTop: CAL_LINE, padding: '4px 8px 0 0', textAlign: 'right', fontSize: 16, lineHeight: 1.2, color: '#444' })}>{calHourLabel(CAL_END)}</div>
        {days.map((d, c) => <div key={d.toISOString()} aria-hidden="true" style={{ gridRow: hours.length + 2, gridColumn: c + 2, borderTop: CAL_LINE, borderLeft: CAL_LINE }} />)}
        {days.map((d, c) => {
          const idx = calWeekdayIndex(d);
          const laid = calLayoutDay(blocks.filter(b => b.days.includes(idx)));
          const isToday = calSameDay(d, today);
          return (
            <div key={d.toISOString()} style={{ gridRow: `2 / ${hours.length + 2}`, gridColumn: c + 2, position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
              {laid.map(({ b, col, cols }) => {
                const top = ((Math.max(b.start, CAL_START * 60) - CAL_START * 60) / 60) * CAL_ROW;
                const hasOverlap = !!overlaps.get(`${b.id}:${idx}`);
                const height = Math.max(hasOverlap ? 88 : 44, ((Math.min(b.end, CAL_END * 60) - Math.max(b.start, CAL_START * 60)) / 60) * CAL_ROW - 2);
                return (
                  <CalBlockButton key={b.id} b={b} day={d} overlap={calOverlapText(overlaps, b.id, idx)} onEdit={onEdit}
                    style={{ position: 'absolute', top: top + 1, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, pointerEvents: 'auto' }} />
                );
              })}
              {isToday && showNow && (
                <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: nowTop - 1, height: 2, background: '#2F7BEA', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: 4, background: '#2F7BEA' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Month: dates in a grid. A small dot marks a day that has a block (with a hidden count for screen readers);
// tapping a date opens that day.
function CalMonthGrid({ anchor, today, blocks, isMobile, weekends, onOpenDay }: { anchor: Date; today: Date; blocks: CalBlock[]; isMobile: boolean; weekends: boolean; onOpenDay: (d: Date) => void }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = calMonday(first);
  const cells = Array.from({ length: 42 }, (_, i) => calAddDays(start, i));
  const rows = cells[35].getMonth() === anchor.getMonth() || cells[28].getMonth() === anchor.getMonth() ? 6 : 5;
  const cols = weekends ? 7 : 5;
  const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, cols);
  return (
    <div role="group" aria-label={`${calFmt(anchor, { month: 'long', year: 'numeric' })}, tap a date to open that day`}
      style={{ margin: isMobile ? '0 -16px' : 0, border: CAL_LINE, borderRadius: isMobile ? 0 : 12, overflow: 'hidden', background: '#FFF' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {heads.map(h => <div key={h} aria-hidden="true" style={{ minHeight: 40, display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 600, color: '#000', borderBottom: CAL_LINE }}>{isMobile ? h[0] : h}</div>)}
        {cells.slice(0, rows * 7).filter(d => calWeekdayIndex(d) < cols).map(d => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = calSameDay(d, today);
          const idx = calWeekdayIndex(d);
          const count = blocks.filter(b => b.days.includes(idx)).length;
          return (
            <button key={d.toISOString()} type="button" className="cal-press" onClick={() => onOpenDay(d)}
              aria-label={`${calFmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${isToday ? ', today' : ''}${count ? `, ${count} ${count === 1 ? 'block' : 'blocks'}` : ''}. Open day.`}
              style={{ minHeight: 56, padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: '#FFF', border: 0, borderTop: CAL_LINE, borderLeft: CAL_LINE, color: inMonth ? '#000' : '#767676', fontFamily: 'var(--font-sans)', fontSize: 16, cursor: 'pointer' }}>
              <span style={{ minWidth: 32, height: 32, borderRadius: 16, display: 'grid', placeItems: 'center', background: isToday ? CAL_TODAY_BG : 'transparent', fontWeight: isToday ? 700 : 400 }}>{d.getDate()}</span>
              <span aria-hidden="true" style={{ display: 'flex', gap: 3, minHeight: 8 }}>
                {Array.from({ length: Math.min(count, 3) }, (_, k) => <span key={k} style={{ width: 8, height: 8, borderRadius: 4, background: '#444' }} />)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Schedule: a plain list of the week's days, with each day's blocks or "Nothing scheduled."
function CalScheduleList({ days, today, blocks, overlaps, onEdit }: { days: Date[]; today: Date; blocks: CalBlock[]; overlaps: Map<string, string[]>; onEdit: (b: CalBlock) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {days.map(d => {
        const isToday = calSameDay(d, today);
        const list = blocks.filter(b => b.days.includes(calWeekdayIndex(d))).sort((x, y) => x.start - y.start);
        return (
          <section key={d.toISOString()} aria-label={`${calFmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`}
            style={{ border: CAL_LINE, borderRadius: 12, padding: '12px 16px', background: '#FFF' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 600, lineHeight: 1.3, color: '#000' }}>
              <span>{calFmt(d, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
              {isToday && <span style={{ fontSize: 14, fontWeight: 600, background: CAL_TODAY_BG, borderRadius: 100, padding: '2px 10px' }}>Today</span>}
            </h3>
            {list.length === 0 ? (
              <p style={{ margin: '4px 0 0', fontSize: 16, lineHeight: 1.5, color: '#444' }}>Nothing scheduled.</p>
            ) : (
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map(b => (
                  <li key={b.id}>
                    <CalBlockButton b={b} day={d} overlap={calOverlapText(overlaps, b.id, calWeekdayIndex(d))} onEdit={onEdit}
                      style={{ width: '100%', minHeight: 44, fontSize: 16, padding: '8px 12px' }} />
                    <div style={{ fontSize: 16, color: '#444', marginTop: 2 }}>{calTimeText(b.start)} – {calTimeText(b.end)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// "Jump to date": a small month picker under the date range. A tapped day becomes the current day.
function CalMonthPicker({ anchor, today, isMobile, onPick, onClose }: { anchor: Date; today: Date; isMobile: boolean; onPick: (d: Date) => void; onClose: () => void }) {
  const [shown, setShown] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-cal-range]')) closeRef.current(); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    ref.current?.querySelector<HTMLButtonElement>('[data-picked="true"]')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); };
  }, []);
  const start = calMonday(shown);
  const cells = Array.from({ length: 42 }, (_, i) => calAddDays(start, i));
  const rows = cells[35].getMonth() === shown.getMonth() ? 6 : 5;
  const navBtn: React.CSSProperties = { width: 44, height: 44, display: 'grid', placeItems: 'center', background: '#FFF', border: '1px solid #000', borderRadius: 22, color: '#000', cursor: 'pointer', fontSize: 20, fontFamily: 'var(--font-sans)' };
  return (
    <div ref={ref} role="dialog" aria-label="Choose a date"
      style={{ position: 'absolute', top: 'calc(100% + 8px)', zIndex: 30, left: isMobile ? -16 : 0, right: isMobile ? -16 : undefined, width: isMobile ? undefined : 336, boxSizing: 'border-box', padding: 6, background: '#FFF', border: '1px solid #000', borderRadius: isMobile ? 0 : 16, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '0 2px 6px' }}>
        <button type="button" className="cal-press" aria-label="Previous month" onClick={() => setShown(m => calAddMonths(m, -1))} style={navBtn}>‹</button>
        <div aria-live="polite" style={{ fontSize: 18, fontWeight: 600, color: '#000' }}>{calFmt(shown, { month: 'long', year: 'numeric' })}</div>
        <button type="button" className="cal-press" aria-label="Next month" onClick={() => setShown(m => calAddMonths(m, 1))} style={navBtn}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => <div key={i} aria-hidden="true" style={{ minHeight: 28, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600, color: '#444' }}>{h}</div>)}
        {cells.slice(0, rows * 7).map(d => {
          const inMonth = d.getMonth() === shown.getMonth();
          const isToday = calSameDay(d, today);
          const picked = calSameDay(d, anchor);
          return (
            <button key={d.toISOString()} type="button" className="cal-press" data-picked={picked} onClick={() => onPick(d)}
              aria-label={`${calFmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${isToday ? ', today' : ''}`}
              style={{ minHeight: 44, display: 'grid', placeItems: 'center', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: inMonth ? '#000' : '#767676', fontSize: 16, fontFamily: 'var(--font-sans)' }}>
              <span style={{ minWidth: 36, height: 36, borderRadius: 18, display: 'grid', placeItems: 'center', background: isToday ? CAL_TODAY_BG : 'transparent', border: picked ? '2px solid #000' : '2px solid transparent', fontWeight: isToday ? 700 : 400 }}>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const CAL_BLOCKS_KEY = 'focus-electives:blocks';
function calLoadBlocks(): CalBlock[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CAL_BLOCKS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter((b): b is CalBlock => b && typeof b.id === 'string' && typeof b.title === 'string' && Array.isArray(b.days) && b.days.every((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6) && typeof b.start === 'number' && typeof b.end === 'number' && b.end > b.start)
      .filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true))); // two blocks with one id would edit and delete together
  } catch { return []; }
}
const calMinutes = (v: string) => { const m = /^(\d{2}):(\d{2})$/.exec(v); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const calTimeValue = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Add or edit one of the student's own blocks: title, weekdays, start and end time. Stored on this device only.
function CalBlockForm({ block, defaultDay, onSave, onDelete, onClose }: { block: CalBlock | null; defaultDay: number; onSave: (b: CalBlock) => void; onDelete: (b: CalBlock) => void; onClose: () => void }) {
  const [title, setTitle] = useState(block?.title ?? '');
  const [days, setDays] = useState<number[]>(block?.days ?? [defaultDay]);
  const [start, setStart] = useState(calTimeValue(block?.start ?? 9 * 60));
  const [end, setEnd] = useState(calTimeValue(block?.end ?? 10 * 60));
  const [error, setError] = useState('');
  const submitted = useRef(false); // the form stays on screen while it closes, so a second tap must not save again
  const toggleDay = (d: number) => setDays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitted.current) return;
    const s0 = calMinutes(start), e0 = calMinutes(end);
    if (!title.trim()) return setError('Give the block a name, like Work.');
    if (days.length === 0) return setError('Pick at least one day.');
    if (Number.isNaN(s0) || Number.isNaN(e0)) return setError('Pick a start and an end time.');
    if (e0 <= s0) return setError('The end time has to be after the start time.');
    if (s0 < CAL_START * 60 || e0 > CAL_END * 60) return setError('Blocks can run from 8 AM to 8 PM.');
    submitted.current = true;
    onSave({ id: block?.id ?? `block-${Date.now()}`, title: title.trim(), days, start: s0, end: e0 });
  }
  const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 16, lineHeight: 1.5, color: '#000', fontWeight: 600 } as const;
  return (
    <Dialog title={block ? 'Edit block' : 'Add a block'} onClose={onClose}>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={label}>Title
          <input autoFocus value={title} maxLength={40} onChange={e => setTitle(e.target.value)} placeholder="e.g. Work" style={{ ...fieldBox, fontWeight: 400 }} />
        </label>
        <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
          <legend style={{ ...label, padding: 0, marginBottom: 6 }}>Days</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CAL_DAY_NAMES.map((n, i) => (
              <button key={n} type="button" className="cal-press" aria-pressed={days.includes(i)} aria-label={n} onClick={() => toggleDay(i)}
                style={{ minWidth: 52, minHeight: 44, padding: '0 10px', border: '1px solid #000', borderRadius: 100, background: days.includes(i) ? '#000' : '#FFF', color: days.includes(i) ? '#FFF' : '#000', fontSize: 16, fontFamily: 'var(--font-sans)', fontWeight: days.includes(i) ? 600 : 400, cursor: 'pointer' }}>{n.slice(0, 3)}</button>
            ))}
          </div>
        </fieldset>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ ...label, flex: 1 }}>Start
            <input type="time" value={start} min="08:00" max="20:00" step={900} onChange={e => setStart(e.target.value)} style={{ ...fieldBox, fontWeight: 400 }} />
          </label>
          <label style={{ ...label, flex: 1 }}>End
            <input type="time" value={end} min="08:00" max="20:00" step={900} onChange={e => setEnd(e.target.value)} style={{ ...fieldBox, fontWeight: 400 }} />
          </label>
        </div>
        {error && <p role="alert" style={{ margin: 0, padding: '10px 14px', background: '#FFF6DC', borderLeft: '4px solid #8A6A00', borderRadius: 8, fontSize: 16, lineHeight: 1.5, color: '#000' }}>{error}</p>}
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#444' }}>Blocks stay on this device.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type="submit" style={btnDark}>Save</button>
          <button type="button" onClick={onClose} style={btnLight}>Cancel</button>
          {block && <button type="button" onClick={() => onDelete(block)} style={btnLight}>Delete</button>}
        </div>
      </form>
    </Dialog>
  );
}

// A small settings menu next to the view buttons. For now it holds one switch: show Saturday and Sunday in this view.
function CalViewSettings({ view, weekends, onToggle }: { view: CalView; weekends: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); opener.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  const label = CAL_VIEWS.find(v => v.key === view)?.label ?? '';
  return (
    <div ref={wrap} style={{ position: 'relative', flexShrink: 0 }}>
      <button ref={opener} type="button" className="cal-press" aria-label="View settings" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: '#FFF', color: '#000', border: '1px solid #000', borderRadius: 22, cursor: 'pointer' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
      </button>
      {open && (
        <div role="group" aria-label="View settings" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 30, width: 'min(300px, calc(100vw - 32px))', boxSizing: 'border-box', padding: 8, background: '#FFF', border: '1px solid #000', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}>
          <button type="button" role="switch" aria-checked={weekends} onClick={onToggle}
            style={{ width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 10px', background: 'none', border: 0, borderRadius: 12, textAlign: 'left', fontFamily: 'var(--font-sans)', color: '#000', cursor: 'pointer' }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>Show weekends</span>
              <span style={{ fontSize: 14, lineHeight: 1.3, color: '#444' }}>For the {label} view</span>
            </span>
            <span aria-hidden="true" style={{ position: 'relative', width: 52, height: 32, borderRadius: 16, background: weekends ? '#000' : '#FFF', border: '2px solid #000', flexShrink: 0, boxSizing: 'border-box' }}>
              <span style={{ position: 'absolute', top: 3, left: weekends ? 23 : 3, width: 22, height: 22, borderRadius: 11, background: weekends ? '#FFF' : '#000', transition: 'left 120ms ease-out' }} />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// The "Plans and Classes" panel: a side panel on desktop, a bottom sheet on phones. It is static for now: it lists
// plans and classes with "Times not posted" and changes nothing on the calendar. No class day, time or location.
function CalClassRow({ c }: { c: Course }) {
  return (
    <li style={{ border: CAL_LINE, borderRadius: 12, padding: '8px 14px', background: '#FFF', display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 16, lineHeight: 1.5, color: '#444' }}>{c.code}</span>
      <AppLink to={classHref(c)} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, alignSelf: 'flex-start', color: '#000', fontSize: 18, fontWeight: 600, lineHeight: 1.3, textUnderlineOffset: 3, overflowWrap: 'anywhere' }}>{c.title}</AppLink>
      <span style={{ fontSize: 16, lineHeight: 1.5, color: '#444' }}>Times not posted</span>
    </li>
  );
}

function CalPanel({ plans, scrollMax }: { plans: Plan[]; scrollMax: string }) {
  const [tab, setTab] = useState<'plans' | 'classes'>('plans');
  const [query, setQuery] = useState('');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs: { key: 'plans' | 'classes'; label: string }[] = [{ key: 'plans', label: 'Plans' }, { key: 'classes', label: 'Classes' }];
  const q = query.trim().toLowerCase();
  const classes = COURSES.filter(c => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault(); e.stopPropagation(); // the arrow keys here switch tabs, not the calendar's period
    const next = e.key === 'Home' ? 'plans' : e.key === 'End' ? 'classes' : tab === 'plans' ? 'classes' : 'plans';
    setTab(next); tabRefs.current[next]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label="Plans and Classes" onKeyDown={onTabKey} style={{ display: 'flex', border: '1px solid #000', borderRadius: 100, overflow: 'hidden' }}>
        {tabs.map(t => (
          <button key={t.key} ref={el => { tabRefs.current[t.key] = el; }} type="button" role="tab" id={`cal-tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`cal-tabpanel-${t.key}`} tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            style={{ flex: 1, minHeight: 44, border: 0, background: tab === t.key ? '#000' : '#FFF', color: tab === t.key ? '#FFF' : '#000', fontSize: 16, fontFamily: 'var(--font-sans)', fontWeight: tab === t.key ? 600 : 400, cursor: 'pointer' }}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`cal-tabpanel-${tab}`} aria-labelledby={`cal-tab-${tab}`} style={{ marginTop: 12 }}>
        {tab === 'plans' ? (
          plans.length === 0 ? (
            <div>
              <p style={{ margin: '0 0 12px', fontSize: 16, lineHeight: 1.5, color: '#000' }}>Nothing saved yet. Browse classes and tap save to build a plan.</p>
              <AppLink to="#/" style={linkBtnDark}>Browse classes</AppLink>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: scrollMax, overflowY: 'auto' }}>
              {plans.map(plan => {
                const cs = plan.items.flatMap(i => { const c = COURSES_BY_ID.get(i.id); return c ? [c] : []; });
                return (
                  <section key={plan.id} aria-label={plan.name}>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, lineHeight: 1.3, color: '#000', overflowWrap: 'anywhere' }}>{plan.name}</h3>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: '#444', marginBottom: 6 }}>{plan.term ? planTermText(plan) : 'No semester'} · {cs.length} {cs.length === 1 ? 'class' : 'classes'}</div>
                    {cs.length === 0 ? <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#444' }}>No classes in this plan yet.</p> : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>{cs.map(c => <CalClassRow key={c.id} c={c} />)}</ul>
                    )}
                  </section>
                );
              })}
            </div>
          )
        ) : (
          <div>
            <div style={{ marginBottom: 12 }}><SearchField value={query} onChange={setQuery} placeholder="Search classes" /></div>
            <p role="status" style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.4, color: '#444' }}>{classes.length} {classes.length === 1 ? 'class' : 'classes'}</p>
            {classes.length === 0 ? <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#000' }}>No classes match "{query.trim()}".</p> : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: scrollMax, overflowY: 'auto' }}>{classes.map(c => <CalClassRow key={c.id} c={c} />)}</ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CalShortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [['D', 'Day view'], ['W', 'Week view'], ['M', 'Month view'], ['A', 'Schedule view'], ['T', 'Go to today'], ['← →', 'Previous or next'], ['?', 'Show this card'], ['Esc', 'Close a menu']];
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 20, rowGap: 8, fontSize: 18, lineHeight: 1.4, color: '#000' }}>
        {rows.flatMap(([k, v]) => [
          <dt key={`${k}-k`}><kbd style={{ fontFamily: 'var(--font-sans)', fontSize: 16, padding: '2px 10px', border: '1px solid #000', borderRadius: 8, background: '#F6F6F6' }}>{k}</kbd></dt>,
          <dd key={`${k}-v`} style={{ margin: 0 }}>{v}</dd>,
        ])}
      </dl>
      <p style={{ margin: '16px 0 0', fontSize: 16, lineHeight: 1.5, color: '#444' }}>Shortcuts are off while you are typing in a field.</p>
    </Dialog>
  );
}

function CalendarPage({ plans, activePlanId, onPickPlan, onCreatePlan }: { plans: Plan[]; activePlanId: string | null; onPickPlan: (id: string) => void; onCreatePlan: () => void }) {
  const vw = useWindowWidth();
  const isMobile = vw < 640;
  const sidePanel = vw >= 1000; // wide screens get the side panel; narrower ones open it as a sheet
  const [panelOpen, setPanelOpen] = useState(false);
  const reduce = useReducedMotion();
  const [blocks, setBlocks] = useState<CalBlock[]>(calLoadBlocks);
  const [editing, setEditing] = useState<{ block: CalBlock | null } | null>(null);
  const [undo, setUndo] = useState<{ block: CalBlock; index: number } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem(CAL_BLOCKS_KEY, JSON.stringify(blocks)); } catch { /* storage can be blocked */ }
  }, [blocks]);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 7000);
    return () => clearTimeout(t);
  }, [undo]);
  const overlaps = calOverlaps(blocks);
  const onEditBlock = (b: CalBlock) => setEditing({ block: b });
  const saveBlock = (b: CalBlock) => {
    setBlocks(prev => (prev.some(x => x.id === b.id) ? prev.map(x => (x.id === b.id ? b : x)) : [...prev, b]));
    setEditing(null);
  };
  const deleteBlock = (b: CalBlock) => {
    const index = blocks.findIndex(x => x.id === b.id);
    if (index === -1) { setEditing(null); return; } // already deleted (the form is still closing): nothing to undo
    setBlocks(prev => prev.filter(x => x.id !== b.id));
    setUndo({ block: b, index });
    setEditing(null);
  };
  const undoDelete = () => {
    if (!undo) return;
    setBlocks(prev => (prev.some(x => x.id === undo.block.id) ? prev : [...prev.slice(0, undo.index), undo.block, ...prev.slice(undo.index)]));
    setUndo(null);
  };

  const plan = plans.find(p => p.id === activePlanId) ?? plans[0] ?? null;
  const courses = plan ? plan.items.flatMap(i => { const c = COURSES_BY_ID.get(i.id); return c ? [c] : []; }) : [];
  const termLine = plan?.term ? planTermText(plan) : '';
  const mono = { fontFamily: 'var(--font-sans)', fontSize: 16, lineHeight: 1.5, color: '#444' } as const;

  const [view, setView] = useState<CalView>(() => calReadView(isMobile));
  const [anchor, setAnchor] = useState(() => calStartOfDay(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [dir, setDir] = useState(0);
  const [weekendsByView, setWeekendsByView] = useState(() => semester.showCalendarSettings ? calReadWeekends() : { ...CAL_WEEKENDS_DEFAULT });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const rangeBtn = useRef<HTMLButtonElement>(null);
  const today = calStartOfDay(now);
  const weekends = weekendsByView[view];
  const span = weekends ? 7 : 5;
  const monday = calWeekMonday(anchor, today, weekends); // where Week and Schedule start

  useEffect(() => {
    if (!semester.showCalendarSettings) return; // the setting is hidden, so nothing is saved or read back
    try { window.localStorage.setItem(CAL_WEEKENDS_KEY, JSON.stringify(weekendsByView)); } catch { /* storage can be blocked */ }
  }, [weekendsByView]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const changeView = (v: CalView) => {
    setDir(0); setView(v);
    try { window.localStorage.setItem(CAL_VIEW_KEY, v); } catch { /* storage can be blocked */ }
  };
  // Stepping months from the 31st clamps to a short month's last day; remember the day wanted so stepping back returns to it.
  const wantedDay = useRef(anchor.getDate());
  const shift = (n: number) => {
    setDir(n);
    if (view === 'month') setAnchor(calAddMonths(anchor, n, wantedDay.current));
    else {
      let next = view === 'day' ? calAddDays(anchor, n) : calAddDays(monday, 7 * n);
      if (view === 'day' && !weekends) while (calWeekdayIndex(next) >= 5) next = calAddDays(next, n); // skip Saturday and Sunday
      wantedDay.current = next.getDate(); setAnchor(next);
    }
  };
  const settle = (d: Date) => { wantedDay.current = d.getDate(); setAnchor(d); };
  const goToday = () => { const t = calStartOfDay(new Date()); setDir(t >= anchor ? 1 : -1); settle(t); };
  const jumpTo = (d: Date) => { setDir(d >= anchor ? 1 : -1); settle(calStartOfDay(d)); };
  const openDay = (d: Date) => { setDir(0); settle(calStartOfDay(d)); changeView('day'); };

  // Announce each change of period to screen readers.
  const firstRun = useRef(true);
  const rangeText = calRangeLabel(view, view === 'day' || view === 'month' ? anchor : monday, span);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setAnnounce(`${CAL_VIEWS.find(v => v.key === view)?.label} view, ${rangeText}`);
  }, [view, rangeText]);

  // Keyboard shortcuts (ignored while typing in a field or while a card is open).
  const shiftRef = useRef(shift), todayRef = useRef(goToday), helpOpenRef = useRef(false);
  shiftRef.current = shift; todayRef.current = goToday; helpOpenRef.current = helpOpen || editing !== null || panelOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || helpOpenRef.current) return;
      const k = e.key.toLowerCase();
      const view_ = ({ d: 'day', w: 'week', m: 'month', a: 'schedule' } as Record<string, CalView>)[k];
      if (view_) { changeView(view_); e.preventDefault(); }
      else if (k === 't') { todayRef.current(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { shiftRef.current(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { shiftRef.current(1); e.preventDefault(); }
      else if (e.key === '?') { setHelpOpen(true); e.preventDefault(); }
      else if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Swipe left / right on a phone to go forward or back.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    // A week grid wider than the screen scrolls sideways itself, so a swipe that starts on it is left alone.
    const grid = (e.target as HTMLElement).closest<HTMLElement>('[data-cal-scroll]');
    touch.current = grid && grid.scrollWidth > grid.clientWidth + 1 ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current; touch.current = null;
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) shift(dx < 0 ? 1 : -1);
  };

  const weekDays = Array.from({ length: span }, (_, i) => calAddDays(monday, i));
  const showingNextWeek = !weekends && (view === 'week' || view === 'schedule') && calSameDay(anchor, today) && calWeekdayIndex(today) >= 5;
  const periodKey = `${view}|${view === 'month' ? `${anchor.getFullYear()}-${anchor.getMonth()}` : view === 'day' ? anchor.toDateString() : monday.toDateString()}`;
  // Blocks on Saturday or Sunday that the current view is not showing.
  const hiddenWeekendBlocks = view !== 'day' && !weekends ? blocks.filter(b => b.days.every(d => d >= 5)).length : 0;
  const periodBlocks = view === 'day'
    ? blocks.filter(b => b.days.includes(calWeekdayIndex(anchor)))
    : weekends ? blocks : blocks.filter(b => b.days.some(d => d < 5));
  const emptyLine = periodBlocks.length === 0
    ? (view === 'week' ? 'Your week is wide open.' : view === 'day' ? 'Your day is wide open.' : view === 'month' ? 'Nothing scheduled this month.' : '')
    : '';
  const gridLabel = view === 'day'
    ? `Day schedule for ${calFmt(anchor, { weekday: 'long', month: 'long', day: 'numeric' })}, 8 AM to 8 PM`
    : `Week schedule, ${rangeText}, Monday to ${weekends ? 'Sunday' : 'Friday'}, 8 AM to 8 PM`;

  const switcher = plan && (
    <label style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 4 : 10, fontSize: 16, lineHeight: 1.5, color: '#444', width: isMobile ? '100%' : undefined }}>
      <span>Plan</span>
      <select aria-label="Choose a plan" value={plan.id}
        onChange={e => { if (e.target.value === NEW_PLAN_OPTION) onCreatePlan(); else onPickPlan(e.target.value); }}
        style={{ minHeight: 44, height: 44, boxSizing: 'border-box', minWidth: isMobile ? 0 : 220, maxWidth: isMobile ? '100%' : 320, width: isMobile ? '100%' : undefined, padding: '0 12px', border: '1px solid #000', borderRadius: 12, background: '#FFF', color: '#000', fontSize: 16, fontFamily: 'var(--font-sans)' }}>
        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={NEW_PLAN_OPTION}>+ New plan…</option>
      </select>
    </label>
  );

  const planList = (
    <section aria-labelledby="cal-plan-title" style={{ marginTop: isMobile ? 8 : 40, maxWidth: 860 }}>
      <h2 id="cal-plan-title" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em', color: '#000' }}>Classes in your plan</h2>
      {plan && courses.length > 0 && <div style={{ ...mono, marginTop: 8 }}>{plan.name}{termLine ? ` · ${termLine}` : ''}</div>}
      {courses.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: '0 0 16px', fontSize: 16, lineHeight: 1.5, color: '#000', maxWidth: '62ch' }}>Nothing saved yet. Browse classes and tap save to build a plan.</p>
          <AppLink to="#/" style={linkBtnDark}>Browse classes</AppLink>
        </div>
      ) : (
        <ul style={{ margin: '16px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {courses.map(c => (
            <li key={c.id} style={{ border: CAL_LINE, borderRadius: 12, padding: '12px 16px', background: '#FFF', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={mono}>{c.code}</div>
              <AppLink to={classHref(c)} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, alignSelf: 'flex-start', color: '#000', fontSize: 18, fontWeight: 600, lineHeight: 1.3, textUnderlineOffset: 3, overflowWrap: 'anywhere' }}>{c.title}</AppLink>
              {showsAvailability(c) && <div style={{ ...mono, color: '#000' }}>{availabilityOf(c).full}</div>}
              <div style={{ fontSize: 16, lineHeight: 1.5, color: '#444' }}>Times not posted</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const pill: React.CSSProperties = { minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#FFF', color: '#000', border: '1px solid #000', borderRadius: 100, fontSize: 16, fontFamily: 'var(--font-sans)', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
  const arrow: React.CSSProperties = { ...pill, width: 44, padding: 0, fontSize: 22 };
  const toolbar = (
    <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <button type="button" className="cal-press" onClick={goToday} style={pill}>Today</button>
        <button type="button" className="cal-press" onClick={() => shift(-1)} aria-label={`Previous ${view === 'schedule' ? 'week' : view}`} style={arrow}>‹</button>
        <button type="button" className="cal-press" onClick={() => shift(1)} aria-label={`Next ${view === 'schedule' ? 'week' : view}`} style={arrow}>›</button>
        <button ref={rangeBtn} type="button" data-cal-range className="cal-press" aria-haspopup="dialog" aria-expanded={pickerOpen}
          aria-label={`Jump to date. Showing ${rangeText}`} onClick={() => setPickerOpen(o => !o)}
          style={{ ...pill, fontSize: 18, fontWeight: 600, border: 0, textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 4, padding: '0 8px' }}>
          {rangeText}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, width: isMobile ? '100%' : undefined }}>
        <button type="button" className="cal-press" onClick={() => setEditing({ block: null })} style={{ ...pill, flex: isMobile ? 1 : undefined }}>+ Add a block</button>
        {!sidePanel && <button type="button" className="cal-press" aria-haspopup="dialog" onClick={() => setPanelOpen(true)} style={{ ...pill, flex: isMobile ? 1 : undefined }}>Add to calendar</button>}
        <div role="group" aria-label="Calendar view" style={{ display: 'flex', flex: isMobile ? '1 1 100%' : undefined, border: '1px solid #000', borderRadius: 100, overflow: 'hidden' }}>
          {CAL_VIEWS.map(v => (
            <button key={v.key} type="button" className="cal-press" aria-pressed={view === v.key} onClick={() => changeView(v.key)} aria-keyshortcuts={v.hotkey}
              style={{ flex: isMobile ? 1 : undefined, minHeight: 44, minWidth: 44, padding: isMobile ? '0 4px' : '0 16px', border: 0, background: view === v.key ? '#000' : '#FFF', color: view === v.key ? '#FFF' : '#000', fontSize: 16, fontFamily: 'var(--font-sans)', fontWeight: view === v.key ? 600 : 400, cursor: 'pointer' }}>
              {v.label}
            </button>
          ))}
        </div>
        {semester.showCalendarSettings && <CalViewSettings view={view} weekends={weekends} onToggle={() => setWeekendsByView(w => ({ ...w, [view]: !w[view] }))} />}
        {!isMobile && <button type="button" className="cal-press" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(true)} style={{ ...pill, width: 44, padding: 0 }}>?</button>}
      </div>
      {pickerOpen && <CalMonthPicker anchor={anchor} today={today} isMobile={isMobile}
        onPick={d => { jumpTo(d); setPickerOpen(false); rangeBtn.current?.focus(); }}
        onClose={() => { setPickerOpen(false); rangeBtn.current?.focus(); }} />}
    </div>
  );

  const content = view === 'month'
    ? <CalMonthGrid anchor={anchor} today={today} blocks={blocks} isMobile={isMobile} weekends={weekends} onOpenDay={openDay} />
    : view === 'schedule'
      ? <CalScheduleList days={weekDays} today={today} blocks={blocks} overlaps={overlaps} onEdit={onEditBlock} />
      : <CalTimeGrid days={view === 'day' ? [anchor] : weekDays} blocks={blocks} overlaps={overlaps} today={today} now={now} isMobile={isMobile} periodKey={periodKey} label={gridLabel} onEdit={onEditBlock} />;

  const calendarArea = (
    <div onTouchStart={isMobile ? onTouchStart : undefined} onTouchEnd={isMobile ? onTouchEnd : undefined} style={{ marginTop: isMobile ? 24 : 0 }}>
      {toolbar}
      {undo && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, margin: '0 0 8px', fontSize: 16, lineHeight: 1.5, color: '#000' }}>
          <span>Deleted "{undo.block.title}".</span>
          <button type="button" className="cal-press" onClick={undoDelete} style={{ minHeight: 44, padding: '0 12px', background: 'none', border: 0, color: '#000', fontSize: 16, fontFamily: 'var(--font-sans)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' }}>Undo</button>
        </div>
      )}
      {semester.showCalendarSettings && hiddenWeekendBlocks > 0 && <p style={{ margin: '0 0 8px', fontSize: 16, lineHeight: 1.5, color: '#000' }}>{hiddenWeekendBlocks} {hiddenWeekendBlocks === 1 ? 'block is' : 'blocks are'} on a weekend and hidden. Turn on Show weekends to see {hiddenWeekendBlocks === 1 ? 'it' : 'them'}.</p>}
      {showingNextWeek && <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.4, color: '#444' }}>Showing next week</p>}
      {emptyLine && <p style={{ margin: '0 0 12px', fontSize: 18, lineHeight: 1.4, color: '#000' }}>{emptyLine}</p>}
      <motion.div key={periodKey} initial={reduce ? false : { opacity: 0, x: dir * 28 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduce ? 0 : 0.15, ease: 'easeOut' }}>
        {content}
      </motion.div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div style={{ marginBottom: 12 }}><BackButton label="Saved" ariaLabel="Back to Saved" to="#/saved" restoreSavedScroll /></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: isMobile ? 32 : 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, color: '#000' }}>Calendar</h1>
        {!isMobile && switcher}
      </div>
      {isMobile && switcher && <div style={{ marginTop: 12 }}>{switcher}</div>}
      <div style={{ ...mono, marginTop: 8 }}>{semester.nextTermName} · {CAL_VIEWS.find(v => v.key === view)?.label.toLowerCase()} view</div>
      <p role="note" style={{ margin: '12px 0 24px', maxWidth: '62ch', fontSize: 16, lineHeight: 1.5, color: '#000' }}>
        Class times aren't posted yet, so classes can't be placed on the calendar.
      </p>
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>
      {isMobile ? <>{planList}{calendarArea}</> : sidePanel ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{calendarArea}{planList}</div>
          <aside aria-label="Plans and Classes" style={{ width: 320, flexShrink: 0, boxSizing: 'border-box', padding: 16, border: '1px solid #000', borderRadius: 16, background: '#FFF' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em', color: '#000' }}>Add to calendar</h2>
            <CalPanel plans={plans} scrollMax="min(560px, 60vh)" />
          </aside>
        </div>
      ) : <>{calendarArea}{planList}</>}
      <AnimatePresence>{helpOpen && <CalShortcuts key="help" onClose={() => setHelpOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {panelOpen && !sidePanel && (
          <Dialog key="panel" title="Add to calendar" onClose={() => setPanelOpen(false)}>
            <CalPanel plans={plans} scrollMax="50vh" />
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editing && <CalBlockForm key={editing.block?.id ?? 'new'} block={editing.block} defaultDay={calWeekdayIndex(anchor) < 5 || weekends || view === 'day' ? calWeekdayIndex(anchor) : 4} onSave={saveBlock} onDelete={deleteBlock} onClose={() => setEditing(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Plans page and Saved classes page ────────────────────────────────────────
// ─── Saved: plan folders, then every saved class ──────────────────────────────
const ALL_SAVED_ID = '__all__';

// What the Saved page can do. The App owns the data and the dialogs.
interface SavedActions extends PlanActions {
  newPlan: () => void;
  addToPlan: (courseId: string, el?: HTMLElement | null) => void;
  removeSaved: (courseId: string) => void;
  addClasses: (planId: string) => void;
}

// One plan as a folder: a tab at the top-left that holds the plan name, a 2x2 preview of its class covers, and under it the term and
// count with the "..." menu. The folder is one link, to the plan's address. The look of the tab and body is in index.css (.plan-folder).
// The folder's bottom line: [season icon] "Fall 2027 · 5 classes", always on one line. If it would not fit (a narrow phone card), the
// term shortens to "Fall '27", and then the count to just the number. A Summer or missing term (old plans) shows as saved, with no icon.
function FolderMeta({ term, n }: { term: string; n: number }) {
  const kind = seasonOf(term) === 'fall' ? 'fall' : seasonOf(term) === 'spring' ? 'spring' : null;
  const label = term || 'No semester';
  const short = term ? term.replace(/ \d{2}(\d{2})$/, " '$1") : label;
  const full = `${n} ${n === 1 ? 'class' : 'classes'}`;
  // each step is a little shorter than the one before; the later ones also drop to 14px
  const steps = [{ t: `${label} · ${full}`, sm: false }, { t: `${short} · ${full}`, sm: false }, { t: `${short} · ${n}`, sm: true }, { t: short, sm: true }, { t: label.split(' ')[0], sm: true, xs: true }];
  const [level, setLevel] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth + 0.5 && level < steps.length - 1) setLevel(level + 1);
  }, [level, term, n]);
  useEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    const ro = new ResizeObserver(() => setLevel(0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, fontSize: 16, lineHeight: 1.4, color: '#444' }}>
      {kind && <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}><SeasonGlyph kind={kind} size={20} /></span>}
      <span ref={ref} title={`${label} · ${full}`} style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: (steps[level] as { xs?: boolean }).xs ? 13 : steps[level].sm ? 14 : 16 }}>{steps[level].t}</span>
    </div>
  );
}
function PlanFolder({ plan, actions }: { plan: Plan; actions: PlanActions }) {
  const courses = plan.items.flatMap(i => { const c = COURSES_BY_ID.get(i.id); return c ? [c] : []; });
  const n = plan.items.length;
  const shown = courses.slice(0, 4);
  const cell: React.CSSProperties = { aspectRatio: '4 / 3', borderRadius: 10, overflow: 'hidden', background: '#EDEDED', minWidth: 0 };
  const count = `${n} ${n === 1 ? 'class' : 'classes'}`;
  const name = plan.name.trim() || 'Untitled plan';
  // The link is an empty element whose ::after (.card-link) covers the whole folder, so one tap anywhere opens the plan; the "..."
  // menu sits above it and never opens the plan.
  return (
    <div className="plan-folder">
      <AppLink to={planHref(plan)} className="card-link plan-folder-link" aria-label={`Open plan ${[name, plan.term, count].filter(Boolean).join(', ')}`} title={name} />
      <span className="plan-folder-tab" aria-hidden="true"><span className="plan-folder-name">{name}</span></span>
      <div className="plan-folder-body">
        {shown.length === 0 ? (
          <div style={{ ...cell, display: 'grid', placeItems: 'center', padding: 8, textAlign: 'center', fontSize: 16, lineHeight: 1.4, color: '#444' }}>No classes yet</div>
        ) : (
          <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            {[0, 1, 2, 3].map(i => <div key={i} style={cell}>{shown[i] && <Cover course={shown[i]} />}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 'auto' }}>
          <FolderMeta key={`${plan.term}|${n}`} term={plan.term} n={n} />
          <div style={{ margin: '-6px -8px -6px 0', flexShrink: 0 }}>
            <PlanMenu planName={name} onRename={() => actions.rename(plan)} onChangeSemester={() => actions.changeSemester(plan)} onDelete={() => actions.remove(plan)} />
          </div>
        </div>
      </div>
    </div>
  );
}
function NewPlanFolder({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="plan-folder plan-folder-new" aria-label="New plan">
      <span className="plan-folder-tab" aria-hidden="true"><span className="plan-folder-name">New plan</span></span>
      <span className="plan-folder-body">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
      </span>
    </button>
  );
}

// Choose classes from the saved list for a new plan (checkboxes), or skip and add them later.
function PickClassesDialog({ planName, planTerm, courses, onAdd, onClose }: { planName: string; planTerm: string; courses: Course[]; onAdd: (ids: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Dialog title={`Add classes to ${planName}`} onClose={onClose}>
      <p style={{ margin:'0 0 8px', fontSize:16, lineHeight:1.5, color:'#444' }}>{courses.length ? 'Choose from your saved classes.' : 'Every saved class is already in this plan. Save more classes from Browse to add them.'}</p>
      <ul style={{ listStyle:'none', margin:0, padding:0, maxHeight:'46vh', overflowY:'auto' }}>
        {courses.map(c => {
          const fit = planTermFit(c, planTerm);
          const reasonId = `pick-reason-${c.id}`;
          return (
            <li key={c.id}>
              <label style={{ ...listRow, cursor: fit.ok ? 'pointer' : 'not-allowed' }}>
                <input type="checkbox" checked={fit.ok && picked.has(c.id)} aria-disabled={!fit.ok || undefined} aria-describedby={fit.ok ? undefined : reasonId}
                  onChange={() => { if (fit.ok) toggle(c.id); }} style={{ width:24, height:24, flexShrink:0, accentColor:'#000', opacity: fit.ok ? 1 : 0.4 }} />
                <span style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
                  <span style={{ fontWeight:600, lineHeight:1.4, overflowWrap:'anywhere', opacity: fit.ok ? 1 : 0.5 }}>{c.title}</span>
                  <span style={{ fontSize:16, lineHeight:1.5, color:'#444', opacity: fit.ok ? 1 : 0.7 }}>{c.code} · {creditsLabel(c.credits)}</span>
                  {!fit.ok && <span id={reasonId} style={{ fontSize:15, lineHeight:1.35, color:'#444' }}>{fit.reason}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, flexWrap:'wrap', marginTop:16 }}>
        <button type="button" onClick={onClose} style={btnLight}>Cancel</button>
        <button type="button" disabled={picked.size === 0} onClick={() => onAdd([...picked])} style={{ ...btnDark, ...(picked.size ? {} : btnOff) }}>
          {picked.size ? `Add ${picked.size} ${picked.size === 1 ? 'class' : 'classes'}` : 'Add classes'}
        </button>
      </div>
    </Dialog>
  );
}

// A small round icon button with a tooltip (hover or keyboard focus) and a real name for screen readers.
const iconBtn: React.CSSProperties = { width: 44, height: 44, padding: 0, borderRadius: '50%', border: '1px solid #000', background: '#FFF', color: '#000', display: 'grid', placeItems: 'center', cursor: 'pointer', textDecoration: 'none', position: 'relative' };

// A condensed Browse tile for the All saved grid: cover, title, code and credits, season icons. Under it: the prerequisite
// (only when there is one) and three icon buttons: search, add to plan, remove.
function SavedClassTile({ course, actions }: { course: Course; actions: SavedActions }) {
  const phone = useWindowWidth() < 640;
  const [open, setOpen] = useState(false);
  const prereq = requiredPrereq(course);
  const hasPrereq = prereq !== 'No prerequisites';
  const meta = cardMeta(course, useDisplayCode()(course));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, height: '100%' }}>
      <article className="tile" data-zoom-card data-course={course.id} style={{ ['--card-hue' as string]: accentFor(course.category), ['--card-radius' as string]: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', minWidth: 0, height: 'auto' }}>
        <div data-zoom-source style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', borderRadius: '23px 23px 0 0', overflow: 'hidden', flexShrink: 0 }}>
          <Cover course={course} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: phone ? 4 : 6, width: '100%', minWidth: 0, padding: phone ? '6px 8px' : '8px 12px' }}>
          <h3 className="tile-title" style={{ margin: 0, fontSize: phone ? 16 : 18, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em', color: '#000', maxWidth: '100%' }}>
            <AppLink to={classHref(course)} className="card-link">{course.title}</AppLink>
          </h3>
          <div style={{ fontSize: 14, lineHeight: 1.3, color: '#444', overflowWrap: 'anywhere' }}>{meta}</div>
          <div className="tile-ctl" role="group" aria-label={`${course.title}: when it has run`} style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
            <SeasonMarks course={course} />
          </div>
        </div>
      </article>
      {hasPrereq && (
        <button type="button" aria-expanded={open} aria-label={`Prerequisite: ${prereq}`} title={prereq} onClick={() => setOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 6, minHeight: 44, padding: '10px 4px', border: 0, background: 'none', textAlign: 'left', color: '#000', fontSize: 14, lineHeight: 1.3, fontFamily: 'var(--font-sans)', cursor: 'pointer', width: '100%', minWidth: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          <span style={{ minWidth: 0, ...(open ? { overflowWrap: 'anywhere' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }}>{prereq}</span>
        </button>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 'auto' }}>
        <a className="icon-tip" data-tip="Search in CU class search" href={classSearchLink(course)} target="_blank" rel="noopener noreferrer" aria-label={`Search ${course.code} in CU class search (opens in a new tab)`} style={iconBtn}><ExternalIcon size={20} /></a>
        <button className="icon-tip" data-tip="Add to plan" type="button" aria-label={`Add ${course.title} to a plan`} onClick={e => actions.addToPlan(course.id, e.currentTarget)} style={iconBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5h5" /></svg>
        </button>
        <button className="icon-tip" data-tip="Remove from saved" type="button" aria-label={`Remove ${course.title} from saved`} onClick={() => actions.removeSaved(course.id)} style={iconBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
        </button>
      </div>
    </div>
  );
}

// The person icon on the advisor card and banner: white on a blue circle.
function AdvisorIcon({ size = 40 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', background: 'var(--accent)', color: '#FFF', display: 'grid', placeItems: 'center' }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>
    </span>
  );
}
const ADVISOR_BUTTON_SR = 'with an advisor, opens in a new tab';

// The one advisor look: a pale gray row with the blue person circle, the headline, an optional supporting line and note, and a blue
// "Book a time" button. Used on the Saved overview, on plans and on class pages.
//   inline:  sizes to its content (the right of a heading row on desktop)
//   row:     fills its column, the button at the right (the class page's right column)
//   stacked: fills the width, the button under the text at full width and 52px tall (phones on a class page)
//   block:   fills the width, the button wraps under the text only if the line is too narrow (plans on phones)
// `showText` adds the supporting sentence (semester.advisorCardShowText by default); `note` is one muted line under the text.
function AdvisorBanner({ layout = 'block', showText = semester.advisorCardShowText, note = '' }: { layout?: 'inline' | 'row' | 'stacked' | 'block'; showText?: boolean; note?: string }) {
  const compact = layout === 'block';
  const blue: React.CSSProperties = { background: 'var(--accent)', color: '#FFF', border: 0, borderRadius: 12, fontWeight: 700, minHeight: 44 };
  const btn: React.CSSProperties = layout === 'stacked'
    ? { ...blue, width: '100%', minHeight: 52, justifyContent: 'center', boxSizing: 'border-box' }
    : layout === 'block' ? { ...blue, flex: '1 1 auto', justifyContent: 'center', padding: '0 12px', gap: 6, fontSize: 15 }
    : { ...blue, flexShrink: 0 };
  return (
    <div role="note" data-advisor style={{ boxSizing: 'border-box', display: 'flex', flexDirection: layout === 'stacked' ? 'column' : 'row', flexWrap: layout === 'stacked' || layout === 'row' ? 'nowrap' : 'wrap', alignItems: layout === 'stacked' ? 'stretch' : 'center', columnGap: compact ? 8 : 12, rowGap: 10, width: layout === 'inline' ? 'fit-content' : '100%', maxWidth: '100%', padding: '12px 14px', background: '#F3F3F5', borderRadius: 16, fontSize: 14, lineHeight: 1.35, color: '#000' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12, minWidth: 0, flex: layout === 'row' ? 1 : undefined }}>
        <AdvisorIcon size={compact ? 32 : 40} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, whiteSpace: layout === 'inline' ? 'nowrap' : undefined }}>{semester.advisorCardHeadline}</div>
          {showText && <div>{semester.advisorCardText}</div>}
          {note && <div style={{ color: '#444' }}>{note}</div>}
        </div>
      </div>
      <ExternalAction href={semester.advisorBookingUrl} sr={ADVISOR_BUTTON_SR} className="advisor-btn" style={btn}>{semester.advisorBookingLabel}</ExternalAction>
    </div>
  );
}

// The All saved tab: every saved class, with Add to plan and Remove on each.
function AllSavedView({ courses, actions }: { courses: Course[]; actions: SavedActions }) {
  const isMobile = useWindowWidth() < 640;
  const all: Plan = { id: ALL_SAVED_ID, name: 'Saved classes', term: '', items: courses.map(c => ({ id: c.id, role: 'first' as PlanRole })) };
  const [textNote, setTextNote] = useState('');
  if (courses.length === 0) {
    return (
      <div>
        <h2 style={{ margin:'0 0 12px', fontSize:isMobile ? 26 : 30, fontWeight:700, letterSpacing:'-0.02em', lineHeight:1.2, color:'#000' }}>All saved (0)</h2>
        <p style={{ margin:'0 0 16px', fontSize:16, lineHeight:1.5, color:'#000', maxWidth:'62ch' }}>Nothing saved yet. Tap the bookmark on a class to save it.</p>
        <AppLink to="#/" style={linkBtnDark}>Browse</AppLink>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:16 }}>
        <div style={{ minWidth:0 }}>
          <h2 style={{ margin:0, fontSize:isMobile ? 26 : 30, fontWeight:700, letterSpacing:'-0.02em', lineHeight:1.2, color:'#000' }}>All saved ({courses.length})</h2>
          <div style={{ marginTop:8, fontFamily:'var(--font-sans)', fontSize:17, lineHeight:1.5, color:'#444' }}>{creditsText(courses.map(c => c.credits))}</div>
          {summaryLine(courses)}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <button onClick={async () => { const exp = planExport(all); const ok = await copyText(planAsText(all, exp.first, exp.backup, { url: semester.advisorBookingUrl }, { flat: true })); setTextNote(ok ? 'Copied. You can paste it into a message or a note.' : "Couldn't copy automatically. Opening the share window so you can select the text."); if (!ok) actions.share(all); }} style={btnLight}>Copy as text</button>
          <button onClick={() => actions.share(all)} style={btnLight}>Share or print</button>
        </div>
      </div>
      {textNote && <p role="status" style={{ margin:'0 0 8px', fontSize:16, lineHeight:1.5, color:'#000' }}>{textNote}</p>}
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${isMobile ? 2 : 4}, minmax(0, 1fr))`, gap:isMobile ? 14 : 20, alignItems:'stretch' }}>
        {courses.map(c => <SavedClassTile key={c.id} course={c} actions={actions} />)}
      </div>
    </div>
  );
}

function SavedPage({ savedIds, plans, planId, actions }: { savedIds: Set<string>; plans: Plan[]; planId?: string; actions: SavedActions }) {
  const isMobile = useWindowWidth() < 640;
  const savedCourses = COURSES.filter(c => savedIds.has(c.id));
  const plan = planId ? plans.find(p => p.id === planId) : undefined;
  useEffect(() => {
    if (plan) return;
    const onScroll = () => { savedOverviewY = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [!!plan]);
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.3 }}>
      {!plan && (
        // The heading, with the advisor banner on the same row at the right when there is room (otherwise under it, left-aligned).
        <div style={{ display:'flex', flexWrap:'wrap', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:isMobile ? 16 : 24 }}>
          <div style={{ minWidth:0 }}>
            <h1 style={{ fontSize:isMobile?32:40, fontWeight:700, letterSpacing:'-0.03em', color:'#000', margin:0, lineHeight:1.15 }}>Saved</h1>
              </div>
          {savedCourses.some(hasException) && <div style={isMobile ? { width:'100%' } : undefined}><AdvisorBanner layout={isMobile ? 'block' : 'inline'} /></div>}
        </div>
      )}
      {plan ? (
        <div id="classes" tabIndex={-1} style={{ outline:'none', scrollMarginTop:isMobile ? 16 : 80 }}>
          <PlanView key={plan.id} plan={plan} actions={actions} hasSaved={savedCourses.length > 0} />
        </div>
      ) : (
        <>
          <section aria-label="Plans" style={{ marginBottom:isMobile ? 32 : 48 }}>
            <h2 style={{ margin:'0 0 16px', fontSize:isMobile ? 26 : 30, fontWeight:700, letterSpacing:'-0.02em', lineHeight:1.2, color:'#000' }}>Plans</h2>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${isMobile ? 2 : 3}, minmax(0, 1fr))`, gap:isMobile ? 16 : 24, alignItems:'stretch' }}>
              {plans.map(p => <PlanFolder key={p.id} plan={p} actions={actions} />)}
              <NewPlanFolder onClick={actions.newPlan} />
            </div>
          </section>
          <div id="classes" tabIndex={-1} style={{ outline:'none', scrollMarginTop:isMobile ? 16 : 80 }}>
            <AllSavedView courses={savedCourses} actions={actions} />
          </div>
        </>
      )}
    </motion.div>
  );
}

// The header's one Saved control: a bookmark icon, the word "Saved" and a count badge. It is how people reach saved classes and plans.
function SavedNavItem({ count, active, onClick }: { count: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined} aria-label={count ? `Saved, ${count} saved` : 'Saved'}
      style={{ display:'flex', alignItems:'center', gap:8, height:TOPBAR_H, padding:0, whiteSpace:'nowrap', flexShrink:0, background:'none', border:0, borderBottom:`2px solid ${active ? '#000' : 'transparent'}`, boxSizing:'border-box', cursor:'pointer',
        fontFamily:'var(--font-sans)', fontSize:16, fontWeight:active ? 600 : 400, color:active ? '#000' : '#444' }}>
      <BookmarkIcon filled={active || count > 0} />
      <span aria-hidden="true">Saved</span>
      {count > 0 && <span aria-hidden="true" style={{ minWidth:22, height:22, padding:'0 6px', borderRadius:11, background:'#000', color:'#FFF', fontSize:12, fontWeight:700, lineHeight:1, display:'grid', placeItems:'center', boxSizing:'border-box' }}>{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

// Header button that opens the advisor booking page in a new tab. The booking page opened without asking
// for a CU sign-in when checked, so there is no login note in its description.
function AdvisorButton() {
  return (
    <a href={semester.advisorBookingUrl} target="_blank" rel="noopener noreferrer" aria-label="Meet an advisor: book an appointment, opens in a new tab" className="external-action"
      style={{ ...externalAction, padding:'0 14px', fontWeight:600, whiteSpace:'nowrap', flexShrink:0 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>
      <span aria-hidden="true">{semester.advisorHeaderLabel}</span>
      <ExternalIcon size={16} />
    </a>
  );
}

// A round icon button with a visible text label under it (the button keeps its own accessible name).
function IconWithLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, width:52, flexShrink:0 }}>
      {children}
      <span aria-hidden="true" style={{ fontSize:14, lineHeight:1.2, color:'#000' }}>{label}</span>
    </div>
  );
}

// The round Calendar button: opens the static calendar page (#/calendar).
function CalendarIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/></svg>;
}

function CalendarButton({ glass = false }: { glass?: boolean }) {
  return (
    <AppLink to="#/calendar" aria-label="Calendar" className={glass ? 'glass' : undefined}
      style={{ width:44, height:44, padding:0, borderRadius:'50%', display:'grid', placeItems:'center', flexShrink:0, textDecoration:'none',
        ...(glass ? { color:'#FFF' } : { border:'1px solid #000', background:'#FFF', color:'#000' }) }}>
      <CalendarIcon />
    </AppLink>
  );
}

// ─── Project tile ─────────────────────────────────────────────────────────────
function ProjectTile({ project, isSelected, onOpen }: { project:Project; isSelected:boolean; onOpen:()=>void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div layoutId={`ptile-${project.id}`} onClick={onOpen} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{ aspectRatio:'1/1', background:'#EDEDED', borderRadius:8, overflow:'hidden', position:'relative', cursor:'pointer', opacity:isSelected?0:1, transform:hovered&&!isSelected?'scale(1.06)':'scale(1)', boxShadow:hovered&&!isSelected?'0 12px 40px rgba(0,0,0,0.12)':'0 0 0 transparent', transition:'transform 0.45s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.35s ease, opacity 0.15s ease' }}>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}><ImagePlaceholder size={28} /></div>
      <motion.div animate={{ opacity:hovered&&!isSelected?1:0 }} transition={{ duration:0.22 }} style={{ position:'absolute', bottom:0, left:0, right:0, background:'linear-gradient(to top, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0) 100%)', padding:'28px 12px 12px', pointerEvents:'none' }}>
        <div style={{ fontSize:20, fontWeight:600, color:'#000', lineHeight:1.3 }}>{project.title}</div>
        <div style={{ fontSize:16, color:'#444', marginTop:4, lineHeight:1.5 }}>{project.student}</div>
      </motion.div>
    </motion.div>
  );
}

// ─── Project overlay ──────────────────────────────────────────────────────────
function ProjectOverlay({ project, courseCode, archiveYear, onClose }: { project:Project; courseCode:string; archiveYear:ArchiveYear; onClose:()=>void }) {
  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.3 }} onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.38)', backdropFilter:'blur(6px)', WebkitBackdropFilter:'blur(6px)', zIndex:600 }} />
      <motion.div layoutId={`ptile-${project.id}`} transition={{ duration:0.5, ease:EASE }} style={{ position:'fixed', top:'5vh', left:'8vw', width:'84vw', height:'90vh', background:'#FFF', borderRadius:16, zIndex:601, overflow:'hidden', display:'flex' }}>
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ delay:0.3, duration:0.3 }} style={{ display:'flex', width:'100%', height:'100%' }}>
          <div style={{ width:200, flexShrink:0, padding:'40px 28px', borderRight:'1px solid #F0F0F0', display:'flex', flexDirection:'column', gap:18 }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:'#EDEDED', flexShrink:0 }} />
            <div style={{ fontSize:16, fontWeight:500, color:'#000', lineHeight:1.5 }}>{project.student}</div>
            <div style={{ display:'flex', gap:16 }}>
              <button style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'#444', display:'flex' }} aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></button>
              <button style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'#444', display:'flex' }} aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg></button>
            </div>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'40px 48px 48px' }}>
            <div style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#444', letterSpacing:'0.05em', marginBottom:32 }}>{project.title}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:16, marginBottom:40 }}>
              {[0,1,2,3].map(i=><div key={i} style={{ background:'#EDEDED', aspectRatio:'4/3', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}><ImagePlaceholder /></div>)}
            </div>
            <p style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#000', lineHeight:1.6, margin:'0 0 20px', maxWidth:'52em' }}>{project.description}</p>
            <div style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#444', letterSpacing:'0.04em' }}>{courseCode} · Spring {archiveYear}</div>
          </div>
          <button onClick={onClose} aria-label="Close project" style={{ position:'absolute', top:20, right:20, background:'none', border:'none', width:44, height:44, padding:0, cursor:'pointer', color:'#000', opacity:1, display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity 0.15s ease' }} onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='0.4'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </motion.div>
      </motion.div>
    </>
  );
}

// ─── Student project archive ──────────────────────────────────────────────────
function ProjectArchive({ courseCode }: { courseCode:string }) {
  const byYear = PROJECTS[courseCode] ?? {};
  const years = ARCHIVE_YEARS.filter(y => (byYear[y]?.length ?? 0) > 0);
  const [year, setYear] = useState<ArchiveYear>(years[years.length - 1] ?? 2026);
  const [yearDir, setYearDir] = useState(0);
  const [selectedProject, setSelectedProject] = useState<Project|null>(null);

  function changeYear(dir: number) {
    const idx = years.indexOf(year);
    const next = years[idx + dir];
    if (!next) return;
    setYearDir(dir); setYear(next); setSelectedProject(null);
  }
  const yearIdx = years.indexOf(year);
  if (years.length === 0) return null;

  return (
    <div style={{ marginTop:96, paddingTop:64, borderTop:'1px solid #F0F0F0' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, marginBottom:64 }}>
        <h2 style={{ fontFamily:'var(--font-sans)', fontSize:16, fontWeight:400, margin:0, color:'#444', letterSpacing:'0.08em', textTransform:'uppercase' }}>Student Project Archive</h2>
        <div style={{ display:'flex', alignItems:'center', gap:20 }}>
          <button onClick={()=>changeYear(-1)} disabled={yearIdx===0} style={{ background:'none', border:'none', padding:0, minWidth:44, minHeight:44, justifyContent:'center', cursor:yearIdx===0?'default':'pointer', color:'#000', opacity:yearIdx===0?0.3:1, transition:'opacity 0.15s ease', display:'flex', alignItems:'center' }} aria-label="Previous year">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={year} initial={{ opacity:0, y:yearDir*6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:yearDir*-6 }} transition={{ duration:0.5, ease:EASE }} style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#000', minWidth:48, textAlign:'center' }}>{year}</motion.div>
          </AnimatePresence>
          <button onClick={()=>changeYear(1)} disabled={yearIdx===years.length-1} style={{ background:'none', border:'none', padding:0, minWidth:44, minHeight:44, justifyContent:'center', cursor:yearIdx===years.length-1?'default':'pointer', color:'#000', opacity:yearIdx===years.length-1?0.3:1, transition:'opacity 0.15s ease', display:'flex', alignItems:'center' }} aria-label="Next year">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={year} initial={{ opacity:0, y:yearDir*12 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:yearDir*-12 }} transition={{ duration:0.5, ease:EASE }} style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,280px))', gap:48, justifyContent:'center' }}>
          {(byYear[year] ?? []).map(project=>(
            <ProjectTile key={project.id} project={project} isSelected={selectedProject?.id===project.id} onOpen={()=>setSelectedProject(project)} />
          ))}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>
        {selectedProject && <ProjectOverlay key={selectedProject.id} project={selectedProject} courseCode={courseCode} archiveYear={year} onClose={()=>setSelectedProject(null)} />}
      </AnimatePresence>
    </div>
  );
}

// The "Class times" card on a class page: days, times and dates only, for the semesters the class runs in. A term other than the
// running one carries "Based on <term>. <next term> times aren't posted yet." so it is never read as next term's schedule.
// Identical sections (same days, time and dates) show once. Over 3 lines, the rest sit behind "Show all".
const DAY_NAMES: Record<string, string> = { M:'Mon', T:'Tue', W:'Wed', R:'Thu', F:'Fri', S:'Sat', U:'Sun' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return { text: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, pm: h >= 12 }; };
function timeRange(start: string, end: string) {
  const a = clock(start), b = clock(end);
  return a.pm === b.pm ? `${a.text} to ${b.text} ${b.pm ? 'PM' : 'AM'}` : `${a.text} ${a.pm ? 'PM' : 'AM'} to ${b.text} ${b.pm ? 'PM' : 'AM'}`;
}
function dateRange(v: string) {
  const m = v.match(/^(\d\d)-(\d\d) to (\d\d)-(\d\d)$/);
  return m ? `${MONTHS[+m[1] - 1]} ${+m[2]} to ${MONTHS[+m[3] - 1]} ${+m[4]}` : v;
}
const sectionTopic = (s: ClassSection) => (s.title.split(':').pop() ?? '').trim();
function sectionLine(s: ClassSection) {
  if (s.variesBySection) return 'Varies by section';
  if (s.online) return 'Online, no set time';
  if (!s.days || !s.start || !s.end) return s.meets || 'No set time'; // e.g. "No Time Assigned", as posted
  return `${s.days.split('').map(d => DAY_NAMES[d] ?? d).join('/')} ${timeRange(s.start, s.end)}`;
}
function ClassTimes({ course }: { course: Course }) {
  const headingId = useId();
  const byTerm = course.sectionsByTerm ?? {};
  // Only the upcoming terms (past terms are history and stay out of this card), and every section of each one.
  const terms = upcomingTerms(course.termsOffered, TERM_CONTEXT);
  const hideInstructors = !showInstructors(course);
  const labelled = terms.length > 1; // a heading only when the class is offered in more than one upcoming term
  const small: React.CSSProperties = { fontSize: 14, lineHeight: 1.4, color: '#444', overflowWrap: 'anywhere' };
  return (
    <section aria-labelledby={headingId} style={{ boxSizing:'border-box', width:'100%', padding:'14px 16px', background:'#F3F3F5', borderRadius:16, color:'#000' }}>
      <h2 id={headingId} style={{ margin:0, fontFamily:'var(--font-sans)', fontSize:16, fontWeight:700, lineHeight:1.3 }}>Class times</h2>
      <div style={{ marginTop: 6 }}><TrustLine course={course} align="start" /></div>
      {terms.length === 0 && <p style={{ margin:'8px 0 0', fontSize:16, lineHeight:1.5 }}>{availabilityOf(course).full}</p>}
      {terms.map(term => {
        const sections = [...(byTerm[term] ?? [])].sort((a, b) => a.section.localeCompare(b.section));
        return (
          <div key={term} style={{ marginTop:10 }}>
            {labelled && <div style={{ fontSize:14, lineHeight:1.4, fontWeight:600 }}>{term.split(' ')[0]}</div>}
            {sections.length === 0 ? (
              <p style={{ margin:labelled ? '4px 0 0' : '-4px 0 0', fontSize:16, lineHeight:1.5 }}>Times not posted yet</p>
            ) : (
              <ul style={{ listStyle:'none', margin:'4px 0 0', padding:0, display:'flex', flexDirection:'column', gap:12 }}>
                {sections.map(s => (
                  <li key={`${s.section}-${s.classNumber}`} style={{ minWidth:0 }}>
                    <div style={small}>{[`Section ${s.section}`, s.type, s.title && s.title !== course.title ? s.title : ''].filter(Boolean).join(' · ')}</div>
                    <div style={{ fontSize:16, lineHeight:1.4, fontWeight:600 }}>{sectionLine(s)}</div>
                    {s.dates && <div style={small}>{dateRange(s.dates)}</div>}
                    {(s.room || s.mode) && <div style={small}>{[s.room, s.mode].filter(Boolean).join(' · ')}</div>}
                    {!hideInstructors && s.instructor && <div style={small}>{s.instructor}</div>}
                    {s.notes && <div style={small}>{s.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

// The primary next step for a class: opens CU class search for it in a new tab.
function ClassSearchButton({ course, wide = false }: { course: Course; wide?: boolean }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:wide ? 'stretch' : 'flex-start', gap:6 }}>
      <ExternalAction href={classSearchLink(course)} sr={`for ${course.code} (opens in a new tab)`} style={wide ? { minHeight:52, justifyContent:'center', width:'100%', boxSizing:'border-box' } : undefined}>Search this class in CU class search</ExternalAction>
      <span style={{ fontSize:14, lineHeight:1.4, color:'#444' }}>Opens CU class search in a new tab</span>
    </div>
  );
}

// Contact-advisor card: one button to the advisor's booking page (address and label live in semester.ts).

// The class page's meta line: "ATLS 3110", then "· Special topic" and/or the credits when they apply, then one icon per focus area (in its
// color, named for screen readers, with a tooltip) and the season icons with their words. The season group is the page's only
// availability signal: a leaf for each Fall, a blossom for each Spring, or the dash with "Not offered recently".
function AreaIconButton({ id, area }: { id: string; area: string }) {
  const { openId, setOpenId } = useContext(TagTooltipContext);
  const open = openId === id;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const icon = AREA_ICONS[area];
  if (!icon) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button ref={ref} type="button" className="tag-pill" title={area} aria-label={area} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setRect(ref.current?.getBoundingClientRect() ?? null); setOpenId(open ? null : id); }}
        style={{ ['--tag-line' as string]: accentFor(area), minWidth: 44, height: 44, padding: 0, border: 0, borderRadius: 12, background: 'none', display: 'inline-grid', placeItems: 'center', cursor: 'pointer', color: accentFor(area) }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icon}</svg>
      </button>
      {open && (
        <AnchoredPopover rect={rect} ariaLabel={area} width={240} onClose={() => setOpenId(null)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#000' }}>{area}</p>
            <button onClick={() => setOpenId(null)} aria-label="Close" style={{ width: 44, height: 44, minWidth: 44, flexShrink: 0, margin: '-10px -10px -10px 0', background: 'none', border: 0, color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </AnchoredPopover>
      )}
    </span>
  );
}

function ClassMeta({ course }: { course: Course }) {
  const code = useDisplayCode()(course);
  const areas = areasOf(course);
  const extras = [course.specialTopic ? 'Special topic' : '', course.credits.trim() ? creditsLabel(course.credits) : ''].filter(Boolean);
  return (
    <div data-meta style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, margin: 0, fontFamily: 'var(--font-sans)', fontSize: 16, lineHeight: 1.5, color: '#444' }}>
      <span style={{ marginRight: 6 }}>{[code, ...extras].join(' · ')}</span>
      {areas.map(a => <AreaIconButton key={a} id={`${course.id}:area:${a}`} area={a} />)}
      <span data-seasons style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <SeasonMarks course={course} />
      </span>
    </div>
  );
}

// "Taught by Danny Rankin": plain text, with an inline underlined link (and a small external icon) for each instructor who has
// a People page. Left out when the class has no instructor.
function TaughtBy({ course }: { course: Course }) {
  if (!showInstructors(course)) return null; // independent study: the instructors are never listed
  // The names come from the upcoming term. A name links to the person's People page when we have it (matched on last name and first initial).
  const names = upcomingInstructors(course, TERM_CONTEXT).split(', ').map(n => n.trim()).filter(Boolean);
  const people = names.length
    ? names.map(n => {
        const parts = n.split(' ');
        const bio = course.instructors.find(b => { const bp = b.name.split(' '); return bp[bp.length - 1].toLowerCase() === parts[parts.length - 1].toLowerCase() && bp[0][0]?.toLowerCase() === parts[0][0]?.toLowerCase(); });
        return { name: bio?.name ?? n, url: bio?.url ?? '' };
      })
    : course.instructors.length ? course.instructors : course.instructor ? [{ name: course.instructor, url: '' }] : [];
  if (!people.length) return null;
  return (
    <p data-instructors style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#000' }}>
      Taught by{' '}
      {people.map((person, i) => (
        <Fragment key={person.name}>
          {i > 0 && ', '}
          {person.url ? (
            <a href={person.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, padding: '11px 0', color: '#000', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {person.name}<span className="sr-only"> (opens in a new tab)</span><ExternalIcon size={14} />
            </a>
          ) : person.name}
        </Fragment>
      ))}
    </p>
  );
}

// A class has prerequisites to show when its required-prerequisites text is more than "None" (shown exactly as in the data).
const hasRequiredPrereq = (c: Course) => c.prereqRequired.trim() !== '' && !/^none( listed)?\.?$/i.test(c.prereqRequired.trim());

const stepBtn: React.CSSProperties = { minWidth:44, minHeight:44, padding:0, background:'none', border:0, color:UI.ink, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:22 };

// ─── Detail page ──────────────────────────────────────────────────────────────
interface DetailPageProps {
  course: Course; isSaved: boolean; onBookmark: (el: HTMLElement) => void;
  onBack: ()=>void;
  onAddToPlan: (e?: React.MouseEvent<HTMLElement>) => void;
  onStep: (dir: 1 | -1) => void;
  nav: React.ReactNode;
}

function DetailPage({ course, isSaved, onBookmark, onBack, onAddToPlan, onStep, nav }: DetailPageProps) {
  const photoSrc = course.photo ? photoUrl(course.photo) : '';
  const images = photoSrc ? [photoSrc] : course.image.split(/[\n|]/).map(u => u.trim()).filter(isHttpUrl);
  const reduceMotion = useReducedMotion();
  // How this page entered: 'zoom' (opened from a tile: the text rises in a short stagger), 'fade' (deep link or reload, or no View
  // Transitions: a 200ms fade-in), or 'slide'/'none' (the transition itself does the work).
  const [entrance] = useState(getEntrance);
  const order = MODE_ORDER[useMode()];
  const stepIndex = useMemo(() => order.findIndex(c => c.id === course.id), [order, course.id]);
  const stepCount = order.length;
  const [imgIdx, setImgIdx] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const accentColor = accentFor(course.category);
  const vw = useWindowWidth();
  const isMobile = vw < 640;
  const wide = vw >= 1024;
  const searchNote = searchTermNote(availabilityOf(course), TERM_CONTEXT);
  const topicNote = sharesNumber(course) ? `This number covers several topics. Look for ${course.title.split(':').pop()?.trim()} in the results.` : '';

  useEffect(() => {
    function handleScroll() { setScrolled(window.scrollY > 10); }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  function goImage(dir: number) { setImgIdx(i => Math.max(0, Math.min(images.length - 1, i + dir))); }
  // title and meta first, then the right rail, then the text: about 60ms apart, each rising 12px
  function S(i: number) { return entrance === 'zoom' && !reduceMotion ? { initial:{ opacity:0, y:12 }, animate:{ opacity:1, y:0, transition:{ duration:0.32, ease:EASE, delay:Math.min(i,2)*0.06 } } } : {}; }

  // Desktop (1024px and wider): the back/next bar, then the cover (60%) beside a 40% column with the save, search and advisor actions,
  // then the text (title, meta, instructors, description, prerequisites) underneath, left-aligned. Phones and tablets use the layout below.
  if (wide) {
    const coverLabel = images.length === 0 ? 'Illustration' : photoSrc && course.photoCredit ? course.photoCredit : '';
    return (
      <motion.div data-class-page initial={entrance === 'fade' && !reduceMotion ? { opacity:0, scale:0.985 } : false} animate={{ opacity:1, scale:1, transition:{ duration:0.2, ease:'easeOut' } }}>
        <div style={{ maxWidth:1200, margin:'0 auto' }}>
          <div style={{ position:'sticky', top:TOPBAR_H, zIndex:50, background:'#FFF', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0', marginBottom:16, boxShadow:scrolled?'0 1px 0 rgba(0,0,0,0.06)':'none', transition:'box-shadow 0.25s ease' }}>
            <BackButton label="Back" ariaLabel="Back" onClick={onBack} />
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button onClick={() => onStep(-1)} disabled={stepIndex <= 0} aria-label="Previous class" style={{ ...stepBtn, opacity: stepIndex <= 0 ? 0.35 : 1 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <button onClick={() => onStep(1)} disabled={stepIndex < 0 || stepIndex >= stepCount - 1} aria-label="Next class" style={{ ...stepBtn, opacity: stepIndex >= stepCount - 1 ? 0.35 : 1 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'calc((100% - 40px) * 0.6) calc((100% - 40px) * 0.4)', columnGap:40, alignItems:'start' }}>
            <div style={{ minWidth:0 }}>
              <div data-cover style={{ position:'relative', aspectRatio:'4 / 3', borderRadius:28, overflow:'hidden', background:'#E4E4E8' }}>
                {images.length > 0
                  ? <FadeImg key={images[imgIdx]} src={images[imgIdx]} alt={photoSrc ? course.photoAlt : `${course.title}, image ${imgIdx + 1} of ${images.length}`} />
                  : <Cover course={course} />}
                {coverLabel && <span style={{ position:'absolute', right:12, bottom:12, padding:'3px 10px', borderRadius:100, background:'rgba(255,255,255,0.88)', color:'#000', fontSize:13, lineHeight:1.4, fontWeight:600 }}>{coverLabel}</span>}
              </div>
              {images.length > 1 && (
                <div style={{ display:'flex', alignItems:'center', gap:16, marginTop:14 }}>
                  <button onClick={()=>goImage(-1)} disabled={imgIdx===0} aria-label="Previous image" style={{ background:'none', border:'none', padding:0, minWidth:44, minHeight:44, display:'flex', alignItems:'center', justifyContent:'center', cursor:imgIdx===0?'default':'pointer', opacity:imgIdx===0?0.3:1 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"/></svg></button>
                  <span style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#444' }}>{imgIdx+1} / {images.length}</span>
                  <button onClick={()=>goImage(1)} disabled={imgIdx===images.length-1} aria-label="Next image" style={{ background:'none', border:'none', padding:0, minWidth:44, minHeight:44, display:'flex', alignItems:'center', justifyContent:'center', cursor:imgIdx===images.length-1?'default':'pointer', opacity:imgIdx===images.length-1?0.3:1 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9 18l6-6-6-6"/></svg></button>
                </div>
              )}
            </div>
            <aside data-rail aria-label="Save and look this class up" style={{ display:'flex', flexDirection:'column', gap:16, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <SaveButton isSaved={isSaved} onPress={onBookmark} />
                {isSaved && <button onClick={e => onAddToPlan(e)} style={{ ...filledButton, padding:'0 18px' }}>Add to plan</button>}
              </div>
              <ClassTimes course={course} />
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <ClassSearchButton course={course} wide />
                {topicNote && <p style={{ margin:0, fontSize:14, lineHeight:1.4, color:'#444' }}>{topicNote}</p>}
                {course.notOfferedRecently && <p role="note" style={{ margin:0, fontSize:16, lineHeight:1.5, color:'#000', fontWeight:500 }}>Ask your academic advisor whether it will run.</p>}
              </div>
              <AdvisorBanner layout="row" showText note={hasException(course) ? semester.advisorCardClassNote : ''} />
            </aside>
          </div>

          <div style={{ maxWidth:720, marginTop:32, display:'flex', flexDirection:'column', gap:24 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <motion.div {...S(0)}>
                <h1 tabIndex={-1} style={{ fontFamily:'var(--font-sans)', fontSize:44, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.15, color:'#000', margin:0, outline:'none' }}>{course.title}</h1>
              </motion.div>
              <motion.div {...S(0)}><ClassMeta course={course} /></motion.div>
              <TaughtBy course={course} />
            </div>
            {course.description && <motion.div {...S(2)}><p style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#000', lineHeight:1.6, margin:0, maxWidth:'58ch' }}>{course.description}</p></motion.div>}
            {hasRequiredPrereq(course) && (
              <p style={{ margin:0, maxWidth:'58ch', fontSize:16, lineHeight:1.5, color:'#000', fontFamily:'var(--font-sans)' }}>
                <span style={{ fontWeight:400, color:'#595959' }}>Prerequisites:</span> <span style={{ fontWeight:500 }}>{course.prereqRequired.trim()}</span>
              </p>
            )}
            {/Critical Perspectives/.test(course.countsToward) && <p style={{ margin:0, fontSize:16, lineHeight:1.5, color:'#000' }}>Also counts toward Critical Perspectives</p>}
            {course.advisorConfirmation && (
              <p style={{ margin:0, maxWidth:'58ch', fontSize:16, lineHeight:1.5, color:'#000' }}>
                Confirmed as a Focus Elective by the {course.advisorConfirmation.by} on {formatDate(course.advisorConfirmation.date)}.{course.advisorConfirmation.auditMayNotListIt ? ' The degree audit may not list it yet.' : ''}
              </p>
            )}
          </div>
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1, transition:{ delay:0.55, duration:0.5 } }}>
            <ProjectArchive courseCode={course.code} />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div data-class-page initial={entrance === 'fade' && !reduceMotion ? { opacity:0, scale:0.985 } : false} animate={{ opacity:1, scale:1, transition:{ duration:0.2, ease:'easeOut' } }}>
      {/* Sticky action bar */}
      <div style={{ position:'sticky', top:isMobile?0:TOPBAR_H, zIndex:50, background:'#FFF', display:'flex', alignItems:'center', justifyContent:'space-between', padding:isMobile ? 'calc(8px + env(safe-area-inset-top, 0px)) 0 8px' : '14px 0', marginBottom:isMobile ? 16 : 32, boxShadow:scrolled?'0 1px 0 rgba(0,0,0,0.06)':'none', transition:'box-shadow 0.25s ease' }}>
        <BackButton label="Back" ariaLabel="Back" onClick={onBack} />
        <div style={{ display:'flex', alignItems:'center', gap:isMobile ? 12 : 24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <button onClick={() => onStep(-1)} disabled={stepIndex <= 0} aria-label="Previous class" style={{ ...stepBtn, opacity: stepIndex <= 0 ? 0.35 : 1 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button onClick={() => onStep(1)} disabled={stepIndex < 0 || stepIndex >= stepCount - 1} aria-label="Next class" style={{ ...stepBtn, opacity: stepIndex >= stepCount - 1 ? 0.35 : 1 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <SaveButton isSaved={isSaved} onPress={onBookmark} />
          {nav}
        </div>
      </div>

      {/* One template for every class: a hero (the illustrated cover, or the real photo when there is one), then an intro column
          (title, meta, instructors), a body column (description and details) and a right rail with the class search button and,
          for classes with an exception, the advisor card. On phones the rail sits between the intro and the body. */}
      <div style={{ margin: isMobile ? '0 0 20px' : '0 0 28px', maxWidth: 960 }}>
        <div data-cover style={{ aspectRatio: images.length ? (isMobile ? '4 / 3' : '16 / 9') : (isMobile ? '2 / 1' : '3 / 1'), borderRadius: 16, overflow: 'hidden', background: '#E4E4E8' }}>
          {images.length > 0
            ? <FadeImg key={images[imgIdx]} src={images[imgIdx]} alt={photoSrc ? course.photoAlt : `${course.title}, image ${imgIdx + 1} of ${images.length}`} />
            : <Cover course={course} />}
        </div>
        {images.length === 0 && <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.4, color: '#444' }}>Illustration. Real class photos are coming.</p>}
        {photoSrc && course.photoCredit && <p style={{ margin:'8px 0 0', fontSize:14, lineHeight:1.4, color:'#444' }}>{course.photoCredit}</p>}
          {images.length > 1 && (
            <div style={{ display:'flex', alignItems:'center', gap:16, marginTop:14 }}>
              <button onClick={()=>goImage(-1)} disabled={imgIdx===0} aria-label="Previous image" style={{ background:'none', border:'none', padding:0, minWidth:44, minHeight:44, display:'flex', alignItems:'center', justifyContent:'center', cursor:imgIdx===0?'default':'pointer', color:'#000', opacity:imgIdx===0?0.3:1 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
              <span style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#444' }}>{imgIdx+1} / {images.length}</span>
              <button onClick={()=>goImage(1)} disabled={imgIdx===images.length-1} aria-label="Next image" style={{ background:'none', border:'none', padding:0, minWidth:44, minHeight:44, display:'flex', alignItems:'center', justifyContent:'center', cursor:imgIdx===images.length-1?'default':'pointer', color:'#000', opacity:imgIdx===images.length-1?0.3:1 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
            </div>
          )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) 360px' : 'minmax(0, 1fr)', gridTemplateAreas: wide ? '"intro rail" "body rail"' : '"intro" "rail" "body"', gridTemplateRows: wide ? 'auto 1fr' : undefined, columnGap:64, rowGap:24, alignItems:'start' }}>
        <div style={{ gridArea:'intro', display:'flex', flexDirection:'column', gap:8, paddingTop:4, minWidth:0 }}>
          {isSaved && (
            <div role="status" style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:4, margin:'0 0 -8px', fontSize:16, lineHeight:1.5, color:'#000' }}>
              <span>Saved ✓</span>
              <button onClick={e => onAddToPlan(e)} style={{ ...filledButton, padding:'0 18px', marginLeft:6 }}>Add to plan</button>
            </div>
          )}
          <motion.div {...S(0)}>
            <h1 tabIndex={-1} style={{ fontFamily:'var(--font-sans)', fontSize:isMobile?32:40, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.15, color:'#000', margin:0, outline:'none' }}>{course.title}</h1>
          </motion.div>
          <motion.div {...S(0)}><ClassMeta course={course} /></motion.div>
          <TaughtBy course={course} />
        </div>

        <motion.aside {...S(1)} data-rail aria-label="Look this class up" style={{ gridArea:'rail', display:'flex', flexDirection:'column', gap:16, minWidth:0, ...(wide ? { position:'sticky', top:TOPBAR_H + 88 } : {}) }}>
          <ClassTimes course={course} />
          {semester.showAvailabilityNotes && showsAvailability(course) && <div style={{ display:'flex' }}><AvailabilityPill course={course} full /></div>}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <ClassSearchButton course={course} />
            {semester.showAvailabilityNotes && searchNote && <p style={{ margin:0, fontSize:14, lineHeight:1.4, color:'#444' }}>{searchNote}</p>}
            {topicNote && <p style={{ margin:0, fontSize:14, lineHeight:1.4, color:'#444' }}>{topicNote}</p>}
            {course.notOfferedRecently && (
              <p role="note" style={{ margin:0, fontSize:16, lineHeight:1.5, color:'#000', fontWeight:500 }}>
                Ask your academic advisor whether it will run.
              </p>
            )}
          </div>
          <AdvisorBanner layout={isMobile ? 'stacked' : 'row'} showText note={hasException(course) ? semester.advisorCardClassNote : ''} />
        </motion.aside>

        <div style={{ gridArea:'body', display:'flex', flexDirection:'column', gap:24, minWidth:0 }}>
          {course.description && <motion.div {...S(2)}><p style={{ fontFamily:'var(--font-sans)', fontSize:16, color:'#000', lineHeight:1.6, margin:0, maxWidth:'58ch' }}>{course.description}</p></motion.div>}
          {hasRequiredPrereq(course) && (
            <p style={{ margin:0, maxWidth:'58ch', fontSize:16, lineHeight:1.5, color:'#000', fontFamily:'var(--font-sans)' }}>
              <span style={{ fontWeight:400, color:'#595959' }}>Prerequisites:</span> <span style={{ fontWeight:500 }}>{course.prereqRequired.trim()}</span>
            </p>
          )}
          {/Critical Perspectives/.test(course.countsToward) && (
            <p style={{ margin:0, fontSize:16, lineHeight:1.5, color:'#000' }}>Also counts toward Critical Perspectives</p>
          )}
          {course.advisorConfirmation && (
            <p style={{ margin:0, maxWidth:'58ch', fontSize:16, lineHeight:1.5, color:'#000' }}>
              Confirmed as a Focus Elective by the {course.advisorConfirmation.by} on {formatDate(course.advisorConfirmation.date)}.{course.advisorConfirmation.auditMayNotListIt ? ' The degree audit may not list it yet.' : ''}
            </p>
          )}
        </div>
      </div>

      <motion.div initial={{ opacity:0 }} animate={{ opacity:1, transition:{ delay:0.55, duration:0.5 } }}>
        <ProjectArchive courseCode={course.code} />
      </motion.div>
    </motion.div>
  );
}

// ─── Help panel ───────────────────────────────────────────────────────────────
function HelpPanel({ onClose }: { onClose:()=>void }) {
  return (
    <motion.div key="help-panel" initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }} transition={{ duration:0.6, ease:[0.16,1,0.3,1] }}
      style={{ position:'fixed', top:0, right:0, width:'35%', height:'100vh', background:'rgba(247,241,234,0.75)', backdropFilter:'blur(30px)', WebkitBackdropFilter:'blur(30px)', zIndex:100, display:'flex', flexDirection:'column', padding:'40px 40px 40px', overflow:'hidden', boxShadow:'-40px 0 80px rgba(0,0,0,0.07)' }}>
      <div aria-hidden style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:'8%', left:'10%', width:340, height:340, borderRadius:'50%', background:'#F2C94C', filter:'blur(90px)', animation:'glow-drift-1 8s ease-in-out infinite', opacity:0.20 }} />
        <div style={{ position:'absolute', top:'42%', right:'-10%', width:300, height:300, borderRadius:'50%', background:'#D93F7A', filter:'blur(90px)', animation:'glow-drift-2 10s ease-in-out infinite', opacity:0.13 }} />
        <div style={{ position:'absolute', bottom:'8%', left:'25%', width:260, height:260, borderRadius:'50%', background:'#E06C3A', filter:'blur(80px)', animation:'glow-drift-3 9s ease-in-out infinite', opacity:0.12 }} />
      </div>
      <div style={{ position:'relative', zIndex:1, display:'flex', flexDirection:'column', height:'100%' }}>
        <button onClick={onClose} aria-label="Close help panel" style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', width:24, height:24, marginBottom:32, opacity:0.45, transition:'opacity 0.15s ease' }} onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='0.45'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <h2 style={{ fontFamily:'var(--font-sans)', fontSize:20, fontWeight:500, letterSpacing:'-0.02em', color:'#000', margin:0, lineHeight:1.3, marginBottom:32 }}>Need help finding an elective?</h2>
        <div style={{ flex:1, overflowY:'auto' }} />
      </div>
    </motion.div>
  );
}

// ─── Home button (top-left, all pages except Detail) ─────────────────────────
function HomeButton({ active, onClick }: { active: boolean; onClick?: ()=>void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:48 }}
      onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}>
      {/* Hover bg */}
      <div style={{ position:'absolute', inset:-8, borderRadius:12, background:'#EDEDED', opacity:hovered && !active ? 1 : 0, transition:'opacity 0.18s ease', pointerEvents:'none' }} />
      {/* Active outline */}
      {active && <div style={{ position:'absolute', inset:-6, borderRadius:10, border:'1.5px solid #000', pointerEvents:'none' }} />}
      <button
        onClick={active ? undefined : onClick}
        aria-label="Home" aria-current={active ? 'page' : undefined}
        style={{ background:'none', border:'none', padding:0, cursor:active?'default':'pointer', color:'#000',
          transform: hovered && !active ? 'scale(1.2)' : 'scale(1)',
          transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          display:'flex', alignItems:'center', justifyContent:'center', position:'relative', zIndex:1 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
          {/* Filled house */}
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          {/* Smile arc cut-in (window arch) */}
          <path d="M10.5 15 Q12 13 13.5 15" stroke="#FFF" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
        </svg>
      </button>
      {/* Tooltip */}
      {hovered && !active && (
        <div style={{ position:'absolute', top:'calc(100% + 7px)', left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.78)', color:'#FFF', fontSize:16, padding:'4px 8px', borderRadius:5, whiteSpace:'nowrap', pointerEvents:'none', fontFamily:'var(--font-sans)', letterSpacing:'0.01em', zIndex:10 }}>
          Home
        </div>
      )}
    </div>
  );
}

// ─── Top-right nav icon (with tooltip + hover pop) ────────────────────────────
function NavIcon({ children, tooltip, onClick, active }: { children:React.ReactNode; tooltip:string; onClick?:()=>void; active?:boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
      <button
        onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onClick={onClick}
        aria-label={tooltip} aria-pressed={active}
        style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'#000', opacity:active ? 0.35 : 1, transform:hovered ? 'scale(1.2)' : 'scale(1)', transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease', display:'flex', alignItems:'center', justifyContent:'center' }}
      >
        {children}
      </button>
      {hovered && (
        <div style={{ position:'absolute', top:'calc(100% + 7px)', left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.78)', color:'#FFF', fontSize:16, padding:'4px 8px', borderRadius:5, whiteSpace:'nowrap', pointerEvents:'none', fontFamily:'var(--font-sans)', letterSpacing:'0.01em', zIndex:10 }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ─── "Your Classes" text nav link ────────────────────────────────────────────
function YourClassesLink({ active, onClick }: { active: boolean; onClick: ()=>void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onClick={onClick}
      style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontFamily:'var(--font-sans)', fontSize:16, fontWeight:500, color:'#000', letterSpacing:'-0.01em',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
        transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        textDecoration:'none', display:'inline-flex', alignItems:'center', gap:0, flexDirection:'column', lineHeight:1 }}>
      <span>Your Classes</span>
      <span style={{ display:'block', height:1, background:'#000', width:'100%',
        opacity: active || hovered ? 1 : 0,
        transition:'opacity 0.18s ease',
        marginTop:2 }} />
    </button>
  );
}

// ─── Top-right nav cluster (? · Your Classes · avatar) ────────────────────────
interface TopRightNavProps {
  helpOpen: boolean; onToggleHelp: ()=>void;
  libraryOpen: boolean; onToggleLibrary: ()=>void;
  profileOpen: boolean; profileHovered: boolean;
  setProfileOpen: (fn:(v:boolean)=>boolean)=>void; setProfileHovered: (v:boolean)=>void;
}
function TopRightNav({ helpOpen, onToggleHelp, libraryOpen, onToggleLibrary, profileOpen, profileHovered, setProfileOpen, setProfileHovered }: TopRightNavProps) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:24, flexShrink:0 }}>
      <NavIcon tooltip="Help me choose" active={helpOpen} onClick={onToggleHelp}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/><path d="M9.5 9a3 3 0 0 1 5.5 1c0 2-3 3-3 3"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor"/>
        </svg>
      </NavIcon>
      <YourClassesLink active={libraryOpen} onClick={onToggleLibrary} />
      <ProfileAvatar open={profileOpen} hovered={profileHovered} setOpen={setProfileOpen} setHovered={setProfileHovered} />
    </div>
  );
}

// ─── Mobile class grid ────────────────────────────────────────────────────────

function MobileNavIcon({ type }: { type:'home'|'plus'|'search' }) {
  const common = { width:22, height:22, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true, focusable:false } as const;
  if (type === 'home') return <svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>;
  if (type === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
  if (type === 'search') return <svg {...common}><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>;
}

// True while a sheet or modal dialog is on screen (they are all portalled to <body>), so the bottom bar can step out of the way.
function useModalOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('body > [aria-modal="true"], body > * [aria-modal="true"]'));
    let raf = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(check); });
    mo.observe(document.body, { childList: true });
    check();
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return open;
}

type BarItem = 'browse' | 'calendar' | 'saved';
function BarIcon({ type, filled }: { type: BarItem; filled: boolean }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
  const f = filled ? 'currentColor' : 'none';
  if (type === 'browse') return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill={f} /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" fill={f} /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" fill={f} /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" fill={f} /></svg>;
  if (type === 'calendar') return <svg {...common}><rect x="3.5" y="5" width="17" height="15.5" rx="2" fill={f} /><path d="M8 3v4M16 3v4" /><path d="M3.5 10h17" stroke={filled ? '#FFF' : 'currentColor'} /></svg>;
  return <svg {...common}><path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1z" fill={f} /></svg>;
}

// The phone's primary navigation: a white bar docked to the bottom edge. The active item has a bolder label, a filled icon and a
// line above it. Page content ends above it (see --bar-h), and it steps aside while a sheet or dialog is open.
const BAR_H = 'calc(56px + env(safe-area-inset-bottom, 0px))';
function MobileBottomNav({ active, savedCount, onBrowse, onCalendar, onSaved }: {
  active: BarItem | null; savedCount: number; onBrowse: () => void; onCalendar: () => void; onSaved: () => void;
}) {
  const hidden = useModalOpen();
  const item = (type: BarItem, label: string, onClick: () => void, badge = 0) => {
    const on = active === type;
    return (
      <button key={type} onClick={onClick} aria-current={on ? 'page' : undefined} aria-label={badge ? `${label}, ${badge} saved` : label}
        style={{ flex: '1 1 0', minWidth: 44, minHeight: 56, position: 'relative', border: 0, borderTop: `3px solid ${on ? '#000' : 'transparent'}`, background: 'none', padding: '5px 0 0', cursor: 'pointer',
          color: on ? '#000' : '#444', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.2, fontWeight: on ? 700 : 500 }}>
        <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
          <BarIcon type={type} filled={on} />
          {badge > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -6, right: -12, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#000', color: '#FFF', fontSize: 12, fontWeight: 700, lineHeight: '18px', textAlign: 'center', boxSizing: 'border-box' }}>{badge}</span>}
        </span>
        <span aria-hidden="true">{label}</span>
      </button>
    );
  };
  return (
    <nav aria-label="Primary" className="mobile-nav no-print" aria-hidden={hidden || undefined} style={{
      position: 'fixed', zIndex: 900, left: 0, right: 0, bottom: 0, boxSizing: 'border-box', height: BAR_H, paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      background: '#FFF', borderTop: '1px solid #D6D6D6', display: hidden ? 'none' : 'flex', alignItems: 'stretch',
    }}>
      {item('browse', 'Browse', onBrowse)}
      {semester.showCalendar && item('calendar', 'Calendar', onCalendar)}
      {item('saved', 'Saved', onSaved, savedCount)}
    </nav>
  );
}

function DesktopTopBar({ showSaved = true, homeActive, savedActive, savedCount, onHome, onSaved }: {
  showSaved?:boolean; homeActive:boolean; savedActive:boolean; savedCount:number; onHome:()=>void; onSaved:()=>void;
}) {
  const narrow = useWindowWidth() < 860;
  const item = (type:'home'|'plus', label:string, active:boolean, onClick:()=>void) => (
    <button onClick={onClick} aria-current={active?'page':undefined} style={{
      display:'flex', alignItems:'center', gap:8, height:TOPBAR_H, padding:0, whiteSpace:'nowrap', flexShrink:0, background:'none', border:0,
      borderBottom:`2px solid ${active?'#000':'transparent'}`, boxSizing:'border-box', cursor:'pointer',
      fontFamily:'var(--font-sans)', fontSize:16, fontWeight:active?600:400, color:active?'#000':'#444',
    }}><MobileNavIcon type={type} />{label}</button>
  );
  return (
    <header style={{ position:'fixed', top:0, left:0, right:0, zIndex:800, background:'#FFF', borderBottom:'1px solid #EBEBEB' }}>
      <div style={{ padding:`0 ${SPACING.pagePx}px` }}>
        <nav aria-label="Primary" style={{ height:TOPBAR_H, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          {item('home','Home',homeActive,onHome)}
          <div style={{ display:'flex', alignItems:'center', gap:narrow ? 14 : 32 }}>
            {semester.showCalendar && <CalendarButton />}
            {showSaved && <SavedNavItem count={savedCount} active={savedActive} onClick={onSaved} />}
            <AdvisorButton />
          </div>
        </nav>
      </div>
    </header>
  );
}

function MobileSheet({ onClose, label, panelRef, children }: { onClose:()=>void; label?: string; panelRef?: React.Ref<HTMLDivElement>; children:React.ReactNode }) {
  return createPortal(
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:2100, background:'rgba(0,0,0,0.28)', display:'flex', alignItems:'flex-end' }}
    >
      <motion.div
        ref={panelRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label={label}
        className="dialog-panel"
        initial={{ y:'100%' }} animate={{ y:0 }} exit={{ y:'100%' }}
        transition={{ duration:0.42, ease:EASE }}
        onClick={e=>e.stopPropagation()}
        style={{
          position:'relative', width:'100%', maxHeight:'82vh', overflowY:'auto', background:'#FFF', borderRadius:'22px 22px 0 0',
          padding:'10px 20px calc(22px + env(safe-area-inset-bottom, 0px))',
          boxShadow:'0 -10px 40px rgba(0,0,0,0.12)', outline:'none',
        }}
      >
        <div className="no-print" style={{ width:38, height:4, borderRadius:9, background:'#D6D6D6', margin:'0 auto 20px' }} />
        <button onClick={onClose} aria-label="Close" className="no-print"
          style={{ position:'absolute', top:14, right:10, width:44, height:44, background:'none', border:'none', color:'#000', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        {children}
      </motion.div>
    </motion.div>,
    document.body
  );
}

// ─── Saved data + class page URLs ─────────────────────────────────────────────
const COURSE_IDS = new Set(COURSES.map(c => c.id));
const COURSE_HASH = '#/class/';

function loadSaved(): SavedState {
  try {
    const { state, discard } = parseSaved(window.localStorage.getItem(STORAGE_KEY), COURSE_IDS);
    if (discard) window.localStorage.removeItem(STORAGE_KEY);
    return state;
  } catch {
    return { savedIds: [], plans: [] };
  }
}

type Route =
  | { name: 'home' }
  | { name: 'class'; course: Course }
  | { name: 'saved'; planId?: string }
  | { name: 'about' }
  | { name: 'calendar' }
  | { name: 'notfound'; kind: 'page' | 'class' };

const ACTIVE_PLAN_KEY = 'focus-electives:active-plan';

function parseRoute(): Route {
  const { pathname, hash } = window.location;
  const base = import.meta.env.BASE_URL;
  if (pathname !== base && pathname !== `${base}index.html`) return { name: 'notfound', kind: 'page' };
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    const [head, arg] = parts.map(decodeURIComponent);
    if (parts.length === 0) return { name: 'home' };
    if (head === 'class' && arg && parts.length === 2) {
      const course = COURSES_BY_ID.get(arg);
      return course ? { name: 'class', course } : { name: 'notfound', kind: 'class' };
    }
    // Plans live on the Saved page now: an old plan link opens Saved with that plan's tab, and #/plans opens Saved.
    if (head === 'plan' && arg && parts.length === 2) return { name: 'saved', planId: arg };
    if (head === 'plans' && parts.length === 1) return { name: 'saved' };
    if (head === 'saved' && parts.length === 1) return { name: 'saved' };
    if (head === 'about' && parts.length === 1) return { name: 'about' };
    if (head === 'calendar' && parts.length === 1) return semester.showCalendar ? { name: 'calendar' } : { name: 'saved' };
    // Older links to the profile page
    if (head === 'profile' && parts.length === 1) return { name: 'saved' };
    if (head === 'profile' && parts.length === 2 && (arg === 'saved' || arg === 'plans')) return { name: 'saved' };
  } catch { /* a badly written address is just a page we don't have */ }
  return { name: 'notfound', kind: 'page' };
}

const ABOUT_TEXT = [
  "ATLAS has more than 40 focus electives. Game design. Fabrication. Sound. AR/VR. Branding. AI. Accessibility.",
  "That's a lot of opportunity. But too many students never see it, because the information is scattered, outdated or contradictory.",
  "Picking your classes shouldn't depend on who you know or how many tabs you can keep open. Every student deserves to see every option, understand what it means for their degree, and plan with confidence.",
  "This is about the student experience. It should feel simple. It should feel honest. And it should feel like it was made for you.",
  "That's what this guide is for.",
  "Saved classes and plans are kept on this device only. Clearing your browser or switching devices will remove them.",
  "Always confirm with CU class search and your advisor.",
];

function AboutPage() {
  const isMobile = useWindowWidth() < 640;
  const feedback = semester.feedbackFormUrl.trim();
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.25 }}>
      <h1 style={{ margin:0, fontSize:isMobile ? 32 : 40, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.15, color:'#000' }}>About</h1>
      <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:16, maxWidth:'62ch' }}>
        {ABOUT_TEXT.map((text, i) => <p key={i} style={{ margin:0, fontSize:16, lineHeight:1.5, color:'#000' }}>{text}</p>)}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, marginTop:24 }}>
        <AppLink to="#/" style={linkBtnDark}>Start exploring</AppLink>
        {feedback && (
          <ExternalAction href={feedback} sr="(opens in a new tab)">Give feedback</ExternalAction>
        )}
      </div>
      <p style={{ margin:'32px 0 0', fontSize:14, lineHeight:1.4, color:'#444' }}>Build {__BUILD_ID__} · {new Date(__BUILD_TIME__).toLocaleDateString('en-US', { month:'short', day:'numeric' })}</p>
    </motion.div>
  );
}

function NotFoundPage({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.25 }}>
      <h1 style={{ margin:0, fontSize:40, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.15, color:'#000' }}>Page not found</h1>
      <p style={{ margin:'16px 0 24px', maxWidth:'62ch', fontSize:16, lineHeight:1.5, color:'#000' }}>{message}</p>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
        <AppLink to="#/" style={linkBtnDark}>Browse all classes</AppLink>
      </div>
    </motion.div>
  );
}

function SiteFooter({ isMobile, hideChecked = false }: { isMobile: boolean; hideChecked?: boolean }) {
  const feedback = semester.feedbackFormUrl.trim();
  const small = { display:'inline-flex', alignItems:'center', justifyContent:'center', gap:4, minHeight:44, minWidth:44, padding:0, border:0, borderRadius:0, background:'none', color:'#444', fontSize:14, fontWeight:500, textDecoration:'underline', textUnderlineOffset:3 } as const;
  return (
    <footer style={{ margin:isMobile ? '0 16px' : `0 ${SPACING.pagePx}px`, padding:isMobile ? `24px 0 calc(${BAR_H} + 88px)` : '24px 0 96px', borderTop:'1px solid #E0E0E0', display:'flex', flexDirection:'column', gap:4, maxWidth:'70ch' }}>
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', columnGap:20 }}>
        {feedback && <ExternalAction href={feedback} sr="(opens in a new tab)" style={small}>Give feedback</ExternalAction>}
        <AppLink to="#/about" style={small}>About</AppLink>
      </div>
      {!hideChecked && <span style={{ fontSize:14, lineHeight:1.4, color:'#444' }}>Data last checked: {formatDate(semester.dataLastChecked)}</span>}
    </footer>
  );
}

// ─── Phone header: search + saved button, then Focus areas · Filters · Sort ───
const AREA_NAMES = Object.keys(CATEGORY_COLORS);
const chipBase = { ...outlinedChip, display:'inline-flex', alignItems:'center', gap:8, maxWidth:'100%', lineHeight:1.3, textAlign:'left' } as const;

type SortKey = 'number' | 'az' | 'recent' | 'credits';
const SORTS: { key: SortKey; label: string }[] = [
  { key:'number', label:'Course number' },
  { key:'az', label:'A to Z' },
  { key:'recent', label:'Recently offered' },
  { key:'credits', label:'Credits' },
];
const byNumber = (mode: ViewMode) => (a: Course, b: Course) =>
  displayCodeOf(a, mode).localeCompare(displayCodeOf(b, mode), 'en', { numeric:true }) || a.title.localeCompare(b.title);
// Classes not offered recently go to the end of the default list. The sort is stable, so each group keeps its order.
const endNotOffered = (list: Course[]) => [...list.filter(c => availabilityOf(c).kind !== 'none'), ...list.filter(c => availabilityOf(c).kind === 'none')];
function sortCourses(list: Course[], key: SortKey, mode: ViewMode) {
  const copy = [...list];
  const byNum = byNumber(mode);
  if (key === 'az') return copy.sort((a, b) => a.title.localeCompare(b.title) || byNum(a, b));
  if (key === 'recent') return copy.sort((a, b) => termRank(lastOffered(b.termsOffered)) - termRank(lastOffered(a.termsOffered)) || byNum(a, b));
  if (key === 'credits') return copy.sort((a, b) => (creditRange(a.credits)?.min ?? Infinity) - (creditRange(b.credits)?.min ?? Infinity) || byNum(a, b));
  return endNotOffered(copy.sort(byNum));
}
// The browse order of each mode, used by the previous and next class buttons.
const MODE_ORDER: Record<ViewMode, Course[]> = {
  grad: sortCourses(MODE_ENTRIES.grad.map(e => e.course), 'number', 'grad'),
  undergrad: sortCourses(MODE_ENTRIES.undergrad.map(e => e.course), 'number', 'undergrad'),
};


function MobileFilterBar({ query, onQuery, quick, onToggleQuick, onClearQuick, count, anyActive, onClear }: {
  query: string; onQuery: (v: string) => void;
  quick: Set<QuickKey>; onToggleQuick: (k: QuickKey) => void; onClearQuick: () => void; count: number; anyActive: boolean; onClear: () => void;
}) {
  const [stuck, setStuck] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setStuck((barRef.current?.getBoundingClientRect().top ?? 1) <= 0.5);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive:true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Search; then Filters (with "Clear search and filters" beside it when something is active); then the count with the season key.
  return (
    <div ref={barRef} style={{ position:'sticky', top:0, zIndex:40, margin:'0 -16px 4px', padding:'8px 16px', background:'#FFF', borderBottom:`1px solid ${stuck ? '#E0E0E0' : 'transparent'}` }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
        <SearchBox value={query} onChange={onQuery} isMobile flush />
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', columnGap:8, marginTop:8 }}>
        <FilterControl active={quick} onToggle={onToggleQuick} onClear={onClearQuick} count={count} />
        {anyActive && (
          <button onClick={onClear} style={{ minHeight:44, padding:'0 4px', border:0, background:'none', color:'#000', fontSize:16, fontFamily:'var(--font-sans)', fontWeight:500, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' }}>Clear search and filters</button>
        )}
        <div style={{ flexBasis: '100%' }}><ResultsBar flush count={count} anyActive={anyActive} onClear={onClear} hideClear /></div>
      </div>
    </div>
  );
}

// Desktop Browse toolbar: full size at the top of the page, then a compact floating panel once it reaches the top bar.
// The wrapper keeps the expanded height and stays put, so the cards below never shift; only the panel inside changes.
function CondensingToolbar({ query, onQuery, quick, onToggleQuick, onClearQuick, count, anyActive, onClear, categories, onToggleArea, onClearAreas }: {
  query: string; onQuery: (v: string) => void;
  quick: Set<QuickKey>; onToggleQuick: (k: QuickKey) => void; onClearQuick: () => void; count: number; anyActive: boolean; onClear: () => void;
  categories: Set<string>; onToggleArea: (tag: string) => void; onClearAreas: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);
  const condensedRef = useRef(false);
  condensedRef.current = condensed;
  const [height, setHeight] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const animate = motionMode === 'full' && !reduceMotion;

  // Reserve the fully expanded height. Only measured while expanded (offsetHeight ignores the animation's transform).
  useLayoutEffect(() => {
    const el = panelRef.current; if (!el) return;
    const measure = () => { if (!condensedRef.current) setHeight(el.offsetHeight); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setCondensed((wrapRef.current?.getBoundingClientRect().top ?? Infinity) <= TOPBAR_H + 0.5);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive:true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const pos = animate ? 'position' : false;
  const t = animate ? { duration:0.3, ease:EASE } : { duration:0 };
  const css = animate ? 'background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease' : 'none';
  return (
    <div ref={wrapRef} style={{ position:'sticky', top:TOPBAR_H, zIndex:40, height:height ?? undefined, display:'flex', alignItems:'flex-start', pointerEvents:'none', marginBottom:height === null ? 24 : 0 }}>
      <motion.div ref={panelRef} layout={animate} transition={t}
        style={{
          pointerEvents:'auto', boxSizing:'border-box', display:'grid', alignItems:'center', width: condensed ? 'fit-content' : '100%', maxWidth:'100%',
          gridTemplateColumns: condensed ? '300px minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gridTemplateAreas: condensed ? '"search filters" "areas areas"' : '"search" "filters" "areas"',
          rowGap: condensed ? 4 : 24, columnGap: 16,
          padding: condensed ? '10px 16px 4px' : 0, margin: condensed ? '8px auto 0' : 0, // auto side margins center the pinned panel at any width
          background: condensed ? '#FFF' : 'rgba(255,255,255,0)', border: condensed ? '1px solid var(--line-soft)' : '0 solid transparent',
          borderRadius:16, boxShadow: condensed ? '0 8px 24px rgba(0,0,0,0.10)' : '0 0 0 rgba(0,0,0,0)', transition:css,
        }}>
        <motion.div layout={pos} transition={t} style={{ gridArea:'search', maxWidth: condensed ? undefined : 560, minWidth:0 }}>
          <SearchBox value={query} onChange={onQuery} isMobile={false} bare />
        </motion.div>
        <motion.div layout={pos} transition={t} style={{ gridArea:'filters', minWidth:0 }}>
          <QuickFilters active={quick} onToggle={onToggleQuick} count={count} anyActive={anyActive} onClear={onClear} onClearQuick={onClearQuick} condensed={condensed} />
        </motion.div>
        <motion.div layout={pos} transition={t} style={{ gridArea:'areas', minWidth:0 }}>
          <AreaChipRow categories={categories} onToggle={onToggleArea} onClear={onClearAreas} compact={condensed} />
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [initialSaved] = useState(loadSaved);
  // Grad or Undergrad: read on load and saved on every change (src/core/mode.ts). Grad is the default.
  const [mode, setMode] = useState<ViewMode>(() => readMode(safeStorage()));
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const chooseMode = (next: ViewMode) => { setMode(next); writeMode(safeStorage(), next); };
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  // The search text also lives in ?q= so a search survives an unexpected reload instead of
  // silently resetting to nothing.
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set('q', query); else url.searchParams.delete('q');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [query]);
  const [quick, setQuick] = useState<Set<QuickKey>>(new Set());
  const vw = useWindowWidth();
  const isMobile = vw < 640;
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(initialSaved.savedIds));
  const [toast, setToast] = useState<ToastState|null>(null);
  const [announce, setAnnounce] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [route, setRoute] = useState<Route>(parseRoute);
  const routeRef = useRef(route);
  routeRef.current = route;
  // A plan opens at #/plan/<id> inside the Saved page. Other old addresses (#/plans and the like) settle on #/saved, and so does a
  // plan id that doesn't exist.
  useEffect(() => {
    if (route.name !== 'saved') return;
    if (route.planId && plansRef.current.some(p => p.id === route.planId)) { setActivePlanId(route.planId); return; }
    if (window.location.hash !== '#/saved') window.history.replaceState(window.history.state, '', '#/saved');
    if (route.planId) setRoute({ name: 'saved' });
  }, [route]);
  const zoomed = useRef(false); // the open class page was reached by zooming a tile, so closing zooms back into it
  const pendingKey = useRef('');
  const [plans, setPlans] = useState<Plan[]>(() => initialSaved.plans);
  const plansRef = useRef(plans);
  plansRef.current = plans;
  // The plan the calendar shows: the last plan opened or picked, remembered on this device; else the first.
  const [activePlanId, setActivePlanId] = useState<string | null>(() => {
    try { return window.localStorage.getItem(ACTIVE_PLAN_KEY); } catch { return null; }
  });
  useEffect(() => {
    try { if (activePlanId) window.localStorage.setItem(ACTIVE_PLAN_KEY, activePlanId); else window.localStorage.removeItem(ACTIVE_PLAN_KEY); } catch { /* storage can be blocked */ }
  }, [activePlanId]);
  const [pickPlanId, setPickPlanId] = useState<string|null>(null);
  const [picker, setPicker] = useState<string|null>(null); // the class whose Add to plan dialog is open
  const bookmarkEl = useRef<HTMLElement|null>(null); // the bookmark to give focus back to when the dialog closes
  const openPicker = (courseId: string, el?: Element | null) => { if (el) bookmarkEl.current = el as HTMLElement; setPicker(courseId); };
  const closePicker = () => {
    setPicker(null);
    requestAnimationFrame(() => { const el = bookmarkEl.current; if (el?.isConnected) el.focus({ preventScroll: true }); });
  };
  const [planDialog, setPlanDialog] = useState<{ mode: 'create'|'rename'|'semester'; planId?: string; courseId?: string }|null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'deletePlan'; planId: string } | { kind: 'removeSaved'; courseId: string } | { kind: 'changeTerm'; planId: string; term: string; titles: string[] } | null>(null);
  const [sharePlanId, setSharePlanId] = useState<string|null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastPage = useRef<string | null>(null);

  // The class list for the active mode (coursesForMode), then the search and filters.
  const modeCourses = useMemo(() => MODE_ENTRIES[mode].map(e => e.course), [mode]);
  const filteredCourses = modeCourses.filter(c => inCategories(c, selectedCategories) && matchesSearch(c, query) && passesQuick(c, quick));
  const shownCourses = sortCourses(filteredCourses, 'number', mode);
  const toggleQuick = (k: QuickKey) => setQuick(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // One notification at a time; a new one replaces the old. It dismisses itself (see Toast).
  function showToast(message: string, action?: ToastAction | ToastAction[], note?: string) {
    setToast({ message, actions: action ? [action].flat() : [], note, key: Date.now() + Math.random() });
  }

  // Is there a newer build on the server? Checked when the page loads and when the tab comes back after 5 minutes or more. We only
  // ever offer a Refresh button; the page never reloads by itself, so nobody loses a half-made plan or a half-typed field.
  useEffect(() => {
    let hiddenAt = 0;
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = await res.json();
        if (typeof build === 'string' && build !== __BUILD_ID__ && __BUILD_ID__ !== 'dev') {
          setToast({ message: 'A new version is ready', actions: [{ label: 'Refresh', run: () => window.location.reload() }, { label: 'Later', run: () => {} }], persist: true, key: Date.now() + Math.random() });
        }
      } catch { /* offline or no version file (dev): nothing to say */ }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= 5 * 60 * 1000) { hiddenAt = 0; check(); }
    };
    check();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // "Added to Spring plan 1", with View and Undo.
  function notifyAdded(courseId: string, plan: { id: string; name: string }, note?: string) {
    showToast(`Added to ${plan.name}`, [{ label: 'View', run: () => navigate(planHref(plan)) }, { label: 'Undo', run: () => removeFromPlan(plan.id, courseId) }], note);
  }

  // Any number of areas. Choosing every one is the same as All, so it clears the individual picks.
  function handleFilter(tag: string) {
    if (tag==='All') { setSelectedCategories(new Set()); return; }
    setSelectedCategories(prev => {
      const n=new Set(prev); n.has(tag)?n.delete(tag):n.add(tag);
      return n.size >= Object.keys(CATEGORY_COLORS).length ? new Set() : n;
    });
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeSaved(savedIds, plans));
    } catch { /* storage unavailable: saving just lasts until the page closes */ }
  }, [savedIds, plans]);

  const routeKey = (r: Route) => r.name === 'class' ? `class:${r.course.id}` : r.name === 'saved' ? `saved:${r.planId ?? ''}` : r.name;
  const focusTitle = () => document.querySelector<HTMLElement>('[data-class-page] h1')?.focus({ preventScroll: true });
  const focusTile = (id: string) => () => {
    const link = document.querySelector<HTMLElement>(`[data-zoom-card][data-course="${CSS.escape(id)}"] a`);
    (link ?? mainRef.current)?.focus({ preventScroll: true });
  };

  // Going back or forward: show that page again and put the scroll position back where it was. Leaving a class page that was
  // opened from a tile zooms the hero back into that tile (inside the transition, with the scroll already restored).
  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    const sync = () => {
      const next = parseRoute();
      const cur = routeRef.current;
      const key = routeKey(next);
      if (key === routeKey(cur) || key === pendingKey.current) return; // popstate and hashchange both fire for one change
      pendingKey.current = key;
      const y = Number(window.history.state?.scrollY) || 0;
      const update = () => setRoute(next);
      const scroll = () => window.scrollTo({ top: y, behavior: 'instant' }); // runs once the page is committed, so the height is the new page's
      if (cur.name === 'class' && next.name !== 'class' && next.name !== 'notfound' && zoomed.current) {
        const id = cur.course.id;
        transition(update, { kind: 'close', from: document.querySelector('[data-class-page] [data-cover]'), findTo: () => zoomSourceFor(id), scroll, after: () => { pendingKey.current = ''; focusTile(id)(); } });
      } else {
        if (next.name !== 'class') zoomed.current = false;
        transition(update, { kind: 'fade', scroll, after: () => { pendingKey.current = ''; } });
      }
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);

  function navigate(hash: string, opts?: { replace?: boolean; from?: Element | null; scrollY?: number }) {
    if ((window.location.hash || '#/') === hash && window.location.pathname === import.meta.env.BASE_URL) {
      // Already on this address. If its page is showing, a second tap scrolls to the top; if the page is still on its way in
      // (a double tap during the open animation), there is nothing more to do.
      if (routeKey(parseRoute()) === routeKey(routeRef.current)) window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      return;
    }
    // The history entry is written now, before any transition starts, so Back pressed at any moment lands on the right page.
    window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, '');
    if (opts?.replace) window.history.replaceState({ fromApp: true }, '', hash);
    else window.history.pushState({ fromApp: true }, '', hash);
    const target = routeKey(parseRoute());
    // The update reads the address when it runs, so if Back arrives first the page it shows is the one Back chose.
    let landed: Route | null = null;
    const run = () => { landed = parseRoute(); setRoute(landed); };
    // a new page always starts at the top (unless Back got there first and chose a different page)
    const scroll = () => { if (!opts?.replace && landed && routeKey(landed) === target) window.scrollTo({ top: opts?.scrollY ?? 0, behavior: 'instant' }); };
    const opening = hash.startsWith('#/class/') && routeRef.current.name !== 'class' && !!opts?.from;
    zoomed.current = opening;
    pendingKey.current = '';
    if (opening) transition(run, { kind: 'open', from: opts?.from, findTo: () => document.querySelector('[data-class-page] [data-cover]'), scroll, after: focusTitle });
    else transition(run, { kind: 'fade', scroll });
  }

  // Previous / next class (buttons and the arrow keys): a short horizontal slide in the browse order, not the zoom.
  function stepClass(dir: 1 | -1) {
    const cur = parseRoute(); // the address is up to date even while the last step is still animating
    if (cur.name !== 'class') return;
    const classOrder = MODE_ORDER[modeRef.current];
    const i = classOrder.findIndex(c => c.id === cur.course.id);
    const target = classOrder[i + dir];
    if (!target) return;
    window.history.replaceState({ ...window.history.state, fromApp: true }, '', classHref(target)); // the address changes first, like a navigation
    const run = () => setRoute(parseRoute());
    transition(run, { kind: dir > 0 ? 'slide-next' : 'slide-prev', scroll: () => window.scrollTo({ top: 0, behavior: 'instant' }), after: focusTitle });
  }

  function goBack() {
    if (window.history.state?.fromApp) window.history.back();
    else navigate('#/', { replace: true });
  }

  // Press "/" on the home page to jump to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || route.name !== 'home') return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const box = document.getElementById('search-input') as HTMLInputElement | null;
      if (box) { e.preventDefault(); box.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name]);

  // On a class page: Escape closes it (the same reverse zoom as the back button); the left and right arrows step through classes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (parseRoute().name !== 'class') return; // the address decides, so Escape works even while the page is still opening
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return; // a dialog or tooltip owns the keys while it is open
      if (e.key === 'Escape') { e.preventDefault(); goBack(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepClass(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepClass(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Each page gets its own tab title, and keyboard focus moves to the new page's content.
  useEffect(() => {
    const name = APP_NAME;
    document.title =
      route.name === 'class' ? `${route.course.title} · ${name}`
      : route.name === 'saved' ? `Saved · ${name}`
      : route.name === 'about' ? `About · ${name}`
      : route.name === 'calendar' ? `Calendar · ${name}`
      : route.name === 'notfound' ? `Page not found · ${name}`
      : name;
    const page = route.name + (route.name === 'class' ? route.course.id : '');
    if (lastPage.current !== null && lastPage.current !== page) mainRef.current?.focus({ preventScroll: true });
    lastPage.current = page;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // The one rule: any class in a plan is also in Saved. Deleting a plan never touches Saved.
  const markSaved = (id: string) => setSavedIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));

  function removeSaved(id: string) {
    setSavedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    setPlans(prev => prev.map(p => ({ ...p, items: p.items.filter(i => i.id !== id) })));
  }

  function addToPlan(courseId: string, planId: string) {
    markSaved(courseId);
    setPlans(prev => prev.map(p => (p.id === planId && !p.items.some(i => i.id === courseId) ? { ...p, items: [...p.items, { id: courseId, role: 'first' as PlanRole }] } : p)));
  }

  function removeFromPlan(planId: string, courseId: string) {
    setPlans(prev => prev.map(p => (p.id === planId ? { ...p, items: p.items.filter(i => i.id !== courseId) } : p)));
  }

  const putBack = (planId: string, item: PlanItem, index: number) =>
    setPlans(prev => prev.map(p => (p.id === planId && !p.items.some(i => i.id === item.id) ? { ...p, items: [...p.items.slice(0, index), item, ...p.items.slice(index)] } : p)));

  function removeFromPlanWithUndo(planId: string, courseId: string) {
    const plan = plans.find(p => p.id === planId);
    const item = plan?.items.find(i => i.id === courseId);
    if (!plan || !item) return;
    const index = plan.items.indexOf(item);
    removeFromPlan(planId, courseId);
    showToast(`Removed from ${plan.name}`, { label: 'Undo', run: () => putBack(planId, item, index) });
  }

  function removeSavedWithUndo(courseId: string) {
    const memberships = plans.flatMap(p => { const item = p.items.find(i => i.id === courseId); return item ? [{ planId: p.id, item, index: p.items.indexOf(item) }] : []; });
    removeSaved(courseId);
    showToast('Removed from saved', { label: 'Undo', run: () => { markSaved(courseId); memberships.forEach(m => putBack(m.planId, m.item, m.index)); } });
  }

  function deletePlanWithUndo(planId: string) {
    const index = plans.findIndex(p => p.id === planId);
    const plan = plans[index];
    if (!plan) return;
    if (routeRef.current.name === 'saved' && routeRef.current.planId === planId) navigate('#/saved', { replace: true }); // the open plan is going away
    setPlans(prev => prev.filter(p => p.id !== planId));
    showToast(`Deleted ${plan.name}`, { label: 'Undo', run: () => setPlans(prev => (prev.some(p => p.id === plan.id) ? prev : [...prev.slice(0, index), plan, ...prev.slice(index)])) });
  }

  // In the Add to plan dialog the checkboxes show what happened, so no notification.
  function toggleInPlan(courseId: string, planId: string) {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;
    const course = COURSES_BY_ID.get(courseId);
    if (plan.items.some(i => i.id === courseId)) removeFromPlan(planId, courseId);
    else if (!course || planTermFit(course, plan.term).ok) addToPlan(courseId, planId);
  }

  function setRole(planId: string, courseId: string, role: PlanRole) {
    setPlans(prev => prev.map(p => (p.id === planId ? { ...p, items: p.items.map(i => (i.id === courseId ? { ...i, role } : i)) } : p)));
  }

  function createPlan(name: string, term: string, courseId?: string, go = true) {
    if (courseId) markSaved(courseId);
    const id = `plan-${Date.now()}`;
    setPlans(prev => [...prev, { id, name, term, items: courseId ? [{ id: courseId, role: 'first' as PlanRole }] : [] }]);
    setActivePlanId(id);
    if (go && !courseId && routeRef.current.name === 'saved') navigate(planHref({ id }));
    return id;
  }

  function addManyToPlan(planId: string, ids: string[]) {
    const term = plans.find(p => p.id === planId)?.term ?? '';
    ids = ids.filter(id => { const c = COURSES_BY_ID.get(id); return !c || planTermFit(c, term).ok; });
    setPlans(prev => prev.map(p => (p.id === planId ? { ...p, items: [...p.items, ...ids.filter(id => !p.items.some(i => i.id === id)).map(id => ({ id, role: 'first' as PlanRole }))] } : p)));
  }

  // Tapping a bookmark: an unsaved class is saved right away; a saved one opens its menu.
  function pressBookmark(course: Course, el?: HTMLElement | null) {
    if (!savedIds.has(course.id)) {
      markSaved(course.id);
      if (el) bookmarkEl.current = el;
      showToast('Saved', { label: 'Add to plan', run: () => openPicker(course.id) });
    } else {
      requestRemoveSaved(course.id); // the bookmark on a saved class unsaves it (it asks first if the class is in a plan)
    }
  }

  function requestRemoveSaved(courseId: string) {
    if (plans.some(p => p.items.some(i => i.id === courseId))) {
      setConfirm({ kind: 'removeSaved', courseId });
    } else {
      removeSavedWithUndo(courseId);
    }
  }

  function submitPlanDialog(name: string, term: string) {
    if (!planDialog) return;
    if (planDialog.mode === 'create') {
      // From "+ New plan" on Saved: createPlan opens the new, empty plan. From a class: the class goes in the plan if it fits the term,
      // we stay where we were, and a notification says what happened.
      const course = planDialog.courseId ? COURSES_BY_ID.get(planDialog.courseId) : undefined;
      const fits = !course || planTermFit(course, term).ok;
      const note = takeDeviceNote(plans.length > 0);
      const id = createPlan(name, term, fits ? planDialog.courseId : undefined, !course);
      if (course) {
        setPicker(null);
        if (fits) notifyAdded(course.id, { id, name }, note);
        else {
          const seasons = planTermFit(course, term).seasons;
          showToast(`Created ${name}. ${course.title} ${seasons.length ? `runs in ${seasons.join(' and ')}` : "isn't offered recently"}, so it wasn't added.`, undefined, note);
        }
      } else if (note) showToast(`Created ${name}`, undefined, note);
      else setToast(null); // no pill for later plans; clear any older one
    } else if (planDialog.planId) {
      const id = planDialog.planId;
      if (planDialog.mode === 'semester') {
        // Moving a plan to a term some of its classes don't run in: ask first, never remove them quietly.
        const plan = plans.find(p => p.id === id);
        const clash = (plan?.items ?? []).flatMap(i => { const c = COURSES_BY_ID.get(i.id); return c && !planTermFit(c, term).ok ? [c] : []; });
        if (clash.length) { setConfirm({ kind: 'changeTerm', planId: id, term, titles: clash.map(c => c.title) }); setPlanDialog(null); return; }
      }
      setPlans(prev => prev.map(p => (p.id === id ? (planDialog.mode === 'rename' ? { ...p, name } : { ...p, term }) : p)));
    }
    setPlanDialog(null);
  }

  const planActions: SavedActions = {
    create: () => setPlanDialog({ mode: 'create' }),
    newPlan: () => setPlanDialog({ mode: 'create' }),
    addClasses: id => setPickPlanId(id),
    addToPlan: openPicker,
    removeSaved: requestRemoveSaved,
    setRole,
    removeFromPlan: removeFromPlanWithUndo,
    rename: plan => setPlanDialog({ mode: 'rename', planId: plan.id }),
    changeSemester: plan => setPlanDialog({ mode: 'semester', planId: plan.id }),
    remove: plan => setConfirm({ kind: 'deletePlan', planId: plan.id }),
    share: plan => setSharePlanId(plan.id),
  };

  // The remembered plan, unless it was deleted: then the first plan.
  const shownPlanId = plans.some(p => p.id === activePlanId) ? activePlanId : plans[0]?.id ?? null;
  const pickerCourse = picker ? COURSES_BY_ID.get(picker) ?? null : null;
  const editingPlan = planDialog?.planId ? plans.find(p => p.id === planDialog.planId) : undefined;
  const sharePlan = sharePlanId === ALL_SAVED_ID
    ? { id: ALL_SAVED_ID, name: 'Saved classes', term: '', items: COURSES.filter(c => savedIds.has(c.id)).map(c => ({ id: c.id, role: 'first' as PlanRole })) }
    : sharePlanId ? plans.find(p => p.id === sharePlanId) ?? null : null;
  const pickPlan = pickPlanId ? plans.find(p => p.id === pickPlanId) ?? null : null;

  const anyFilter = query.trim() !== '' || selectedCategories.size > 0 || [...quick].some(k => FILTER_KEYS_SHOWN.has(k));

  function clearFilters() {
    setQuery('');
    setSelectedCategories(new Set());
    setQuick(new Set());
  }

  const px = isMobile ? 16 : SPACING.pagePx;

  const nav = null;
  const navView: BarItem | null = route.name === 'home' ? 'browse' : route.name === 'calendar' ? 'calendar' : route.name === 'saved' ? 'saved' : null;

  return (
    <ModeContext.Provider value={mode}>
    <TagTooltipProvider>
    <MotionConfig reducedMotion={motionMode === 'off' ? 'always' : 'user'}>
    <NavContext.Provider value={navigate}>
    <div style={{ minHeight:'100vh', background:'#FFF', display:'flex', position:'relative' }}>
      <a href="#main-content" className="skip-link no-print" onClick={e => {
        e.preventDefault();
        const target = (route.name === 'home' || route.name === 'saved' ? document.getElementById('classes') : null) ?? mainRef.current;
        target?.focus();
        target?.scrollIntoView({ block:'start' });
      }}>{route.name === 'home' || route.name === 'saved' ? 'Skip to classes' : 'Skip to main content'}</a>
      {!isMobile && (
        <DesktopTopBar
          homeActive={route.name === 'home'}
          showSaved={route.name !== 'class'}
          savedActive={route.name === 'saved'}
          savedCount={savedIds.size}
          onHome={() => navigate('#/')}
          onSaved={() => navigate('#/saved')}
        />
      )}
      {/* Main content area */}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
      <motion.main ref={mainRef} id="main-content" tabIndex={-1} animate={{ width:helpOpen&&!isMobile?'65%':'100%' }} transition={{ duration:0.6, ease:[0.16,1,0.3,1] }}
        style={{ minWidth:0, flex:1, padding:`${isMobile ? (route.name === 'class' ? 0 : 24) : (route.name === 'class' ? TOPBAR_H : TOPBAR_H + 40)}px ${px}px 48px`, boxSizing:'border-box' }}>
        {isMobile && (
          <div className="no-print" style={{ display:'flex', justifyContent:'flex-end', margin:route.name === 'class' ? 0 : '-16px 0 0', padding:route.name === 'class' ? '8px 0 0' : '0 0 8px' }}>
            <AdvisorButton />
          </div>
        )}
        <div>
          <Fragment>
            {route.name === 'class' ? (
              <DetailPage key="detail" course={route.course}
                isSaved={savedIds.has(route.course.id)}
                onBookmark={el=>pressBookmark(route.course, el)}
                onBack={goBack}
                onAddToPlan={e => openPicker(route.course.id, e?.currentTarget)}
                onStep={stepClass}
                nav={nav}
              />
            ) : route.name === 'notfound' ? (
              <NotFoundPage key="notfound" message={route.kind === 'class'
                ? "We couldn't find that class. The link may be mistyped, or the class may have been removed from the guide."
                : "We couldn't find that page. The link may be mistyped or out of date."} />
            ) : route.name === 'saved' ? (
              <SavedPage key="saved" savedIds={savedIds} plans={plans} planId={route.planId} actions={planActions} />
            ) : route.name === 'calendar' ? (
              <CalendarPage key="calendar" plans={plans} activePlanId={shownPlanId} onPickPlan={setActivePlanId} onCreatePlan={planActions.create} />
            ) : route.name === 'about' ? (
              <AboutPage key="about" />
            ) : (
              <motion.div key="grid" initial={getEntrance() === 'fade' ? { opacity:0 } : false} animate={{ opacity:1, transition:{ duration:0.2 } }}>
                {/* Header */}
                <div style={{ display:'flex', flexDirection:isMobile?'column':'row', alignItems:'flex-start', justifyContent:isMobile?'flex-start':'space-between', gap:isMobile?16:0, marginBottom:isMobile?12:SPACING.headingMb }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:12, width:'100%' }}>
                    <h1 style={{ fontSize:isMobile?32:40, fontWeight:700, letterSpacing:'-0.03em', color:'#000', margin:0, lineHeight:1.15 }}>{APP_NAME}</h1>
                    <ModeToggle mode={mode} onChange={chooseMode} />
                  </div>
                </div>

                {isMobile ? (
                  <>
                  <MobileFilterBar query={query} onQuery={setQuery}
                    quick={quick} onToggleQuick={toggleQuick} onClearQuick={() => setQuick(new Set())} count={filteredCourses.length}
                    anyActive={anyFilter} onClear={clearFilters} />
                  <AreaChipRow categories={selectedCategories} onToggle={handleFilter} onClear={() => handleFilter('All')} bleed={12} />
                  </>
                ) : (
                <>
                <CondensingToolbar query={query} onQuery={setQuery}
                  quick={quick} onToggleQuick={toggleQuick} onClearQuick={() => setQuick(new Set())} count={filteredCourses.length}
                  anyActive={anyFilter} onClear={clearFilters}
                  categories={selectedCategories} onToggleArea={handleFilter} onClearAreas={() => handleFilter('All')} />
                </>
                )}

                {/* Course grid */}
                <div id="classes" tabIndex={-1} style={{ outline:'none', scrollMarginTop:isMobile ? 140 : TOPBAR_H + 150 }}>
                {filteredCourses.length === 0 ? (
                  <TileGrid>
                    <TileEmpty message={query.trim() ? `No classes match "${query.trim()}"` : 'No classes match your filters'} hint="Try a different word, or clear the search and filters.">
                      <button type="button" onClick={clearFilters} style={filledButton}>Clear filters</button>
                    </TileEmpty>
                  </TileGrid>
                ) : (
                  <TileGrid>
                    <AnimatePresence mode="popLayout">
                      {shownCourses.map((course,i)=>(
                        <ClassTile key={course.id} course={course}
                          saved={savedIds.has(course.id)}
                          onBookmark={el=>pressBookmark(course, el)}
                          index={i}
                        />
                      ))}
                    </AnimatePresence>
                  </TileGrid>
                )}
                </div>
              </motion.div>
            )}
          </Fragment>
        </div>
      </motion.main>
      <SiteFooter isMobile={isMobile} hideChecked={route.name === 'class' && vw >= 1024} />
      </div>

      <AnimatePresence>{helpOpen && !isMobile && <HelpPanel onClose={()=>setHelpOpen(false)} />}</AnimatePresence>
      <div role="region" aria-label="Notifications">
        <div role="status" aria-live="polite" className="sr-only">{announce}</div>
        {toast && <Toast key={toast.key} toast={toast} onDismiss={()=>setToast(null)} />}
      </div>

      {isMobile && (
        <MobileBottomNav active={navView} savedCount={savedIds.size}
          onBrowse={() => navigate('#/')} onCalendar={() => navigate('#/calendar')} onSaved={() => navigate('#/saved')} />
      )}

      <AnimatePresence>
        {picker && pickerCourse && (
          <AddToPlanDialog key="add-to-plan" course={pickerCourse} plans={plans}
            onToggle={planId => toggleInPlan(pickerCourse.id, planId)}
            onCreate={() => setPlanDialog({ mode: 'create', courseId: pickerCourse.id })}
            onClose={closePicker} />
        )}
        {planDialog && (planDialog.mode === 'create' || editingPlan) && (
          <PlanFormDialog key={`plan-form-${planDialog.mode}-${planDialog.planId ?? 'new'}`} mode={planDialog.mode}
            initialName={planDialog.mode === 'rename' ? editingPlan?.name : ''} initialTerm={planDialog.mode === 'semester' ? editingPlan?.term : planDialog.mode === 'create' && planDialog.courseId && COURSES_BY_ID.get(planDialog.courseId) ? suggestedTermFor(COURSES_BY_ID.get(planDialog.courseId)!) : ''}
            onSubmit={submitPlanDialog} onClose={() => setPlanDialog(null)} />
        )}
        {confirm?.kind === 'deletePlan' && (
          <ConfirmDialog key="confirm-delete" title="Delete this plan?" message="The classes stay saved." confirmLabel="Delete"
            onConfirm={() => { deletePlanWithUndo(confirm.planId); setConfirm(null); }}
            onClose={() => setConfirm(null)} />
        )}
        {confirm?.kind === 'changeTerm' && (
          <ConfirmDialog key="confirm-change-term" title="Change semester?" confirmLabel="Change anyway"
            message={`These classes don't usually run in ${confirm.term}: ${confirm.titles.join(', ')}. They stay in the plan.`}
            onConfirm={() => { setPlans(prev => prev.map(p => (p.id === confirm.planId ? { ...p, term: confirm.term } : p))); setConfirm(null); }}
            onClose={() => setConfirm(null)} />
        )}
        {confirm?.kind === 'removeSaved' && (
          <ConfirmDialog key="confirm-remove-saved" title="Remove from saved?" confirmLabel="Remove"
            message={(() => {
              const names = plans.filter(p => p.items.some(i => i.id === confirm.courseId)).map(p => p.name);
              return `This class is in ${names.join(', ')}. Removing it from saved also removes it from ${names.length === 1 ? 'that plan' : 'those plans'}.`;
            })()}
            onConfirm={() => { removeSavedWithUndo(confirm.courseId); setConfirm(null); }}
            onClose={() => setConfirm(null)} />
        )}
        {pickPlan && (
          <PickClassesDialog key="pick-classes" planName={pickPlan.name} planTerm={pickPlan.term} courses={COURSES.filter(c => savedIds.has(c.id) && !pickPlan.items.some(i => i.id === c.id))}
            onAdd={ids => { addManyToPlan(pickPlan.id, ids); setPickPlanId(null); showToast(`Added ${ids.length} ${ids.length === 1 ? 'class' : 'classes'} to ${pickPlan.name}`, { label: 'View', run: () => navigate(planHref(pickPlan)) }); }}
            onClose={() => setPickPlanId(null)} />
        )}
        {sharePlan && <SharePlanDialog key="share-plan" plan={sharePlan} onClose={() => setSharePlanId(null)} />}
      </AnimatePresence>
    </div>
    </NavContext.Provider>
    </MotionConfig>
    </TagTooltipProvider>
    </ModeContext.Provider>
  );
}
