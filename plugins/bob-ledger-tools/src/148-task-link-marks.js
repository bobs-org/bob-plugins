// --- Task link marks: pure mark-core ------------------------------------
// Owned by the `docs/task-link-marks.md` display contract in bob-cli
// (bob-cli-f5 phase `core`). Pure helpers only: the block-link scanner
// (TS), the document-level line eligibility (TC), the target-line parser
// and state model (pure TR), and the tooltip model (TT). Every helper is
// synchronous and never throws; bad input yields null or an empty list.
// Reuses `relationInlineCodeRanges` and the `relationWikilinkSpans`
// approach, `mentionIsEdgeLine` for managed rows, `PLAN_DAILY_PATH_RE`,
// `planSectionRange`, `planFencedLines`, `planParseEntry`,
// `todayIsSubBulletLine`, `todayIndentLen`, `todayBulletBody`, and
// `todayWikilinkTokens` for the ledger-row rule, and
// `dependencyCleanTaskText` for tooltips. The mark is truthful, never
// guessing: only provably task targets get rings.

function taskLinkMarkInlineCommentRanges(lineText) {
  try {
    const text = String(lineText || "");
    const ranges = [];
    let search = 0;
    for (;;) {
      const open = text.indexOf("%%", search);
      if (open === -1) {
        break;
      }
      const close = text.indexOf("%%", open + 2);
      if (close === -1) {
        ranges.push({ start: open, end: text.length });
        break;
      }
      ranges.push({ start: open, end: close + 2 });
      search = close + 2;
    }
    return ranges;
  } catch (error) {
    return [];
  }
}

