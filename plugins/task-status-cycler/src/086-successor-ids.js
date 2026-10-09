// Successor block-ID minting (docs/task-dependencies.md §12.4, §11.7 SB
// vectors). Pure code only: no vault reads, no editor writes.
//
// This fragment is a faithful JS port of bob-cli's
// `src/native/capture_block_ids.rs` (`suggest_ids_with_used` and its
// STOPWORDS, LEADING_VERBS, `words_in`, `phrase_spans`, `wikilink_phrase`,
// and `join_truncated` plus the `-2`…`-9` suffix rules) and of
// `note_tasks::clean_description`. Capture and Ctrl+Enter mint
// byte-identical IDs; the SB vectors pin both.

const SUCCESSOR_ID_STOPWORDS = [
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "its", "my", "of", "on", "or", "our", "so", "that", "the",
  "their", "this", "to", "via", "with", "your",
];

const SUCCESSOR_ID_LEADING_VERBS = [
  "add",
  "build",
  "check",
  "clean",
  "create",
  "delete",
  "document",
  "enable",
  "ensure",
  "finish",
  "fix",
  "implement",
  "improve",
  "investigate",
  "make",
  "migrate",
  "move",
  "plan",
  "read",
  "refactor",
  "remove",
  "rename",
  "research",
  "review",
  "run",
  "start",
  "stop",
  "support",
  "test",
  "try",
  "update",
  "use",
  "write",
];

const SUCCESSOR_ID_STOPWORD_SET = new Set(SUCCESSOR_ID_STOPWORDS);
const SUCCESSOR_ID_LEADING_VERB_SET = new Set(SUCCESSOR_ID_LEADING_VERBS);

// Mirrors `capture_block_ids::is_valid_block_id`: ASCII letters, digits,
// and `-`, non-empty.
function isValidSuccessorBlockId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    /^[A-Za-z0-9-]+$/.test(id)
  );
}

// ASCII alphanumeric runs, lowercased. Anything else is a separator, exactly
// like the Rust byte walk (`words_in`).
function successorWordsIn(text) {
  const words = [];
  let current = "";
  const flush = () => {
    if (current && !SUCCESSOR_ID_STOPWORD_SET.has(current)) {
      words.push(current);
    }
    current = "";
  };
  for (const ch of String(text || "")) {
    if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9")
    ) {
      current += ch.toLowerCase();
    } else {
      flush();
    }
  }
  flush();
  return words;
}

function successorWikilinkPhrase(inner) {
  const text = String(inner || "");
  const aliasIndex = text.indexOf("|");
  if (aliasIndex !== -1) {
    return text.slice(aliasIndex + 1);
  }
  const hashIndex = text.indexOf("#");
  const target = hashIndex === -1 ? text : text.slice(0, hashIndex);
  const slashIndex = target.lastIndexOf("/");
  return slashIndex === -1 ? target : target.slice(slashIndex + 1);
}

// Char index of a UTF-16 offset inside a char array, for spans the Rust code
// finds as byte offsets (`indexOf(")")` / `indexOf("]]")` only ever match
// ASCII, so the offset is always a char boundary).
function successorCharIndexOfOffsets(chars, offset) {
  let cursor = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (cursor === offset) {
      return index;
    }
    cursor += chars[index].length;
  }
  return chars.length;
}

