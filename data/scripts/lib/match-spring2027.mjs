// Shared by attach-spring2027.mjs and report-spring2027.mjs: how a merged section finds its class
// in courses.json, and how sheet instructor names are written. See attach-spring2027.mjs for the rules.
export const termRank = (t) => {
  const [season = '', year = ''] = t.split(' ');
  return (Number(year) || 0) * 10 + (['spring', 'summer', 'fall'].indexOf(season.toLowerCase()) + 1);
};
export const words = (t) =>
  String(t ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(advanced|adv)\s+((special|critical)\s+)?topics:?/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
export const norm = (t) => words(t).join(' ');

// "Mahajan, A., Gross, M." -> "A. Mahajan, M. Gross"; the pull's "D. Rankin" passes through unchanged.
export function displayName(text) {
  const pairs = [...text.matchAll(/([A-Za-z][A-Za-z'-]*)\.?\s*,\s*([A-Za-z])\.?/g)];
  if (!pairs.length) return text;
  const rest = text.replace(/([A-Za-z][A-Za-z'-]*)\.?\s*,\s*([A-Za-z])\.?/g, '').replace(/[\s,]/g, '');
  if (rest) return text; // something unexpected is left over: keep the posted text
  return pairs.map((m) => `${m[2].toUpperCase()}. ${m[1]}`).join(', ');
}

export function findClass(rec, courses) {
  const cands = courses.filter((c) => c.code === rec.courseCode);
  if (!cands.length) return { reason: 'no class with this code' };
  const titleRequired = cands.length > 1 || cands.some((c) => c.specialTopic);
  if (!titleRequired) return { course: cands[0] };
  const t = norm(rec.title);
  const exact = cands.filter((c) => norm(c.title) === t);
  if (exact.length === 1) return { course: exact[0] };
  const w = words(rec.title);
  const subset = w.length ? cands.filter((c) => w.every((x) => words(c.title).includes(x))) : [];
  if (subset.length === 1) return { course: subset[0] };
  return { reason: cands.length > 1 ? `shared code, no unique title match among ${cands.length} classes` : 'special-topics code, title does not match' };
}
