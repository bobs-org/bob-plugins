// Pure model for recalling reusable row notes from bank-month contents.
// The bank walk index owns the content snapshot; this file only ranks views.

const BANK_NOTE_SUGGEST_LIMIT = 4;
const BANK_NOTE_SUGGEST_HALF_LIFE_DAYS = 30;
const BANK_NOTE_SUGGEST_GLOBAL_MIN = 2;

function bankNoteFold(value) {
  return String(value === null || value === undefined ? "" : value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function bankNoteMerchantLabel(payee) {
  return String(payee === null || payee === undefined ? "" : payee)
    .replace(/\*\s*([a-z0-9]{1,12})(?![a-z0-9])/gi, (match, code) =>
      /\d/.test(code) ? "" : match)
    .replace(/#\d+/g, "")
    .replace(/\d{4,}/g, "#")
    .replace(/\*/g, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function bankNoteMerchantKey(payee) {
  return bankNoteFold(bankNoteMerchantLabel(payee));
}

function bankNoteUseOrder(left, right) {
  const ld = String(left && left.date || "");
  const rd = String(right && right.date || "");
  if (ld !== rd) return ld > rd ? -1 : 1;
  const lp = String(left && left.path || "");
  const rp = String(right && right.path || "");
  if (lp !== rp) return lp > rp ? -1 : 1;
  return (Number(right && right.line) || 0) - (Number(left && left.line) || 0);
}

function bankNoteLibraryFromContents(fileContents, cache) {
  const files = Array.isArray(fileContents) ? fileContents : [];
  const memo = cache instanceof Map ? cache : new Map();
  const allEntries = [];
  for (const file of files) {
    const path = typeof bankNormalizePath === "function"
      ? bankNormalizePath(file && file.path)
      : String(file && file.path || "");
    const content = typeof file?.content === "string" ? file.content : "";
    if (!path) continue;
    let cached = memo.get(path);
    if (!cached || cached.content !== content) {
      let parsed = null;
      try { parsed = bankTokenizeSource(path, content); } catch (_) {}
      const entries = [];
      for (const token of parsed && Array.isArray(parsed.rows) ? parsed.rows : []) {
        const note = typeof token.note === "string" ? token.note : "";
        if (!note || token.noteEditable !== true) continue;
        const normalized = bankNoteNormalize(note);
        if (!normalized.ok || normalized.text !== note || normalized.changes.length) continue;
        const key = bankNoteFold(note);
        if (!key) continue;
        entries.push(Object.freeze({
          key,
          text: note,
          path: String(token.path || path),
          line: Number.isInteger(token.line) ? token.line : 0,
          date: typeof token.date === "string" ? token.date : "",
          payee: typeof token.payee === "string" ? token.payee : "",
          merchantKey: bankNoteMerchantKey(token.payee),
          merchantLabel: bankNoteMerchantLabel(token.payee),
        }));
      }
      cached = Object.freeze({ content, entries: Object.freeze(entries) });
      memo.set(path, cached);
    }
    allEntries.push(...cached.entries);
  }
  return Object.freeze({ available: true, entries: Object.freeze(allEntries) });
}

function bankNoteDateNumber(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / 86400000);
}

function bankNoteReferenceDate(row) {
  const date = bankNoteDateNumber(row && row.date);
  if (date !== null) return date;
  try { return bankNoteDateNumber(bankLocalDate()); } catch (_) { return null; }
}

function bankNoteSuggestQuery(value) {
  const raw = String(value === null || value === undefined ? "" : value);
  const trailing = /\s$/u.test(raw);
  const folded = bankNoteFold(raw);
  return folded ? `${folded}${trailing ? " " : ""}` : (trailing ? " " : "");
}

function bankNoteQueryMatch(key, query) {
  if (!query || key === query) return null;
  if (key.startsWith(query)) return 0;
  let at = key.indexOf(query);
  while (at >= 0) {
    const before = at > 0 ? Array.from(key.slice(0, at)).pop() : "";
    if (!before || !/[\p{L}\p{N}]/u.test(before)) return 1;
    at = key.indexOf(query, at + 1);
  }
  return null;
}

function bankNoteLatest(uses) {
  return uses.slice().sort(bankNoteUseOrder)[0] || null;
}

function bankNoteScore(uses, referenceDay) {
  if (referenceDay === null) return uses.length;
  return uses.reduce((score, use) => {
    const useDay = bankNoteDateNumber(use.date);
    if (useDay === null) return score;
    const age = Math.max(0, referenceDay - useDay);
    return score + Math.pow(0.5, age / BANK_NOTE_SUGGEST_HALF_LIFE_DAYS);
  }, 0);
}

function bankNoteMatchHighlight(text, query, matchClass) {
  const value = String(text || "");
  if (!query || !value) return null;
  const starts = [];
  if (matchClass === 0) starts.push(0);
  else {
    for (let at = 0; at < value.length; at += 1) {
      if (at === 0 || !/[\p{L}\p{N}]/u.test(Array.from(value.slice(0, at)).pop() || "")) starts.push(at);
    }
  }
  for (const start of starts) {
    for (let end = start + 1; end <= value.length; end += 1) {
      const part = value.slice(start, end);
      const folded = bankNoteFold(part) + (/\s$/u.test(part) && bankNoteFold(part) ? " " : "");
      if (folded === query) return Object.freeze({ start, end });
    }
  }
  return null;
}

function bankNoteSuggest({ library, query, row, limit } = {}) {
  const entries = library && Array.isArray(library.entries) ? library.entries : [];
  if (!library || library.available !== true) return Object.freeze([]);
  const rowPath = typeof bankNormalizePath === "function"
    ? bankNormalizePath(row && row.path)
    : String(row && row.path || "");
  const rowLine = Number.isInteger(row && row.line) ? row.line : null;
  const merchantKey = bankNoteMerchantKey(row && row.payee);
  const referenceDay = bankNoteReferenceDate(row);
  const foldedQuery = bankNoteSuggestQuery(query);
  const empty = foldedQuery.length === 0;
  const groups = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string" || typeof entry.text !== "string") continue;
    if (rowLine !== null && entry.path === rowPath && entry.line === rowLine) continue;
    let group = groups.get(entry.key);
    if (!group) {
      group = [];
      groups.set(entry.key, group);
    }
    group.push(entry);
  }

  const candidates = [];
  for (const [key, uses] of groups) {
    if (!uses.length) continue;
    const affineUses = merchantKey ? uses.filter((use) => use.merchantKey === merchantKey) : [];
    const affine = affineUses.length > 0;
    const matchClass = empty ? 0 : bankNoteQueryMatch(key, foldedQuery);
    if (empty ? !affine : matchClass === null) continue;
    if (!empty && !affine && Array.from(foldedQuery.trim()).length < BANK_NOTE_SUGGEST_GLOBAL_MIN) continue;
    const displayUse = bankNoteLatest(uses);
    const metaUses = affine ? affineUses : uses;
    const recentMetaUse = bankNoteLatest(metaUses);
    const count = metaUses.length;
    const day = String(recentMetaUse && recentMetaUse.date || "");
    const refYear = row && typeof row.date === "string" && row.date.match(/^(\d{4})-/)
      ? row.date.slice(0, 4)
      : (() => { try { return String(bankLocalDate()).slice(0, 4); } catch (_) { return ""; } })();
    const dateLabel = typeof bankWalkShortDayLabel === "function"
      ? bankWalkShortDayLabel(day)
      : day;
    const date = dateLabel && day.slice(0, 4) !== refYear ? `${dateLabel} ${day.slice(0, 4)}` : dateLabel;
    const countLabel = count >= 2 ? `${count}×` : "";
    const merchantLabel = affine ? "" : String(displayUse && displayUse.merchantLabel || "");
    const metaParts = [merchantLabel, countLabel, date].filter(Boolean);
    const affinityScore = bankNoteScore(affineUses, referenceDay);
    const globalScore = bankNoteScore(uses, referenceDay);
    const latest = bankNoteLatest(uses);
    candidates.push({
      key,
      text: displayUse.text,
      matchClass,
      affine,
      meta: metaParts.join(" · "),
      metaMerchant: merchantLabel,
      metaSuffix: [countLabel, date].filter(Boolean).join(" · "),
      highlight: empty ? null : bankNoteMatchHighlight(displayUse.text, foldedQuery, matchClass),
      affinityScore,
      score: affine ? affinityScore : globalScore,
      lastUse: latest,
      lastAffineUse: bankNoteLatest(affineUses),
    });
  }
  candidates.sort((left, right) => {
    if (empty) {
      if (left.affinityScore !== right.affinityScore) return right.affinityScore - left.affinityScore;
      const dateOrder = bankNoteUseOrder(left.lastAffineUse, right.lastAffineUse);
      return dateOrder || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    }
    if (left.matchClass !== right.matchClass) return left.matchClass - right.matchClass;
    if (left.affine !== right.affine) return left.affine ? -1 : 1;
    if (left.score !== right.score) return right.score - left.score;
    const dateOrder = bankNoteUseOrder(left.lastUse, right.lastUse);
    return dateOrder || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  });
  const max = Number.isInteger(limit) && limit >= 0 ? limit : BANK_NOTE_SUGGEST_LIMIT;
  return Object.freeze(candidates.slice(0, max).map((candidate) => Object.freeze({
    key: candidate.key,
    text: candidate.text,
    matchClass: candidate.matchClass,
    affine: candidate.affine,
    meta: candidate.meta,
    metaMerchant: candidate.metaMerchant,
    metaSuffix: candidate.metaSuffix,
    highlight: candidate.highlight,
  })));
}

function bankNoteSuggestGhost({ rows, value, selectedKey, selectionStart, selectionEnd, scrollWidth, clientWidth } = {}) {
  if (selectedKey !== null && selectedKey !== undefined) return null;
  const top = Array.isArray(rows) ? rows[0] : null;
  const field = String(value === null || value === undefined ? "" : value);
  if (!top || top.matchClass !== 0 || typeof top.text !== "string") return null;
  if (top.text.slice(0, field.length).toLowerCase() !== field.toLowerCase()) return null;
  if (typeof selectionStart === "number" && selectionStart !== field.length) return null;
  if (typeof selectionEnd === "number" && selectionEnd !== field.length) return null;
  if (typeof scrollWidth === "number" && typeof clientWidth === "number" && scrollWidth > clientWidth) return null;
  return Object.freeze({ key: top.key, text: top.text.slice(field.length) });
}

function bankNoteSuggestStep(rows, selectedKey, direction) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const step = Number(direction) < 0 ? -1 : 1;
  const index = list.findIndex((row) => row && row.key === selectedKey);
  if (index < 0) return list[step > 0 ? 0 : list.length - 1].key;
  const next = index + step;
  if (next < 0 || next >= list.length) return null;
  return list[next].key;
}
