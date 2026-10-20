import verification from '../../../data/verification.json';
import { defaultConfig, termContext } from '../../core/config.ts';

// The only place semester settings live. Change these each term, then follow
// SEMESTER-UPDATE.md in the project root.

interface SemesterSettings {
  /**
   * CU class search term code for nextTermName: the number after "srcdb=" in the class search address.
   * Leave it null until CU has posted that term. While null, class search links carry no term (so
   * they never point at an old one) and the site says the term isn't posted yet. Set the real code
   * once and every link, and the "posted" note, updates from it. Don't guess a code.
   */
  classSearchTermCode: string | null;
  /**
   * The term classes are running in right now, e.g. "Fall 2026".
   * UPDATE THIS EVERY TERM: the app now says nothing when a class is running in this term, and only
   * mentions availability when something is off. A stale value makes every class look like an exception.
   */
  currentTermName: string;
  /**
   * Set to true to bring back the old "Running now" wording (card status line, "Running now" filter, class page
   * and plan lines, plan counts, export text). Left false, the app says nothing about classes that are running.
   */
  showRunningNow: boolean;
  /** Set to true to show the "Open to non-majors" chip in the Filters panel. Off by default to keep the panel short; the data and filter logic stay. */
  showNonMajorFilter: boolean;
  /** Set to true to show the "Counts toward" section (Focus, Critical Perspectives) in the Filters panel. Off by default; the tag data and filter logic stay. */
  showCountsTowardFilter: boolean;
  /** Set to true to show the "Not offered recently" chip under Availability in the Filters panel. Off by default; the not-offered logic and data stay. */
  showNotOfferedFilter: boolean;
  /** Set to true to bring back the availability notes on class pages: the "Last offered Spring 2026..." pill and the "Search shows Fall 2026 only..." zero-result note. Off by default; the season icons stay as the only availability signal. Plans and exports keep their wording either way. */
  showAvailabilityNotes: boolean;
  /** Show the short labels (All, AI, Making...) under the area filter icons. Names and tooltips stay either way. */
  showAreaLabels: boolean;
  /** Set to true to bring the Calendar feature back: the header icon, the phone bottom bar item, the Plans page link and the #/calendar page. Off by default; the calendar code stays, and #/calendar sends people to Plans while it is off. */
  showCalendar: boolean;
  /** Set to true to bring back the view settings button in the calendar toolbar, with its "Show weekends" switch. Off by default; Week, Day and Schedule then show Monday to Friday and Month shows all seven days. The weekends logic stays. */
  showCalendarSettings: boolean;
  /** Only let a class into a plan whose term it has run in (a Spring plan takes classes that have run in Spring, a Fall plan those that have run in Fall). Set to false to let any class into any plan. Plans with no term accept anything either way. */
  enforcePlanTerms: boolean;
  /** The upcoming term students are planning for, e.g. "Spring 2027" or "Fall 2027". */
  nextTermName: string;
  /** The day you last checked the data, as YYYY-MM-DD. Shown in the footer of every page. */
  dataLastChecked: string;
  /** Where the advisor card sends students to book time (opens in a new tab). */
  advisorBookingUrl: string;
  /** The advisor card's headline. */
  advisorCardHeadline: string;
  /** The line under the advisor card's headline. */
  advisorCardText: string;
  /** Set to true to show the supporting sentence (advisorCardText) in the compact advisor card on the Saved and plan pages. Off by default. */
  advisorCardShowText: boolean;
  /** The advisor card's button label. */
  advisorBookingLabel: string;
  /** The muted line under the advisor card's text on a class page (only there): why the card is showing. */
  advisorCardClassNote: string;
  /** The short label on the header's advisor button (same booking address). */
  advisorHeaderLabel: string;
  /** Address of your feedback form. The "Give feedback" link (footer and About page) shows it when showFeedbackLink is on. */
  feedbackFormUrl: string;
  /** Show the app name as the visible title on Home. Off: the h1 stays in the page for screen readers only (visually hidden). */
  showHomeTitle: boolean;
  /** Show the tagline under the Home title (APP_COPY.tagline in src/core/config.ts). */
  showTagline: boolean;
  /** Show the footer line (APP_COPY.footerDisclaimer in src/core/config.ts). */
  showFooterDisclaimer: boolean;
  /** Show the About link in the footer. The About page and the #/about address stay in place either way. */
  showAboutLink: boolean;
  /** Show the "Give feedback" link in the footer and on the About page. Needs feedbackFormUrl. */
  showFeedbackLink: boolean;
}

export const semester: SemesterSettings = {
  classSearchTermCode: defaultConfig.classSearchTermCode, // the term code and term names come from src/core/config.ts
  currentTermName: defaultConfig.currentTermName,
  showRunningNow: false,
  showNonMajorFilter: false,
  showCountsTowardFilter: false,
  showNotOfferedFilter: false,
  showAreaLabels: true,
  showAvailabilityNotes: false,
  showCalendar: false,
  showCalendarSettings: false,
  enforcePlanTerms: true,
  nextTermName: defaultConfig.nextTermName,
  dataLastChecked: verification.meta.checkedAt, // the date of the last class search check (data/verification.json)
  advisorBookingUrl: 'https://bookings.cloud.microsoft/book/CS_BridgetAdvisingHours@o365.colorado.edu/?ismsaljsauthenabled=true',
  advisorCardHeadline: 'Not sure what to take?',
  advisorCardText: 'Talk it through with an advisor.',
  advisorCardShowText: false,
  advisorBookingLabel: 'Book a time',
  advisorCardClassNote: 'This one may need checking.',
  advisorHeaderLabel: 'Meet an advisor',
  feedbackFormUrl: 'https://forms.gle/wdVvYTLZjv5w3z4U8',
  showHomeTitle: false,
  showTagline: false,
  showFooterDisclaimer: false,
  showAboutLink: false,
  showFeedbackLink: false,
};

/** True once classSearchTermCode is set, meaning CU has posted nextTermName. */
export const nextTermPosted = termContext(defaultConfig).nextTermPosted;
