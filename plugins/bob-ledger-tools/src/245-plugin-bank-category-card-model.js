// Pure Category card view model, key table, session, and end-of-run summary
// (bank_weekly_category_walk card-model). No DOM, no spawns: card-ui renders
// what these return. Bob owns categories, hotkeys, groups, and suggestions.

const BANK_CATEGORY_MONEY_GROUP = "Money moves";
const BANK_CATEGORY_SOURCES = ["rule", "learned", "bank"];
const BANK_CATEGORY_LOCK_MS = 300;
const BANK_CATEGORY_SESSION_IDLE_MS = 15 * 60 * 1000;

function bankCategoryText(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const BANK_CATEGORY_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function bankCategoryMonthLabel(pathOrKey) {
  const fromPath = typeof pathOrKey === "string" ? bankMonthFromPath(pathOrKey) : null;
  const key = fromPath
    ? fromPath.key
    : (typeof pathOrKey === "string" && /^\d{4}-\d{2}$/.test(pathOrKey) ? pathOrKey : null);
  if (!key) return null;
  const month = Number(key.slice(5, 7));
  return BANK_CATEGORY_MONTH_NAMES[month - 1] || key;
}

function bankCategoryDayLabel(date) {
  if (typeof date !== "string") return null;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return bankCategoryText(date);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const abbr = typeof BANK_MONTHS_ABBR !== "undefined" ? BANK_MONTHS_ABBR[month - 1] : null;
  return abbr ? `${abbr} ${day}` : date;
}

function bankCategoryProgressModel(mode, progress, pathOrKey) {
  if (mode !== "close" || !progress || typeof progress !== "object") return null;
  const month = bankCategoryText(progress.month) || bankCategoryMonthLabel(pathOrKey);
  return month ? { ...progress, month } : { ...progress };
}

function bankCategoryAnnounceText(input = {}) {
  const amount = bankCategoryText(input.amount) || "";
  const label = bankCategoryText(input.categoryLabel);
  const nextAmount = bankCategoryText(input.nextAmount);
  const filed = label ? `Filed ${amount} as ${label}` : `Filed ${amount} · no category`;
  if (nextAmount) return `${filed} · next ${nextAmount} waiting`;
  return filed;
}

function bankCategoryVisible(categories) {
  return (Array.isArray(categories) ? categories : []).filter(
    (entry) => entry && typeof entry.key === "string" && entry.key && entry.hidden !== true,
  );
}

function bankCategoryByKey(categories, key) {
  if (!key || !Array.isArray(categories)) {
    return null;
  }
  return categories.find((entry) => entry && entry.key === key) || null;
}

// Hotkey table in declared order. `q` never files: it cancels the card.
function bankCategoryKeyTable(categories) {
  const byKey = new Map();
  for (const entry of bankCategoryVisible(categories)) {
    const hotkey = typeof entry.hotkey === "string" && entry.hotkey.length === 1
      ? entry.hotkey.toLowerCase()
      : null;
    if (!hotkey || hotkey === "q" || byKey.has(hotkey)) {
      continue;
    }
    byKey.set(hotkey, entry.key);
  }
  return byKey;
}

function bankCategoryTileLabel(entry) {
  const emoji = typeof entry.emoji === "string" ? entry.emoji : "";
  const label = typeof entry.label === "string" ? entry.label : entry.key;
  return `${emoji ? `${emoji} ` : ""}${label}`;
}

function bankCategorySections(categories, options = {}) {
  const inflow = options.inflow === true;
  const visible = bankCategoryVisible(categories);
  const sections = [];
  const indexByGroup = new Map();
  const untitledKey = "";
  for (const entry of visible) {
    const group = typeof entry.group === "string" && entry.group.trim() ? entry.group : null;
    const mapKey = group || untitledKey;
    let section = indexByGroup.has(mapKey) ? sections[indexByGroup.get(mapKey)] : null;
    if (!section) {
      section = { group, tiles: [], dimmed: false };
      indexByGroup.set(mapKey, sections.length);
      sections.push(section);
    }
    const hotkey = typeof entry.hotkey === "string" && entry.hotkey.length === 1
      ? entry.hotkey.toLowerCase()
      : null;
    section.tiles.push({
      key: entry.key,
      hotkey,
      keycap: hotkey ? hotkey.toUpperCase() : null,
      emoji: typeof entry.emoji === "string" ? entry.emoji : "",
      label: typeof entry.label === "string" ? entry.label : entry.key,
      text: bankCategoryTileLabel(entry),
      dimmed: false,
    });
  }
  if (inflow) {
    const moneyIndex = sections.findIndex((section) => section.group === BANK_CATEGORY_MONEY_GROUP);
    if (moneyIndex > 0) {
      const [money] = sections.splice(moneyIndex, 1);
      sections.unshift(money);
    }
    for (const section of sections) {
      if (section.group !== BANK_CATEGORY_MONEY_GROUP) {
        section.dimmed = true;
        for (const tile of section.tiles) {
          tile.dimmed = true;
        }
      }
    }
  }
  return sections;
}

function bankCategoryHighlightKey(categories, rowCategoryKey, suggestion) {
  const visible = bankCategoryVisible(categories);
  const visibleKeys = new Set(visible.map((entry) => entry.key));
  if (rowCategoryKey && visibleKeys.has(rowCategoryKey)) {
    return rowCategoryKey;
  }
  if (suggestion && visibleKeys.has(suggestion.category)) {
    return suggestion.category;
  }
  return null;
}

// Footer variants: row+suggestion agree, row wins, suggestion only, neither.
function bankCategoryCardFooter(rowCategoryKey, rowCategoryLabel, suggestion, suggestionLabel) {
  if (rowCategoryKey && suggestion && suggestion.category === rowCategoryKey) {
    return {
      kind: "agree",
      highlightKey: rowCategoryKey,
      origin: "suggestion",
      source: suggestion.source,
      text: `↵ ${rowCategoryLabel} · ${suggestion.source}`,
    };
  }
  if (rowCategoryKey) {
    return {
      kind: "row",
      highlightKey: rowCategoryKey,
      origin: "row",
      source: null,
      text: `↵ ${rowCategoryLabel} · on the row`,
    };
  }
  if (suggestion) {
    return {
      kind: "suggestion",
      highlightKey: suggestion.category,
      origin: "suggestion",
      source: suggestion.source,
      text: `↵ ${suggestionLabel} · ${suggestion.source}`,
    };
  }
  return { kind: "none", highlightKey: null, origin: null, source: null, text: "pick a category" };
}

function bankCategoryOldBob(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return false;
  }
  return !categories.some(
    (entry) => entry && typeof entry.hotkey === "string" && entry.hotkey.length === 1,
  );
}

