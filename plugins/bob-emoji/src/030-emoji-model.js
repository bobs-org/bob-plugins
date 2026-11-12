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

function emojiNormalizeQuery(value) {
  try {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  } catch (error) {
    return "";
  }
}

function emojiBuildIndex(catalog) {
  try {
    if (!Array.isArray(catalog)) return [];
    return catalog.map((entry, catalogIndex) => {
      const aliases = Array.isArray(entry && entry.aliases)
        ? entry.aliases.filter((alias) => typeof alias === "string" && alias.length > 0)
        : [];
      const tags = Array.isArray(entry && entry.tags)
        ? entry.tags.filter((tag) => typeof tag === "string" && tag.length > 0)
        : [];
      return {
        emoji: typeof (entry && entry.emoji) === "string" ? entry.emoji : "",
        aliases,
        aliasesLower: aliases.map((alias) => alias.toLowerCase()),
        tags,
        tagsLower: tags.map((tag) => tag.toLowerCase()),
        description: typeof (entry && entry.description) === "string" ? entry.description : "",
        descriptionLower: typeof (entry && entry.description) === "string"
          ? entry.description.toLowerCase()
          : "",
        descriptionWords: typeof (entry && entry.description) === "string"
          ? entry.description.toLowerCase().split(/[^a-z0-9+_-]+/).filter(Boolean)
          : [],
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
    const byEmoji = new Map((Array.isArray(index) ? index : []).map((entry) => [entry.emoji, entry]));
    const seenAliases = new Set();
    const recents = [];
    for (const raw of value) {
      if (!raw || typeof raw.alias !== "string" || typeof raw.emoji !== "string") continue;
      const alias = raw.alias.trim().toLowerCase();
      if (!alias || !raw.emoji || seenAliases.has(alias)) continue;
      const entry = byEmoji.get(raw.emoji);
      if (!entry || !entry.aliasesLower.includes(alias)) continue;
      seenAliases.add(alias);
      recents.push({ alias, emoji: raw.emoji });
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
    const next = [{ alias, emoji }, ...emojiNormalizeRecents(recents, index)]
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

function emojiSearch(index, query, recents = [], limit = BOB_EMOJI_SUGGESTION_LIMIT, popularAliases = BOB_EMOJI_POPULAR) {
  try {
    const entries = Array.isArray(index) ? index : [];
    const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : BOB_EMOJI_SUGGESTION_LIMIT;
    if (!cap) return [];
    const normalized = emojiNormalizeQuery(query);
    const byAlias = emojiIndexByAlias(entries);
    const safeRecents = emojiNormalizeRecents(recents, entries);
    if (!normalized) {
      const rows = [];
      const seenEmoji = new Set();
      for (const recent of safeRecents) {
        const entry = entries.find((candidate) => candidate.emoji === recent.emoji);
        if (!entry || seenEmoji.has(entry.emoji)) continue;
        seenEmoji.add(entry.emoji);
        rows.push(emojiSuggestion(entry, recent.alias, { isRecent: true }));
      }
      for (const popularAlias of Array.isArray(popularAliases) ? popularAliases : []) {
        const alias = emojiNormalizeQuery(popularAlias);
        const entry = byAlias.get(alias);
        if (!entry || seenEmoji.has(entry.emoji)) continue;
        seenEmoji.add(entry.emoji);
        rows.push(emojiSuggestion(entry, alias));
      }
      return rows.slice(0, cap);
    }

    const recentRank = new Map();
    for (let i = 0; i < safeRecents.length; i += 1) {
      const emoji = safeRecents[i].emoji;
      if (!recentRank.has(emoji)) recentRank.set(emoji, i);
    }
    const matches = [];
    for (const entry of entries) {
      let tier = null;
      let exactAlias = false;
      if (entry.aliasesLower.some((alias) => alias.startsWith(normalized))) {
        tier = 0;
        exactAlias = entry.aliasesLower.includes(normalized);
      } else if (entry.aliasesLower.some((alias) => alias.includes(normalized))) {
        tier = 1;
      } else if (entry.tagsLower.some((tag) => tag.includes(normalized))) {
        tier = 2;
      } else if (entry.descriptionWords.some((word) => word.includes(normalized))) {
        tier = 3;
      }
      if (tier === null) continue;
      matches.push({
        entry,
        tier,
        exactAlias,
        recentRank: recentRank.has(entry.emoji) ? recentRank.get(entry.emoji) : Number.MAX_SAFE_INTEGER,
      });
    }
    matches.sort((left, right) =>
      left.tier - right.tier ||
      Number(right.exactAlias) - Number(left.exactAlias) ||
      left.recentRank - right.recentRank ||
      left.entry.catalogIndex - right.entry.catalogIndex);
    return matches.slice(0, cap).map((match) =>
      emojiSuggestion(match.entry, match.entry.aliases[0], {
        query: normalized,
        isRecent: recentRank.has(match.entry.emoji),
        matchTier: match.tier,
      }));
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
    // Syntax highlighting is an optional guard; its failure must not block typing.
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