function taskLinkMarkPosExcluded(ranges, open, end) {
  try {
    if (!Array.isArray(ranges)) {
      return false;
    }
    for (const span of ranges) {
      try {
        if (span && open < span.end && end > span.start) {
          return true;
        }
      } catch (error) {
        continue;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function taskLinkMarkDecodeDest(raw) {
  try {
    const text = String(raw || "");
    try {
      return decodeURIComponent(text);
    } catch (error) {
      try {
        return decodeURI(text);
      } catch (inner) {
        return text;
      }
    }
  } catch (error) {
    return String(raw || "");
  }
}

function taskLinkMarkIsUriScheme(dest) {
  try {
    const text = String(dest || "");
    const colon = text.indexOf(":");
    if (colon === -1) {
      return false;
    }
    const scheme = text.slice(0, colon);
    if (!scheme || !/[A-Za-z]/.test(scheme[0])) {
      return false;
    }
    if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) {
      return false;
    }
    // A Windows drive (`C:\…`) or `C:/…` prefix is a path, not a scheme.
    if (/^[A-Za-z]$/.test(scheme) && text.length > 2 && (text[2] === "\\" || text[2] === "/")) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function taskLinkMarkStruckAt(text, open, end) {
  try {
    const value = String(text || "");
    if (open >= 2 && end + 2 <= value.length) {
      if (value.slice(open - 2, open) === "~~" && value.slice(end, end + 2) === "~~") {
        return open - 2;
      }
    }
    return open;
  } catch (error) {
    return open;
  }
}

// `taskLinkMarkSpans(lineText)` returns a frozen array of frozen
// `{at, linkpath, blockId, kind, alias}` in UTF-16 offsets, where `at`
// is where the ring goes (the link start, or the opening `~~` of a
// struck link). Wikilinks give `kind: "wiki"`, Markdown links give
// `kind: "md"`. Embeds, inline code, inline `%%…%%`, schemes, and bad
// ids give no span. Never throws.
function taskLinkMarkSpans(lineText) {
  try {
    const text = String(lineText || "");
    if (text === "" || (text.indexOf("#^") === -1 && text.toLowerCase().indexOf("#%5e") === -1)) {
      return Object.freeze([]);
    }
    let code = [];
    try {
      code = relationInlineCodeRanges(text);
    } catch (error) {
      code = [];
    }
    let commented = [];
    try {
      commented = taskLinkMarkInlineCommentRanges(text);
    } catch (error) {
      commented = [];
    }
    const spans = [];
    // Wikilinks `[[path#^id]]` / `[[path#^id|alias]]` / `[[#^id]]`.
    try {
      let cursor = 0;
      for (;;) {
        const open = text.indexOf("[[", cursor);
        if (open === -1) {
          break;
        }
        const close = text.indexOf("]]", open + 2);
        if (close === -1) {
          break;
        }
        const end = close + 2;
        cursor = end;
        try {
          if (taskLinkMarkPosExcluded(code, open, end)) {
            continue;
          }
          if (taskLinkMarkPosExcluded(commented, open, end)) {
            continue;
          }
          const embedded = open > 0 && text[open - 1] === "!";
          if (embedded) {
            continue;
          }
          const inside = text.slice(open + 2, close);
          const pipe = inside.indexOf("|");
          const target = pipe === -1 ? inside : inside.slice(0, pipe);
          const caret = target.indexOf("#^");
          if (caret === -1) {
            continue;
          }
          const rawPath = target.slice(0, caret).trim();
          const blockId = target.slice(caret + 2).trim();
          if (!blockId || !/^[A-Za-z0-9-]+$/.test(blockId)) {
            continue;
          }
          if (rawPath.includes("#") || rawPath.includes("^")) {
            continue;
          }
          const alias = pipe === -1 ? null : inside.slice(pipe + 1);
          const at = taskLinkMarkStruckAt(text, open, end);
          spans.push(Object.freeze({
            at,
            linkpath: rawPath,
            blockId,
            kind: "wiki",
            alias,
          }));
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // One bad wikilink never breaks the scan.
    }
    // Markdown links `[text](dest)` with `<…>`, percent-encoding, `%5E`.
    try {
      let cursor = 0;
      while (cursor < text.length) {
        const openBracket = text.indexOf("[", cursor);
        if (openBracket === -1) {
          break;
        }
        // Skip images `![…](…)` and nested brackets by finding the close.
        const embedded = openBracket > 0 && text[openBracket - 1] === "!";
        const closeBracket = text.indexOf("]", openBracket + 1);
        if (closeBracket === -1) {
          break;
        }
        if (text[closeBracket + 1] !== "(") {
          cursor = closeBracket + 1;
          continue;
        }
        const destOpen = closeBracket + 2;
        const destClose = text.indexOf(")", destOpen);
        if (destClose === -1) {
          break;
        }
        const linkEnd = destClose + 1;
        cursor = linkEnd;
        try {
          if (embedded) {
            continue;
          }
          if (taskLinkMarkPosExcluded(code, openBracket, linkEnd)) {
            continue;
          }
          if (taskLinkMarkPosExcluded(commented, openBracket, linkEnd)) {
            continue;
          }
          let rawDest = text.slice(destOpen, destClose).trim();
          if (rawDest === "") {
            continue;
          }
          // Drop an optional `<title>` tail: `[t](dest "title")`.
          const titled = rawDest.match(/^(\S+)\s+["'][^"']*["']\s*$/u);
          if (titled) {
            rawDest = titled[1];
          }
          if (rawDest.startsWith("<") && rawDest.endsWith(">") && rawDest.length >= 2) {
            rawDest = rawDest.slice(1, -1).trim();
          }
          if (rawDest === "") {
            continue;
          }
          const decoded = taskLinkMarkDecodeDest(rawDest);
          const hash = decoded.indexOf("#");
          if (hash === -1) {
            continue;
          }
          const beforeHash = decoded.slice(0, hash);
          let afterHash = decoded.slice(hash + 1);
          if (afterHash.startsWith("^")) {
            afterHash = afterHash.slice(1);
          } else {
            continue;
          }
          const blockId = afterHash.trim();
          if (!blockId || !/^[A-Za-z0-9-]+$/.test(blockId)) {
            continue;
          }
          const linkpath = beforeHash.trim();
          if (linkpath === "" && false) {
            continue;
          }
          if (taskLinkMarkIsUriScheme(linkpath) || taskLinkMarkIsUriScheme(rawDest)) {
            continue;
          }
          if (linkpath.includes("#") || linkpath.includes("^")) {
            continue;
          }
          const aliasText = text.slice(openBracket + 1, closeBracket);
          const at = taskLinkMarkStruckAt(text, openBracket, linkEnd);
          spans.push(Object.freeze({
            at,
            linkpath,
            blockId,
            kind: "md",
            alias: aliasText,
          }));
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // One bad Markdown link never breaks the scan.
    }
    spans.sort((a, b) => a.at - b.at);
    return Object.freeze(spans);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Whether a ledger bullet body is a dedicated Task Link row: exactly one
// `[[target#^id]]` (alias allowed), after stripping leading `🍅 ` markers,
// unwrapping one `~~…~~` struck pair, and stripping one trailing ` #`
// move-only marker. Closed entries count too. Never throws.
function taskLinkMarkLedgerBodyIsDedicated(body) {
  try {
    let text = String(body || "");
    if (text === "") {
      return false;
    }
    text = text.replace(/^(?:🍅\s*)+/u, "");
    if (text === "") {
      return false;
    }
    try {
      const tail = text.match(/[ \t]#[ \t]*$/u);
      if (tail) {
        const prefix = text.slice(0, text.length - tail[0].length);
        if (prefix.endsWith("]]") || prefix.endsWith("~~")) {
          text = prefix;
        }
      }
    } catch (error) {
      // Keep the body as-is when the tail check fails.
    }
    if (text === "") {
      return false;
    }
    let inner = text;
    if (inner.startsWith("~~") && inner.endsWith("~~") && inner.length >= 4) {
      inner = inner.slice(2, -2);
    }
    if (inner === "") {
      return false;
    }
    let tokens = null;
    try {
      tokens = todayWikilinkTokens(inner);
    } catch (error) {
      return false;
    }
    if (!Array.isArray(tokens) || tokens.length !== 1) {
      return false;
    }
    const token = tokens[0];
    if (!token || token.start !== 0 || token.end !== inner.length) {
      return false;
    }
    if (token.embedded) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Rule 5: whether `lines[index]` is a dedicated Pomodoro Task Link row in
// a canonical daily note's `## Pomodoros` section: a direct child bullet
// of a column-0 Pomodoro entry (open or closed) at that entry's first
// child indent, whose body is exactly one block link (alias allowed),
// optionally after `🍅 `, optionally struck, optionally with a trailing
// ` #`. Deeper bullets and mixed prose return false. Never throws.
function taskLinkMarkIsLedgerTaskLinkLine(lines, index, path) {
  try {
    if (!Array.isArray(lines) || typeof index !== "number") {
      return false;
    }
    const targetPath = String(path || "");
    if (targetPath === "") {
      return false;
    }
    try {
      if (!PLAN_DAILY_PATH_RE.test(targetPath)) {
        return false;
      }
    } catch (error) {
      return false;
    }
    if (index < 0 || index >= lines.length) {
      return false;
    }
    let section = null;
    try {
      section = planSectionRange(lines);
    } catch (error) {
      return false;
    }
    if (!section) {
      return false;
    }
    if (index < section.start || index > section.end) {
      return false;
    }
    let fenced = null;
    try {
      fenced = planFencedLines(lines, section.start, section.end);
    } catch (error) {
      fenced = new Set();
    }
    if (fenced.has(index)) {
      return false;
    }
    const line = String(lines[index] || "");
    let bullet = null;
    try {
      bullet = todayBulletBody(line);
    } catch (error) {
      return false;
    }
    if (!bullet) {
      return false;
    }
    // Find the owning column-0 entry by scanning back.
    let entryIndex = -1;
    try {
      for (let at = index - 1; at >= section.start; at -= 1) {
        const candidate = String(lines[at] || "");
        if (candidate.trim() === "") {
          break;
        }
        if (candidate.startsWith(" ") || candidate.startsWith("\t")) {
          let sub = false;
          try {
            sub = todayIsSubBulletLine(candidate);
          } catch (error) {
            sub = false;
          }
          if (!sub) {
            break;
          }
          continue;
        }
        let parsed = null;
        try {
          parsed = planParseEntry(candidate);
        } catch (error) {
          parsed = null;
        }
        if (!parsed) {
          break;
        }
        entryIndex = at;
        break;
      }
    } catch (error) {
      return false;
    }
    if (entryIndex === -1) {
      return false;
    }
    // The entry's sub-bullet range, mirroring `computeTodayLinks`.
    const range = [];
    try {
      for (let sub = entryIndex + 1; sub <= section.end; sub += 1) {
        if (fenced.has(sub)) {
          continue;
        }
        let isSub = false;
        try {
          isSub = todayIsSubBulletLine(String(lines[sub] || ""));
        } catch (error) {
          isSub = false;
        }
        if (!isSub) {
          break;
        }
        range.push(sub);
      }
    } catch (error) {
      return false;
    }
    if (range.length === 0 || !range.includes(index)) {
      return false;
    }
    let childIndent = 0;
    try {
      childIndent = todayIndentLen(String(lines[range[0]] || ""));
    } catch (error) {
      return false;
    }
    let ownIndent = 0;
    try {
      ownIndent = todayIndentLen(line);
    } catch (error) {
      return false;
    }
    if (ownIndent !== childIndent) {
      return false;
    }
    try {
      return taskLinkMarkLedgerBodyIsDedicated(bullet.body);
    } catch (error) {
      return false;
    }
  } catch (error) {
    return false;
  }
}

function taskLinkMarkFrontmatterEnd(lines) {
  try {
    if (!Array.isArray(lines) || lines.length === 0) {
      return -1;
    }
    if (String(lines[0] || "").trimEnd() !== "---") {
      return -1;
    }
    for (let index = 1; index < lines.length; index += 1) {
      if (String(lines[index] || "").trimEnd() === "---") {
        return index;
      }
    }
    return lines.length - 1;
  } catch (error) {
    return -1;
  }
}

function taskLinkMarkFencedLines(lines) {
  try {
    const fenced = new Set();
    let marker = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || "");
      const match = line.match(/^\s*(`{3,}|~{3,})/u);
      if (!marker && match) {
        marker = match[1][0];
        fenced.add(index);
      } else if (marker) {
        fenced.add(index);
        if (match && match[1][0] === marker) {
          marker = null;
        }
      }
    }
    return fenced;
  } catch (error) {
    return new Set();
  }
}

function taskLinkMarkCommentedLines(lines) {
  // Document-walker set: lines strictly inside a multi-line `%%…%%`
  // comment (an odd `%%` count precedes the line). Single-line inline
  // pairs stay span-level through `taskLinkMarkSpans`, so a prose line
  // with links outside the pair remains eligible.
  try {
    const list = Array.isArray(lines) ? lines : String(lines || "").split("\n");
    const commented = new Set();
    let open = false;
    for (let index = 0; index < list.length; index += 1) {
      const text = String(list[index] || "");
      let count = 0;
      let at = 0;
      for (;;) {
        const found = text.indexOf("%%", at);
        if (found === -1) {
          break;
        }
        count += 1;
        at = found + 2;
      }
      if (open) {
        commented.add(index);
      }
      if (count % 2 === 1) {
        open = !open;
      }
    }
    return commented;
  } catch (error) {
    return new Set();
  }
}

// Bare managed-row text (no list marker required): the TC5 shorthand
// writes `⛓️ **DEPENDS ON:** …` without its bullet, and malformed rows
// still own the line. The `mentionIsEdgeLine` verdicts cover the listed
// forms; this text fallback covers the shorthand so truthfulness never
// depends on a bullet. Never throws.
function taskLinkMarkIsManagedRowText(line) {
  try {
    const text = String(line || "");
    if (text.includes("⛓️") && text.includes("DEPENDS ON")) {
      return true;
    }
    if (text.includes("**DEPENDS ON")) {
      return true;
    }
    if (text.includes("**BLOCKS")) {
      return true;
    }
    if (text.includes("**LINKS")) {
      return true;
    }
    if (text.includes("**LINKED FROM")) {
      return true;
    }
    if (text.includes("**Sub-projects")) {
      return true;
    }
    if (text.includes("🧩") && text.includes("Sub-projects")) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Document-level line eligibility (TC): whether prose links on
// `lines[index]` may wear rings. False for fences, frontmatter,
// multi-line `%%…%%` comments, managed edge rows, and dedicated ledger
// rows (`ledger_rows = skip`); true everywhere else, including task
// lines, log entries, nested or mixed ledger children, area-note
// bullets, daily-note non-ledger sections, headings, blockquotes, and
// callouts. Never throws.
function taskLinkMarkLineEligible(lines, index, path) {
  try {
    if (!Array.isArray(lines) || typeof index !== "number") {
      return false;
    }
    if (index < 0 || index >= lines.length) {
      return false;
    }
    const frontEnd = taskLinkMarkFrontmatterEnd(lines);
    if (index <= frontEnd) {
      return false;
    }
    const fenced = taskLinkMarkFencedLines(lines);
    if (fenced.has(index)) {
      return false;
    }
    const commented = taskLinkMarkCommentedLines(lines);
    if (commented.has(index)) {
      return false;
    }
    const line = String(lines[index] || "");
    try {
      if (typeof mentionIsEdgeLine === "function" && mentionIsEdgeLine(line)) {
        return false;
      }
    } catch (error) {
      // A failed recogniser never opens a ring.
    }
    try {
      if (taskLinkMarkIsManagedRowText(line)) {
        return false;
      }
    } catch (error) {
      return false;
    }
    try {
      if (taskLinkMarkIsLedgerTaskLinkLine(lines, index, path)) {
        return false;
      }
    } catch (error) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// `taskLinkMarkParseTaskLine(lineText)` returns a frozen
// `{symbol, hasTask, blockId}` or null for a non-list line. `symbol`
// is the checkbox char (`" "` when absent), `hasTask` is whether an
// exact `#task` tag token sits outside inline code, and `blockId` is
// the trailing standalone `^id` or null. Never throws.
function taskLinkMarkParseTaskLine(lineText) {
  try {
    const text = String(lineText || "");
    if (text === "") {
      return null;
    }
    const item = text.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([^\]\n])\]/u);
    if (!item) {
      // Paragraphs and plain bullets never resolve (TR9–TR10).
      const trailing = taskLinkMarkTrailingBlockId(text);
      return Object.freeze({ symbol: " ", hasTask: false, blockId: trailing });
    }
    const symbol = item[1];
    let code = [];
    try {
      code = relationInlineCodeRanges(text);
    } catch (error) {
      code = [];
    }
    let hasTask = false;
    try {
      let search = 0;
      for (;;) {
        const at = text.indexOf("#task", search);
        if (at === -1) {
          break;
        }
        search = at + 5;
        const before = at === 0 ? "" : text[at - 1];
        if (before !== "" && !/\s/.test(before)) {
          continue;
        }
        const after = text[at + 5] || "";
        if (after !== "" && /[\p{L}\p{N}_/-]/u.test(after)) {
          continue;
        }
        if (taskLinkMarkPosExcluded(code, at, at + 5)) {
          continue;
        }
        hasTask = true;
        break;
      }
    } catch (error) {
      hasTask = false;
    }
    const blockId = taskLinkMarkTrailingBlockId(text);
    return Object.freeze({ symbol, hasTask, blockId });
  } catch (error) {
    return null;
  }
}

function taskLinkMarkTrailingBlockId(lineText) {
  try {
    const text = String(lineText || "");
    if (text === "") {
      return null;
    }
    const trimmed = text.replace(/[ \t]+$/u, "");
    if (trimmed === "") {
      return null;
    }
    const last = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
    if (last === -1) {
      return null;
    }
    const token = trimmed.slice(last + 1);
    if (!token.startsWith("^")) {
      return null;
    }
    const id = token.slice(1);
    if (id === "" || !/^[A-Za-z0-9-]+$/.test(id)) {
      return null;
    }
    return id;
  } catch (error) {
    return null;
  }
}

// `taskLinkMarkStateFromSymbol(symbol, statusType)` maps a checkbox
// symbol (plus a Tasks status-type fallback for symbols like `>`) to
// `ready`, `next`, `in-progress`, `blocked`, `done`, `cancelled`, or
// null (no ring). Never throws.
function taskLinkMarkStateFromSymbol(symbol, statusType) {
  try {
    const s = String(symbol || "")[0] || "";
    if (s === " ") {
      return "ready";
    }
    if (s === "*") {
      return "next";
    }
    if (s === "/") {
      return "in-progress";
    }
    if (s === "?") {
      return "blocked";
    }
    if (s === "x" || s === "X") {
      return "done";
    }
    if (s === "-") {
      return "cancelled";
    }
    const type = String(statusType || "").toUpperCase();
    if (type === "DONE") {
      return "done";
    }
    if (type === "CANCELLED") {
      return "cancelled";
    }
    if (type === "NON_TASK") {
      return null;
    }
    return "ready";
  } catch (error) {
    return "ready";
  }
}

function taskLinkMarkStateLabel(state) {
  try {
    if (state === "ready") {
      return "Ready";
    }
    if (state === "next") {
      return "Next";
    }
    if (state === "in-progress") {
      return "In Progress";
    }
    if (state === "blocked") {
      return "Blocked";
    }
    if (state === "done") {
      return "Done";
    }
    if (state === "cancelled") {
      return "Cancelled";
    }
    return "Ready";
  } catch (error) {
    return "Ready";
  }
}

function taskLinkMarkBasename(path) {
  try {
    const text = String(path || "");
    if (text === "") {
      return "";
    }
    const base = text.split("/").pop() || text;
    return base.replace(/\.md$/i, "");
  } catch (error) {
    return "";
  }
}

// `taskLinkMarkTooltip({title, state, targetPath, sourcePath})`
// returns the `aria-label` (`<title>\n<Status> · <note>`, or just the
// second line when the title is unknown). Titles are cleaned with
// `dependencyCleanTaskText`, cut to 80 characters (79 plus `…`), and
// never contain `::`. Never throws.
function taskLinkMarkTooltip(input) {
  try {
    const options = input && typeof input === "object" ? input : {};
    const state = String(options.state || "ready");
    const label = taskLinkMarkStateLabel(state);
    let note = "";
    try {
      const target = String(options.targetPath || "");
      const source = String(options.sourcePath || "");
      if (target === "" || (source !== "" && target === source)) {
        note = "this note";
      } else {
        note = taskLinkMarkBasename(target) || "this note";
      }
    } catch (error) {
      note = "this note";
    }
    const second = `${label} · ${note}`;
    let title = "";
    try {
      const raw = options.title;
      if (typeof raw !== "string" || raw.trim() === "") {
        return second;
      }
      try {
        let source = String(raw);
        source = source.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[^\]\n]\][ \t]*/u, "");
        source = source.replace(/^[ \t]+/u, "");
        title = dependencyCleanTaskText(source);
      } catch (error) {
        title = String(raw);
      }
      title = String(title || "").replace(/\s+/gu, " ").trim();
      title = title.replace(/::/gu, ":");
      if (title === "") {
        return second;
      }
      if (title.length > 80) {
        title = `${title.slice(0, 79)}…`;
      }
      title = title.replace(/::/gu, ":");
      return `${title}\n${second}`;
    } catch (error) {
      return second;
    }
  } catch (error) {
    return "Ready · this note";
  }
}
