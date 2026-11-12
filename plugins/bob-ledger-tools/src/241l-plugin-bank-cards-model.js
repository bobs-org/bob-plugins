// Pure presentation models for the month and queue bank cards, plus the
// daily-note bank chip. Bob supplies every amount and count.

const BANK_CARD_HUES = ["aqua", "blue", "green", "magenta", "orange", "red", "violet", "yellow"];
const BANK_CARD_HEAT_LEVELS = 4;

function bankCardParseFence(source) {
  const values = new Map();
  const errors = [];
  const lines = typeof source === "string" ? source.split(/\r?\n/) : [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\s+#.*$/, "").trim();
    if (!raw || raw.startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/.exec(raw);
    if (!match) {
      errors.push(`Line ${index + 1}: use "view: month" or "view: queue".`);
      continue;
    }
    const key = match[1].toLowerCase();
    if (key !== "view") {
      errors.push(`Unknown option "${match[1]}". This fence accepts only "view".`);
      continue;
    }
    if (values.has(key)) {
      errors.push("Use one view option.");
      continue;
    }
    values.set(key, match[2].replace(/^(?:"([^"]*)"|'([^']*)')$/, (_, a, b) => a || b));
  }
  const view = values.get("view");
  if (!view) errors.push("Add " + '"view: month"' + " or " + '"view: queue"' + ".");
  else if (view !== "month" && view !== "queue") errors.push(`Unknown view "${view}". Use month or queue.`);
  return errors.length ? { ok: false, errors } : { ok: true, view };
}

function bankCardValidateMonthFrontmatter(path, value) {
  const fileMonth = bankMonthFromPath(path);
  const month = typeof value === "string" ? value.trim() : "";
  if (!fileMonth) {
    return { ok: false, code: "month-path", message: "Month cards belong in bank/YYYY-MM.md." };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { ok: false, code: "month-frontmatter", message: "Add a month: YYYY-MM value to this note's frontmatter." };
  }
  if (month !== fileMonth.key) {
    return {
      ok: false,
      code: "month-mismatch",
      message: `Frontmatter month ${month} does not match this file's ${fileMonth.key} name.`,
    };
  }
  return { ok: true, month };
}

function bankCardDate(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? day
    : null;
}

function bankCardDaysInMonth(month) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 0;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function bankCardIsoDate(month, dayNumber) {
  if (bankCardDaysInMonth(month) < dayNumber || dayNumber < 1) return null;
  return `${month}-${String(dayNumber).padStart(2, "0")}`;
}

function bankCardHeatBuckets(days) {
  const sorted = (Array.isArray(days) ? days : [])
    .map((day) => day && day.out_cents)
    .filter((cents) => Number.isSafeInteger(cents) && cents > 0)
    .sort((left, right) => left - right);
  const spans = new Map();
  for (let index = 0; index < sorted.length; index += 1) {
    const value = sorted[index];
    const span = spans.get(value) || { start: index, end: index };
    span.end = index;
    spans.set(value, span);
  }
  const buckets = new Map();
  for (const [value, span] of spans) {
    const midpoint = (span.start + span.end) / 2;
    const bucket = Math.min(
      BANK_CARD_HEAT_LEVELS,
      Math.floor((midpoint / Math.max(sorted.length, 1)) * BANK_CARD_HEAT_LEVELS) + 1,
    );
    buckets.set(value, bucket);
  }
  return buckets;
}

function bankCardMonthHeatModel(month, reportDays, options = {}) {
  const count = bankCardDaysInMonth(month);
  if (!count) return null;
  const days = Array.isArray(reportDays) ? reportDays : [];
  const byDate = new Map(days.filter((day) => day && bankCardDate(day.date)).map((day) => [day.date, day]));
  const headingDates = options.headingDates instanceof Set
    ? options.headingDates
    : new Set(Array.isArray(options.headingDates) ? options.headingDates : []);
  const today = bankCardDate(options.today) || "";
  const heatBuckets = bankCardHeatBuckets(days);
  const cells = [];
  for (let number = 1; number <= count; number += 1) {
    const date = bankCardIsoDate(month, number);
    const source = byDate.get(date) || null;
    const outCents = source && Number.isSafeInteger(source.out_cents) ? Math.max(0, source.out_cents) : 0;
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    cells.push({
      date,
      day: number,
      weekday,
      outCents,
      bucket: outCents === 0 ? 0 : (heatBuckets.get(outCents) || 1),
      waiting: source && Number.isInteger(source.waiting) ? source.waiting : 0,
      today: date === today,
      hasHeading: headingDates.has(date),
      heading: source && typeof source.heading === "string" ? source.heading : "",
    });
  }
  const first = cells[0];
  return {
    month,
    leading: first ? first.weekday : 0,
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    cells,
  };
}

function bankCardMonthModel(report, month, options = {}) {
  if (report && report.teaching_empty === true) {
    return { kind: "teaching-empty", command: "report" };
  }
  const period = report && report.period;
  if (
    !report ||
    report.command !== "report" ||
    !period ||
    period.kind !== "month" ||
    period.key !== month ||
    !report.totals ||
    !Array.isArray(report.breakdown) ||
    !Array.isArray(report.days)
  ) {
    return { kind: "invalid-report", message: "bob bank report did not return this month." };
  }
  const heat = bankCardMonthHeatModel(month, report.days, {
    headingDates: options.headingDates,
    today: report.today,
  });
  if (!heat) return { kind: "invalid-report", message: "This note does not name a valid bank month." };
  const waitingRows = [];
  for (const day of report.days) {
    for (const row of Array.isArray(day.rows) ? day.rows : []) {
      if (row && row.acknowledged === false) {
        waitingRows.push({ ...row, date: row.date || day.date, path: row.path || day.path });
      }
    }
  }
  waitingRows.sort((left, right) =>
    String(left.date || "").localeCompare(String(right.date || "")) ||
    Number(left.line || 0) - Number(right.line || 0),
  );
  return {
    kind: "month",
    month,
    title: period.label || month,
    soFar: period.so_far === true,
    accounts: Array.isArray(report.accounts) ? report.accounts : [],
    totals: report.totals,
    waiting: report.waiting && Number.isInteger(report.waiting.period) ? report.waiting.period : 0,
    flagged: Number.isInteger(report.flagged) ? report.flagged : 0,
    breakdown: report.breakdown.map((entry) => ({
      ...entry,
      share: Math.max(0, Math.min(1, Number.isFinite(entry.share) ? entry.share : 0)),
    })),
    days: heat.cells,
    heat,
    firstWaiting: waitingRows[0] || null,
    empty: waitingRows.length === 0 && report.days.every((day) => !day.rows || day.rows.length === 0),
    monthPaths: Array.isArray(options.monthPaths) ? options.monthPaths : [],
  };
}

function bankCardDedupeIds(ids) {
  return bankDedupeIds(ids);
}

function bankCardRecentMonths(paths, reports, limit = 6) {
  const entries = Array.isArray(paths) ? paths : [];
  const byMonth = reports instanceof Map ? reports : new Map(Object.entries(reports || {}));
  return entries
    .filter((entry) => entry && typeof entry.month === "string" && bankMonthFromPath(entry.path))
    .slice()
    .sort((left, right) => right.month.localeCompare(left.month))
    .slice(0, Math.max(0, Math.min(6, Number.isInteger(limit) ? limit : 6)))
    .map((entry) => {
      const result = byMonth.get(entry.month) || null;
      const report = result && result.report ? result.report : result;
      const valid = report && report.command === "report" && report.period && report.period.key === entry.month && report.period.kind === "month";
      return {
        path: entry.path,
        month: entry.month,
        report: valid ? report : null,
        outCents: valid && report.totals && Number.isSafeInteger(report.totals.out_cents) ? report.totals.out_cents : null,
        label: valid ? (report.period.label || entry.month) : entry.month,
        stale: Boolean(result && result.stale),
        error: result && result.error ? result.error : null,
      };
    });
}

function bankCardQueueModel(report, options = {}) {
  if (report && report.teaching_empty === true) {
    return { kind: "teaching-empty", command: "list" };
  }
  if (!report || report.command !== "list" || !Array.isArray(report.days)) {
    return { kind: "invalid-report", message: "bob bank list did not return a waiting queue." };
  }
  const rows = [];
  for (const day of report.days) {
    for (const row of Array.isArray(day.rows) ? day.rows : []) {
      if (!row || row.acknowledged === true) continue;
      rows.push({
        ...row,
        date: row.date || day.date || "",
        path: row.path || day.path || "",
        heading: day.heading || "",
        dayLine: day.line,
      });
    }
  }
  rows.sort((left, right) =>
    String(left.date).localeCompare(String(right.date)) ||
    String(left.path).localeCompare(String(right.path)) ||
    Number(left.line || 0) - Number(right.line || 0),
  );
  const byDay = new Map();
  for (const row of rows) {
    const key = `${row.path}\u0000${row.date}`;
    if (!byDay.has(key)) {
      byDay.set(key, {
        path: row.path,
        date: row.date,
        heading: row.heading,
        line: row.dayLine,
        rows: [],
        ids: [],
        idLess: 0,
      });
    }
    const group = byDay.get(key);
    group.rows.push(row);
    if (typeof row.id === "string" && row.id.trim()) group.ids.push(row.id.trim());
    else group.idLess += 1;
  }
  const days = Array.from(byDay.values()).map((day) => ({ ...day, ids: bankCardDedupeIds(day.ids) }));
  const monthPaths = Array.isArray(options.monthPaths) ? options.monthPaths : [];
  const recentMonths = bankCardRecentMonths(monthPaths, options.monthReports, 6);
  return {
    kind: "queue",
    today: report.today || "",
    accounts: Array.isArray(report.accounts) ? report.accounts : [],
    counts: report.counts || { rows: rows.length, waiting: rows.length, flagged: 0 },
    rows,
    days,
    empty: rows.length === 0,
    recentMonths,
  };
}

function bankCardDailyChipModel(report, date, today) {
  if (report && report.teaching_empty === true) return { kind: "teaching-empty", date };
  if (!report || report.command !== "report" || !Array.isArray(report.days)) {
    return { kind: "invalid-report", date };
  }
  const day = report.days.find((entry) => entry && entry.date === date);
  if (!day || !Number.isSafeInteger(day.out_cents) || !Number.isSafeInteger(day.in_cents)) {
    return { kind: "day-unavailable", date };
  }
  return {
    kind: "day",
    date,
    outCents: day.out_cents,
    inCents: day.in_cents,
    waitingAll: date === today && report.waiting && Number.isInteger(report.waiting.all)
      ? report.waiting.all
      : null,
  };
}
