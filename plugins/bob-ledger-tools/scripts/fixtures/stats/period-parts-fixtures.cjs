// Deterministic UI fixtures for the period parts layouts. Values are
// presentation-only examples; real numbers and labels remain bob-owned.
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function worked(value, display, quality = "ok", soFar = false) {
  return { value, display, quality, so_far: soFar };
}

function stack(minutes) {
  return [
    { key: "bob.md", minutes: Math.round(minutes * 0.6) },
    { key: "gtd_daily.md", minutes: Math.round(minutes * 0.4) },
  ].filter((entry) => entry.minutes > 0);
}

function child(kind, id, index, options = {}) {
  const future = options.state === "future";
  const notTracked = options.notTracked === true;
  const value = future || notTracked ? null : (options.value === undefined ? 135 + index * 11 : options.value);
  const display = future ? undefined : notTracked ? "–" : Math.floor(value / 60) + "h " + String(value % 60).padStart(2, "0") + "m";
  const reviewState = options.review || (index % 4 === 0 ? "reflected" : index % 4 === 1 ? "drafted" : index % 4 === 2 ? "edited" : "empty");
  const rangeLabel = kind === "week" ? "Oct " + (26 + index) + " – Nov " + (1 + index) : kind === "quarter" ? "Jan 1 – Mar 31" : kind === "year" ? "Jan 1 – Dec 31" : "Jan 1 – Dec 31";
  const row = {
    id,
    kind,
    label: kind === "week" ? id.slice(-3) : id,
    range_label: rangeLabel,
    path: kind === "week" ? "2026/" + id + ".md" : kind === "quarter" ? "2026/" + id + ".md" : (id + ".md"),
    exists: options.exists !== false,
    state: future ? "future" : "closed",
  };
  if (future) return row;
  row.worked = worked(value, display, notTracked ? "not_tracked" : "ok");
  row.done = { value: 20 + index, display: String(20 + index), quality: "ok" };
  row.stack = notTracked ? [] : stack(value);
  row.mostly_display = notTracked ? "" : "bob 60% · gtd_daily 40%";
  row.review = kind === "day" ? null : { state: reviewState, headline: options.headline || (index === 0 ? "A useful child headline" : null), reflection_lead: null };
  row.closeout = kind === "day" ? (index % 2 ? "met" : "missed") : null;
  return row;
}

function column(row, options = {}) {
  const value = row.worked && row.worked.value;
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    caption: row.label,
    path: row.path,
    start: "2026-10-26",
    end: "2026-11-01",
    state: row.state,
    partial: null,
    worked: row.worked || null,
    stack: row.stack || [],
    mark: row.review ? row.review.state : null,
    tick: options.tick || null,
    group: options.group || null,
    partial: options.partial === true ? true : null,
  };
}

function baseReport(base, kind, id, columns, children, groups = [], state = "closed") {
  const report = clone(base);
  report.period = {
    ...report.period,
    id,
    kind,
    title: id === "all" ? "All time" : id,
    state,
    start: "2026-01-01",
    end: "2026-12-31",
  };
  report.columns = columns;
  report.children = children;
  report.groups = groups;
  report.facts = report.facts.map((fact) => ({ ...fact, typical: fact.typical || null }));
  return report;
}

function periodPartsFixtures(base) {
  const quarterColumns = [];
  const quarterChildren = [];
  const ticks = { 0: "Oct", 4: "Nov", 8: "Dec", 13: "Jan" };
  for (let index = 0; index < 14; index += 1) {
    const week = 40 + index;
    const id = "2026-W" + String(week > 53 ? week - 53 : week).padStart(2, "0");
    const state = index > 10 ? "future" : "closed";
    const row = child("week", id, index, { state, notTracked: index === 0, headline: index === 0 ? "A quarter headline" : null });
    const col = column(row, {
      tick: ticks[index] || null,
      partial: index === 0,
    });
    if (index === 0) { col.start = "2026-10-01"; col.end = "2026-10-04"; }
    if (state === "future") col.worked = null;
    quarterChildren.push(row);
    quarterColumns.push(col);
  }
  const currentQuarter = baseReport(base, "quarter", "2026-Q4", quarterColumns, quarterChildren, [], "current");
  const closedQuarterChildren = Array.from({ length: 13 }, (_, index) => child("week", "2026-W" + String(index + 1).padStart(2, "0"), index, { headline: index === 0 ? "A closed quarter headline" : null }));
  const closedQuarter = baseReport(base, "quarter", "2026-Q2", closedQuarterChildren.map((row, index) => column(row, { tick: index === 0 ? "Apr" : index === 4 ? "May" : index === 8 ? "Jun" : null })), closedQuarterChildren);

  const yearWeeks = [];
  for (let index = 0; index < 53; index += 1) {
    const week = index === 52 ? 53 : index + 1;
    const id = "2026-W" + String(week).padStart(2, "0");
    const quarter = week <= 13 ? 1 : week <= 26 ? 2 : week <= 39 ? 3 : 4;
    const row = child("week", id, index, { group: "Q" + quarter, notTracked: index < 22 });
    const col = column(row, { group: "Q" + quarter });
    if (index < 22) col.worked = { ...worked(null, "–", "not_tracked"), value: null };
    yearWeeks.push(col);
  }
  const yearQuarters = [1, 2, 3, 4].map((quarter, index) => child("quarter", "2026-Q" + quarter, index));
  const year = baseReport(base, "year", "2026", yearWeeks, yearQuarters, [1, 2, 3, 4].map((q) => ({ key: "Q" + q, label: "Q" + q, worked_display: ["412h 10m", "390h 00m", "401h 30m", "275h 05m"][q - 1] })), "current");

  const allColumns = [];
  for (const [yearNum, count] of [[2024, 4], [2025, 4], [2026, 4]]) {
    for (let quarter = 1; quarter <= count; quarter += 1) {
      const row = child("quarter", yearNum + "-Q" + quarter, quarter - 1, { notTracked: yearNum < 2026 });
      allColumns.push(column(row, { group: String(yearNum) }));
    }
  }
  const allYears = [child("year", "2024", 0, { notTracked: true, exists: true }), child("year", "2025", 1, { notTracked: true, exists: false }), child("year", "2026", 2)];
  const all = baseReport(base, "all", "all", allColumns, allYears, [
    { key: "2024", label: "2024", worked_display: "–" },
    { key: "2025", label: "2025", worked_display: "–" },
    { key: "2026", label: "2026", worked_display: "1,204h 10m" },
  ], "current");
  return { currentQuarter, closedQuarter, year, all };
}

module.exports = { periodPartsFixtures };
