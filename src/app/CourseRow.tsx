import { firstUpcomingSection, showInstructors, upcomingInstructors } from "../core/courses.ts";
import type { ModeCourse } from "../core/courses.ts";
import { verificationFor, verificationLabel } from "../core/verification.ts";
import { ctx, verificationCtx } from "./data.ts";

export function CourseRow({ entry }: { entry: ModeCourse }) {
  const { course, displayCode } = entry;
  const section = firstUpcomingSection(course, ctx);
  const instructor = showInstructors(course) ? upcomingInstructors(course, ctx) : "";
  const trust = verificationFor(course.id, verificationCtx);
  return (
    <li className="row">
      <div className="row-head">
        <span>{displayCode}</span>
        {course.credits && <span>{course.credits} cr</span>}
      </div>
      <h2 className="row-title">{course.title}</h2>
      <p className="row-meta">{section?.meets || "No meeting time posted"}</p>
      {instructor && <p className="row-meta">{instructor}</p>}
      <p className="row-trust" data-status={trust.status}>
        {verificationLabel(trust.status, trust.checkedAt)}
      </p>
    </li>
  );
}
