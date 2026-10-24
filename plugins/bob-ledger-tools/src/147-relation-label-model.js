// Pure mirror of bob-cli `src/native/relation_labels/`: relation-label
// keys, catalog spelling/order, preference journal fold, and query rank.
// The shared vectors in `scripts/fixtures/relation_labels/` are copied from
// bob-cli and are the parity contract for this mirror.
const RELATION_LABELS_SCHEMA_VERSION = 1;
const RELATION_LABELS_JOURNAL_DIR = ".bob/relations";
const RELATION_LABELS_VIA = "bob-ledger-tools";
const RELATION_LABEL_INVERSES = Object.freeze({
  "merged into": "merged from",
  "duplicate of": "duplicated by",
  "follow-up of": "followed up by",
  "superseded by": "supersedes",
  "split from": "split into",
});

function relationLabelCollapseText(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).join(" ");
}

// Mirrors `relation_label_key`: writer normalization followed by Unicode
// lowercase. Do not add NFC or any other equivalence.
function relationLabelKey(value) {
  return relationLabelCollapseText(value).replace(/:$/u, "").trim().toLowerCase();
}

function relationLabelInversePhrase(value) {
  return RELATION_LABEL_INVERSES[relationLabelKey(value)] || null;
}

function relationLabelCodepointCompare(left, right) {
  const a = Array.from(String(left), (char) => char.codePointAt(0));
  const b = Array.from(String(right), (char) => char.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function relationLabelPathIncluded(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  const directories = parts.slice(0, -1);
  return !directories.some((part) =>
    part.startsWith(".") || part === "_conflicts" || part === "_templates",
  );
}

function relationLabelCatalogRows(edges, prefs = {}) {
  const orderedEdges = (Array.isArray(edges) ? edges : [])
    .filter((edge) => relationLabelPathIncluded(edge && edge.source && edge.source.path))
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftPath = String(left.edge && left.edge.source && left.edge.source.path || "");
      const rightPath = String(right.edge && right.edge.source && right.edge.source.path || "");
      return relationLabelCodepointCompare(leftPath, rightPath) ||
        Number(left.edge && left.edge.relationLine || 0) - Number(right.edge && right.edge.relationLine || 0) ||
        left.index - right.index;
    });
  const byKey = new Map();
  let seen = 0;
  for (const { edge } of orderedEdges) {
    const name = relationLabelCollapseText(edge && edge.label);
    const key = relationLabelKey(name);
    if (!key) continue;
    let row = byKey.get(key);
    if (!row) {
      row = { key, count: 0, spellings: new Map() };
      byKey.set(key, row);
    }
    row.count += 1;
    const spelling = row.spellings.get(name);
    if (spelling) spelling.count += 1;
    else row.spellings.set(name, { name, count: 1, firstSeen: seen });
    seen += 1;
  }

  for (const [key, pref] of Object.entries(prefs || {})) {
    if (!pref || pref.hidden !== true || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      count: 0,
      spellings: new Map(),
      journalName: typeof pref.name === "string" ? pref.name : "",
    });
  }

  const rows = [];
  for (const row of byKey.values()) {
    const spellings = [...row.spellings.values()];
    const display = spellings.slice().sort((left, right) =>
      right.count - left.count || left.firstSeen - right.firstSeen,
    )[0];
    const name = display ? display.name : row.journalName;
    rows.push({
      key: row.key,
      name,
      count: row.count,
      hidden: Boolean(prefs && prefs[row.key] && prefs[row.key].hidden === true),
      inverse: relationLabelInversePhrase(name),
      spellings: spellings
        .sort((left, right) => right.count - left.count || relationLabelCodepointCompare(left.name, right.name))
        .map(({ name: spellingName, count }) => ({ name: spellingName, count })),
    });
  }
  rows.sort((left, right) =>
    right.count - left.count ||
    relationLabelCodepointCompare(left.key, right.key) ||
    relationLabelCodepointCompare(left.name, right.name),
  );
  return rows;
}

