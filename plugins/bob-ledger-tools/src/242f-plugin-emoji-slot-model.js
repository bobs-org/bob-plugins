// Pure model for the album and bank Emoji Slot. The shared component resolves
// bob-emoji at the moment the user opens it; no catalog is copied into this
// plugin.
const ALBUM_EMOJI_SLOT_RESULT_LIMIT = 64;
const ALBUM_EMOJI_SLOT_CATEGORY_LIMIT = 96;
const ALBUM_EMOJI_SLOT_COLUMNS = 8;

function albumEmojiSlotResolveApi(app) {
  try {
    const api = app?.plugins?.plugins?.["bob-emoji"]?.api;
    if (!api || !Number.isFinite(Number(api.version)) || Number(api.version) < 1) return null;
    for (const method of ["search", "suggestForLabel", "categories", "browse", "recents", "remember"]) {
      if (typeof api[method] !== "function") return null;
    }
    return api;
  } catch (_) {
    return null;
  }
}

function albumEmojiSlotGraphemes(value) {
  const text = String(value ?? "");
  if (!text) return [];
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(segmenter.segment(text), (part) => part.segment);
    }
  } catch (_) {}

  // Older Obsidian engines lack Intl.Segmenter. Keep combining marks,
  // variation selectors, modifiers, flags, tag sequences, and ZWJ chains
  // together without splitting surrogate pairs.
  const codepoints = Array.from(text);
  const rows = [];
  const isMark = (character) => {
    try { return /^\p{Mark}$/u.test(character); } catch (_) { return false; }
  };
  const isExtend = (character) => isMark(character) ||
    /[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(character);
  const isRegional = (character) => /^[\u{1F1E6}-\u{1F1FF}]$/u.test(character);

  for (let index = 0; index < codepoints.length;) {
    let grapheme = codepoints[index++];
    if (isRegional(grapheme) && index < codepoints.length && isRegional(codepoints[index])) {
      grapheme += codepoints[index++];
    }
    while (index < codepoints.length) {
      const next = codepoints[index];
      if (isExtend(next)) {
        grapheme += next;
        index += 1;
      } else if (next === "\u200D" && index + 1 < codepoints.length) {
        grapheme += next + codepoints[index + 1];
        index += 2;
      } else break;
    }
    rows.push(grapheme);
  }
  return rows;
}

function albumEmojiSlotIsDigitKeycap(glyph) {
  return /^[0-9]\uFE0F?\u20E3$/u.test(String(glyph || ""));
}

function albumEmojiSlotIsEmojiGrapheme(value) {
  const glyph = String(value || "");
  if (!glyph || albumEmojiSlotGraphemes(glyph).length !== 1) return false;
  if (albumEmojiSlotIsDigitKeycap(glyph)) return true;
  try {
    return /\p{Extended_Pictographic}/u.test(glyph) ||
      /\p{Regional_Indicator}/u.test(glyph) ||
      /\uFE0F/u.test(glyph) || /[\u{1F3FB}-\u{1F3FF}]/u.test(glyph);
  } catch (_) {
    return /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(glyph) || /\uFE0F/u.test(glyph);
  }
}

function albumEmojiSlotGlyphKey(glyph) {
  return String(glyph || "").replace(/\uFE0F/g, "");
}

function albumEmojiSlotWords(value) {
  return new Set(String(value || "").toLowerCase().split(/[^\p{Letter}\p{Number}]+/u).filter((word) => word.length > 1));
}

function albumEmojiSlotNormalizeRows(rows, limit = ALBUM_EMOJI_SLOT_RESULT_LIMIT) {
  const cap = Math.max(0, Number(limit) || 0);
  if (!cap) return [];
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const emoji = typeof raw?.emoji === "string" ? raw.emoji : "";
    if (!emoji || albumEmojiSlotIsDigitKeycap(emoji)) continue;
    const key = albumEmojiSlotGlyphKey(emoji);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...raw,
      emoji,
      name: String(raw?.name || raw?.description || raw?.label || raw?.alias || emoji),
      alias: String(raw?.alias || ""),
      category: String(raw?.category || ""),
    });
    if (output.length >= cap) break;
  }
  return output;
}

