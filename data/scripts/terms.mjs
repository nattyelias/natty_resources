// Finds every term in the spreadsheet from its column names, so adding a new term
// only means adding two columns (no code changes):
//   sp27_offered + sp27_instructor   (sp = Spring, su = Summer, fa = Fall, then a 2-digit year)

const SEASONS = {
  sp: { name: 'Spring', order: 0 },
  su: { name: 'Summer', order: 1 },
  fa: { name: 'Fall', order: 2 },
};

export function detectTerms(header) {
  const terms = [];
  for (const cell of header) {
    const match = String(cell ?? '').match(/^(sp|su|fa)(\d{2})_offered$/i);
    if (!match) continue;
    const season = SEASONS[match[1].toLowerCase()];
    const year = 2000 + Number(match[2]);
    terms.push({
      name: `${season.name} ${year}`,
      sortKey: year * 10 + season.order,
      offeredColumn: match[0],
      instructorColumn: match[0].replace(/_offered$/i, '_instructor'),
    });
  }
  return terms.sort((a, b) => a.sortKey - b.sortKey);
}
