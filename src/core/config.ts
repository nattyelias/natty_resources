// Settings the core needs. Nothing here is a global: callers build or import a CoreConfig
// and pass it into the functions that need it.

import type { TermContext, TermStatusMap } from './terms.ts';
import type { ViewMode } from './types.ts';

export interface CoreConfig {
  /** The term classes are running in right now, e.g. "Fall 2026". Update every term. */
  currentTermName: string;
  /** The upcoming term being planned for, e.g. "Spring 2027". */
  nextTermName: string;
  /**
   * CU class search term code for nextTermName (the number after "srcdb=").
   * null until CU has posted that term. Don't guess a code.
   */
  classSearchTermCode: string | null;
  /**
   * Whether each term is open for planning. "upcoming" terms show as available; "past" terms are history only.
   * Fall 2026 is "past" even though it is still running, because it is no longer open for planning.
   * A term missing here is not treated as upcoming.
   */
  termStatus: TermStatusMap;
}

/** The app's name, shown in the header and the tab title. */
export const APP_NAME = 'Focus Electives';

/**
 * The app's copy: the tagline under the name, the About text and the footer line. Word for word as in the original site
 * (commit ae27a28). Renaming the app or removing any of this is an edit to this one object (and APP_NAME above).
 */
export const APP_COPY = {
  tagline: "A student-made guide to ATLAS focus electives. Independent and unofficial.",
  aboutText: [
    "ATLAS has more than 40 focus electives. Game design. Fabrication. Sound. AR/VR. Branding. AI. Accessibility.",
    "That's a lot of opportunity. But too many students never see it, because the information is scattered, outdated or contradictory.",
    "Picking your classes shouldn't depend on who you know or how many tabs you can keep open. Every student deserves to see every option, understand what it means for their degree, and plan with confidence.",
    "This is about the student experience. It should feel simple. It should feel honest. And it should feel like it was made for you.",
    "That's what this guide is for.",
    "Saved classes and plans are kept on this device only. Clearing your browser or switching devices will remove them.",
    "Built by an ATLAS student, for ATLAS students. Not an official CU or ATLAS tool. Always confirm with CU class search and your advisor.",
  ],
  footerDisclaimer: "Independent and unofficial. A student-built guide, not an official CU Boulder or ATLAS tool.",
};

/** The mode shown when nothing valid has been saved. */
export const DEFAULT_MODE: ViewMode = 'grad';

export const defaultConfig: CoreConfig = {
  currentTermName: 'Fall 2026',
  nextTermName: 'Spring 2027',
  classSearchTermCode: '2271', // 2 + year (27) + season digit (1 = spring); see data/scripts/pull-class-search.mjs
  termStatus: {
    'Spring 2026': 'past',
    'Fall 2026': 'past',
    'Spring 2027': 'upcoming',
  },
};

/** What the term functions in terms.ts need, worked out from a config. */
export const termContext = (config: CoreConfig): TermContext => ({
  currentTermName: config.currentTermName,
  nextTermName: config.nextTermName,
  nextTermPosted: config.classSearchTermCode !== null,
  termStatus: config.termStatus,
});
