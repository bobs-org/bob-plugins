// Pure Bank Period Charts model. bob already computed every cent; this layer
// only compares, divides for ratios, formats copy, and chooses visibility.

const BANK_PERIOD_VIEWS = ["both", "cashflow", "categories"];
const BANK_PERIOD_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BANK_PERIOD_STATE_WORDS = {
  tracked: "",
  partial: "partly covered",
  untracked: "not tracked",
  awaiting_import: "not imported yet",
  future: "future",
};

function bankPeriodViewOf(value) {
  return BANK_PERIOD_VIEWS.includes(value) ? value : "both";
}

function bankPeriodNextView(value) {
  const current = bankPeriodViewOf(value);
  return BANK_PERIOD_VIEWS[(BANK_PERIOD_VIEWS.indexOf(current) + 1) % BANK_PERIOD_VIEWS.length];
}

function bankPeriodLastIsoWeek(isoYear) {
  return typeof periodNotesIsoWeekMonday === "function" && periodNotesIsoWeekMonday(isoYear, 53) ? 53 : 52;
}

function bankPeriodExpectedBounds(kind, id) {
  if (kind === "day") return /^\d{4}-\d{2}-\d{2}$/.test(id) ? { start: id, end: id } : null;
  if (typeof periodNotesIsoWeekMonday !== "function" || typeof bankIsoShiftDays !== "function") return null;
  if (kind === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(id);
    if (!match) return null;
    const start = periodNotesIsoWeekMonday(Number(match[1]), Number(match[2]));
    const end = start ? bankIsoShiftDays(start, 6) : null;
    return start && end ? { start, end } : null;
  }
  if (kind === "quarter") {
    const match = /^(\d{4})-Q([1-4])$/.exec(id);
    if (!match) return null;
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const startWeek = (quarter - 1) * 13 + 1;
    const lastWeek = quarter === 4 ? bankPeriodLastIsoWeek(year) : quarter * 13;
    const start = periodNotesIsoWeekMonday(year, startWeek);
    const lastMonday = periodNotesIsoWeekMonday(year, lastWeek);
    const end = lastMonday ? bankIsoShiftDays(lastMonday, 6) : null;
    return start && end ? { start, end } : null;
  }
  if (kind === "year") {
    const year = Number(id);
    if (!Number.isInteger(year)) return null;
    const start = periodNotesIsoWeekMonday(year, 1);
    const lastMonday = periodNotesIsoWeekMonday(year, bankPeriodLastIsoWeek(year));
    const end = lastMonday ? bankIsoShiftDays(lastMonday, 6) : null;
    return start && end ? { start, end } : null;
  }
  return null;
}

function bankPeriodIdentityMatches(report, ctx) {
  const kind = ctx && ctx.kind;
  const expectedKind = typeof bankBadgeKind === "function" ? bankBadgeKind(kind) : null;
  const period = report && report.period;
  if (!period || expectedKind === null || period.kind !== expectedKind) return false;
  const periodId = typeof ctx.periodId === "string" && ctx.periodId
    ? ctx.periodId
    : (kind === "day" && typeof ctx.day === "string" ? ctx.day : "");
  if (kind === "all" || kind === "all_time") {
    const keyOk = period.key === "all" || period.key === "all_time";
    const start = bankIsoDateOrNull(period.start);
    const end = bankIsoDateOrNull(period.end);
    return keyOk && start.ok && start.value !== null && end.ok && end.value !== null;
  }
  if (!periodId || period.key !== periodId) return false;
  const bounds = bankPeriodExpectedBounds(kind, periodId);
  if (!bounds) return false;
  return period.start === bounds.start && period.end === bounds.end;
}

