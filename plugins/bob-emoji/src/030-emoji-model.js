const BOB_EMOJI_POPULAR = [
  "+1",
  "heart",
  "joy",
  "tada",
  "fire",
  "blush",
  "pray",
  "sweat_smile",
  "100",
  "cry",
  "eyes",
  "white_check_mark",
  "sparkles",
  "rocket",
  "thinking",
  "heart_eyes",
];
const BOB_EMOJI_RECENTS_LIMIT = 30;
const BOB_EMOJI_SUGGESTION_LIMIT = 30;
const BOB_EMOJI_API_VERSION = 1;

const BOB_EMOJI_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "with",
  "by", "at", "from", "as", "is", "are", "it", "its", "this", "that",
]);

function emojiStripVS16(value) {
  try {
    return typeof value === "string" ? value.replace(/️/g, "") : "";
  } catch (error) {
    return typeof value === "string" ? value : "";
  }
}

function emojiNormalizeQuery(value) {
  try {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase().replace(/^:+|:+$/g, "").trim();
  } catch (error) {
    return "";
  }
}

function emojiTokenizeQuery(normalized) {
  try {
    if (!normalized) return [];
    return normalized.split(/[_\-\s ]+/).map((token) => token.trim()).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function emojiStemToken(word) {
  try {
    if (typeof word !== "string" || word.length < 4) return word;
    if (word.length > 5 && word.endsWith("ing")) {
      const stemmed = word.slice(0, -3);
      if (stemmed.length >= 3) return stemmed;
    }
    if (word.length > 4 && word.endsWith("ed")) {
      const stemmed = word.slice(0, -2);
      if (stemmed.length >= 3) return stemmed;
    }
    if (word.length > 4 && word.endsWith("es")) {
      const stemmed = word.slice(0, -2);
      if (stemmed.length >= 3) return stemmed;
    }
    if (word.length > 3 && word.endsWith("s")) {
      const stemmed = word.slice(0, -1);
      if (stemmed.length >= 2) return stemmed;
    }
    return word;
  } catch (error) {
    return word;
  }
}

function emojiBuildIndex(catalog) {
  try {
    if (!Array.isArray(catalog)) return [];
    return catalog.map((entry, catalogIndex) => {
      const aliases = Array.isArray(entry && entry.aliases)
        ? entry.aliases.filter((alias) => typeof alias === "string" && alias.length > 0)
        : [];
      const aliasesLower = aliases.map((alias) => alias.toLowerCase());
      const aliasWords = [...new Set(aliasesLower.flatMap((alias) => alias.split(/[_\-\s]+/).filter(Boolean)))];
      const tags = Array.isArray(entry && entry.tags)
        ? entry.tags.filter((tag) => typeof tag === "string" && tag.length > 0)
        : [];
      const tagsLower = tags.map((tag) => tag.toLowerCase());
      const keywords = Array.isArray(entry && entry.keywords)
        ? entry.keywords.filter((keyword) => typeof keyword === "string" && keyword.length > 0)
        : [];
      const keywordsLower = keywords.map((keyword) => keyword.toLowerCase());
      const keywordWords = [...new Set(keywordsLower.flatMap((keyword) => keyword.split(/[^a-z0-9+]+/).filter(Boolean)))];
      const description = typeof (entry && entry.description) === "string" ? entry.description : "";
      const descriptionLower = description.toLowerCase();
      const descriptionWords = descriptionLower.split(/[^a-z0-9+_-]+/).filter(Boolean);
      const category = typeof (entry && entry.category) === "string" && entry.category ? entry.category : "Symbols";
      const emoji = typeof (entry && entry.emoji) === "string" ? entry.emoji : "";
      return {
        emoji,
        emojiStripped: emojiStripVS16(emoji),
        aliases,
        aliasesLower,
        aliasWords,
        tags,
        tagsLower,
        keywords,
        keywordsLower,
        keywordWords,
        description,
        descriptionLower,
        descriptionWords,
        category,
        catalogIndex,
      };
    }).filter((entry) => entry.emoji && entry.aliases.length > 0);
  } catch (error) {
    return [];
  }
}

function emojiNormalizeRecents(value, index) {
  try {
    if (!Array.isArray(value)) return [];
    const entries = Array.isArray(index) ? index : [];
    const byEmoji = new Map(entries.map((entry) => [entry.emoji, entry]));
    const byStripped = new Map(entries.map((entry) => [entry.emojiStripped || emojiStripVS16(entry.emoji), entry]));
    const seenAliases = new Set();
    const recents = [];
    for (const raw of value) {
      if (!raw || typeof raw.alias !== "string" || typeof raw.emoji !== "string") continue;
      const alias = raw.alias.trim().toLowerCase();
      if (!alias || !raw.emoji || seenAliases.has(alias)) continue;
      const entry = byEmoji.get(raw.emoji) || byStripped.get(emojiStripVS16(raw.emoji));
      if (!entry || !entry.aliasesLower.includes(alias)) continue;
      seenAliases.add(alias);
      recents.push({ alias, emoji: entry.emoji });
      if (recents.length >= BOB_EMOJI_RECENTS_LIMIT) break;
    }
    return recents;
  } catch (error) {
    return [];
  }
}

function emojiRecordRecent(recents, suggestion, index) {
  try {
    const alias = emojiNormalizeQuery(suggestion && suggestion.alias);
    const emoji = suggestion && typeof suggestion.emoji === "string" ? suggestion.emoji : "";
    if (!alias || !emoji) return emojiNormalizeRecents(recents, index);
    const entries = Array.isArray(index) ? index : [];
    const byEmoji = new Map(entries.map((entry) => [entry.emoji, entry]));
    const byStripped = new Map(entries.map((entry) => [entry.emojiStripped || emojiStripVS16(entry.emoji), entry]));
    const canonical = byEmoji.get(emoji) || byStripped.get(emojiStripVS16(emoji));
    const canonicalEmoji = canonical ? canonical.emoji : emoji;
    const next = [{ alias, emoji: canonicalEmoji }, ...emojiNormalizeRecents(recents, index)]
      .filter((recent, position, rows) => rows.findIndex((candidate) => candidate.alias === recent.alias) === position);
    return emojiNormalizeRecents(next, index);
  } catch (error) {
    return emojiNormalizeRecents(recents, index);
  }
}

function emojiIndexByAlias(index) {
  const byAlias = new Map();
  for (const entry of Array.isArray(index) ? index : []) {
    for (const alias of entry.aliasesLower || []) {
      if (!byAlias.has(alias)) byAlias.set(alias, entry);
    }
  }
  return byAlias;
}

function emojiIndexByGlyph(index) {
  const byGlyph = new Map();
  const byStripped = new Map();
  for (const entry of Array.isArray(index) ? index : []) {
    if (entry.emoji && !byGlyph.has(entry.emoji)) byGlyph.set(entry.emoji, entry);
    const stripped = entry.emojiStripped || emojiStripVS16(entry.emoji);
    if (stripped && !byStripped.has(stripped)) byStripped.set(stripped, entry);
  }
  return { byGlyph, byStripped };
}

function emojiSuggestion(entry, alias, options = {}) {
  return {
    emoji: entry.emoji,
    alias: alias || entry.aliases[0],
    primaryAlias: entry.aliases[0],
    aliases: entry.aliases,
    tags: entry.tags,
    description: entry.description,
    query: options.query || "",
    isRecent: options.isRecent === true,
    matchTier: Number.isFinite(options.matchTier) ? options.matchTier : null,
  };
}

function emojiApiRow(entry, options = {}) {
  try {
    if (!entry || typeof entry.emoji !== "string") return null;
    return {
      emoji: entry.emoji,
      name: typeof entry.description === "string" ? entry.description : "",
      alias: typeof options.alias === "string" && options.alias ? options.alias : (entry.aliases[0] || ""),
      aliases: Array.isArray(entry.aliases) ? [...entry.aliases] : [],
      category: typeof entry.category === "string" ? entry.category : "Symbols",
      keywords: Array.isArray(entry.keywords) ? [...entry.keywords] : [],
      matchTier: Number.isFinite(options.matchTier) ? options.matchTier : null,
    };
  } catch (error) {
    return null;
  }
}

function emojiDamerauDistanceOne(token, word) {
  try {
    if (token === word) return true;
    const a = String(token);
    const b = String(word);
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > 1) return false;
    if (m === 0 || n === 0) return Math.max(m, n) === 1;
    let diffs = 0;
    let i = 0;
    let j = 0;
    if (m === n) {
      for (let k = 0; k < m; k += 1) if (a[k] !== b[k]) diffs += 1;
      if (diffs === 1) return true;
      if (diffs === 2) {
        for (let k = 0; k < m - 1; k += 1) {
          if (a[k] !== b[k]) {
            return a[k] === b[k + 1] && a[k + 1] === b[k] && a.slice(k + 2) === b.slice(k + 2) && a.slice(0, k) === b.slice(0, k);
          }
        }
      }
      return false;
    }
    const longer = m > n ? a : b;
    const shorter = m > n ? b : a;
    i = 0;
    j = 0;
    let skipped = false;
    while (i < longer.length && j < shorter.length) {
      if (longer[i] === shorter[j]) {
        i += 1;
        j += 1;
      } else {
        if (skipped) return false;
        skipped = true;
        i += 1;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

function emojiTokenTier(entry, token) {
  try {
    if (!token) return null;
    for (const alias of entry.aliasesLower || []) if (alias === token) return 0;
    for (const keyword of entry.keywordsLower || []) if (keyword === token) return 0;
    for (const tag of entry.tagsLower || []) if (tag === token) return 0;
    for (const alias of entry.aliasesLower || []) if (alias.startsWith(token)) return 1;
    for (const word of entry.aliasWords || []) if (word.startsWith(token)) return 2;
    for (const keyword of entry.keywordsLower || []) if (keyword.startsWith(token) && keyword !== token) return 2;
    for (const word of entry.keywordWords || []) if (word.startsWith(token)) return 2;
    for (const tag of entry.tagsLower || []) if (tag.startsWith(token)) return 2;
    for (const alias of entry.aliasesLower || []) if (alias.includes(token)) return 3;
    for (const keyword of entry.keywordsLower || []) if (keyword.includes(token)) return 3;
    for (const tag of entry.tagsLower || []) if (tag.includes(token)) return 3;
    for (const word of entry.descriptionWords || []) if (word.startsWith(token)) return 4;
    if ((entry.descriptionLower || "").includes(token)) return 5;
    return null;
  } catch (error) {
    return null;
  }
}

function emojiTokenAliasTier(entry, token) {
  try {
    if (!token) return null;
    for (const alias of entry.aliasesLower || []) if (alias === token) return 0;
    for (const alias of entry.aliasesLower || []) if (alias.startsWith(token)) return 1;
    for (const word of entry.aliasWords || []) if (word.startsWith(token)) return 2;
    for (const alias of entry.aliasesLower || []) if (alias.includes(token)) return 3;
    return null;
  } catch (error) {
    return null;
  }
}

function emojiTokenAliasFuzzyTier(entry, token) {
  try {
    if (!token || token.length < 4) return null;
    const candidates = [...(entry.aliasesLower || []), ...(entry.aliasWords || [])];
    for (const word of candidates) {
      if (Math.abs(word.length - token.length) > 1) continue;
      if (emojiDamerauDistanceOne(token, word)) return 6;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function emojiTokenFuzzyTier(entry, token) {
  try {
    if (!token || token.length < 4) return null;
    const candidates = [
      ...(entry.aliasesLower || []),
      ...(entry.aliasWords || []),
      ...(entry.keywordsLower || []),
      ...(entry.keywordWords || []),
      ...(entry.tagsLower || []),
      ...(entry.descriptionWords || []),
    ];
    for (const word of candidates) {
      if (Math.abs(word.length - token.length) > 1) continue;
      if (emojiDamerauDistanceOne(token, word)) return 6;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function emojiSingleGrapheme(text) {
  try {
    const value = typeof text === "string" ? text.trim() : "";
    if (!value) return null;
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
      if (segments.length === 1) return segments[0].segment;
      return null;
    }
    if ([...value].length === 1) return value;
    return null;
  } catch (error) {
    return null;
  }
}

function emojiNormalizeBoost(boost, index) {
  try {
    if (!Array.isArray(boost) || !boost.length) return { order: [], rank: new Map() };
    const entries = Array.isArray(index) ? index : [];
    const { byGlyph, byStripped } = emojiIndexByGlyph(entries);
    const order = [];
    const seen = new Set();
    for (const raw of boost) {
      let glyph = "";
      if (typeof raw === "string") glyph = raw;
      else if (raw && typeof raw.emoji === "string") glyph = raw.emoji;
      if (!glyph) continue;
      const entry = byGlyph.get(glyph) || byStripped.get(emojiStripVS16(glyph));
      const canonical = entry ? entry.emoji : glyph;
      const key = emojiStripVS16(canonical);
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(canonical);
    }
    const rank = new Map(order.map((glyph, position) => [emojiStripVS16(glyph), position]));
    return { order, rank };
  } catch (error) {
    return { order: [], rank: new Map() };
  }
}

function emojiSearch(index, query, recents = [], limit = BOB_EMOJI_SUGGESTION_LIMIT, popularAliases = BOB_EMOJI_POPULAR, boostArg = []) {
  try {
    const entries = Array.isArray(index) ? index : [];
    const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : BOB_EMOJI_SUGGESTION_LIMIT;
    if (!cap) return [];
    const boost = Array.isArray(boostArg) ? boostArg : (boostArg && Array.isArray(boostArg.boost) ? boostArg.boost : []);
    const { order: boostOrder, rank: boostRank } = emojiNormalizeBoost(boost, entries);
    const normalized = emojiNormalizeQuery(query);
    const byAlias = emojiIndexByAlias(entries);
    const safeRecents = emojiNormalizeRecents(recents, entries);
    const recentRank = new Map();
    for (let i = 0; i < safeRecents.length; i += 1) {
      const key = emojiStripVS16(safeRecents[i].emoji);
      if (!recentRank.has(key)) recentRank.set(key, i);
    }
    const boostRankByStripped = boostRank;
    if (!normalized) {
      const rows = [];
      const seenEmoji = new Set();
      const pushEntry = (entry, alias, isRecent, tier) => {
        const key = emojiStripVS16(entry.emoji);
        if (seenEmoji.has(key)) return;
        seenEmoji.add(key);
        const row = emojiSuggestion(entry, alias, { isRecent, matchTier: tier });
        const apiRow = emojiApiRow(entry, { alias: row.alias, matchTier: tier });
        if (apiRow) {
          apiRow.isRecent = isRecent === true;
          apiRow.query = "";
          rows.push(apiRow);
        } else {
          rows.push(row);
        }
      };
      for (const glyph of boostOrder) {
        const found = entries.find((candidate) => emojiStripVS16(candidate.emoji) === emojiStripVS16(glyph));
        if (found) pushEntry(found, found.aliases[0], recentRank.has(emojiStripVS16(found.emoji)), null);
      }
      for (const recent of safeRecents) {
        const entry = entries.find((candidate) => candidate.emoji === recent.emoji);
        if (!entry) continue;
        pushEntry(entry, recent.alias, true, null);
      }
      for (const popularAlias of Array.isArray(popularAliases) ? popularAliases : []) {
        const alias = emojiNormalizeQuery(popularAlias);
        const entry = byAlias.get(alias);
        if (!entry) continue;
        pushEntry(entry, alias, false, null);
      }
      return rows.slice(0, cap);
    }

    const glyphQuery = emojiSingleGrapheme(typeof query === "string" ? query.trim() : "");
    let glyphFirst = null;
    if (glyphQuery) {
      const { byGlyph, byStripped } = emojiIndexByGlyph(entries);
      glyphFirst = byGlyph.get(glyphQuery) || byStripped.get(emojiStripVS16(glyphQuery)) || null;
    }

    const tokens = emojiTokenizeQuery(normalized);
    if (!tokens.length) return [];
    const matches = [];
    const matchedKeys = new Set();
    if (glyphFirst) matchedKeys.add(emojiStripVS16(glyphFirst.emoji));
    for (const entry of entries) {
      const key = emojiStripVS16(entry.emoji);
      if (glyphFirst && key === emojiStripVS16(glyphFirst.emoji)) continue;
      let worst = -1;
      let aliasWorst = -1;
      let aliasOk = true;
      let ok = true;
      for (const token of tokens) {
        const tier = emojiTokenTier(entry, token);
        if (tier === null) {
          ok = false;
          break;
        }
        if (tier > worst) worst = tier;
        const aliasTier = emojiTokenAliasTier(entry, token);
        if (aliasTier === null) aliasOk = false;
        else if (aliasTier > aliasWorst) aliasWorst = aliasTier;
      }
      if (!ok) continue;
      matchedKeys.add(key);
      matches.push({
        entry,
        tier: worst,
        aliasTier: aliasOk ? aliasWorst : Number.MAX_SAFE_INTEGER,
        boostRank: boostRankByStripped.has(key) ? boostRankByStripped.get(key) : Number.MAX_SAFE_INTEGER,
        recentRank: recentRank.has(key) ? recentRank.get(key) : Number.MAX_SAFE_INTEGER,
      });
    }
    if (matches.length < 8) {
      for (const entry of entries) {
        const key = emojiStripVS16(entry.emoji);
        if (matchedKeys.has(key)) continue;
        let worst = -1;
        let aliasWorst = -1;
        let aliasOk = true;
        let ok = true;
        for (const token of tokens) {
          let tier = emojiTokenTier(entry, token);
          if (tier === null) tier = emojiTokenFuzzyTier(entry, token);
          if (tier === null) {
            ok = false;
            break;
          }
          if (tier > worst) worst = tier;
          let aliasTier = emojiTokenAliasTier(entry, token);
          if (aliasTier === null) aliasTier = emojiTokenAliasFuzzyTier(entry, token);
          if (aliasTier === null) aliasOk = false;
          else if (aliasTier > aliasWorst) aliasWorst = aliasTier;
        }
        if (!ok) continue;
        if (worst !== 6) continue;
        matchedKeys.add(key);
        matches.push({
          entry,
          tier: worst,
          aliasTier: aliasOk ? aliasWorst : Number.MAX_SAFE_INTEGER,
          boostRank: boostRankByStripped.has(key) ? boostRankByStripped.get(key) : Number.MAX_SAFE_INTEGER,
          recentRank: recentRank.has(key) ? recentRank.get(key) : Number.MAX_SAFE_INTEGER,
        });
      }
    }
    matches.sort((left, right) =>
      left.tier - right.tier ||
      left.aliasTier - right.aliasTier ||
      left.boostRank - right.boostRank ||
      left.recentRank - right.recentRank ||
      left.entry.catalogIndex - right.entry.catalogIndex);
    const rows = [];
    if (glyphFirst) {
      const key = emojiStripVS16(glyphFirst.emoji);
      const row = emojiApiRow(glyphFirst, {
        alias: glyphFirst.aliases[0],
        matchTier: 0,
      });
      if (row) {
        row.query = normalized;
        row.isRecent = recentRank.has(key);
        rows.push(row);
      }
    }
    for (const match of matches) {
      if (rows.length >= cap) break;
      const key = emojiStripVS16(match.entry.emoji);
      const row = emojiApiRow(match.entry, {
        alias: match.entry.aliases[0],
        matchTier: match.tier,
      });
      if (!row) continue;
      row.query = normalized;
      row.isRecent = recentRank.has(key);
      rows.push(row);
    }
    return rows.slice(0, cap);
  } catch (error) {
    return [];
  }
}

function emojiSuggestForLabel(label, index, options = {}) {
  try {
    const entries = Array.isArray(index) ? index : [];
    const cap = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : BOB_EMOJI_SUGGESTION_LIMIT;
    if (!cap) return [];
    if (typeof label !== "string" || !label.trim()) return [];
    const rawTokens = label.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
    const tokens = [];
    for (const raw of rawTokens) {
      if (BOB_EMOJI_STOP_WORDS.has(raw)) continue;
      const stemmed = emojiStemToken(raw);
      if (stemmed) tokens.push(stemmed);
    }
    if (!tokens.length) return [];
    const exclude = new Set();
    if (Array.isArray(options.exclude)) {
      for (const raw of options.exclude) {
        const glyph = typeof raw === "string" ? raw : (raw && typeof raw.emoji === "string" ? raw.emoji : "");
        if (glyph) exclude.add(emojiStripVS16(glyph));
      }
    }
    const scored = [];
    for (const entry of entries) {
      const key = emojiStripVS16(entry.emoji);
      if (exclude.has(key)) continue;
      let matched = 0;
      let worst = -1;
      for (const token of tokens) {
        const tier = emojiTokenTier(entry, token);
        if (tier === null || tier > 5) continue;
        matched += 1;
        if (tier > worst) worst = tier;
      }
      if (!matched) continue;
      scored.push({ entry, matched, tier: worst });
    }
    scored.sort((left, right) =>
      right.matched - left.matched ||
      left.tier - right.tier ||
      left.entry.catalogIndex - right.entry.catalogIndex);
    return scored.slice(0, cap).map((item) => emojiApiRow(item.entry, {
      alias: item.entry.aliases[0],
      matchTier: item.tier,
    })).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function emojiCategories(index) {
  try {
    const entries = Array.isArray(index) ? index : [];
    const seen = [];
    const known = new Set();
    for (const entry of entries) {
      const category = typeof entry.category === "string" && entry.category ? entry.category : "Symbols";
      if (known.has(category)) continue;
      known.add(category);
      seen.push(category);
    }
    return seen;
  } catch (error) {
    return [];
  }
}

function emojiNormalizeCategoryId(value) {
  try {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  } catch (error) {
    return "";
  }
}

function emojiBrowse(index, categoryId, options = {}) {
  try {
    const entries = Array.isArray(index) ? index : [];
    const wanted = emojiNormalizeCategoryId(categoryId);
    if (!wanted) return [];
    const limit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : 100;
    const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0;
    if (!limit) return [];
    const filtered = entries.filter((entry) => emojiNormalizeCategoryId(entry.category) === wanted);
    return filtered.slice(offset, offset + limit).map((entry) => emojiApiRow(entry, {
      alias: entry.aliases[0],
      matchTier: null,
    })).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function emojiInfo(index, glyph) {
  try {
    if (typeof glyph !== "string" || !glyph) return null;
    const entries = Array.isArray(index) ? index : [];
    const { byGlyph, byStripped } = emojiIndexByGlyph(entries);
    const trimmed = glyph.trim();
    const entry = byGlyph.get(trimmed) || byStripped.get(emojiStripVS16(trimmed)) || null;
    if (!entry) return null;
    return emojiApiRow(entry, { alias: entry.aliases[0], matchTier: null });
  } catch (error) {
    return null;
  }
}

function emojiRecentRows(index, recents, limit) {
  try {
    const entries = Array.isArray(index) ? index : [];
    const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : BOB_EMOJI_RECENTS_LIMIT;
    if (!cap) return [];
    const safe = emojiNormalizeRecents(recents, entries);
    const byEmoji = new Map(entries.map((entry) => [entry.emoji, entry]));
    const rows = [];
    for (const recent of safe) {
      if (rows.length >= cap) break;
      const entry = byEmoji.get(recent.emoji);
      if (!entry) continue;
      const row = emojiApiRow(entry, { alias: recent.alias, matchTier: null });
      if (row) rows.push(row);
    }
    return rows;
  } catch (error) {
    return [];
  }
}

function emojiOffsetAt(editor, position) {
  try {
    if (editor && typeof editor.offsetAt === "function") {
      const offset = editor.offsetAt(position);
      return Number.isFinite(offset) ? offset : -1;
    }
    if (!editor || typeof editor.getLine !== "function") return -1;
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) {
      offset += String(editor.getLine(line) || "").length + 1;
    }
    return offset + position.ch;
  } catch (error) {
    return -1;
  }
}

function emojiContextAllows(editor, triggerOffset, syntaxTree = EmojiSyntaxTree) {
  try {
    const state = editor && editor.cm && editor.cm.state;
    if (!state || typeof syntaxTree !== "function") return true;
    const tree = syntaxTree(state);
    if (!tree || typeof tree.resolveInner !== "function") return true;
    let node = tree.resolveInner(triggerOffset + 1, -1);
    const seen = new Set();
    while (node && !seen.has(node)) {
      seen.add(node);
      const name = String(node.type && node.type.name || node.name || "").toLowerCase();
      if (name.includes("code") || name.includes("math") || name.includes("frontmatter") || name.includes("comment")) {
        return false;
      }
      node = node.parent || null;
    }
    return true;
  } catch (error) {
    return true;
  }
}

function emojiFindTrigger(cursor, editor, syntaxTree = EmojiSyntaxTree) {
  try {
    if (!cursor || !Number.isInteger(cursor.line) || !Number.isInteger(cursor.ch) ||
        !editor || typeof editor.getLine !== "function") return null;
    const line = String(editor.getLine(cursor.line) || "");
    if (cursor.ch < 0 || cursor.ch > line.length) return null;
    const before = line.slice(0, cursor.ch);
    const match = /(^|\s):([A-Za-z0-9_+-]*)$/i.exec(before);
    if (!match) return null;
    const colonCh = match.index + match[1].length;
    const start = { line: cursor.line, ch: colonCh };
    const startOffset = emojiOffsetAt(editor, start);
    if (startOffset < 0 || !emojiContextAllows(editor, startOffset, syntaxTree)) return null;
    return { start, end: { line: cursor.line, ch: cursor.ch }, query: match[2] };
  } catch (error) {
    return null;
  }
}
