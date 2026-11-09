// Prompt block-ID naming contract (plan 202610/task_block_id_prefill.md).
// Pure functions only: no vault reads, no editor writes. Copy-small-helpers:
// an equivalent fragment lives in bob-navigation-hotkeys; both are exercised
// by scripts/prompt-block-id-fixtures.cjs. Do not change the automatic
// successor minting contract (task-status-cycler 086-successor-ids.js).

const PROMPT_BLOCK_ID_STOPWORDS = [
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "its", "my", "of", "on", "or", "our", "so", "that", "the",
  "their", "this", "to", "via", "with", "your",
];

const PROMPT_BLOCK_ID_STOPWORD_SET = new Set(PROMPT_BLOCK_ID_STOPWORDS);
const PROMPT_BLOCK_ID_MAX_LENGTH = 32;

function promptBlockIdEscapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function promptBlockIdStripCombining(text) {
  return String(text || "").replace(/[\u0300-\u036f]/g, "");
}

function promptBlockIdNormalizeLatin(text) {
  try {
    return promptBlockIdStripCombining(String(text || "").normalize("NFKD"));
  } catch (error) {
    return String(text || "");
  }
}

// ASCII alphanumeric runs, lowercased, stopwords dropped. Underscores and
// punctuation separate words, never glue them. Latin accents are normalized
// first so `café` contributes `cafe`.
function promptBlockIdWordsIn(text) {
  const normalized = promptBlockIdNormalizeLatin(text);
  const words = [];
  let current = "";
  const flush = () => {
    if (current && !PROMPT_BLOCK_ID_STOPWORD_SET.has(current)) {
      words.push(current);
    }
    current = "";
  };
  for (const ch of normalized) {
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

function promptBlockIdWikilinkPhrase(inner) {
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

function promptBlockIdExtractTaskBody(rawLine) {
  const line = String(rawLine || "");
  const match = line.match(
    /^[ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+\[[^\]\n]\](?:[ \t]+(.*))?$/,
  );
  if (!match) {
    return null;
  }
  return match[1] || "";
}

// A list item's body, task or plain note bullet: `- [ ] #task Fix it` and
// `- Try mergiraf [created::2026-11-09]` both resolve; a paragraph, heading,
// empty bullet, or a `-`/`*` run with no following space does not. Notebook
// notes are plain bullets, so the block-ID prompt names them the same way it
// names tasks (plan 202611/bob_notebooks.md).
function promptBlockIdExtractBulletBody(rawLine) {
  const taskBody = promptBlockIdExtractTaskBody(rawLine);
  if (taskBody !== null) {
    return taskBody;
  }
  const match = String(rawLine || "").match(
    /^[ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+(\S.*)$/,
  );
  if (!match) {
    return null;
  }
  return match[1];
}

function promptBlockIdFindProtectedSpans(text) {
  const spans = [];
  const body = String(text || "");
  let match;

  const codeRe = /`([^`\n]*?)`/g;
  while ((match = codeRe.exec(body)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  const wikiRe = /\[\[([^\]\n]+?)\]\]/g;
  while ((match = wikiRe.exec(body)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  const mdRe = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  while ((match = mdRe.exec(body)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  const urlRe = /(?:https?:\/\/|www\.)[^\s)\]]+/g;
  while ((match = urlRe.exec(body)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  spans.sort((left, right) => left.start - right.start);
  return spans;
}

function promptBlockIdIndexInSpans(spans, index) {
  for (const span of spans) {
    if (index >= span.start && index < span.end) {
      return true;
    }
  }
  return false;
}

// Clean a task or note-bullet headline for suggestion only; source text is
// never rewritten by this step. Strips the checkbox/list/blockquote prefix
// (via extract),
// trailing block ID, Dataview inline fields, Tasks emoji date/priority
// metadata, and standalone letter-tags outside code/link labels. Preserves
// semantic numbers such as `#123` and technical text inside code spans.
function promptBlockIdCleanHeadline(rawLine) {
  const body = promptBlockIdExtractBulletBody(rawLine);
  if (body === null) {
    return null;
  }
  let text = body.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, "");
  text = text.replace(/[ \t]*\[[^\[\]\n]+::[^\]\n]*\]/g, " ");
  text = text.replace(
    /[ \t]*(?:[\u2600-\u27BF]|\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF])\s*\d{4}-\d{2}-\d{2}/g,
    " ",
  );
  text = text.replace(/[ \t]+(?:🔁|⏫|🔼|🔽|⏬|📅|🛫|⏳)/g, " ");

  const spans = promptBlockIdFindProtectedSpans(text);
  const tagRe = /(^|[\s([{])#([A-Za-z][A-Za-z0-9/_-]*)/g;
  let result = "";
  let lastIndex = 0;
  let tagMatch;
  while ((tagMatch = tagRe.exec(text)) !== null) {
    const tagStart = tagMatch.index + tagMatch[1].length;
    if (promptBlockIdIndexInSpans(spans, tagStart)) {
      continue;
    }
    result += text.slice(lastIndex, tagStart);
    // Keep the prefix (usually whitespace) so surviving tokens stay
    // separated; collapse later.
    result += tagMatch[1];
    lastIndex = tagStart + 1 + tagMatch[2].length;
  }
  result += text.slice(lastIndex);
  text = result;

  text = text
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text;
}

function promptBlockIdIsBareUrlLike(phrase) {
  const text = String(phrase || "").trim();
  if (!text) {
    return true;
  }
  return /[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) || /^www\./i.test(text);
}

// Ordered visible phrases: inline code, straight/curly double-quoted text,
// parenthetical text, wikilinks (alias/basename), Markdown links (label).
// Each Markdown link is one construct so its URL parentheses never become a
// named phrase. Returns visible strings in text order.
function promptBlockIdPhraseSpans(cleaned) {
  const text = String(cleaned || "");
  const chars = Array.from(text);
  const phrases = [];
  let index = 0;

  const offsetsOf = () => {
    const offsets = [];
    let cursor = 0;
    for (const c of chars) {
      offsets.push(cursor);
      cursor += c.length;
    }
    return offsets;
  };

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
    if (ch === "[" && chars[index + 1] === "[") {
      const offsets = offsetsOf();
      const byteClose = text.indexOf("]]", offsets[index] + 2);
      if (byteClose === -1) {
        index += 2;
        continue;
      }
      let close = chars.length;
      for (let scan = 0; scan < chars.length; scan += 1) {
        if (offsets[scan] === byteClose) {
          close = scan;
          break;
        }
      }
      const inner = chars.slice(index + 2, close).join("");
      phrases.push(promptBlockIdWikilinkPhrase(inner));
      index = close + 2;
      continue;
    }
    if (ch === "[") {
      const offsets = offsetsOf();
      const byteBracket = text.indexOf("]", offsets[index] + 1);
      if (
        byteBracket !== -1 &&
        text[byteBracket + 1] === "("
      ) {
        const byteParen = text.indexOf(")", byteBracket + 2);
        if (byteParen !== -1) {
          let labelEnd = chars.length;
          for (let scan = 0; scan < chars.length; scan += 1) {
            if (offsets[scan] === byteBracket) {
              labelEnd = scan;
              break;
            }
          }
          let parenEnd = chars.length;
          for (let scan = 0; scan < chars.length; scan += 1) {
            if (offsets[scan] === byteParen) {
              parenEnd = scan;
              break;
            }
          }
          // Label excludes a leading `!` image marker (handled by slicing
          // from after `[`, which is exact for `![alt](url)` too).
          phrases.push(chars.slice(index + 1, labelEnd).join(""));
          index = parenEnd + 1;
          continue;
        }
      }
      index += 1;
      continue;
    }
    if (ch === "(") {
      const offsets = offsetsOf();
      const byteClose = text.indexOf(")", offsets[index] + 1);
      if (byteClose === -1) {
        index += 1;
        continue;
      }
      let close = chars.length;
      for (let scan = 0; scan < chars.length; scan += 1) {
        if (offsets[scan] === byteClose) {
          close = scan;
          break;
        }
      }
      phrases.push(chars.slice(index + 1, close).join(""));
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return phrases;
}

// Visible prose projection for the fallback: wikilinks and Markdown links
// become their visible text, code spans lose their backticks, bare URLs are
// removed entirely.
function promptBlockIdProseText(cleaned) {
  let text = String(cleaned || "");
  text = text.replace(
    /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (whole, label) => ` ${label || ""} `,
  );
  text = text.replace(
    /\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (whole, label) => ` ${label || ""} `,
  );
  text = text.replace(
    /\[\[([^\]\n]+?)\]\]/g,
    (whole, inner) => ` ${promptBlockIdWikilinkPhrase(inner)} `,
  );
  text = text.replace(/`([^`\n]*?)`/g, (whole, inner) => ` ${inner} `);
  text = text.replace(/(?:https?:\/\/|www\.)[^\s)\]]+/g, " ");
  return text;
}

function promptBlockIdTruncateSlug(slug, maxLength) {
  return String(slug || "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

// Join words with `-`, cutting at 32 characters on a `-` boundary where
// possible; a single over-long token is truncated to the limit.
function promptBlockIdJoinTruncated(words, maxLength) {
  const list = Array.isArray(words) ? words : [];
  if (list.length === 0) {
    return null;
  }
  const limit =
    Number.isInteger(maxLength) && maxLength > 0
      ? maxLength
      : PROMPT_BLOCK_ID_MAX_LENGTH;
  const joined = list.join("-");
  if (joined.length <= limit) {
    return joined && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(joined)
      ? joined
      : null;
  }
  const cut = joined.slice(0, limit).lastIndexOf("-");
  if (cut > 0) {
    return joined.slice(0, cut);
  }
  const truncated = joined.slice(0, limit);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(truncated) && truncated
    ? truncated
    : joined.slice(0, limit).replace(/[^a-z0-9]+$/g, "") || null;
}

function promptBlockIdCountOccurrences(content, id) {
  const needle = String(id || "");
  if (!needle) {
    return 0;
  }
  const re = new RegExp(
    `(^|[ \\t])\\^${promptBlockIdEscapeRegExp(needle)}(?=$|[ \\t\\r\\n])`,
    "gm",
  );
  let count = 0;
  let match;
  while ((match = re.exec(String(content || ""))) !== null) {
    count += 1;
    // Avoid zero-length infinite loops (pattern always consumes, but guard).
    if (match[0].length === 0) {
      re.lastIndex += 1;
    }
  }
  return count;
}

function promptBlockIdReservedSet(reservedIds) {
  if (reservedIds instanceof Set) {
    return reservedIds;
  }
  return new Set(reservedIds || []);
}

// Pure suggestion over task or note-bullet text, occupied note content, and
// pending reservations. Returns a slug or null for non-list input. A line
// with no usable words falls back to `task` for a checkbox line and `note`
// for a plain bullet. Collisions walk
// `stem-2`, `stem-3`, … without a `-9` cutoff, reserving suffix room within
// 32 characters. `excludeId` ignores one occurrence (marker-triggered
// rename); never globally remove duplicates.
function suggestPromptBlockId(rawLine, content, options = {}) {
  const cleaned = promptBlockIdCleanHeadline(rawLine);
  if (cleaned === null) {
    return null;
  }
  const reserved = promptBlockIdReservedSet(options.reservedIds);
  const excludeId =
    typeof options.excludeId === "string" && options.excludeId
      ? options.excludeId
      : null;
  const text = String(content || "");
  const isTaken = (candidate) => {
    if (reserved.has(candidate)) {
      return true;
    }
    let count = promptBlockIdCountOccurrences(text, candidate);
    if (excludeId !== null && candidate === excludeId) {
      count -= 1;
    }
    return count > 0;
  };

  const fallbackStem =
    promptBlockIdExtractTaskBody(rawLine) !== null ? "task" : "note";
  let stem = null;
  const phrases = promptBlockIdPhraseSpans(cleaned);
  for (const phrase of phrases) {
    if (promptBlockIdIsBareUrlLike(phrase)) {
      continue;
    }
    const words = promptBlockIdWordsIn(phrase).slice(0, 4);
    if (words.length === 0) {
      continue;
    }
    const joined = promptBlockIdJoinTruncated(
      words,
      PROMPT_BLOCK_ID_MAX_LENGTH,
    );
    if (joined) {
      stem = joined;
      break;
    }
  }

  if (!stem) {
    const proseWords = promptBlockIdWordsIn(
      promptBlockIdProseText(cleaned),
    ).slice(0, 3);
    if (proseWords.length > 0) {
      stem =
        promptBlockIdJoinTruncated(proseWords, PROMPT_BLOCK_ID_MAX_LENGTH) ||
        fallbackStem;
    } else {
      stem = fallbackStem;
    }
  }

  let candidate = stem;
  let suffix = 2;
  while (isTaken(candidate)) {
    const suffixText = `-${suffix}`;
    const base =
      promptBlockIdTruncateSlug(
        stem,
        Math.max(1, PROMPT_BLOCK_ID_MAX_LENGTH - suffixText.length),
      ) || fallbackStem;
    candidate = `${base}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}