function bankPeriodCompact(cents) {
  if (!Number.isSafeInteger(cents)) return "";
  const magnitude = Math.abs(cents);
  if (magnitude < 100) return bankBadgeAmount(cents, "week");
  const dollars = magnitude / 100;
  if (dollars < 1000) return `$${bankGroupThousands(Math.round(dollars))}`;
  if (dollars < 10000) {
    const tenths = Math.round(dollars / 100) / 10;
    return tenths % 1 === 0 ? `$${tenths}k` : `$${tenths}k`;
  }
  if (dollars < 1000000) return `$${bankGroupThousands(Math.round(dollars / 1000))}k`;
  const millionTenths = Math.round(dollars / 100000) / 10;
  return millionTenths % 1 === 0 ? `$${millionTenths}m` : `$${millionTenths}m`;
}

function bankPeriodNetText(netCents) {
  if (!Number.isSafeInteger(netCents) || netCents === 0) return "";
  if (netCents > 0) return `Net ${bankBadgeMoneyText(netCents, true)}`;
  return `Net −${bankBadgeMoneyText(netCents)}`;
}

function bankPeriodStateWords(state, soFar) {
  const words = [];
  const named = BANK_PERIOD_STATE_WORDS[state];
  if (named) words.push(named);
  if (soFar) words.push("so far");
  return words;
}

function bankPeriodKindWord(granularity) {
  return ({ day: "days", week: "weeks", quarter: "quarters", year: "years" })[granularity] || "periods";
}

function bankPeriodFullDate(iso, periodEnd) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return "";
  const pretty = bankBadgeDate(iso, false, periodEnd);
  return pretty ? `${BANK_PERIOD_WEEKDAYS[parsed.getUTCDay()]} ${pretty}` : "";
}

function bankPeriodAction(column, periodEnd) {
  if (!column || column.ghost || !column.target) return "";
  if (column.kind === "day") {
    const date = bankPeriodFullDate(column.id, periodEnd) || bankBadgeDate(column.id, true) || column.label;
    return `Click to open ${date} in the bank month note`;
  }
  return `Click to open ${column.label || column.id}`;
}

function bankPeriodShareText(share) {
  if (!Number.isFinite(share) || share < 0) return "";
  const percent = Math.round(share * 100);
  if (percent === 0 && share > 0) return "<1%";
  return `${percent}%`;
}

function bankPeriodAmountKind(ctxKind) {
  return ctxKind === "week" ? "week" : ctxKind === "day" ? "day" : "quarter";
}

function bankPeriodHidden(reason, hint) {
  return { state: "hidden", reason, hint: hint || "", stale: false, digest: `hidden:${reason}` };
}

function bankPeriodUnavailable(reason, hint) {
  const model = {
    state: "unavailable",
    reason,
    hint: hint || "The bank charts could not be read.",
    stale: false,
  };
  model.digest = bankPeriodDigest(model);
  return model;
}

