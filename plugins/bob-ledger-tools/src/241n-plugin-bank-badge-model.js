// The Bank Badge is a read-only projection of one bob bank report. Keep its
// visibility, copy, tone, tooltip, and target decisions in this pure model so
// every host paints the same contract.

const BANK_BADGE_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function bankBadgeDate(value, includeYear = false, periodEnd = null) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const endYear = typeof periodEnd === "string" && /^\d{4}-/.test(periodEnd)
    ? Number(periodEnd.slice(0, 4))
    : null;
  const withYear = includeYear || (endYear !== null && year !== endYear);
  return `${BANK_BADGE_MONTHS[month - 1]} ${day}${withYear ? `, ${year}` : ""}`;
}

function bankBadgeKind(reportKind) {
  return ({ day: "day", week: "week", quarter: "quarter", year: "iso_year", all: "all_time" })[reportKind] || null;
}

function bankBadgeAmount(cents, kind) {
  if (!Number.isSafeInteger(cents)) return "";
  const magnitude = Math.abs(cents);
  if (kind === "day" || kind === "week" || magnitude < 100) {
    const dollars = Math.floor(magnitude / 100);
    const remainder = magnitude % 100;
    return `$${bankGroupThousands(dollars)}.${String(remainder).padStart(2, "0")}`;
  }
  const dollars = Math.floor((magnitude + 50) / 100);
  return `$${bankGroupThousands(dollars)}`;
}

function bankBadgeCoverageText(report, kind, today) {
  const coverage = report && report.coverage;
  const period = report && report.period;
  if (!coverage || !period) return "";
  const periodStart = typeof period.start === "string" ? period.start : "";
  const periodEnd = typeof period.end === "string" ? period.end : "";
  const parts = [];
  if (kind === "all") {
    const since = bankBadgeDate(periodStart, true, periodEnd);
    if (since) parts.push(`since ${since}`);
  } else if (typeof coverage.start === "string" && periodStart && coverage.start > periodStart) {
    const since = bankBadgeDate(coverage.start, false, periodEnd);
    if (since) parts.push(`since ${since}`);
  }
  if (
    periodEnd && typeof today === "string" && periodEnd < today &&
    typeof coverage.through === "string" && coverage.through < periodEnd
  ) {
    const through = bankBadgeDate(coverage.through, false, periodEnd);
    if (through) parts.push(`to ${through}`);
  }
  return parts.join(" · ");
}

function bankBadgeMoneyText(cents, explicitPlus = false) {
  if (!Number.isSafeInteger(cents)) return "";
  const text = bankFormatCents(Math.abs(cents));
  if (!text) return "";
  return explicitPlus ? `+${text.replace(/^\+/, "")}` : text.replace(/^\+/, "");
}

function bankBadgeLocation(value) {
  return value && typeof value.path === "string" && value.path &&
    Number.isInteger(value.line) && value.line > 0 &&
    typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    ? { path: value.path, line: value.line, date: value.date }
    : null;
}

function bankBadgeTarget(report, context) {
  const kind = context.kind;
  const navigation = report.navigation && typeof report.navigation === "object"
    ? report.navigation
    : null;
  const waiting = navigation && bankBadgeLocation(navigation.waiting);
  if (waiting) return { ...waiting, type: "waiting" };

  const first = navigation && bankBadgeLocation(navigation.first);
  if (first && (kind === "day" || kind === "week" || (Array.isArray(navigation.months) && navigation.months.length === 1))) {
    return { ...first, type: "day" };
  }

  // Older bob versions have no navigation object. Their day report still
  // identifies the note and heading that the daily strip describes.
  if (!navigation && kind === "day") {
    const day = (Array.isArray(report.days) ? report.days : []).find((entry) => entry && entry.date === context.day);
    if (day && typeof day.path === "string" && day.path && Number.isInteger(day.line) && day.line > 0) {
      return { path: day.path, line: day.line, date: context.day, type: "day" };
    }
  }
  return { path: "bank.md", line: 1, date: null, type: "hub" };
}

