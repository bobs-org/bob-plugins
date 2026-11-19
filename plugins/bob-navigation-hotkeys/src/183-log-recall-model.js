// Pure client model for bob-cli's log-recall vectors. Bob supplies each
// phrase's spelling, score, and recency rank; clients only normalize drafts,
// merge the session overlay, and apply the shared literal match tiers.
function normalizeLogRecallQuery(value) {
  try {
    return String(value == null ? "" : value)
      .normalize("NFC")
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean)
      .join(" ");
  } catch (_error) {
    return "";
  }
}

function logRecallPhrasesFromCatalog(kindCatalog) {
  if (Array.isArray(kindCatalog)) return kindCatalog;
  if (kindCatalog && Array.isArray(kindCatalog.phrases)) return kindCatalog.phrases;
  if (kindCatalog && Array.isArray(kindCatalog.logs)) {
    return kindCatalog.logs.flatMap((log) => Array.isArray(log.phrases) ? log.phrases : []);
  }
  return [];
}

function logRecallOverlayEntries(overlay, kind) {
  if (Array.isArray(overlay)) return overlay;
  return overlay && Array.isArray(overlay[kind]) ? overlay[kind] : [];
}

function logRecallOverlayStamp(entry, kind) {
  const date = new Date(entry.at);
  if (!Number.isFinite(date.getTime())) return entry.at;
  const pad = (value) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return kind === "work" ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

function logRecallWordPrefix(text, query) {
  if (!query) return false;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(query, from);
    if (index < 0) return false;
    if (index === 0) return true;
    const before = Array.from(text.slice(0, index)).at(-1) || "";
    const at = Array.from(text.slice(index))[0] || "";
    if (!/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(at)) return true;
    from = index + Math.max(1, query.length);
  }
  return false;
}

function logRecallMergePhrases(kindCatalog, overlay, kind = null) {
  const phrases = logRecallPhrasesFromCatalog(kindCatalog);
  const entries = logRecallOverlayEntries(overlay, kind);
  const newestByKey = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.text !== "string") continue;
    const key = normalizeLogRecallQuery(entry.key || entry.text);
    const at = typeof entry.at === "string" ? entry.at : "";
    if (!key || !at) continue;
    const old = newestByKey.get(key);
    if (!old || at > old.at) newestByKey.set(key, { ...entry, key, at });
  }
  const recent = [...newestByKey.values()].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const merged = new Map();
  for (const phrase of phrases) {
    if (!phrase || typeof phrase !== "object") continue;
    const key = typeof phrase.key === "string" ? phrase.key : normalizeLogRecallQuery(phrase.text);
    if (!key) continue;
    merged.set(key, { ...phrase, key, score: Number(phrase.score) || 0, recency_rank: Number.isFinite(Number(phrase.recency_rank)) ? Number(phrase.recency_rank) : Number.MAX_SAFE_INTEGER });
  }
  recent.forEach((entry, index) => {
    const recencyRank = index - recent.length;
    const lastUsed = logRecallOverlayStamp(entry, kind);
    const previous = merged.get(entry.key);
    if (previous) {
      merged.set(entry.key, { ...previous, text: entry.text, last_used: lastUsed, recency_rank: recencyRank });
    } else {
      merged.set(entry.key, {
        text: entry.text,
        key: entry.key,
        uses: 1,
        last_used: lastUsed,
        score: 1,
        recency_rank: recencyRank,
        match: null,
      });
    }
  });
  return [...merged.values()];
}

