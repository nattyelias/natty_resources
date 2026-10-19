// Loads the data files and builds the pieces the screen passes to the core functions.
// Nothing here changes the data.
import courses from "../../data/courses.json";
import extra from "../../data/courses-extra.json";
import verification from "../../data/verification.json";
import { defaultConfig, termContext } from "../core/config.ts";
import { allCourses } from "../core/courses.ts";

export const ctx = termContext(defaultConfig);
export const all = allCourses(courses, extra);
export const verificationCtx = { verification };
export const termName = defaultConfig.nextTermName;
