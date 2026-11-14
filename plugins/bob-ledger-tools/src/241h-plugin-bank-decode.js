// --- Bank JSON boundary (bob-cli-kd.6.1.1) --------------------------------
// Decode `bob bank list|report -f json` without duplicating accounting.
// Integer cents stay integers; a schema mismatch or bad JSON is never a
// zero-dollar success. Presentation helpers only format what bob already
// computed.

const BANK_SCHEMA_VERSION = 1;
const BANK_CACHE_SIZE = 32;
const BANK_REVALIDATE_DEBOUNCE_MS = 400;
const BANK_ROLLOVER_INTERVAL_MS = 60 * 1000;

function bankJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bankString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bankText(value) {
  return typeof value === "string" ? value : null;
}

function bankCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function bankIsoDateOrNull(value) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return { ok: false };
  return { ok: true, value };
}

function bankNormalizeCoverage(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!bankJsonObject(value) || typeof value.complete !== "boolean") return { ok: false };
  const trackedSince = bankIsoDateOrNull(value.tracked_since);
  const importedThrough = bankIsoDateOrNull(value.imported_through);
  const start = bankIsoDateOrNull(value.start);
  const through = bankIsoDateOrNull(value.through);
  if (!trackedSince.ok || !importedThrough.ok || !start.ok || !through.ok) return { ok: false };
  return {
    ok: true,
    value: {
      tracked_since: trackedSince.value,
      imported_through: importedThrough.value,
      start: start.value,
      through: through.value,
      complete: value.complete,
    },
  };
}

function bankNormalizeNavigationLocation(value) {
  if (value === null) return { ok: true, value: null };
  if (!bankJsonObject(value) || bankString(value.path) === null || !Number.isInteger(value.line) || value.line < 1) {
    return { ok: false };
  }
  const date = bankIsoDateOrNull(value.date);
  if (!date.ok || date.value === null) return { ok: false };
  return { ok: true, value: { path: value.path, line: value.line, date: date.value } };
}

function bankNormalizeNavigation(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!bankJsonObject(value) || !Array.isArray(value.months)) return { ok: false };
  const waiting = bankNormalizeNavigationLocation(value.waiting);
  const first = bankNormalizeNavigationLocation(value.first);
  if (!waiting.ok || !first.ok || value.months.some((month) => bankString(month) === null)) return { ok: false };
  return {
    ok: true,
    value: { waiting: waiting.value, first: first.value, months: value.months.slice() },
  };
}

function bankSafeCents(value, options = {}) {
  if (options.allowNull === true && value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return { ok: false };
  }
  return { ok: true, value };
}

function bankLocalDate(now = new Date()) {
  try {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } catch (error) {
    return "";
  }
}

function bankGroupThousands(value) {
  const raw = String(value);
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (index > 0 && (raw.length - index) % 3 === 0) {
      out += ",";
    }
    out += raw[index];
  }
  return out;
}

function bankFormatCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    return null;
  }
  const sign = cents > 0 ? "+" : "";
  const abs = cents < 0 ? -cents : cents;
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${bankGroupThousands(dollars)}.${String(remainder).padStart(2, "0")}`;
}

function bankCacheKey(args) {
  try {
    return JSON.stringify(Array.isArray(args) ? args : []);
  } catch (error) {
    return String(args);
  }
}

function bankBuildArgs(options = {}) {
  const opts = bankJsonObject(options) ? options : {};
  const command = opts.command === "report" ? "report" : "list";
  const args = ["bank", command];
  if (command === "list" && opts.all === true) {
    args.push("-a");
  }
  if (command === "report") {
    if (bankString(opts.day) || bankString(opts.date)) {
      args.push("-D", bankString(opts.day) || bankString(opts.date));
    } else if (bankString(opts.week)) {
      args.push("-w", opts.week.trim());
    } else if (bankString(opts.year)) {
      args.push("-y", opts.year.trim());
    } else if (bankString(opts.month)) {
      args.push("-m", opts.month.trim());
    } else if (bankString(opts.period)) {
      args.push("-p", opts.period.trim());
    }
    if (opts.summary === true) {
      args.push("-s");
    }
    if (opts.charts === true) {
      args.push("-c");
    }
  } else if (bankString(opts.month)) {
    args.push("-m", opts.month.trim());
  }
  args.push("-f", "json");
  return args;
}

// Fetch spec for a stats-strip badge. Day and week keep -D/-w so they work
// on an older bob; quarter, ISO year, and all time need -p/-s.
function bankBadgeSpecForStrip(kind, id) {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key) return null;
  if (kind === "day") return { command: "report", date: key };
  if (kind === "week") return { command: "report", week: key };
  if (kind === "quarter" || kind === "year") return { command: "report", period: key, summary: true };
  if (kind === "all" || kind === "all_time") return { command: "report", period: "all", summary: true };
  return null;
}

// First calendar day of a strip's period, or null when the period is not
// in the future (all time) or cannot be dated. Quarter = Monday of week
// (q-1)*13+1; year = Monday of W01.
function bankBadgePeriodStart(kind, id) {
  try {
    if (kind === "day") return /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : null;
    if (kind === "all" || kind === "all_time") return null;
    if (typeof periodNotesIsoWeekMonday !== "function") return null;
    if (kind === "week") {
      const match = /^(\d{4})-W(\d{2})$/.exec(id);
      return match ? periodNotesIsoWeekMonday(Number(match[1]), Number(match[2])) : null;
    }
    if (kind === "quarter") {
      const match = /^(\d{4})-Q([1-4])$/.exec(id);
      return match ? periodNotesIsoWeekMonday(Number(match[1]), (Number(match[2]) - 1) * 13 + 1) : null;
    }
    if (kind === "year") {
      const year = Number(id);
      return Number.isInteger(year) ? periodNotesIsoWeekMonday(year, 1) : null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function bankBadgeOlderBobRefusal(error, args) {
  if (!error) return false;
  const argv = Array.isArray(args) ? args : [];
  const usesPeriod = argv.includes("-p") || argv.includes("--period") || argv.includes("-s") || argv.includes("--summary");
  if (!usesPeriod) return false;
  const text = [error.message, error.detail, error.stderr, error.stdout]
    .filter((part) => typeof part === "string" && part)
    .join("\n");
  if (/(?:unexpected argument|unknown).{0,40}(?:-p|--period|-s|--summary)/i.test(text)) return true;
  return error.exitCode === 2 && (error.code === "bad-json" || /not JSON/i.test(String(error.message || "")));
}

// Fetch spec for the period-note Bank Period Charts panel. Always -p -s -c,
// never the badge's -D/-w older-bob path, so a missing -c cannot hide the badge.
function bankPeriodSpecForStrip(kind, id) {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key) return null;
  if (kind === "week" || kind === "quarter" || kind === "year") {
    return { command: "report", period: key, summary: true, charts: true };
  }
  if (kind === "all" || kind === "all_time") {
    return { command: "report", period: "all", summary: true, charts: true };
  }
  return null;
}

function bankPeriodOlderBobRefusal(error, args) {
  if (!error) return false;
  const argv = Array.isArray(args) ? args : [];
  const usesCharts = argv.includes("-c") || argv.includes("--charts");
  if (!usesCharts) return false;
  const text = [error.message, error.detail, error.stderr, error.stdout]
    .filter((part) => typeof part === "string" && part)
    .join("\n");
  if (/(?:unexpected argument|unknown).{0,40}(?:-c|--charts)/i.test(text)) return true;
  return error.exitCode === 2 && (error.code === "bad-json" || /not JSON/i.test(String(error.message || "")));
}

function bankFail(code, message, stderr) {
  return {
    ok: false,
    code,
    message,
    detail: statsFirstLine(stderr),
  };
}

function bankParseBody(stdout, stderr, commandLabel) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return bankFail("bad-json", `${commandLabel} returned output that is not JSON.`, stderr);
  }
  if (!bankJsonObject(body)) {
    return bankFail("bad-shape", `${commandLabel} returned an unexpected JSON shape.`, stderr);
  }
  if (body.schema_version !== BANK_SCHEMA_VERSION) {
    return bankFail(
      "schema-mismatch",
      `${commandLabel} returned schema ${String(body.schema_version)}, this block reads schema ${BANK_SCHEMA_VERSION}.`,
      stderr,
    );
  }
  if (body.ok === false) {
    const inner = bankJsonObject(body.error) ? body.error : {};
    const message = bankString(inner.message)
      || (typeof body.error === "string" && body.error ? body.error : null)
      || `${commandLabel} reported an error.`;
    return {
      ok: false,
      code: bankString(inner.code) || "bob-error",
      message,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok !== true) {
    return bankFail("bad-shape", `${commandLabel} returned a report without ok: true.`, stderr);
  }
  return { ok: true, body };
}

function bankNormalizeHotkey(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length !== 1) {
    return null;
  }
  return value.toLowerCase();
}

function bankNormalizeGroup(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value;
}

function bankNormalizeSuggestion(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!bankJsonObject(value)) {
    return null;
  }
  const category = bankText(value.category);
  const source = bankText(value.source);
  if (category === null || (source !== "rule" && source !== "learned" && source !== "bank")) {
    return null;
  }
  return { category, source };
}

function bankNormalizeCategory(value) {
  if (!bankJsonObject(value) || bankText(value.key) === null || bankText(value.label) === null) {
    return null;
  }
  return {
    key: value.key,
    emoji: bankText(value.emoji) || "",
    label: value.label,
    builtin: value.builtin === true,
    hotkey: bankNormalizeHotkey(value.hotkey),
    group: bankNormalizeGroup(value.group),
    hidden: value.hidden === true,
  };
}

function bankNormalizeAccount(value) {
  if (!bankJsonObject(value) || bankText(value.alias) === null || bankText(value.label) === null) {
    return null;
  }
  const balance = bankSafeCents(value.balance_cents, { allowNull: true });
  const delta = bankSafeCents(value.delta_cents, { allowNull: true });
  if (!balance.ok || !delta.ok) {
    return null;
  }
  return {
    alias: value.alias,
    label: value.label,
    kind: bankString(value.kind),
    default: value.default === true,
    start: bankString(value.start),
    status: bankString(value.status),
    last_import: value.last_import === null ? null : bankString(value.last_import),
    balance_cents: balance.value,
    balance_asof: value.balance_asof === null ? null : bankString(value.balance_asof),
    delta_cents: delta.value,
    hint: bankText(value.hint),
  };
}

function bankNormalizeLinks(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((link) => typeof link === "string");
}

function bankNormalizeRow(value) {
  if (!bankJsonObject(value)) {
    return null;
  }
  const cents = bankSafeCents(value.cents);
  if (!cents.ok || bankText(value.payee) === null) {
    return null;
  }
  const line = bankCount(value.line);
  if (line === null) {
    return null;
  }
  return {
    path: bankString(value.path),
    line,
    date: bankString(value.date),
    account: bankString(value.account),
    cents: cents.value,
    payee: value.payee,
    category: value.category === null || value.category === undefined ? null : bankText(value.category),
    links: bankNormalizeLinks(value.links),
    note: value.note === null || value.note === undefined ? null : bankText(value.note),
    flagged: value.flagged === true,
    acknowledged: value.acknowledged === true,
    id: value.id === null || value.id === undefined ? null : bankString(value.id),
    origin: bankString(value.origin),
    suggestion: bankNormalizeSuggestion(value.suggestion),
  };
}

function bankNormalizeRows(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const rows = [];
  for (const entry of value) {
    const row = bankNormalizeRow(entry);
    if (!row) {
      return null;
    }
    rows.push(row);
  }
  return rows;
}

function bankSharedFields(body) {
  const categories = Array.isArray(body.categories)
    ? body.categories.map(bankNormalizeCategory).filter(Boolean)
    : [];
  const accounts = Array.isArray(body.accounts)
    ? body.accounts.map(bankNormalizeAccount)
    : [];
  if (Array.isArray(body.accounts) && accounts.some((account) => account === null)) {
    return null;
  }
  return {
    schema_version: BANK_SCHEMA_VERSION,
    today: bankString(body.today),
    categories,
    accounts,
    issues: bankJsonObject(body.issues)
      ? {
          errors: bankCount(body.issues.errors) || 0,
          warnings: bankCount(body.issues.warnings) || 0,
        }
      : { errors: 0, warnings: 0 },
    findings: Array.isArray(body.findings) ? body.findings : [],
  };
}

function bankTeachingReport(body) {
  return {
    schema_version: BANK_SCHEMA_VERSION,
    ok: true,
    teaching_empty: true,
    today: bankString(body.today),
    categories: [],
    accounts: [],
    issues: { errors: 0, warnings: 0 },
    findings: [],
  };
}

function bankDecodeList(stdout, stderr) {
  const parsed = bankParseBody(stdout, stderr, "bob bank list");
  if (!parsed.ok) {
    return parsed;
  }
  const body = parsed.body;
  if (body.teaching_empty === true) {
    return { ok: true, report: { ...bankTeachingReport(body), command: "list" } };
  }
  const shared = bankSharedFields(body);
  if (!shared) {
    return bankFail("bad-shape", "bob bank list returned an account with invalid cents.", stderr);
  }
  const daysRaw = Array.isArray(body.days) ? body.days : null;
  const counts = bankJsonObject(body.counts) ? body.counts : null;
  if (!daysRaw || !counts) {
    return bankFail("bad-shape", "bob bank list returned a report without days or counts.", stderr);
  }
  const days = [];
  for (const day of daysRaw) {
    if (!bankJsonObject(day)) {
      return bankFail("bad-shape", "bob bank list returned a malformed day.", stderr);
    }
    const rows = bankNormalizeRows(day.rows);
    if (!rows) {
      return bankFail("bad-shape", "bob bank list returned a row with invalid cents or payee.", stderr);
    }
    const line = bankCount(day.line);
    if (line === null) {
      return bankFail("bad-shape", "bob bank list returned a day without a line number.", stderr);
    }
    days.push({
      date: bankString(day.date),
      heading: bankText(day.heading) || "",
      path: bankString(day.path),
      line,
      rows,
    });
  }
  const rowsCount = bankCount(counts.rows);
  const waiting = bankCount(counts.waiting);
  const flagged = bankCount(counts.flagged);
  if (rowsCount === null || waiting === null || flagged === null) {
    return bankFail("bad-shape", "bob bank list returned invalid counts.", stderr);
  }
  return {
    ok: true,
    report: {
      ...shared,
      command: "list",
      teaching_empty: false,
      filter: body.filter === "all" ? "all" : "waiting",
      month: body.month === null || body.month === undefined ? null : bankString(body.month),
      days,
      counts: { rows: rowsCount, waiting, flagged },
    },
  };
}

function bankNormalizeTotals(value) {
  if (!bankJsonObject(value)) {
    return null;
  }
  const keys = [
    "out_cents",
    "in_cents",
    "net_cents",
    "refund_cents",
    "transfer_out_cents",
    "transfer_in_cents",
    "cash_out_cents",
    "cash_traced_cents",
    "unclassified_out_cents",
    "unclassified_in_cents",
  ];
  const totals = {};
  for (const key of keys) {
    const cents = bankSafeCents(value[key]);
    if (!cents.ok) {
      return null;
    }
    totals[key] = cents.value;
  }
  return totals;
}

function bankNormalizeBreakdown(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = [];
  for (const entry of value) {
    if (!bankJsonObject(entry) || bankText(entry.key) === null || bankText(entry.label) === null) {
      return null;
    }
    const cents = bankSafeCents(entry.out_cents);
    const rows = bankCount(entry.rows);
    if (!cents.ok || rows === null || typeof entry.share !== "number" || !Number.isFinite(entry.share)) {
      return null;
    }
    entries.push({
      key: entry.key,
      emoji: bankText(entry.emoji) || "",
      label: entry.label,
      out_cents: cents.value,
      share: entry.share,
      rows,
    });
  }
  return entries;
}

function bankDecodeReport(stdout, stderr) {
  const parsed = bankParseBody(stdout, stderr, "bob bank report");
  if (!parsed.ok) {
    return parsed;
  }
  const body = parsed.body;
  if (body.teaching_empty === true) {
    return { ok: true, report: { ...bankTeachingReport(body), command: "report" } };
  }
  const shared = bankSharedFields(body);
  if (!shared) {
    return bankFail("bad-shape", "bob bank report returned an account with invalid cents.", stderr);
  }
  if (!bankJsonObject(body.period) || !Array.isArray(body.days) || !bankJsonObject(body.waiting)) {
    return bankFail("bad-shape", "bob bank report returned a report without period, days, or waiting.", stderr);
  }
  const periodKind = bankText(body.period.kind);
  if (periodKind === null) {
    return bankFail("bad-shape", "bob bank report returned a period without a kind.", stderr);
  }
  const totals = bankNormalizeTotals(body.totals);
  const breakdown = bankNormalizeBreakdown(body.breakdown);
  const coverage = bankNormalizeCoverage(body.coverage);
  const navigation = bankNormalizeNavigation(body.navigation);
  if (!totals || !breakdown || !coverage.ok || !navigation.ok) {
    return bankFail("bad-shape", "bob bank report returned invalid totals, breakdown, coverage, or navigation.", stderr);
  }
  const days = [];
  for (const day of body.days) {
    if (!bankJsonObject(day)) {
      return bankFail("bad-shape", "bob bank report returned a malformed day.", stderr);
    }
    const rows = bankNormalizeRows(Array.isArray(day.rows) ? day.rows : []);
    const outCents = bankSafeCents(day.out_cents);
    const inCents = bankSafeCents(day.in_cents);
    const waiting = bankCount(day.waiting);
    const flagged = bankCount(day.flagged);
    const line = bankCount(day.line);
    if (!rows || !outCents.ok || !inCents.ok || waiting === null || flagged === null || line === null) {
      return bankFail("bad-shape", "bob bank report returned a day with invalid cents or counts.", stderr);
    }
    days.push({
      date: bankString(day.date),
      heading: bankText(day.heading) || "",
      path: bankString(day.path),
      line,
      out_cents: outCents.value,
      in_cents: inCents.value,
      rows,
      waiting,
      flagged,
    });
  }
  const waitingPeriod = bankCount(body.waiting.period);
  const waitingAll = bankCount(body.waiting.all);
  const flagged = bankCount(body.flagged);
  if (waitingPeriod === null || waitingAll === null || flagged === null) {
    return bankFail("bad-shape", "bob bank report returned invalid waiting counts.", stderr);
  }
  const report = {
    ...shared,
    command: "report",
    teaching_empty: false,
    period: {
      kind: periodKind,
      key: bankString(body.period.key),
      start: bankString(body.period.start),
      end: bankString(body.period.end),
      label: bankText(body.period.label) || "",
      so_far: body.period.so_far === true,
      note: body.period.note === null || body.period.note === undefined ? null : bankText(body.period.note),
    },
    totals,
    breakdown,
    days,
    coverage: coverage.value,
    navigation: navigation.value,
    waiting: {
      period: waitingPeriod,
      all: waitingAll,
      oldest: body.waiting.oldest === null || body.waiting.oldest === undefined
        ? null
        : bankString(body.waiting.oldest),
    },
    flagged,
  };
  if (Object.prototype.hasOwnProperty.call(body, "charts")) {
    const charts = bankNormalizeCharts(body.charts, report.period);
    if (!charts.ok) {
      return bankFail("bad-shape", "bob bank report returned invalid charts.", stderr);
    }
    report.charts = charts.value;
  }
  return { ok: true, report };
}

function bankErrorModel(result, options = {}) {
  const error = bankJsonObject(result) ? result : { code: "failed" };
  const tried = Array.isArray(options.tried)
    ? options.tried
    : Array.isArray(error.tried)
      ? error.tried
      : [];
  if (error.code === "bob-not-found" && /needs the desktop app/i.test(String(error.message || ""))) {
    return {
      code: "desktop-only",
      title: "Bank views need the desktop app",
      hint: "bob runs only in Obsidian on a computer. Open this vault there to see bank totals.",
      retry: false,
    };
  }
  if (error.code === "bob-not-found") {
    return {
      code: "bob-not-found",
      title: "bob was not found",
      hint: tried.length > 0
        ? `Tried ${tried.join(", ")}. Set stats.bob_path in ~/.config/bob/config.yml.`
        : "Set stats.bob_path in ~/.config/bob/config.yml.",
      retry: true,
    };
  }
  if (error.code === "timeout") {
    return {
      code: "timeout",
      title: "bob bank timed out",
      hint: "Retry once, then run bob bank list -f json in a terminal.",
      retry: true,
    };
  }
  if (error.code === "schema-mismatch") {
    return {
      code: "schema-mismatch",
      title: "bob bank uses a different schema",
      hint: "Update bob-cli and Bob Ledger Tools together, then retry.",
      retry: true,
    };
  }
  return {
    code: typeof error.code === "string" ? error.code : "failed",
    title: "bob bank failed",
    hint: error.detail || error.message || "Retry once, then run bob bank list in a terminal.",
    retry: true,
  };
}

function bankPresentRow(row) {
  return {
    ...row,
    amountText: bankFormatCents(row.cents),
  };
}

function bankPresentList(report) {
  if (!bankJsonObject(report)) {
    return null;
  }
  if (report.teaching_empty === true) {
    return { kind: "teaching-empty", command: "list", today: report.today };
  }
  return {
    kind: "list",
    command: "list",
    today: report.today,
    filter: report.filter,
    month: report.month,
    counts: report.counts,
    categories: report.categories,
    accounts: report.accounts,
    days: (report.days || []).map((day) => ({
      ...day,
      rows: (day.rows || []).map(bankPresentRow),
    })),
  };
}

function bankPresentReport(report) {
  if (!bankJsonObject(report)) {
    return null;
  }
  if (report.teaching_empty === true) {
    return { kind: "teaching-empty", command: "report", today: report.today };
  }
  const totals = report.totals || {};
  return {
    kind: "report",
    command: "report",
    today: report.today,
    period: report.period,
    categories: report.categories,
    accounts: report.accounts,
    totals: {
      ...totals,
      outText: bankFormatCents(-totals.out_cents),
      inText: bankFormatCents(totals.in_cents),
      netText: bankFormatCents(totals.net_cents),
    },
    breakdown: (report.breakdown || []).map((entry) => ({
      ...entry,
      outText: bankFormatCents(-entry.out_cents),
    })),
    days: (report.days || []).map((day) => ({
      ...day,
      outText: bankFormatCents(-day.out_cents),
      inText: bankFormatCents(day.in_cents),
      rows: (day.rows || []).map(bankPresentRow),
    })),
    coverage: report.coverage || null,
    navigation: report.navigation || null,
    waiting: report.waiting,
    flagged: report.flagged,
  };
}
