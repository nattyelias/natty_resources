// The shape of one class in data/courses.json and one posted meeting time.

export interface Instructor { name: string; url: string }

export interface AdvisorConfirmation { by: string; date: string; auditMayNotListIt: boolean }

/** One posted section of a class in one term (see data/MEETING-TIMES.md). */
export interface Section {
  classNumber: string;
  title: string;
  section: string;
  type: string;
  campus: string;
  days: string;
  start: string;
  end: string;
  meets: string;
  instructor: string;
  dates: string;
  online: boolean;
  variesBySection: boolean;
  /** The next fields come from the merged Spring 2027 schedule (data/spring2027.json) and are only present when it has a value. */
  room?: string;
  mode?: string;
  notes?: string;
  crossListCode?: string;
  /** Where the section was found: "sheet" (ATLAS sheet), "pull" (CU class search) or "both". A plain string so courses.json imports cleanly. */
  source?: string;
  /** True when the sheet and the pull disagree on days or times; days, start and end are then empty. */
  conflict?: boolean;
}

/** The sheet's category for a section: Core, Focus, HT (how-to), CPT (critical perspectives), Grad, Grad/Focus. Empty when the sheet has none. */
export type Level = 'Core' | 'Focus' | 'HT' | 'CPT' | 'Grad' | 'Grad/Focus' | '';

export interface Course {
  id: string;
  code: string;
  specialTopic: boolean;
  title: string;
  credits: string;
  category: string;
  countsToward: string;
  /** Oldest to newest, e.g. ["Spring 2026", "Fall 2026"]. */
  termsOffered: string[];
  notOfferedRecently: boolean;
  instructors: Instructor[];
  advisorConfirmation: AdvisorConfirmation | null;
  instructorsByTerm: Partial<Record<string, string>>;
  instructor: string;
  instructorTitle: string;
  instructorUrl: string;
  description: string;
  tools: string[];
  image: string;
  categorySecondary: string;
  classNumber: string;
  instructorFullName: string;
  crossListings: string;
  sessionLength: string;
  format: string;
  extraCost: string;
  consentRequired: string;
  unlocks: string;
  searchKeywords: string;
  prereqRequired: string;
  prereqRecommended: string;
  noRequiredPrereqs: boolean;
  restriction: string;
  openToNonMajors: boolean;
  /** Optional class photo: a path, its alt text (required with a photo) and a credit line. Empty when none. */
  photo: string;
  photoAlt: string;
  photoCredit: string;
  /** Posted meeting times by term. A class with none has no entry. */
  sectionsByTerm?: Partial<Record<string, Section[]>>;
  /** From the sheet category (data/courses-extra.json only): one of the Level values, or empty. Missing on the classes in courses.json. A plain string so the JSON imports cleanly. */
  level?: string;
  /** True for independent study and dissertation classes (ATLS 4900, 5900, 7900, 8990). Their instructors are individual mentors, so a UI should not list them. The data is kept. */
  independentStudy?: boolean;
}

/** A class as stored in data/courses.json and data/courses-extra.json: a Course before photos are merged in at load. */
export type CourseData = Omit<Course, 'photo' | 'photoAlt' | 'photoCredit'>;

// ─── Verification against CU class search (data/verification.json, from check-class-search.mjs) ───

/** One field where our data and CU class search disagree. Class search is the source of truth. */
export interface MismatchedField { field: string; classSearch: string; ours: string }

export interface SectionVerification {
  code: string;
  /** "confirmed", "mismatch", "pending" (not in class search yet), "new" or "cancelled". A plain string so the JSON imports cleanly. */
  status: string;
  /** The America/Denver date of the check, YYYY-MM-DD. */
  checkedAt: string;
  mismatchedFields: MismatchedField[];
  skipped: string[];
  notes: string[];
}

export interface VerificationFile {
  meta: { checkedAt: string; input: string; srcdb: string; term: string; counts: Record<string, number> } & Record<string, unknown>;
  /** course id -> section number -> result */
  sections: Record<string, Record<string, SectionVerification>>;
}

/** What a class says about how far to trust its Spring 2027 times. */
export type VerificationStatus = 'confirmed' | 'mismatch' | 'pending' | 'unchecked';

export interface ClassVerification {
  status: VerificationStatus;
  /** Latest check date among the class's sections (YYYY-MM-DD), or null when unchecked. */
  checkedAt: string | null;
}