// Ordered phrase spans: backticked, double-quoted (`"…"` or `"…"`),
// parenthesised, then `[[…]]` (alias form via `successorWikilinkPhrase`).
// Mirrors `phrase_spans`, including its first-match-wins scan order.
function successorPhraseSpans(body) {
  const text = String(body || "");
  const chars = Array.from(text);
  const phrases = [];
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index];
    if (ch === "`") {
      const close = chars.indexOf("`", index + 1);
      if (close === -1) {
        index += 1;
        continue;
      }
      phrases.push(chars.slice(index + 1, close).join(""));
      index = close + 1;
      continue;
    }
    if (ch === '"' || ch === "“") {
      let close = -1;
      for (let scan = index + 1; scan < chars.length; scan += 1) {
        if (chars[scan] === '"' || chars[scan] === "”") {
          close = scan;
          break;
        }
      }
      if (close === -1) {
        index += 1;
        continue;
      }
      phrases.push(chars.slice(index + 1, close).join(""));
      index = close + 1;
      continue;
    }
    if (ch === "(") {
      const offsets = [];
      let cursor = 0;
      for (const c of chars) {
        offsets.push(cursor);
        cursor += c.length;
      }
      const byteClose = text.indexOf(")", offsets[index] + 1);
      if (byteClose === -1) {
        index += 1;
        continue;
      }
      const close = successorCharIndexOfOffsets(chars, byteClose);
      phrases.push(chars.slice(index + 1, close).join(""));
      index = close + 1;
      continue;
    }
    if (ch === "[" && chars[index + 1] === "[") {
      const offsets = [];
      let cursor = 0;
      for (const c of chars) {
        offsets.push(cursor);
        cursor += c.length;
      }
      const byteClose = text.indexOf("]]", offsets[index] + 2);
      if (byteClose === -1) {
        index += 2;
        continue;
      }
      const close = successorCharIndexOfOffsets(chars, byteClose);
      phrases.push(successorWikilinkPhrase(chars.slice(index + 2, close).join("")));
      index = close + 2;
      continue;
    }
    index += 1;
  }
  return phrases;
}

// Join words with `-`, cutting at 32 characters on a `-` boundary (never
// mid-word, never empty). Mirrors `join_truncated`; all words are ASCII so
// character and byte lengths agree.
function successorJoinTruncated(words, marker) {
  const list = Array.isArray(words) ? words : [];
  if (list.length === 0) {
    return null;
  }
  const joined = list.join("-");
  let truncated = joined;
  if (joined.length > 32) {
    const cut = joined.slice(0, 32).lastIndexOf("-");
    if (cut <= 0) {
      return null;
    }
    truncated = joined.slice(0, cut);
  }
  if (!truncated || !isValidSuccessorBlockId(truncated)) {
    return null;
  }
  return truncated;
}

// Deterministic suggestions for a description: at most 3. Pure function.
// Mirrors `suggest_ids_with_used` exactly: candidate 1 is the first phrase
// with at least one word (first 4), candidate 2 the first 3 prose words,
// candidate 3 (leading verb only) the next 3 words. A taken candidate takes
// the first free `-2`…`-9` suffix (staying within 64 characters) or is
// dropped. `usedIds` is any iterable of taken IDs.
function suggestSuccessorIds(description, usedIds) {
  const used = new Set(
    Array.from(usedIds || []).map((id) => String(id || "")),
  );
  const body = String(description || "");
  const candidates = [];

  const prose = successorWordsIn(body);
  for (const phrase of successorPhraseSpans(body)) {
    const words = successorWordsIn(phrase);
    if (words.length === 0) {
      continue;
    }
    const joined = successorJoinTruncated(words.slice(0, Math.min(4, words.length)), "^");
    if (joined) {
      candidates.push(joined);
    }
    break;
  }
  if (prose.length > 0) {
    const joined = successorJoinTruncated(prose.slice(0, Math.min(3, prose.length)), "^");
    if (joined) {
      candidates.push(joined);
    }
    if (SUCCESSOR_ID_LEADING_VERB_SET.has(prose[0]) && prose.length > 1) {
      const end = Math.min(1 + 3, prose.length);
      const verbJoined = successorJoinTruncated(prose.slice(1, end), "^");
      if (verbJoined) {
        candidates.push(verbJoined);
      }
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      deduped.push(candidate);
    }
  }

  const out = [];
  for (const candidate of deduped) {
    if (!used.has(candidate)) {
      out.push(candidate);
    } else {
      let placed = null;
      for (let suffix = 2; suffix <= 9; suffix += 1) {
        const suffixed = `${candidate}-${suffix}`;
        if (suffixed.length > 64) {
          continue;
        }
        if (
          !isValidSuccessorBlockId(suffixed) ||
          used.has(suffixed) ||
          seen.has(suffixed)
        ) {
          continue;
        }
        placed = suffixed;
        break;
      }
      if (placed) {
        seen.add(placed);
        out.push(placed);
      }
    }
    if (out.length >= 3) {
      break;
    }
  }
  return out.slice(0, 3);
}

