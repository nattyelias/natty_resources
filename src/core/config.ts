// Settings the core needs. Nothing here is a global: callers build or import a CoreConfig
// and pass it into the functions that need it.

import type { TermContext } from './terms.ts';

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
}

export const defaultConfig: CoreConfig = {
  currentTermName: 'Fall 2026',
  nextTermName: 'Spring 2027',
  classSearchTermCode: '2271', // 2 + year (27) + season digit (1 = spring); see data/scripts/pull-class-search.mjs
};

/** What the term functions in terms.ts need, worked out from a config. */
export const termContext = (config: CoreConfig): TermContext => ({
  currentTermName: config.currentTermName,
  nextTermName: config.nextTermName,
  nextTermPosted: config.classSearchTermCode !== null,
});