function relationLabelParseJournalLine(text, path, lineNumber) {
  try {
    const value = JSON.parse(String(text || ""));
    if (!value || typeof value !== "object" || Array.isArray(value) || value.v !== 1) return null;
    const tsRaw = typeof value.ts === "string" ? value.ts : "";
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(tsRaw)) return null;
    const tsMs = Date.parse(tsRaw);
    const host = typeof value.host === "string" ? value.host : "";
    if (!Number.isFinite(tsMs) || !host) return null;
    const keyOf = (field) => typeof value[field] === "string" ? relationLabelKey(value[field]) : "";
    const nameOf = (field) => typeof value[field] === "string" ? value[field] : "";
    const kind = value.kind;
    if (kind === "relation_label.hide" || kind === "relation_label.unhide") {
      const key = keyOf("key");
      if (!key) return null;
      return {
        tsMs, host, path: String(path || ""), line: Number.isInteger(lineNumber) ? lineNumber : 0,
        kind, key, name: nameOf("name"),
      };
    }
    if (kind === "relation_label.rename") {
      const from = keyOf("from");
      const to = keyOf("to");
      if (!from || !to) return null;
      return {
        tsMs, host, path: String(path || ""), line: Number.isInteger(lineNumber) ? lineNumber : 0,
        kind, from, to, from_name: nameOf("from_name"), to_name: nameOf("to_name"),
      };
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function relationLabelFoldEvents(events) {
  const ordered = (Array.isArray(events) ? events : []).slice().sort((left, right) =>
    left.tsMs - right.tsMs ||
    relationLabelCodepointCompare(left.host, right.host) ||
    relationLabelCodepointCompare(left.path, right.path) ||
    (left.line || 0) - (right.line || 0),
  );
  const byKey = {};
  for (const event of ordered) {
    if (!event || typeof event.kind !== "string") continue;
    if (event.kind === "relation_label.hide" || event.kind === "relation_label.unhide") {
      const pref = byKey[event.key] || { hidden: false, name: "" };
      pref.hidden = event.kind === "relation_label.hide";
      if (event.name) pref.name = event.name;
      byKey[event.key] = pref;
    } else if (event.kind === "relation_label.rename" && event.from !== event.to) {
      const source = byKey[event.from];
      const targetHasState = Object.prototype.hasOwnProperty.call(byKey, event.to);
      if (source && !targetHasState) {
        byKey[event.to] = source;
        delete byKey[event.from];
      }
      const target = byKey[event.to];
      if (event.to_name && target && !target.name) target.name = event.to_name;
    }
  }
  return { byKey };
}

function relationLabelRankRows(rows, query, hidden = "exclude") {
  const filter = hidden === "only" || hidden === "include" ? hidden : "exclude";
  const needle = relationLabelKey(query);
  const catalog = (Array.isArray(rows) ? rows : [])
    .filter((row) => filter === "include" || (filter === "only" ? row.hidden === true : row.hidden !== true))
    .slice()
    .sort((left, right) =>
      Math.max(0, Number(right.count) || 0) - Math.max(0, Number(left.count) || 0) ||
      relationLabelCodepointCompare(left.key || relationLabelKey(left.name), right.key || relationLabelKey(right.name)) ||
      relationLabelCodepointCompare(left.name, right.name),
    );
  if (!needle) return catalog;
  const matching = catalog.filter((row) =>
    relationLabelKey(row.name).includes(needle),
  );
  return [
    ...matching.filter((row) => relationLabelKey(row.name).startsWith(needle)),
    ...matching.filter((row) => !relationLabelKey(row.name).startsWith(needle)),
  ];
}

function relationLabelApiRows(edges, prefs, query, options = {}) {
  const hidden = options && typeof options.hidden === "string" ? options.hidden : "exclude";
  return relationLabelRankRows(relationLabelCatalogRows(edges, prefs), query, hidden).map((row) => ({
    key: row.key,
    name: row.name,
    count: row.count,
    hidden: row.hidden,
    inverse: row.inverse,
  }));
}

function relationLabelsDecodeWrite(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_error) {
    return {
      ok: false,
      code: "unsupported",
      message: "Update bob to manage relation labels.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "bad-shape", message: "bob relations returned an unexpected JSON shape.", detail: statsFirstLine(stderr) };
  }
  if (body.ok === true) return { ok: true, report: body };
  return {
    ok: false,
    code: typeof body.code === "string" && body.code ? body.code : "bob-error",
    message: typeof body.message === "string" && body.message ? body.message : "bob relations reported an error.",
    detail: statsFirstLine(stderr),
  };
}
