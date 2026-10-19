// What we know about how well a class matches CU class search. Pure functions: the verification
// data (data/verification.json) arrives inside the ctx argument, so nothing here reads a file.

import type { ClassVerification, VerificationFile, VerificationStatus } from './types.ts';

export interface VerificationContext {
  /** The parsed data/verification.json, or null when no check has been run. */
  verification: VerificationFile | null;
}

/**
 * The class-level status, worked out from the class's sections:
 *   "mismatch"   any section differs from class search
 *   "pending"    any section is not in class search yet, and none differ
 *   "confirmed"  every section is confirmed
 *   "unchecked"  anything else: no sections checked, or a mix with only cancelled or new sections
 * checkedAt is the latest check date among the sections.
 */
export function verificationFor(courseId: string, ctx: VerificationContext): ClassVerification {
  const sections = Object.values(ctx.verification?.sections[courseId] ?? {});
  if (!sections.length) return { status: 'unchecked', checkedAt: null };
  const checkedAt = sections.map((s) => s.checkedAt).sort().at(-1) ?? null;
  const has = (status: string) => sections.some((s) => s.status === status);
  let status: VerificationStatus = 'unchecked';
  if (has('mismatch')) status = 'mismatch';
  else if (has('pending')) status = 'pending';
  else if (sections.every((s) => s.status === 'confirmed')) status = 'confirmed';
  return { status, checkedAt };
}

/** The line a UI shows for a status. Pass checkedAt for "confirmed" so the line carries the date. */
export function verificationLabel(status: VerificationStatus, checkedAt?: string | null): string {
  switch (status) {
    case 'confirmed':
      return checkedAt ? `Confirmed in CU class search, ${checkedAt}` : 'Confirmed in CU class search';
    case 'mismatch':
      return 'Differs from CU class search, check before registering';
    case 'pending':
      return 'From the ATLAS schedule, not in CU class search yet';
    case 'unchecked':
      return 'Not checked yet';
  }
}
