// Pure Bank Setup header model (bob-cli-lt setup-header). No DOM, no spawns:
// the collapsed-line grammar, section and tile models built from
// `bankCategorySections` so order matches the Category card, tooltips, state
// selection, and repaint signatures. The hosts fragment paints what these
// return. Bob owns categories, hotkeys, groups, and usage.

const BANK_SETUP_CLASS = "bob-bank-setup";
const BANK_SETUP_SURFACE_CLASS = "bob-bank-setup-surface";
const BANK_SETUP_HUB_PATH = "bank.md";
const BANK_SETUP_DEFAULT_EXPANDED = true;
const BANK_SETUP_MONEY_GROUP = "Money moves";

function bankSetupText(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bankSetupCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function bankSetupHubPath(value) {
  const text = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return text.replace(/\\/g, "/").replace(/^\.\//, "");
}

function bankSetupIsHubPath(fileOrPath) {
  return /^bank\.md$/i.test(bankSetupHubPath(fileOrPath));
}

// Setup header state selection. `report` is a decoded `bob bank config`
// report (or null); `error` is the fetch failure (or null). `desktop` gates
// the mobile degrade line; without a report and without an error the header
// is still loading.
function bankSetupStateKind(report, error, options = {}) {
  if (options.desktop === false) {
    return "mobile";
  }
  if (error && (error.code === "unsupported" || error.code === "bob-not-found")) {
    return "unsupported";
  }
  if (report && typeof report.state === "string") {
    if (report.state === "valid") {
      return "valid";
    }
    if (report.state === "invalid") {
      return "invalid";
    }
    return "missing";
  }
  if (report && report.teaching_empty === true) {
    return "missing";
  }
  if (error) {
    return error.code === "unloaded" ? "loading" : "refresh-failed";
  }
  return "loading";
}

function bankSetupStatusTone(status) {
  if (status === "balanced") {
    return { icon: "✓", word: "balanced", tone: "ok" };
  }
  if (status === "stale") {
    return { icon: "⚠", word: "stale", tone: "warn" };
  }
  if (status === "delta") {
    return { icon: "✗", word: "delta", tone: "bad" };
  }
  return { icon: "·", word: status || "unknown", tone: "muted" };
}

function bankSetupSinceLabel(iso) {
  const match = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) {
    return null;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `since ${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function bankSetupProvenanceLabel(source) {
  if (source === "explicit") {
    return "pinned";
  }
  if (source === "builtin_default") {
    return "built-in default";
  }
  if (source === "derived") {
    return "derived — may change when categories change; pin it in Bank setup";
  }
  return null;
}

// One header tile. `entry` is a decoded config category. Hidden entries stay
// valid on rows and are never offered: they render in the HIDDEN row, not in
// `bankCategorySections` (which only sees visible entries, like the card).
function bankSetupTile(entry) {
  if (!entry || typeof entry.key !== "string" || !entry.key) {
    return null;
  }
  const hotkey = typeof entry.hotkey === "string" && entry.hotkey.length === 1
    ? entry.hotkey.toLowerCase()
    : null;
  const rows = bankSetupCount(entry.rows);
  const keycap = hotkey ? hotkey.toUpperCase() : null;
  const provenance = bankSetupProvenanceLabel(entry.hotkey_source);
  const tooltip = [
    `${entry.emoji ? `${entry.emoji} ` : ""}${entry.label}`,
    `stored as ${entry.key}`,
    hotkey ? `key ${keycap}${provenance ? ` ${provenance}` : ""}` : "no key",
    rows === null ? null : `${rows} row${rows === 1 ? "" : "s"}`,
  ].filter((part) => part !== null).join(" · ");
  return {
    key: entry.key,
    hotkey,
    keycap,
    keycapStyle: hotkey === null ? "none" : entry.hotkey_source === "derived" ? "dashed" : "solid",
    emoji: typeof entry.emoji === "string" ? entry.emoji : "",
    label: typeof entry.label === "string" && entry.label ? entry.label : entry.key,
    rows,
    rule_refs: bankSetupCount(entry.rule_refs),
    group: typeof entry.group === "string" && entry.group.trim() ? entry.group : null,
    builtin: entry.builtin === true,
    hidden: entry.hidden === true,
    line: Number.isInteger(entry.line) && entry.line > 0
      ? entry.line
      : Number.isInteger(entry.source_line) && entry.source_line > 0
        ? entry.source_line
        : null,
    storedKey: entry.key,
    provenance,
    tooltip,
    ariaLabel: rows === null
      ? `${entry.label}, key ${keycap || "none"}`
      : `${entry.label}, key ${keycap || "none"}, ${rows} row${rows === 1 ? "" : "s"}`,
  };
}

function bankSetupAccountModel(entry) {
  if (!entry || typeof entry.alias !== "string" || !entry.alias) {
    return null;
  }
  const status = bankSetupStatusTone(typeof entry.status === "string" ? entry.status : "");
  return {
    alias: entry.alias,
    label: typeof entry.label === "string" && entry.label ? entry.label : entry.alias,
    kind: bankSetupText(entry.kind),
    default: entry.default === true,
    start: bankSetupText(entry.start),
    sinceLabel: bankSetupSinceLabel(entry.start),
    line: Number.isInteger(entry.line) && entry.line > 0
      ? entry.line
      : Number.isInteger(entry.source_line) && entry.source_line > 0
        ? entry.source_line
        : null,
    rows: bankSetupCount(entry.rows),
    status: status.word,
    statusIcon: status.icon,
    statusTone: status.tone,
    hint: bankSetupText(entry.hint),
    tooltip: [
      typeof entry.label === "string" && entry.label ? entry.label : entry.alias,
      entry.kind || null,
      entry.default === true ? "default" : null,
      bankSetupSinceLabel(entry.start),
      `${status.icon} ${status.word}`,
    ].filter((part) => part !== null).join(" · "),
  };
}

function bankSetupRuleModel(entry, labelByKey) {
  if (!entry || typeof entry.match !== "string" || !entry.match) {
    return null;
  }
  const catLabel = entry.cat && labelByKey && labelByKey.get(entry.cat);
  return {
    index: Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : null,
    match: entry.match,
    payee: bankSetupText(entry.payee),
    cat: bankSetupText(entry.cat),
    catLabel: catLabel || entry.cat || null,
    link: bankSetupText(entry.link),
    line: Number.isInteger(entry.line) && entry.line > 0
      ? entry.line
      : Number.isInteger(entry.source_line) && entry.source_line > 0
        ? entry.source_line
        : null,
    readTimeDead: /[0-9]{4,}/.test(entry.match),
  };
}

function bankSetupFindingModel(entry) {
  if (!entry || typeof entry.message !== "string" || !entry.message) {
    return null;
  }
  const line = Number.isInteger(entry.line) && entry.line > 0 ? entry.line : null;
  const keyPath = bankSetupText(entry.key_path);
  return {
    code: bankSetupText(entry.code),
    severity: entry.severity === "warning" ? "warning" : "error",
    path: bankSetupText(entry.path),
    line,
    key_path: keyPath,
    message: entry.message,
    hint: bankSetupText(entry.hint),
    label: [line !== null ? `line ${line}` : null, keyPath, entry.message]
      .filter((part) => part !== null)
      .join(" · "),
  };
}

function bankSetupPlural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// Collapsed grammar: the account label (or "+ N more"), the visible category
// count with a hidden tail, and the rule count. Money never appears here.
function bankSetupCollapsedLine(model) {
  if (!model) {
    return "Setup";
  }
  const accounts = Array.isArray(model.accounts) ? model.accounts : [];
  const accountText = accounts.length === 0
    ? "no accounts"
    : accounts.length === 1
      ? `🏦 ${accounts[0].label}`
      : `🏦 ${accounts[0].label} + ${accounts.length - 1} more`;
  const visible = bankSetupCount(model.visibleCount) || 0;
  const hidden = bankSetupCount(model.hiddenCount) || 0;
  const categoryText = hidden > 0
    ? `${bankSetupPlural(visible, "category", "categories")} · ${hidden} hidden`
    : bankSetupPlural(visible, "category", "categories");
  const rules = bankSetupCount(model.ruleCount) || 0;
  const ruleText = rules === 0 ? "no rules" : bankSetupPlural(rules, "rule", "rules");
  return `${accountText} · ${categoryText} · ${ruleText}`;
}

function bankSetupModel(report, options = {}) {
  const error = options.error || null;
  const desktop = options.desktop !== false;
  const expanded = options.expanded === true;
  const state = bankSetupStateKind(report, error, { desktop });
  const categories = report && Array.isArray(report.categories) ? report.categories : [];
  const labelByKey = new Map(
    categories
      .filter((entry) => entry && typeof entry.key === "string")
      .map((entry) => [entry.key, entry.label || entry.key]),
  );
  const visibleEntries = categories.filter((entry) => entry && entry.hidden !== true);
  const hiddenEntries = categories.filter((entry) => entry && entry.hidden === true);
  const sections = typeof bankCategorySections === "function"
    ? bankCategorySections(visibleEntries, {})
    : [];
  for (const section of sections) {
    for (const tile of section.tiles || []) {
      const full = categories.find((entry) => entry && entry.key === tile.key);
      const enriched = bankSetupTile(full || { key: tile.key, label: tile.label, hotkey: tile.hotkey });
      if (enriched) {
        tile.keycapStyle = enriched.keycapStyle;
        tile.rows = enriched.rows;
        tile.tooltip = enriched.tooltip;
        tile.ariaLabel = enriched.ariaLabel;
        tile.line = enriched.line;
        tile.provenance = enriched.provenance;
      }
    }
  }
  const hiddenTiles = hiddenEntries.map(bankSetupTile).filter(Boolean);
  const accounts = (report && Array.isArray(report.accounts) ? report.accounts : [])
    .map(bankSetupAccountModel)
    .filter(Boolean);
  const rules = (report && Array.isArray(report.rules) ? report.rules : [])
    .map((entry) => bankSetupRuleModel(entry, labelByKey))
    .filter(Boolean);
  const findings = (report && Array.isArray(report.findings) ? report.findings : [])
    .map(bankSetupFindingModel)
    .filter(Boolean);
  const errorFindings = findings.filter((entry) => entry.severity === "error");
  const staleAfter = report && report.stale_after && typeof report.stale_after === "object"
    ? report.stale_after
    : { days: 10, explicit: false, line: null };
  const model = {
    state,
    desktop,
    expanded: state === "invalid" ? true : expanded,
    stale: options.stale === true,
    refreshing: options.refreshing === true,
    errorCode: error && typeof error.code === "string" ? error.code : null,
    errorMessage: error && typeof error.message === "string" ? error.message : null,
    teachingEmpty: Boolean(report && report.teaching_empty),
    partial: Boolean(report && report.partial),
    path: (report && bankSetupText(report.path)) || BANK_SETUP_HUB_PATH,
    line: report && Number.isInteger(report.line) && report.line > 0 ? report.line : null,
    fingerprint: (report && bankSetupText(report.fingerprint)) || null,
    lastGoodAt: typeof options.lastGoodAt === "number" ? options.lastGoodAt : null,
    lastGoodLabel: bankSetupText(options.lastGoodLabel),
    accounts,
    sections,
    hiddenTiles,
    visibleCount: visibleEntries.length,
    hiddenCount: hiddenEntries.length,
    freeKeys: Array.isArray(report && report.free_hotkeys)
      ? report.free_hotkeys.filter((key) => typeof key === "string" && key.length === 1)
      : [],
    ruleCount: rules.length,
    rules,
    findings,
    errorCount: errorFindings.length,
    staleAfterDays: bankSetupCount(staleAfter.days),
    staleAfterExplicit: staleAfter.explicit === true,
    staleAfterLine: Number.isInteger(staleAfter.line) && staleAfter.line > 0 ? staleAfter.line : null,
    starter: report && typeof report.starter === "string" && report.starter ? report.starter : null,
    today: (report && bankSetupText(report.today)) || null,
  };
  model.collapsedLine = bankSetupCollapsedLine(model);
  model.signature = bankSetupModelSignature(model);
  return model;
}

// Pure line-shift for lint marks across an edit: each delta is
// { fromLine, delta } in 1-based lines. A mark on an edited line drops;
// marks below shift; marks above keep their line.
function bankSetupMapFindingLines(marks, deltas) {
  const out = [];
  for (const mark of Array.isArray(marks) ? marks : []) {
    if (!mark || !Number.isInteger(mark.line) || mark.line < 1) {
      continue;
    }
    let line = mark.line;
    let dropped = false;
    for (const delta of Array.isArray(deltas) ? deltas : []) {
      if (!delta || !Number.isInteger(delta.fromLine) || !Number.isInteger(delta.delta)) {
        continue;
      }
      if (line < delta.fromLine) {
        continue;
      }
      if (delta.delta === 0) {
        // A same-line edit drops only that line; marks below keep their line.
        if (line === delta.fromLine) {
          dropped = true;
          break;
        }
        continue;
      }
      if (line === delta.fromLine) {
        dropped = true;
        break;
      }
      line += delta.delta;
    }
    if (!dropped && line > 0) {
      out.push({ ...mark, line });
    }
  }
  return out;
}

// Pure lint-mark model: one entry per located finding. Marks are keyed by
// line so the editor can map them through edits.
function bankSetupLintMarks(findings) {
  const out = [];
  for (const entry of Array.isArray(findings) ? findings : []) {
    if (!entry || typeof entry.message !== "string" || !entry.message) {
      continue;
    }
    if (!Number.isInteger(entry.line) || entry.line < 1) {
      continue;
    }
    out.push({
      line: entry.line,
      severity: entry.severity === "warning" ? "warning" : "error",
      message: entry.message,
      keyPath: typeof entry.key_path === "string" ? entry.key_path : null,
      tooltip: [entry.key_path || null, entry.message].filter(Boolean).join(" — "),
    });
  }
  return out;
}

// Widget identity: the model signature plus the live surface options.
function bankSetupSignature(model, extra = {}) {
  try {
    return [model && model.signature, extra.expanded === true, extra.desktop !== false].join("::");
  } catch (error) {
    return "setup";
  }
}

// Repaint signature: collapsed grammar, section and tile identity, counts,
// state, and freshness. Money and row text never participate.
function bankSetupModelSignature(model) {
  if (!model) {
    return "none";
  }
  const tiles = [];
  for (const section of model.sections || []) {
    for (const tile of section.tiles || []) {
      tiles.push([
        tile.key,
        tile.hotkey || "",
        tile.keycapStyle || "",
        tile.rows === null || tile.rows === undefined ? "" : String(tile.rows),
      ].join(":"));
    }
  }
  const hidden = (model.hiddenTiles || []).map((tile) => `${tile.key}:${tile.hotkey || ""}`).join(",");
  const accounts = (model.accounts || [])
    .map((account) => `${account.alias}:${account.status || ""}`)
    .join(",");
  const rules = (model.rules || []).map((rule) => `${rule.match}→${rule.cat || ""}`).join(",");
  const findings = (model.findings || [])
    .map((finding) => `${finding.severity}:${finding.line || 0}:${finding.message}`)
    .join("|");
  return JSON.stringify({
    state: model.state,
    expanded: model.expanded,
    stale: model.stale,
    refreshing: model.refreshing,
    error: model.errorCode,
    fingerprint: model.fingerprint,
    collapsed: model.collapsedLine,
    accounts,
    tiles: tiles.join(","),
    hidden,
    free: (model.freeKeys || []).join(""),
    rules,
    findings,
    staleDays: model.staleAfterDays,
  });
}