function bankBadgeTargetAction(target) {
  if (target && target.type === "waiting") return "Click to open the oldest waiting row (Ctrl+Enter files it)";
  if (target && target.type === "day") {
    const date = bankBadgeDate(target.date, true);
    return `Click to open ${date || target.date} in the bank month note`;
  }
  return "Click to open bank.md";
}

function bankBadgeTooltip(report, context, parts, target) {
  const period = report.period || {};
  const lines = [];
  const label = period.label || period.key || (context.day || "Bank period");
  lines.push(`${label}${period.so_far ? " · so far" : ""}`);

  const inCents = report.totals.in_cents;
  const outCents = report.totals.out_cents;
  if (inCents > 0 || outCents > 0) {
    const net = bankFormatCents(report.totals.net_cents);
    lines.push(`In ${bankBadgeMoneyText(inCents, true)} · Out ${bankBadgeMoneyText(outCents)}${net ? ` · Net ${net}` : ""}`);
  }

  const topOut = (Array.isArray(report.breakdown) ? report.breakdown : [])
    .filter((entry) => entry && Number.isSafeInteger(entry.out_cents) && entry.out_cents > 0)
    .slice()
    .sort((left, right) => right.out_cents - left.out_cents)
    .slice(0, 3);
  if (topOut.length) {
    lines.push(`Top out: ${topOut.map((entry) => `${entry.emoji ? `${entry.emoji} ` : ""}${entry.label} ${bankBadgeMoneyText(entry.out_cents)}`).join(" · ")}`);
  }

  const totals = report.totals;
  const notCounted = [];
  const transfers = Math.max(Number(totals.transfer_out_cents) || 0, Number(totals.transfer_in_cents) || 0);
  if (transfers > 0) notCounted.push(`transfers ↔ ${bankBadgeMoneyText(transfers)}`);
  if (totals.unclassified_in_cents > 0) notCounted.push(`unclassified in ${bankBadgeMoneyText(totals.unclassified_in_cents, true)}`);
  if (totals.cash_traced_cents > 0) notCounted.push(`cash traced ${bankBadgeMoneyText(totals.cash_traced_cents)}`);
  if (notCounted.length) lines.push(`Not counted: ${notCounted.join(" · ")}`);

  const waiting = Number.isInteger(report.waiting.period) ? report.waiting.period : 0;
  if (waiting > 0) {
    const oldest = (report.navigation && report.navigation.waiting && report.navigation.waiting.date) || report.waiting.oldest;
    const oldestText = oldest ? ` · oldest ${bankBadgeDate(oldest, false, period.end) || oldest}` : "";
    const all = context.kind === "day" && context.day === context.today && Number.isInteger(report.waiting.all)
      ? ` · ${report.waiting.all} across all months`
      : "";
    lines.push(`${waiting} ${waiting === 1 ? "row" : "rows"} waiting${oldestText}${all}`);
  }

  if (report.coverage && (report.coverage.tracked_since || report.coverage.imported_through)) {
    const tracked = report.coverage.tracked_since
      ? bankBadgeDate(report.coverage.tracked_since, false, period.end)
      : "";
    const imported = report.coverage.imported_through
      ? bankBadgeDate(report.coverage.imported_through, false, period.end)
      : "";
    const coverage = [];
    if (tracked) coverage.push(`Tracked since ${tracked}`);
    if (imported) coverage.push(`imported through ${imported}`);
    if (coverage.length) lines.push(coverage.join(" · "));
  }

  lines.push(bankBadgeTargetAction(target));
  if (context.stale) {
    lines.push(context.refreshFailed
      ? "Refresh failed; last good values shown."
      : "Values are being refreshed; last good values shown.");
  }
  return lines.join("\n");
}