function bankCategoryRowLabel(categories, key) {
  const entry = bankCategoryByKey(categories, key);
  if (!entry) {
    return key;
  }
  return bankCategoryTileLabel(entry);
}

function bankCategoryCardModel(input = {}) {
  const mode = input.mode === "set" ? "set" : "close";
  const categories = Array.isArray(input.categories) ? input.categories : null;
  const row = input.row && typeof input.row === "object" ? input.row : {};
  if (!categories) {
    const reason = bankCategoryText(input.reason) || "categories unavailable";
    return {
      kind: "restricted",
      mode,
      inflow: Number.isSafeInteger(row.cents) && row.cents > 0,
      reason,
      header: {
        cents: Number.isSafeInteger(row.cents) ? row.cents : null,
        payee: bankCategoryText(row.payee) || "",
        date: bankCategoryText(row.date) || null,
        day: bankCategoryDayLabel(row.date),
        flagged: row.flagged === true,
        account: bankCategoryText(row.account) || null,
        state: mode === "set" ? (row.acknowledged === true ? "acknowledged" : "waiting") : null,
      },
      footer: { kind: "restricted", text: "␣ acknowledge · esc cancel" },
      hint: reason,
      progress: bankCategoryProgressModel(mode, input.progress, input.path || row.path),
    };
  }
  const inflow = Number.isSafeInteger(row.cents) && row.cents > 0;
  const sections = bankCategorySections(categories, { inflow });
  const suggestion = input.suggestion && typeof input.suggestion === "object" &&
      typeof input.suggestion.category === "string" && BANK_CATEGORY_SOURCES.includes(input.suggestion.source)
    ? { category: input.suggestion.category, source: input.suggestion.source }
    : null;
  const visibleKeys = new Set(bankCategoryVisible(categories).map((entry) => entry.key));
  const rowCategoryKey = typeof row.category === "string" && visibleKeys.has(row.category)
    ? row.category
    : (typeof row.category === "string" && row.category ? row.category : null);
  const highlightableRowKey = rowCategoryKey && visibleKeys.has(rowCategoryKey) ? rowCategoryKey : null;
  const highlightableSuggestion = suggestion && visibleKeys.has(suggestion.category) ? suggestion : null;
  const highlightKey = highlightableRowKey || (highlightableSuggestion ? highlightableSuggestion.category : null);
  const rowLabel = rowCategoryKey ? bankCategoryRowLabel(categories, rowCategoryKey) : null;
  const suggestionLabel = highlightableSuggestion
    ? bankCategoryRowLabel(categories, highlightableSuggestion.category)
    : null;
  const footer = bankCategoryCardFooter(
    highlightableRowKey ? highlightableRowKey : null,
    highlightableRowKey ? bankCategoryRowLabel(categories, highlightableRowKey) : null,
    highlightableSuggestion,
    highlightableSuggestion ? bankCategoryRowLabel(categories, highlightableSuggestion.category) : null,
  );
  void rowLabel;
  void suggestionLabel;
  const oldBob = bankCategoryOldBob(categories);
  return {
    kind: "card",
    mode,
    inflow,
    oldBob,
    header: {
      cents: Number.isSafeInteger(row.cents) ? row.cents : null,
      payee: bankCategoryText(row.payee) || "",
      date: bankCategoryText(row.date) || null,
      day: bankCategoryDayLabel(row.date),
      flagged: row.flagged === true,
      account: bankCategoryText(row.account) || null,
      state: mode === "set" ? (row.acknowledged === true ? "acknowledged" : "waiting") : null,
    },
    sections,
    highlightKey,
    footer: oldBob
      ? { ...footer, hint: "update bob for one-key filing" }
      : footer,
    progress: bankCategoryProgressModel(mode, input.progress, input.path || row.path),
  };
}