function bankPeriodDigest(model) {
  try {
    const source = JSON.stringify({
      state: model.state,
      reason: model.reason,
      hint: model.hint,
      stale: model.stale,
      header: model.header,
      cashflow: model.cashflow && {
        encoding: model.cashflow.encoding,
        inBandRatio: model.cashflow.inBandRatio,
        columns: model.cashflow.columns,
        fallbackColumns: model.cashflow.fallbackColumns,
        ghost: model.cashflow.ghost,
      },
      categories: model.categories,
      notCounted: model.notCounted,
      waitingLine: model.waitingLine,
      ariaLabel: model.ariaLabel,
      tables: model.tables,
    });
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${model.state}:${(hash >>> 0).toString(36)}`;
  } catch (error) {
    return `${model.state || "unavailable"}:digest`;
  }
}

function bankPeriodDecorations(bucket) {
  const decorations = [];
  if (bucket.state === "partial") decorations.push("partial");
  if (bucket.state === "untracked") decorations.push("untracked");
  if (bucket.state === "awaiting_import") decorations.push("hatch");
  if (bucket.state === "future") decorations.push("stub");
  if (bucket.so_far) decorations.push("so_far");
  if (bucket.waiting > 0) decorations.push("waiting");
  return decorations;
}

function bankPeriodColumnTooltip(column, report, ctx) {
  const period = report.period || {};
  const lines = [];
  const title = column.kind === "day"
    ? (bankPeriodFullDate(column.id, period.end) || column.label || column.id)
    : (column.label || column.id);
  lines.push(`${title}${column.soFar ? " · so far" : ""}`);
  const money = [];
  if (column.inCents > 0) money.push(`In ${bankBadgeMoneyText(column.inCents, true)}`);
  if (column.outCents > 0) money.push(`Out ${bankBadgeMoneyText(column.outCents)}`);
  if (column.inCents > 0 && column.outCents > 0) {
    const net = bankPeriodNetText(column.netCents);
    if (net) money.push(net);
  }
  if (money.length) lines.push(money.join(" · "));
  if (column.topOut && column.topOut.length) {
    lines.push(`Top out: ${column.topOut.map((entry) => `${entry.emoji ? `${entry.emoji} ` : ""}${entry.label} ${bankBadgeMoneyText(entry.out_cents)}`).join(" · ")}`);
  }
  const counts = [];
  if (column.rows > 0) counts.push(`${column.rows} ${column.rows === 1 ? "row" : "rows"}`);
  if (column.waiting > 0) counts.push(`${column.waiting} waiting`);
  if (counts.length) lines.push(counts.join(" · "));
  const words = bankPeriodStateWords(column.state, false);
  if (words.length) lines.push(words.join(" · "));
  const action = bankPeriodAction(column, period.end);
  if (action) lines.push(action);
  if (ctx.stale) {
    lines.push(ctx.refreshFailed
      ? "Refresh failed; last good values shown."
      : "Values are being refreshed; last good values shown.");
  }
  return lines.join("\n");
}

function bankPeriodColumnReadout(column) {
  const parts = [column.label || column.id];
  if (column.inCents > 0) parts.push(`in ${bankBadgeMoneyText(column.inCents, true)}`);
  if (column.outCents > 0) parts.push(`out ${bankBadgeMoneyText(column.outCents)}`);
  if (column.rows > 0) parts.push(`${column.rows} ${column.rows === 1 ? "row" : "rows"}`);
  parts.push(...bankPeriodStateWords(column.state, column.soFar));
  return parts.filter(Boolean).join(" · ");
}

function bankPeriodBuildColumn(bucket, scale, ctx, report) {
  const maxIn = scale.maxIn;
  const maxOut = scale.maxOut;
  const column = {
    id: bucket.id,
    kind: bucket.kind,
    label: bucket.label,
    group: bucket.group,
    start: bucket.start,
    end: bucket.end,
    state: bucket.state,
    soFar: bucket.so_far === true,
    inCents: bucket.in_cents,
    outCents: bucket.out_cents,
    netCents: bucket.net_cents,
    waiting: bucket.waiting,
    rows: bucket.rows,
    topOut: bucket.top_out,
    target: bucket.target,
    ghost: false,
    marker: scale.encoding === "markers" && bucket.in_cents > 0,
    inRatio: maxIn > 0 ? bucket.in_cents / maxIn : 0,
    outRatio: maxOut > 0 ? bucket.out_cents / maxOut : 0,
    decorations: bankPeriodDecorations(bucket),
    words: bankPeriodStateWords(bucket.state, bucket.so_far === true),
    extremeIn: false,
    extremeOut: false,
  };
  column.tooltip = bankPeriodColumnTooltip(column, report, ctx);
  column.readout = bankPeriodColumnReadout(column);
  column.aria = column.readout;
  return column;
}

function bankPeriodMarkExtremes(columns, encoding) {
  let maxOutIndex = -1;
  let maxOut = 0;
  let maxInIndex = -1;
  let maxIn = 0;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (column.ghost) continue;
    if (column.outCents > maxOut) {
      maxOut = column.outCents;
      maxOutIndex = index;
    }
    if (column.inCents > maxIn) {
      maxIn = column.inCents;
      maxInIndex = index;
    }
  }
  if (maxOutIndex >= 0 && maxOut > 0) {
    columns[maxOutIndex].extremeOut = true;
    columns[maxOutIndex].extremeOutLabel = bankPeriodCompact(maxOut);
  }
  if (encoding === "mirrored" && maxInIndex >= 0 && maxIn > 0) {
    columns[maxInIndex].extremeIn = true;
    columns[maxInIndex].extremeInLabel = `+${bankPeriodCompact(maxIn)}`;
  }
  if (encoding === "markers" && maxInIndex >= 0 && maxIn > 0) {
    columns[maxInIndex].extremeIn = true;
    columns[maxInIndex].extremeInLabel = `+${bankPeriodCompact(maxIn)}`;
  }
}

function bankPeriodLeadingGhost(groups, buckets) {
  if (!Array.isArray(groups) || !groups.length || !Array.isArray(buckets)) return null;
  const byGroup = new Map();
  for (const bucket of buckets) {
    const key = bucket.group;
    if (!key) continue;
    const list = byGroup.get(key) || [];
    list.push(bucket);
    byGroup.set(key, list);
  }
  const leading = [];
  for (const group of groups) {
    const key = group.label || group.id;
    const members = byGroup.get(key) || byGroup.get(group.id) || [];
    const source = members.length ? members : [group];
    const collapsible = source.every((entry) => (
      entry.state === "untracked"
      && (entry.in_cents || 0) === 0
      && (entry.out_cents || 0) === 0
    ));
    if (!collapsible) break;
    leading.push(group);
  }
  if (!leading.length) return null;
  const first = leading[0].label || leading[0].id;
  const last = leading[leading.length - 1].label || leading[leading.length - 1].id;
  const skipped = new Set(leading.map((group) => group.label || group.id).concat(leading.map((group) => group.id)));
  return {
    ghost: {
      id: `ghost:${first}:${last}`,
      kind: "year",
      label: first === last ? `${first} · not tracked` : `${first}–${last} · not tracked`,
      group: null,
      state: "untracked",
      soFar: false,
      inCents: 0,
      outCents: 0,
      netCents: 0,
      waiting: 0,
      rows: 0,
      topOut: [],
      target: null,
      ghost: true,
      marker: false,
      inRatio: 0,
      outRatio: 0,
      decorations: ["untracked"],
      words: ["not tracked"],
      extremeIn: false,
      extremeOut: false,
      tooltip: first === last ? `${first} · not tracked` : `${first}–${last} · not tracked`,
      readout: first === last ? `${first} · not tracked` : `${first}–${last} · not tracked`,
      aria: first === last ? `${first}, not tracked` : `${first} to ${last}, not tracked`,
    },
    skipped,
  };
}

function bankPeriodCategoryRows(categories, amountKind) {
  if (!categories || !Array.isArray(categories.series) || !categories.series.length) return null;
  const rows = categories.series.map((entry) => {
    const amount = bankBadgeAmount(entry.out_cents, amountKind);
    const percent = bankPeriodShareText(entry.share);
    let label = entry.label;
    if (entry.kind === "cash") label = `${entry.label} · destination unknown`;
    return {
      key: entry.key,
      kind: entry.kind,
      emoji: entry.emoji || "",
      label,
      sourceLabel: entry.label,
      outCents: entry.out_cents,
      share: entry.share,
      rows: entry.rows,
      amount,
      percent,
      rest: false,
      amber: entry.kind === "unclassified",
      muted: false,
      tooltip: [
        `${entry.emoji ? `${entry.emoji} ` : ""}${entry.label}`,
        `Out ${bankBadgeMoneyText(entry.out_cents)} · ${percent} · ${entry.rows} ${entry.rows === 1 ? "row" : "rows"}`,
      ].join("\n"),
    };
  });
  if (categories.rest && categories.rest.count > 0) {
    const rest = categories.rest;
    rows.push({
      key: "rest",
      kind: "rest",
      emoji: "",
      label: `${rest.count} more`,
      sourceLabel: `${rest.count} more`,
      outCents: rest.out_cents,
      share: rest.share,
      rows: rest.rows,
      amount: bankBadgeAmount(rest.out_cents, amountKind),
      percent: bankPeriodShareText(rest.share),
      rest: true,
      amber: false,
      muted: true,
      tooltip: [
        `${rest.count} more`,
        `Out ${bankBadgeMoneyText(rest.out_cents)} · ${bankPeriodShareText(rest.share)} · ${rest.rows} ${rest.rows === 1 ? "row" : "rows"}`,
      ].join("\n"),
    });
  }
  return rows;
}

function bankPeriodNotCounted(report, ctx) {
  const totals = report.totals || {};
  const parts = [];
  const transfers = Math.max(Number(totals.transfer_out_cents) || 0, Number(totals.transfer_in_cents) || 0);
  const amountKind = bankPeriodAmountKind(ctx.kind);
  if (transfers > 0) {
    parts.push({ key: "transfers", text: `transfers ↔ ${bankBadgeAmount(transfers, amountKind)}` });
  }
  if (totals.unclassified_in_cents > 0) {
    parts.push({
      key: "unclassified_in",
      text: `unclassified in ${bankBadgeMoneyText(totals.unclassified_in_cents, true)}`,
    });
  }
  if (totals.cash_traced_cents > 0) {
    parts.push({ key: "cash", text: `cash traced ${bankBadgeAmount(totals.cash_traced_cents, amountKind)}` });
  }
  if (ctx.badgeEnabled !== true) {
    const waiting = report.waiting && Number.isInteger(report.waiting.period) ? report.waiting.period : 0;
    if (waiting > 0) {
      const oldest = (report.navigation && report.navigation.waiting && report.navigation.waiting.date)
        || report.waiting.oldest;
      const oldestText = oldest ? ` · oldest ${bankBadgeDate(oldest, false, report.period && report.period.end) || oldest}` : "";
      parts.push({
        key: "waiting",
        text: `● ${waiting} waiting${oldestText} →`,
        target: report.navigation && report.navigation.waiting
          ? { path: report.navigation.waiting.path, line: report.navigation.waiting.line }
          : null,
      });
    }
    const coverage = bankBadgeCoverageText(report, ctx.kind, ctx.today);
    if (coverage) parts.push({ key: "coverage", text: coverage });
  }
  return parts.length ? parts : null;
}

function bankPeriodWaitingLine(report, ctx) {
  const waiting = report.waiting && Number.isInteger(report.waiting.period) ? report.waiting.period : 0;
  if (waiting <= 0) return null;
  const oldest = (report.navigation && report.navigation.waiting && report.navigation.waiting.date)
    || report.waiting.oldest;
  const oldestText = oldest ? ` · oldest ${bankBadgeDate(oldest, false, report.period && report.period.end) || oldest}` : "";
  return {
    text: `● ${waiting} waiting${oldestText} →`,
    target: report.navigation && report.navigation.waiting
      ? { path: report.navigation.waiting.path, line: report.navigation.waiting.line }
      : null,
  };
}

function bankPeriodAriaLabel(report, ctx, cashflow, categories) {
  const period = report.period || {};
  const phrases = [
    `${period.label || period.key || ctx.periodId || "This period"}${period.so_far ? ", so far" : ""}`,
  ];
  if (report.totals.in_cents > 0) phrases.push(`in ${bankBadgeMoneyText(report.totals.in_cents, true)}`);
  if (report.totals.out_cents > 0) phrases.push(`out ${bankBadgeMoneyText(report.totals.out_cents)}`);
  const top = categories && categories.rows && categories.rows.find((row) => !row.rest);
  if (top) phrases.push(`top ${top.sourceLabel || top.label}`);
  if (cashflow && cashflow.columns && cashflow.columns.length) {
    const awaiting = cashflow.columns.filter((column) => !column.ghost && column.state === "awaiting_import").length;
    const total = cashflow.columns.filter((column) => !column.ghost).length;
    if (awaiting > 0 && total > 0) {
      phrases.push(`${awaiting} of ${total} ${bankPeriodKindWord(cashflow.granularity)} not imported yet`);
    }
  }
  return phrases.join(", ");
}

function bankPeriodTables(cashflow, categories) {
  const tables = {};
  if (cashflow && cashflow.columns) {
    tables.cashflow = {
      caption: "In and out by period",
      columns: ["period", "in", "out", "net", "waiting", "rows", "state"],
      rows: cashflow.columns.filter((column) => !column.ghost).map((column) => ({
        period: column.label || column.id,
        in: column.inCents > 0 ? bankBadgeMoneyText(column.inCents, true) : "",
        out: column.outCents > 0 ? bankBadgeMoneyText(column.outCents) : "",
        net: column.inCents > 0 && column.outCents > 0
          ? bankPeriodNetText(column.netCents).replace(/^Net /, "")
          : "",
        waiting: column.waiting > 0 ? String(column.waiting) : "",
        rows: column.rows > 0 ? String(column.rows) : "",
        state: column.words.join(" · "),
      })),
    };
  }
  if (categories && categories.rows) {
    tables.categories = {
      caption: "Out by category",
      columns: ["category", "out", "share", "rows"],
      rows: categories.rows.map((row) => ({
        category: row.sourceLabel || row.label,
        out: bankBadgeMoneyText(row.outCents),
        share: row.percent,
        rows: String(row.rows),
      })),
    };
  }
  return tables;
}

function bankPeriodCashflowModel(charts, ctx, report) {
  if (!charts || !Array.isArray(charts.buckets) || charts.buckets.length < 2) return null;
  const encoding = charts.granularity === "day" ? "markers" : "mirrored";
  let maxIn = 0;
  let maxOut = 0;
  for (const bucket of charts.buckets) {
    if (bucket.in_cents > maxIn) maxIn = bucket.in_cents;
    if (bucket.out_cents > maxOut) maxOut = bucket.out_cents;
  }
  const scale = { encoding, maxIn, maxOut };
  const collapse = ctx.kind === "all" && charts.granularity === "quarter"
    ? bankPeriodLeadingGhost(charts.groups, charts.buckets)
    : null;
  const remaining = collapse
    ? charts.buckets.filter((bucket) => !collapse.skipped.has(bucket.group) && !collapse.skipped.has(bucket.id))
    : charts.buckets;
  const columns = remaining.map((bucket) => bankPeriodBuildColumn(bucket, scale, ctx, report));
  if (collapse) columns.unshift(collapse.ghost);
  bankPeriodMarkExtremes(columns, encoding);
  const fallbackColumns = (ctx.kind === "year" && Array.isArray(charts.groups) && charts.groups.length)
    ? charts.groups.map((group) => bankPeriodBuildColumn(group, {
      encoding,
      maxIn: charts.groups.reduce((max, entry) => (entry.in_cents > max ? entry.in_cents : max), 0),
      maxOut: charts.groups.reduce((max, entry) => (entry.out_cents > max ? entry.out_cents : max), 0),
    }, ctx, report))
    : [];
  if (fallbackColumns.length) bankPeriodMarkExtremes(fallbackColumns, encoding);
  const inBandRatio = encoding === "mirrored"
    ? (maxIn === 0 ? 0 : maxIn / (maxIn + maxOut))
    : null;
  return {
    encoding,
    granularity: charts.granularity,
    maxIn,
    maxOut,
    inBandRatio,
    columns,
    fallbackColumns,
    ghost: collapse ? collapse.ghost : null,
  };
}

function bankPeriodChartsModel(report, context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  if (ctx.olderBob === true) return bankPeriodHidden("older-bob");
  if (report && report.teaching_empty === true) return bankPeriodHidden("teaching-empty");
  if (
    !report || report.command !== "report" || !report.period || !report.totals || !report.waiting ||
    !Number.isSafeInteger(report.totals.in_cents) || report.totals.in_cents < 0 ||
    !Number.isSafeInteger(report.totals.out_cents) || report.totals.out_cents < 0 ||
    !Number.isInteger(report.waiting.period) || report.waiting.period < 0
  ) {
    return bankPeriodUnavailable("invalid-report", "The bank charts could not be read.");
  }
  if (!bankPeriodIdentityMatches(report, ctx)) {
    return bankPeriodUnavailable("period-mismatch", "The bank report does not match this stats strip.");
  }
  const today = typeof ctx.today === "string" ? ctx.today : "";
  if (typeof report.period.start === "string" && today && report.period.start > today) {
    return bankPeriodHidden("future");
  }
  const inCents = report.totals.in_cents;
  const outCents = report.totals.out_cents;
  const waiting = report.waiting.period;
  if (inCents === 0 && outCents === 0 && waiting === 0) return bankPeriodHidden("empty");
  if (inCents === 0 && outCents === 0 && waiting > 0) {
    if (ctx.badgeEnabled === true) return bankPeriodHidden("waiting-badge");
    const waitingModel = {
      state: "waiting",
      reason: "waiting",
      hint: "",
      stale: ctx.stale === true,
      waitingLine: bankPeriodWaitingLine(report, ctx),
      ariaLabel: `${report.period.label || report.period.key || "This period"}, ${waiting} waiting`,
    };
    waitingModel.digest = bankPeriodDigest(waitingModel);
    return waitingModel;
  }
  if (!Object.prototype.hasOwnProperty.call(report, "charts")) {
    return bankPeriodUnavailable("missing-charts", "The bank charts could not be read.");
  }

  const charts = report.charts;
  const view = bankPeriodViewOf(ctx.view);
  const collapsed = ctx.collapsed === true;
  const cashflow = charts ? bankPeriodCashflowModel(charts, ctx, report) : null;
  const categoryRows = charts ? bankPeriodCategoryRows(charts.categories, bankPeriodAmountKind(ctx.kind)) : null;
  const categories = categoryRows ? { rows: categoryRows } : null;
  const cashflowAvailable = Boolean(cashflow);
  const categoriesAvailable = Boolean(categories);
  const both = cashflowAvailable && categoriesAvailable;
  let shown = [];
  if (!collapsed) {
    if (both) {
      shown = view === "cashflow" ? ["cashflow"] : view === "categories" ? ["categories"] : ["cashflow", "categories"];
    } else if (cashflowAvailable) shown = ["cashflow"];
    else if (categoriesAvailable) shown = ["categories"];
  }
  const header = {
    label: "BANK CHARTS",
    collapsed,
    view,
    nextView: bankPeriodNextView(view),
    switchShown: both,
    shown,
    available: [cashflowAvailable ? "cashflow" : null, categoriesAvailable ? "categories" : null].filter(Boolean),
  };
  const model = {
    state: "charts",
    reason: charts === null ? "charts-null" : "charts",
    hint: "",
    stale: ctx.stale === true,
    header,
    cashflow,
    categories,
    notCounted: bankPeriodNotCounted(report, ctx),
    waitingLine: null,
    ariaLabel: bankPeriodAriaLabel(report, ctx, cashflow, categories),
    tables: bankPeriodTables(cashflow, categories),
  };
  if (ctx.stale) {
    model.hint = ctx.refreshFailed
      ? "Refresh failed; last good values shown."
      : "Values are being refreshed; last good values shown.";
  }
  model.digest = bankPeriodDigest(model);
  return model;
}
