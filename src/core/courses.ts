// Course lists worked out from terms. Pure functions: the config arrives as an argument.

import { upcomingTerms } from './terms.ts';
import type { TermContext } from './terms.ts';

type HasTerms = { termsOffered: string[] };

/** Classes with at least one upcoming term: what a student can still take. */
export const offeredInUpcomingTerms = <C extends HasTerms>(courses: C[], ctx: TermContext): C[] =>
  courses.filter((c) => upcomingTerms(c.termsOffered, ctx).length > 0);

/** Classes that have run in at least one term, but only in past terms. */
export const ranOnlyInPastTerms = <C extends HasTerms>(courses: C[], ctx: TermContext): C[] =>
  courses.filter((c) => c.termsOffered.length > 0 && upcomingTerms(c.termsOffered, ctx).length === 0);