// Single-key resolution. Returns a pure action descriptor; rendering and the
// editor transaction belong to card-ui.
function bankCategoryResolveCardKey(input = {}) {
  const key = typeof input.key === "string" ? input.key : "";
  const table = input.table instanceof Map ? input.table : bankCategoryKeyTable(input.categories);
  if (key === "Enter" || key === "Ctrl+Enter") {
    return { action: "accept" };
  }
  if (key === " ") {
    return { action: "no-category" };
  }
  if (key === "Escape" || key === "q" || key === "Q" || key === "Ctrl+[") {
    return { action: "cancel" };
  }
  if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" ||
    key === "Ctrl+N" || key === "Ctrl+P") {
    return { action: "move", key };
  }
  if (key.length === 1) {
    const lower = key.toLowerCase();
    if (lower === "q") {
      return { action: "cancel" };
    }
    if (table.has(lower)) {
      return { action: "file", category: table.get(lower) };
    }
  }
  return { action: "ignore" };
}

function bankCategoryMoveHighlight(highlightKey, tiles, direction) {
  const order = (Array.isArray(tiles) ? tiles : []).map((tile) => tile.key);
  if (order.length === 0) {
    return null;
  }
  const at = order.indexOf(highlightKey);
  if (at < 0) {
    return direction === "back" ? order[order.length - 1] : order[0];
  }
  if (direction === "back") {
    return order[(at - 1 + order.length) % order.length];
  }
  return order[(at + 1) % order.length];
}

// Opening chord: the held or repeating Enter that opened the card never
// accepts. A second Ctrl+Enter counts only after the opening Enter keyup.
function bankCategoryChordInit(openedWithEnter) {
  return { swallowEnter: openedWithEnter === true, enterUpSeen: false };
}

function bankCategoryChordKeyup(state) {
  return { swallowEnter: false, enterUpSeen: true, prev: state || null };
}

function bankCategoryChordShouldSwallow(state, key) {
  if (!state || state.swallowEnter !== true) {
    return false;
  }
  return key === "Enter";
}

// Gesture lock: for ~300ms after a landing, Ctrl+Enter is swallowed.
function bankCategoryLockInit(nowMs) {
  return { lockedUntil: Number.isFinite(nowMs) ? nowMs + BANK_CATEGORY_LOCK_MS : 0 };
}