function albumEmojiSlotVocabularyRows(vocabulary, label, limit = 12) {
  const labelWords = albumEmojiSlotWords(label);
  const rows = [];
  for (const [index, item] of (Array.isArray(vocabulary) ? vocabulary : []).entries()) {
    const emoji = typeof item?.emoji === "string" ? item.emoji : "";
    if (!emoji || albumEmojiSlotIsDigitKeycap(emoji)) continue;
    const name = String(item?.label || emoji);
    let overlap = 0;
    for (const word of albumEmojiSlotWords(name)) if (labelWords.has(word)) overlap += 1;
    rows.push({
      emoji,
      name,
      label: name,
      alias: "",
      category: "In your albums",
      vocabulary: true,
      overlap,
      sourceIndex: index,
    });
  }
  rows.sort((left, right) => right.overlap - left.overlap ||
    left.name.localeCompare(right.name) || left.sourceIndex - right.sourceIndex);
  return albumEmojiSlotNormalizeRows(rows, Math.max(0, limit));
}

function albumEmojiSlotDuplicateLabels(glyph, siblings) {
  const key = albumEmojiSlotGlyphKey(glyph);
  if (!key) return [];
  return [...new Set((Array.isArray(siblings) ? siblings : [])
    .filter((item) => albumEmojiSlotGlyphKey(item?.emoji) === key)
    .map((item) => String(item?.label || "").trim())
    .filter(Boolean))];
}

function albumEmojiSlotResultModel(api, options = {}) {
  const query = String(options.query || "").trim();
  const categories = (() => {
    try { return [...new Set((api?.categories?.() || []).filter((value) => typeof value === "string" && value))]; }
    catch (_) { return []; }
  })();
  const sections = [];
  const add = (title, rawRows, limit = ALBUM_EMOJI_SLOT_RESULT_LIMIT) => {
    const rows = albumEmojiSlotNormalizeRows(rawRows, limit);
    if (rows.length) sections.push({ title, rows });
  };

  if (query) {
    let rows = [];
    try { rows = api.search(query, { limit: ALBUM_EMOJI_SLOT_RESULT_LIMIT }); } catch (_) {}
    add("Results", rows);
  } else if (options.category) {
    let rows = [];
    try { rows = api.browse(options.category, { limit: ALBUM_EMOJI_SLOT_CATEGORY_LIMIT, offset: 0 }); } catch (_) {}
    add(options.category, rows, ALBUM_EMOJI_SLOT_CATEGORY_LIMIT);
  } else {
    let labelRows = [];
    let recentRows = [];
    try { labelRows = api.suggestForLabel(String(options.label || ""), { limit: 9 }); } catch (_) {}
    try { recentRows = api.recents({ limit: 9 }); } catch (_) {}
    if (String(options.label || "").trim()) add(`For “${String(options.label || "").trim()}”`, labelRows, 9);
    add("In your albums", albumEmojiSlotVocabularyRows(options.vocabulary, options.label, 12), 12);
    add("Recent", recentRows, 9);
  }

  const rows = [];
  const seen = new Set();
  for (const section of sections) {
    section.rows = section.rows.filter((row) => {
      const key = albumEmojiSlotGlyphKey(row.emoji);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    rows.push(...section.rows);
  }
  return { query, category: String(options.category || ""), categories, sections: sections.filter((section) => section.rows.length), rows };
}

function albumEmojiSlotMoveHighlight(index, key, count, columns = ALBUM_EMOJI_SLOT_COLUMNS) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return -1;
  const current = Math.min(Math.max(0, Number(index) || 0), total - 1);
  const delta = key === "ArrowLeft" ? -1
    : key === "ArrowRight" ? 1
      : key === "ArrowUp" || key === "p" || key === "P" ? -columns
        : key === "ArrowDown" || key === "n" || key === "N" ? columns
          : 0;
  return Math.min(total - 1, Math.max(0, current + delta));
}