function rankLogRecall(kindCatalog, overlay, query, kind = null) {
  const phrases = logRecallMergePhrases(kindCatalog, overlay, kind);
  const q = normalizeLogRecallQuery(query);
  const tiers = { exact: [], prefix: [], word: [], substring: [], none: [] };
  for (const phrase of phrases) {
    const key = normalizeLogRecallQuery(phrase.key || phrase.text);
    let match = "none";
    if (!q) match = "none";
    else if (key === q) match = "exact";
    else if (key.startsWith(q)) match = "prefix";
    else if (logRecallWordPrefix(key, q)) match = "word";
    else if (key.includes(q)) match = "substring";
    else continue;
    tiers[match].push({ ...phrase, match: match === "none" ? null : match });
  }
  const ordered = [];
  const names = q ? ["exact", "prefix", "word", "substring"] : ["none"];
  for (const name of names) {
    const rows = tiers[name];
    const newest = rows.reduce((best, row) => Math.min(best, Number(row.recency_rank)), Number.POSITIVE_INFINITY);
    rows.sort((left, right) => {
      const leftRank = Number(left.recency_rank);
      const rightRank = Number(right.recency_rank);
      const leftPinned = leftRank === newest;
      const rightPinned = rightRank === newest;
      return Number(rightPinned) - Number(leftPinned)
        || Number(right.score || 0) - Number(left.score || 0)
        || leftRank - rightRank
        || String(left.key).localeCompare(String(right.key));
    });
    ordered.push(...rows);
  }
  return ordered;
}

function logRecallInitialState(options = {}) {
  return {
    mode: "draft",
    kind: options.kind || "work",
    draft: String(options.draft || ""),
    rows: Array.isArray(options.rows) ? options.rows.slice() : [],
    selectedKey: null,
    edge: null,
  };
}

function logRecallReduce(state, action = {}) {
  const current = state && typeof state === "object" ? state : logRecallInitialState();
  const rows = Array.isArray(action.rows) ? action.rows : current.rows || [];
  const selectedIndex = rows.findIndex((row) => row && row.key === current.selectedKey);
  switch (action.type) {
    case "draft":
      return { ...current, mode: "draft", draft: String(action.text == null ? "" : action.text), rows, selectedKey: null, edge: null };
    case "rows":
      return { ...current, rows, selectedKey: rows.some((row) => row.key === current.selectedKey) ? current.selectedKey : null };
    case "kind":
      return { ...current, kind: action.kind || current.kind, mode: "draft", rows, selectedKey: null, edge: null };
    case "enter":
      if (!rows.length) return { ...current, rows, edge: "empty" };
      return { ...current, mode: "recalling", rows, selectedKey: rows[0].key, edge: null };
    case "click":
      return action.row && action.row.key ? { ...current, mode: "recalling", selectedKey: action.row.key, edge: null } : current;
    case "next": {
      if (!rows.length) return { ...current, rows, edge: "empty" };
      if (current.mode !== "recalling" || selectedIndex < 0) return { ...current, mode: "recalling", rows, selectedKey: rows[0].key, edge: null };
      if (selectedIndex >= rows.length - 1) return { ...current, rows, edge: "bottom" };
      return { ...current, rows, selectedKey: rows[selectedIndex + 1].key, edge: null };
    }
    case "previous": {
      if (!rows.length) return { ...current, rows, edge: "empty" };
      if (current.mode !== "recalling" || selectedIndex < 0) return { ...current, mode: "recalling", rows, selectedKey: rows[0].key, edge: null };
      if (selectedIndex === 0) return { ...current, mode: "draft", selectedKey: null, edge: null };
      return { ...current, rows, selectedKey: rows[selectedIndex - 1].key, edge: null };
    }
    case "backOut":
      return current.mode === "recalling" ? { ...current, mode: "draft", selectedKey: null, edge: null } : current;
    default:
      return current;
  }
}

function formatLogRecallAge(value, precision = "minute", now = new Date()) {
  const source = value && typeof value === "object" ? value.last_used : value;
  if (typeof source !== "string" || !source) return "";
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
  if (!dayMatch) return "";
  const at = precision === "day" || /^\d{4}-\d{2}-\d{2}$/.test(source)
    ? new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]))
    : /T\d{2}:\d{2}:\d{2}/.test(source)
      ? new Date(source)
      : new Date(`${source.replace(" ", "T")}:00`);
  if (!Number.isFinite(at.getTime())) return "";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const days = Math.max(0, Math.floor((today - date) / 86400000));
  if (precision === "day" || /^\d{4}-\d{2}-\d{2}$/.test(source)) {
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d`;
  } else {
    const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60000));
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440 && days === 0) return `${Math.floor(minutes / 60)}h`;
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d`;
  }
  const sameYear = at.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
}