function bankCategoryLockActive(lock, nowMs) {
  if (!lock || !Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs < lock.lockedUntil;
}

// Walk session: per note path, counts filed/accepted/picked/no-category.
function bankCategorySessionStart(path, nowMs) {
  return {
    path: typeof path === "string" ? path : "",
    startedAt: Number.isFinite(nowMs) ? nowMs : Date.now(),
    lastActivity: Number.isFinite(nowMs) ? nowMs : Date.now(),
    filed: 0,
    accepted: 0,
    picked: 0,
    noCategory: 0,
  };
}

function bankCategorySessionRecord(session, kind, nowMs) {
  if (!session) {
    return session;
  }
  const next = { ...session, lastActivity: Number.isFinite(nowMs) ? nowMs : session.lastActivity };
  next.filed += 1;
  if (kind === "accept") {
    next.accepted += 1;
  } else if (kind === "pick") {
    next.picked += 1;
  } else if (kind === "no-category") {
    next.noCategory += 1;
  }
  return next;
}

function bankCategorySessionProgress(session, stillWaiting) {
  const filed = session && Number.isInteger(session.filed) ? session.filed : 0;
  const waiting = Number.isInteger(stillWaiting) && stillWaiting >= 0 ? stillWaiting : 0;
  return { filed: filed + 1, total: filed + waiting, waiting };
}

function bankCategorySessionIdleExpired(session, nowMs) {
  if (!session || !Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs - session.lastActivity > BANK_CATEGORY_SESSION_IDLE_MS;
}

function bankCategoryElapsedText(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function bankCategoryAccountLine(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  const importable = list.filter((account) => account && account.kind !== "cash");
  if (importable.length === 0) {
    return null;
  }
  const parts = [];
  for (const account of importable) {
    const label = account.label || account.alias || "Account";
    const status = typeof account.status === "string" ? account.status : null;
    if (status && status !== "balanced" && status !== "ok") {
      if (/stale/i.test(status)) {
        parts.push(`${label} ⚠ import stale`);
      } else if (/gap/i.test(status)) {
        parts.push(`${label} ⚠ gap`);
      } else if (/delta/i.test(status)) {
        const hint = typeof account.hint === "string" && account.hint ? ` ${account.hint}` : "";
        parts.push(`${label} Δ${hint}`);
      } else {
        const hint = typeof account.hint === "string" && account.hint ? ` · ${account.hint}` : "";
        parts.push(`${label} ${status}${hint}`);
      }
      continue;
    }
    if (typeof account.hint === "string" && account.hint) {
      parts.push(`${label} ${account.hint}`);
      continue;
    }
    parts.push(`${label} ✓ balanced`);
  }
  return parts.join(" · ");
}

// End-of-run notice model. Bob owns every number; only line one shows when
// bob is unreachable.
function bankCategoryEndOfRunSummary(input = {}) {
  const monthLabel = bankCategoryText(input.monthLabel) || "Month";
  const filed = Number.isInteger(input.filed) && input.filed >= 0 ? input.filed : 0;
  const elapsedText = bankCategoryElapsedText(input.elapsedMs);
  const accepted = Number.isInteger(input.accepted) ? input.accepted : 0;
  const picked = Number.isInteger(input.picked) ? input.picked : 0;
  const noCategory = Number.isInteger(input.noCategory) ? input.noCategory : 0;
  const line1 = `🏦 ${monthLabel} filed — ${filed} row${filed === 1 ? "" : "s"} in ${elapsedText}`;
  if (input.bobReachable === false) {
    return { line1, line2: null, waitingLinks: [], counts: { accepted, picked, noCategory } };
  }
  const accountLine = bankCategoryAccountLine(input.accounts);
  const waitingLinks = (Array.isArray(input.waitingByMonth) ? input.waitingByMonth : [])
    .filter((entry) => entry && Number.isInteger(entry.waiting) && entry.waiting > 0 &&
      bankCategoryText(entry.month))
    .map((entry) => ({ month: entry.month, waiting: entry.waiting, path: entry.path || `bank/${entry.month}.md` }));
  const countsLine = `${accepted} accepted · ${picked} picked · ${noCategory} without a category`;
  const line2parts = [];
  if (accountLine) {
    line2parts.push(accountLine);
  }
  for (const link of waitingLinks) {
    line2parts.push(`${link.waiting} waiting in ${link.month} →`);
  }
  return {
    line1,
    line2: line2parts.length > 0 ? line2parts.join("   ") : null,
    detail: countsLine,
    waitingLinks,
    counts: { accepted, picked, noCategory },
  };
}