function bankBadgeAriaLabel(report, context, parts, target) {
  const period = report.period || {};
  const periodLabel = period.label || period.key || context.day || "this period";
  const phrases = [`Bank, ${periodLabel}${period.so_far ? ", so far" : ""}`];
  for (const part of parts) {
    if (part.key === "in" || part.key === "out") phrases.push(`${part.words} ${part.exact}`);
    else if (part.key === "waiting") phrases.push(`${part.amount} ${Number(part.amount) === 1 ? "row" : "rows"} waiting`);
    else if (part.key === "coverage") {
      for (const phrase of part.fragments || []) {
        phrases.push(phrase.startsWith("since ") ? `tracked ${phrase}` : `available ${phrase}`);
      }
    }
  }
  phrases.push(bankBadgeTargetAction(target).replace(/^Click to /, "Opens ").replace(/ \(Ctrl\+Enter files it\)/, ""));
  return phrases.join(": ");
}

function bankBadgeValidDate(value) {
  try {
    if (typeof dayStripDateParts === "function") return dayStripDateParts(value) !== null;
  } catch (error) {
    // Fall through to the pattern check.
  }
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function bankBadgeShiftDay(value, amount) {
  try {
    if (typeof dayStripShiftDay === "function") return dayStripShiftDay(value, amount);
  } catch (error) {
    // Fall through to null.
  }
  return "";
}

function bankBadgeExpectedBounds(kind, requestedId) {
  try {
    const id = typeof requestedId === "string" ? requestedId.trim() : "";
    if (!id) return null;
    if (kind === "day") {
      if (!bankBadgeValidDate(id)) return null;
      return { key: id, start: id, end: id };
    }
    if (kind === "week") {
      const match = /^(\d{4})-W(\d{2})$/.exec(id);
      if (!match || typeof periodNotesIsoWeekMonday !== "function") return null;
      const start = periodNotesIsoWeekMonday(Number(match[1]), Number(match[2]));
      if (!start) return null;
      const end = bankBadgeShiftDay(start, 6);
      if (!end) return null;
      return { key: id, start, end };
    }
    if (kind === "quarter") {
      const match = /^(\d{4})-Q([1-4])$/.exec(id);
      if (!match || typeof periodNotesIsoWeekMonday !== "function") return null;
      const year = Number(match[1]);
      const quarter = Number(match[2]);
      const start = periodNotesIsoWeekMonday(year, (quarter - 1) * 13 + 1);
      if (!start) return null;
      const nextStart = quarter < 4
        ? periodNotesIsoWeekMonday(year, quarter * 13 + 1)
        : periodNotesIsoWeekMonday(year + 1, 1);
      if (!nextStart) return null;
      const end = bankBadgeShiftDay(nextStart, -1);
      if (!end) return null;
      return { key: id, start, end };
    }
    if (kind === "year") {
      if (!/^\d{4}$/.test(id) || typeof periodNotesIsoWeekMonday !== "function") return null;
      const year = Number(id);
      const start = periodNotesIsoWeekMonday(year, 1);
      const nextStart = periodNotesIsoWeekMonday(year + 1, 1);
      if (!start || !nextStart) return null;
      const end = bankBadgeShiftDay(nextStart, -1);
      if (!end) return null;
      return { key: id, start, end };
    }
    if (kind === "all") {
      if (id !== "all" && id !== "all_time") return null;
      return { key: "all_time", start: null, end: null };
    }
  } catch (error) {
    return null;
  }
  return null;
}

function bankBadgePeriodIdentityValid(report, ctx) {
  const expectedKind = bankBadgeKind(ctx.kind);
  const period = report && report.period;
  if (!period || expectedKind === null || period.kind !== expectedKind) return false;
  const requestedId = typeof ctx.periodId === "string" && ctx.periodId
    ? ctx.periodId
    : ctx.kind === "day" && typeof ctx.day === "string" && ctx.day
      ? ctx.day
      : null;
  if (ctx.kind === "day") {
    if (!requestedId || !bankBadgeValidDate(requestedId)) return false;
    if (period.start !== requestedId || period.end !== requestedId) return false;
    if (typeof period.key === "string" && period.key && period.key !== requestedId) return false;
    return true;
  }
  if (ctx.kind === "all") {
    if (!requestedId) return false;
    if (period.key !== "all_time") return false;
    if (!bankBadgeValidDate(period.start) || !bankBadgeValidDate(period.end)) return false;
    return true;
  }
  if (!requestedId) return false;
  const expected = bankBadgeExpectedBounds(ctx.kind, requestedId);
  if (!expected) return false;
  if (period.key !== expected.key) return false;
  return period.start === expected.start && period.end === expected.end;
}

function bankBadgeModel(report, context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  if (report && report.teaching_empty === true) return { state: "hidden", reason: "teaching-empty" };
  if (
    !report || report.command !== "report" || !report.period || !report.totals || !report.waiting ||
    !Number.isSafeInteger(report.totals.in_cents) || report.totals.in_cents < 0 ||
    !Number.isSafeInteger(report.totals.out_cents) || report.totals.out_cents < 0 ||
    !Number.isInteger(report.waiting.period) || report.waiting.period < 0
  ) {
    return { state: "unavailable", reason: "invalid-report", hint: "The bank report could not be read." };
  }
  if (!bankBadgePeriodIdentityValid(report, ctx)) {
    return { state: "unavailable", reason: "period-mismatch", hint: "The bank report does not match this stats strip." };
  }
  const today = typeof ctx.today === "string" ? ctx.today : "";
  const future = (ctx.kind === "day" && typeof ctx.day === "string" && today && ctx.day > today) ||
    (typeof report.period.start === "string" && today && report.period.start > today);
  if (future) return { state: "hidden", reason: "future" };

  const inCents = report.totals.in_cents;
  const outCents = report.totals.out_cents;
  const waiting = report.waiting.period;
  if (inCents === 0 && outCents === 0 && waiting === 0) return { state: "hidden", reason: "empty" };

  const parts = [];
  if (inCents > 0) {
    const amount = bankBadgeAmount(inCents, ctx.kind);
    parts.push({ key: "in", words: "in", amount: `+${amount}`, exact: bankBadgeMoneyText(inCents, true) });
  }
  if (outCents > 0) {
    const amount = bankBadgeAmount(outCents, ctx.kind);
    parts.push({ key: "out", words: "out", amount, exact: bankBadgeMoneyText(outCents) });
  }
  if (waiting > 0) {
    parts.push({
      key: "waiting",
      words: "waiting",
      amount: String(waiting),
      exact: String(waiting),
      amountFirst: true,
    });
  }
  const coverageText = bankBadgeCoverageText(report, ctx.kind, today);
  if (coverageText) {
    const fragments = coverageText.split(" · ");
    for (const fragment of fragments) {
      const space = fragment.indexOf(" ");
      parts.push({
        key: "coverage",
        words: space < 0 ? fragment : fragment.slice(0, space),
        amount: space < 0 ? "" : fragment.slice(space + 1),
        exact: fragment,
        fragments: [fragment],
      });
    }
  }

  const tone = inCents === 0 && outCents === 0 ? "waiting" : inCents > outCents ? "surplus" : "neutral";
  const target = bankBadgeTarget(report, ctx);
  const text = ["BANK", ...parts.map((part) => part.amountFirst
    ? `${part.amount} ${part.words}`
    : [part.words, part.amount].filter(Boolean).join(" "))].join(" · ");
  return {
    state: "badge",
    label: "BANK",
    kind: ctx.kind,
    tone,
    parts,
    text,
    ariaLabel: bankBadgeAriaLabel(report, ctx, parts, target),
    tooltip: bankBadgeTooltip(report, ctx, parts, target),
    target,
    stale: ctx.stale === true,
  };
}
