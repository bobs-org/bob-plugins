// Strict decoder for `bob bank report -c` `charts`. A malformed object fails
// the whole report with bad-shape. An absent key stays absent; null stays null.
// The plugin never adds money: it only checks types, enums, and partition.

const BANK_CHARTS_VERSION = 1;
const BANK_CHARTS_MAX_BUCKETS = 64;
const BANK_CHARTS_GRANULARITIES = { day: "day", week: "week", quarter: "quarter", year: "year" };
const BANK_CHARTS_BUCKET_KINDS = { day: "day", week: "week", quarter: "quarter", year: "year" };
const BANK_CHARTS_STATES = {
  tracked: "tracked",
  partial: "partial",
  untracked: "untracked",
  awaiting_import: "awaiting_import",
  future: "future",
};
const BANK_CHARTS_CATEGORY_KINDS = { category: "category", cash: "cash", unclassified: "unclassified" };

function bankIsoShiftDays(value, days) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(days)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function bankNonnegCents(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return { ok: false };
  return { ok: true, value };
}

function bankFiniteShare(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function bankNormalizeChartTarget(value) {
  if (value === null) return { ok: true, value: null };
  if (!bankJsonObject(value) || bankString(value.path) === null || !Number.isInteger(value.line) || value.line < 1) {
    return { ok: false };
  }
  return { ok: true, value: { path: value.path, line: value.line } };
}

function bankNormalizeChartTopOut(value) {
  if (!Array.isArray(value) || value.length > 3) return null;
  const entries = [];
  for (const entry of value) {
    if (!bankJsonObject(entry) || bankText(entry.key) === null || bankText(entry.label) === null) return null;
    const cents = bankNonnegCents(entry.out_cents);
    if (!cents.ok) return null;
    entries.push({
      key: entry.key,
      emoji: bankText(entry.emoji) || "",
      label: entry.label,
      out_cents: cents.value,
    });
  }
  return entries;
}

function bankNormalizeChartEntry(value, options) {
  const granularity = options && options.granularity;
  const requireGroupNull = options && options.requireGroupNull === true;
  if (!bankJsonObject(value) || bankString(value.id) === null || bankText(value.label) === null) return null;
  const kind = BANK_CHARTS_BUCKET_KINDS[value.kind];
  const state = BANK_CHARTS_STATES[value.state];
  const start = bankIsoDateOrNull(value.start);
  const end = bankIsoDateOrNull(value.end);
  if (!kind || !state || !start.ok || start.value === null || !end.ok || end.value === null) return null;
  if (start.value > end.value) return null;
  if (!requireGroupNull && kind !== granularity) return null;
  if (value.so_far !== true && value.so_far !== false) return null;
  if (requireGroupNull) {
    if (value.group !== null) return null;
  } else if (value.group !== null && bankString(value.group) === null) {
    return null;
  }
  const inCents = bankNonnegCents(value.in_cents);
  const outCents = bankNonnegCents(value.out_cents);
  if (!inCents.ok || !outCents.ok || typeof value.net_cents !== "number" || !Number.isSafeInteger(value.net_cents)) {
    return null;
  }
  if (value.net_cents !== inCents.value - outCents.value) return null;
  const waiting = bankCount(value.waiting);
  const rows = bankCount(value.rows);
  const topOut = bankNormalizeChartTopOut(value.top_out);
  const target = bankNormalizeChartTarget(value.target);
  if (waiting === null || rows === null || !topOut || !target.ok) return null;
  return {
    id: value.id,
    kind,
    label: value.label,
    start: start.value,
    end: end.value,
    group: value.group === null ? null : value.group,
    so_far: value.so_far === true,
    state,
    in_cents: inCents.value,
    out_cents: outCents.value,
    net_cents: value.net_cents,
    waiting,
    rows,
    top_out: topOut,
    target: target.value,
  };
}

function bankNormalizeChartEntries(value, options) {
  if (!Array.isArray(value)) return null;
  if (!options.allowOversize && value.length > BANK_CHARTS_MAX_BUCKETS) return null;
  const entries = [];
  const ids = new Set();
  for (const raw of value) {
    const entry = bankNormalizeChartEntry(raw, options);
    if (!entry || ids.has(entry.id)) return null;
    ids.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function bankChartsPartitionOk(entries, period) {
  if (!entries.length) return true;
  const periodStart = bankIsoDateOrNull(period && period.start);
  const periodEnd = bankIsoDateOrNull(period && period.end);
  if (!periodStart.ok || periodStart.value === null || !periodEnd.ok || periodEnd.value === null) return false;
  if (entries[0].start !== periodStart.value || entries[entries.length - 1].end !== periodEnd.value) return false;
  for (let index = 1; index < entries.length; index += 1) {
    const expected = bankIsoShiftDays(entries[index - 1].end, 1);
    if (!expected || entries[index].start !== expected) return false;
  }
  return true;
}

function bankChartsGroupsShapeOk(granularity, groups, periodKind) {
  if (granularity === "day" || granularity === "year") return groups.length === 0;
  if (granularity === "week") {
    if (!groups.length) return true;
    if (periodKind === "iso_year") return groups.every((entry) => entry.kind === "quarter");
    return false;
  }
  if (granularity === "quarter") {
    if (!groups.length) return true;
    if (periodKind === "all_time") return groups.every((entry) => entry.kind === "year");
    return false;
  }
  return groups.length === 0;
}

function bankChartsGroupFieldOk(granularity, periodKind, entry) {
  if (granularity === "day" || granularity === "year") return entry.group === null;
  if (granularity === "week" && periodKind === "iso_year") return /^Q[1-4]$/.test(entry.group || "");
  if (granularity === "quarter" && periodKind === "all_time") return /^\d{4}$/.test(entry.group || "");
  return entry.group === null;
}

function bankNormalizeChartCategoryEntry(value) {
  if (!bankJsonObject(value) || bankText(value.key) === null || bankText(value.label) === null) return null;
  const kind = BANK_CHARTS_CATEGORY_KINDS[value.kind];
  const cents = bankNonnegCents(value.out_cents);
  const rows = bankCount(value.rows);
  if (!kind || !cents.ok || rows === null || !bankFiniteShare(value.share)) return null;
  return {
    key: value.key,
    emoji: bankText(value.emoji) || "",
    label: value.label,
    kind,
    out_cents: cents.value,
    share: value.share,
    rows,
  };
}

function bankNormalizeChartCategories(value) {
  if (!bankJsonObject(value) || !Number.isInteger(value.limit) || value.limit < 1 || !Array.isArray(value.series)) {
    return null;
  }
  if (value.series.length > value.limit + 1) return null;
  const series = [];
  const keys = new Set();
  for (const raw of value.series) {
    const entry = bankNormalizeChartCategoryEntry(raw);
    if (!entry || keys.has(entry.key)) return null;
    keys.add(entry.key);
    series.push(entry);
  }
  let rest = null;
  if (value.rest !== null && value.rest !== undefined) {
    if (!bankJsonObject(value.rest)) return null;
    const count = bankCount(value.rest.count);
    const cents = bankNonnegCents(value.rest.out_cents);
    const rows = bankCount(value.rest.rows);
    if (count === null || !cents.ok || rows === null || !bankFiniteShare(value.rest.share)) return null;
    rest = { count, out_cents: cents.value, share: value.rest.share, rows };
  }
  return { limit: value.limit, series, rest };
}

function bankNormalizeCharts(value, period) {
  if (value === null) return { ok: true, value: null };
  if (!bankJsonObject(value) || value.version !== BANK_CHARTS_VERSION) return { ok: false };
  const granularity = BANK_CHARTS_GRANULARITIES[value.granularity];
  if (!granularity) return { ok: false };
  const buckets = bankNormalizeChartEntries(value.buckets, { granularity, requireGroupNull: false });
  const groups = bankNormalizeChartEntries(value.groups, { granularity: null, requireGroupNull: true, allowOversize: true });
  const categories = bankNormalizeChartCategories(value.categories);
  if (!buckets || !groups || !categories) return { ok: false };
  if (groups.length > BANK_CHARTS_MAX_BUCKETS) return { ok: false };
  if (!bankChartsPartitionOk(buckets, period)) return { ok: false };
  const periodKind = period && period.kind;
  if (!bankChartsGroupsShapeOk(granularity, groups, periodKind)) return { ok: false };
  if (!buckets.every((entry) => bankChartsGroupFieldOk(granularity, periodKind, entry))) return { ok: false };
  return {
    ok: true,
    value: { version: BANK_CHARTS_VERSION, granularity, buckets, groups, categories },
  };
}