// Mint a block ID for a successor-link dependent (§12.4): the first
// suggestion, else the first free `task`, `task-2`, `task-3`, … ID.
// Mirrors `capture_block_ids::mint_block_id`. Pure function.
function mintBlockId(description, usedIds) {
  const used = new Set(
    Array.from(usedIds || []).map((id) => String(id || "")),
  );
  const first = suggestSuccessorIds(description, used)[0];
  if (first) {
    return first;
  }
  if (!used.has("task")) {
    return "task";
  }
  let suffix = 2;
  for (;;) {
    const candidate = `task-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

const SUCCESSOR_INLINE_FIELD_RE = /\[[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]*\]/g;

// Clean a task body for the mint pipeline: drop the trailing `^block-id`
// (when given), replace inline `[key:: value]` fields with a space, drop the
// Tasks global-filter tag, collapse whitespace. Mirrors
// `note_tasks::clean_description`. `rawLine` is the body after the status
// box; `globalFilter` defaults to the Tasks default (`#task`).
function cleanDescription(rawLine, globalFilter = "#task", blockId = null) {
  const filter = globalFilter === undefined ? "#task" : globalFilter;
  let text = String(rawLine || "");
  if (blockId) {
    const suffix = `^${String(blockId)}`;
    const trimmed = text.replace(/\s+$/, "");
    text = trimmed.endsWith(suffix)
      ? trimmed.slice(0, trimmed.length - suffix.length)
      : text;
  }
  SUCCESSOR_INLINE_FIELD_RE.lastIndex = 0;
  const withoutFields = text.replace(SUCCESSOR_INLINE_FIELD_RE, " ");
  return withoutFields
    .split(/\s+/)
    .filter(
      (token) =>
        token && (filter === "" || filter == null || token !== filter),
    )
    .join(" ");
}

// Body after the status box (`- [?] body`), mirroring the Rust SB test's
// `find("] ")` split but anchored on a real checkbox.
function successorBodyAfterStatusBox(rawLine) {
  const line = String(rawLine || "");
  const match = line.match(
    /^[ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+\[[^\]\n]\][ \t]*/,
  );
  if (match) {
    return line.slice(match[0].length);
  }
  const index = line.indexOf("] ");
  return index === -1 ? line : line.slice(index + 2);
}

function successorPathWithoutExtension(path) {
  const normalized = normalizeDependencyMarkdownPath(path);
  return normalized.replace(/\.md$/i, "");
}

function successorPathBasename(path) {
  const withoutExtension = successorPathWithoutExtension(path);
  const slash = withoutExtension.lastIndexOf("/");
  return slash === -1 ? withoutExtension : withoutExtension.slice(slash + 1);
}

function successorCountFromBasenameCounts(basenameCounts, stem) {
  const key = String(stem || "").toLowerCase();
  if (basenameCounts instanceof Map) {
    const value = basenameCounts.get(key);
    return typeof value === "number" ? value : null;
  }
  if (basenameCounts && typeof basenameCounts === "object") {
    const value = basenameCounts[key];
    return typeof value === "number" ? value : null;
  }
  return null;
}

// Shortest unambiguous link form for a successor target (§12.4):
// `[[basename#^id]]` when the basename is unique in the vault
// (case-insensitive, counted over the same task-bearing-note set capture
// uses for `&` dependency links), else `[[dir/note#^id]]`. The one
// exception: a successor that lives in the day file itself still names the
// note (`[[20261009#^id]]`), never the bare `[[#^id]]`. `basenameCounts`
// maps the lowercase basename to its vault-wide note count; an unknown
// count links long. Pure function.
function successorLinkText(targetPath, blockId, dailyPath, basenameCounts) {
  const id = String(blockId || "").replace(/^\^/, "");
  const stem = successorPathBasename(targetPath);
  const target = successorPathWithoutExtension(targetPath);
  const daily = dailyPath ? successorPathWithoutExtension(dailyPath) : "";
  const sameAsDaily = !!daily && target.toLowerCase() === daily.toLowerCase();
  const count = successorCountFromBasenameCounts(basenameCounts, stem);
  if (sameAsDaily || count === 1) {
    return `[[${stem}#^${id}]]`;
  }
  return `[[${target}#^${id}]]`;
}
