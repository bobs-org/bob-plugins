// Dependency chips (bob-cli-3n chips): pure Depends-On grammar.
// `docs/task-dependencies.md` §§2, 7, 11.1 (DP vectors) is authoritative.
// Parses one candidate line; context (fenced code, nesting, Work Log)
// arrives via `opts` so the DP18-DP20 `not-a-line` vectors stay testable.
// Never throws.
function parseDependencyLine(lineText, opts) {
  try {
    const options = opts && typeof opts === "object" ? opts : {};
    if (options.inCode === true || options.inWorkLog === true) {
      return { verdict: "not-a-line" };
    }
    if (options.isDirectChild === false) {
      return { verdict: "not-a-line" };
    }
    if (typeof lineText !== "string") {
      return { verdict: "not-a-line" };
    }
    const raw = lineText;
    // DP29: a blockquoted line is never a Depends-On line.
    if (/^\s*>/.test(raw)) {
      return { verdict: "not-a-line" };
    }
    // DP28: the list marker is required, as in the Rust parser and nav.
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(raw)) {
      return { verdict: "not-a-line" };
    }
    let content = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
    content = content.replace(/^\s+/, "");
    // Labels are case-sensitive (DP27), matching the Rust parser and nav.
    const labelRe = /\*\*\s*DEPENDS\s+ON\s*:\s*\*\*|\*\*\s*DEPENDENCIES\s*:\s*\*\*/;
    const labelMatch = labelRe.exec(content);
    if (!labelMatch) {
      return { verdict: "not-a-line" };
    }
    const labelText = labelMatch[0];
    const isLegacyLabel = /DEPENDENCIES/.test(labelText);
    const beforeLabel = content.slice(0, labelMatch.index);
    // DP24: the legacy link emoji never carries VS16; that is not a line.
    if (/\uD83D\uDD17\uFE0F/.test(beforeLabel)) {
      return { verdict: "not-a-line" };
    }
    const emojiMatch = /[⛓🔗]\uFE0F?/.exec(beforeLabel);
    const hasChain = content.indexOf("⛓") !== -1;
    const hasLinkEmoji = content.indexOf("🔗") !== -1;
    let emojiKind = "missing";
    let canonicalEmoji = false;
    if (content.indexOf("⛓️") !== -1 && labelMatch.index >= 0) {
      const head = content.slice(0, labelMatch.index);
      if (head.indexOf("⛓️") !== -1) {
        emojiKind = "chain-vs16";
        canonicalEmoji = true;
      }
    }
    if (!canonicalEmoji) {
      if (hasChain) {
        emojiKind = "chain-bare";
      } else if (hasLinkEmoji) {
        emojiKind = "legacy-link";
      } else {
        emojiKind = "missing";
      }
    }
    const linkRe = /(~~)?(!)?\[\[([^\[\]\n]+?)\]\](~~)?/g;
    const targets = [];
    let m = null;
    let hasBareNoteLink = false;
    while ((m = linkRe.exec(content)) !== null) {
      try {
        const leadingStrike = Boolean(m[1]);
        const embedded = Boolean(m[2]);
        const inner = String(m[3] || "");
        const trailingStrike = Boolean(m[4]);
        const struck = leadingStrike || trailingStrike;
        const barAt = inner.indexOf("|");
        const linkBody = barAt === -1 ? inner : inner.slice(0, barAt);
        const alias = barAt === -1 ? null : inner.slice(barAt + 1);
        const hashAt = linkBody.indexOf("#");
        if (hashAt === -1) {
          hasBareNoteLink = true;
          continue;
        }
        const linkpath = linkBody.slice(0, hashAt);
        const afterHash = linkBody.slice(hashAt + 1);
        if (afterHash.charAt(0) !== "^" || afterHash.length < 2) {
          hasBareNoteLink = true;
          continue;
        }
        const blockId = afterHash.slice(1);
        if (!blockId) {
          hasBareNoteLink = true;
          continue;
        }
        targets.push({
          raw: m[0],
          linkpath,
          blockId,
          alias,
          embedded,
          struck,
          linktext: linkBody,
        });
      } catch (error) {
        continue;
      }
    }
    if (hasBareNoteLink) {
      return { verdict: "malformed" };
    }
    let remainder = String(content);
    remainder = remainder.replace(/(~~)?(!)?\[\[([^\[\]\n]+?)\]\](~~)?/g, "");
    if (remainder.indexOf("[[") !== -1 || remainder.indexOf("]]") !== -1) {
      return { verdict: "malformed" };
    }
    const remLabel = labelRe.exec(remainder);
    if (!remLabel) {
      return { verdict: "not-a-line" };
    }
    const after = remainder.slice(remLabel.index + remLabel[0].length);
    const before = remainder.slice(0, remLabel.index);
    // DP24: VS16 after the legacy link emoji is rejected above; only the
    // bare chain tolerates a missing VS16.
    const beforeOk = /^\s*(?:\u26D3\uFE0F?|\uD83D\uDD17)?\s*$/.test(before);
    const afterOk = /^[\s•·,]*$/.test(after);
    if (!beforeOk || !afterOk) {
      return { verdict: "malformed" };
    }
    if (targets.length === 0) {
      // DP26: a label followed only by separators is malformed; only a bare
      // label (R9) is empty.
      if (!/^[\s]*$/.test(after)) {
        return { verdict: "malformed" };
      }
      return { verdict: "empty", targets: [], canonical: false, emoji: emojiKind, legacyLabel: isLegacyLabel };
    }
    let canonical = true;
    if (emojiKind !== "chain-vs16" || isLegacyLabel) {
      canonical = false;
    }
    for (const t of targets) {
      if (t.alias !== null || t.embedded || t.struck) {
        canonical = false;
        break;
      }
    }
    if (canonical && targets.length >= 2) {
      if (after.indexOf("•") === -1) {
        canonical = false;
      }
      if (after.indexOf("·") !== -1 || after.indexOf(",") !== -1) {
        canonical = false;
      }
    }
    return { verdict: "accept", count: targets.length, targets, canonical, emoji: emojiKind, legacyLabel: isLegacyLabel };
  } catch (error) {
    return { verdict: "not-a-line" };
  }
}

// Dependency chips: true when a candidate Depends-On line is a real one —
// Shared predicates for the Depends-On ownership check below.
function dependencyChipIndentWidth(text) {
  const match = /^[ \t]*/.exec(String(text || ""));
  return match ? match[0].length : 0;
}

function dependencyChipHasMarker(text) {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(String(text || ""));
}

function dependencyChipIsTaskLine(text) {
  const line = String(text || "");
  if (!/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\n]\]/.test(line)) {
    return false;
  }
  return /#task(?![A-Za-z0-9_/-])/.test(line);
}

// a direct child of a `#task` list item (contract DP19/DP20/DP30:
// DP20's parent is the Work Log entry, not a `#task`, so it is already
// excluded; a DP30 line owned by a task nested under a Work Log entry
// counts). `lineTexts` holds every note line; `lineIndex` is
// the 0-based index of the candidate. Never throws.
function dependencyChipLineOwnedByTask(lineTexts, lineIndex) {
  try {
    if (!Array.isArray(lineTexts) || !Number.isInteger(lineIndex)) {
      return false;
    }
    if (lineIndex < 0 || lineIndex >= lineTexts.length) {
      return false;
    }
    const widthOf = dependencyChipIndentWidth;
    const hasMarker = dependencyChipHasMarker;
    const isTaskLine = dependencyChipIsTaskLine;
    const candidateWidth = widthOf(lineTexts[lineIndex]);
    if (!hasMarker(lineTexts[lineIndex])) {
      return false;
    }
    let parent = -1;
    for (let index = lineIndex - 1; index >= 0; index -= 1) {
      const text = String(lineTexts[index] || "");
      if (!text.trim()) {
        continue;
      }
      if (widthOf(text) >= candidateWidth) {
        continue;
      }
      if (!hasMarker(text)) {
        return false;
      }
      parent = index;
      break;
    }
    if (parent === -1 || !isTaskLine(lineTexts[parent])) {
      return false;
    }
    // Ownership walks only from the candidate up to its parent item, so
    // the scan stays O(depth) (contract §7.4).
    return true;
  } catch (error) {
    return false;
  }
}

// Same ownership check as `dependencyChipLineOwnedByTask`, but walking
// ancestors with `doc.line(n)` lookups (contract §7.4) so Live Preview
// touches only visible ranges instead of copying every document line.
// `lineNumber` is 1-based, as `doc.lineAt(pos).number` reports it. Fails
// open (true) when line access is unavailable; fails closed (false) when
// the candidate or its parent is not an owned Depends-On line. Never
// throws.
function dependencyChipLineOwnedByTaskAtDoc(doc, lineNumber) {
  try {
    if (!doc || typeof doc.line !== "function" || !Number.isInteger(lineNumber) || lineNumber < 1) {
      return true;
    }
    const readLine = (number) => {
      try {
        const line = doc.line(number);
        return line && typeof line.text === "string" ? line.text : null;
      } catch (error) {
        return null;
      }
    };
    const candidate = readLine(lineNumber);
    if (candidate === null) {
      return true;
    }
    if (!dependencyChipHasMarker(candidate)) {
      return false;
    }
    const candidateWidth = dependencyChipIndentWidth(candidate);
    let parent = -1;
    let parentText = "";
    for (let number = lineNumber - 1; number >= 1; number -= 1) {
      const text = readLine(number);
      if (text === null) {
        return true;
      }
      if (!text.trim()) {
        continue;
      }
      if (dependencyChipIndentWidth(text) >= candidateWidth) {
        continue;
      }
      if (!dependencyChipHasMarker(text)) {
        return false;
      }
      parent = number;
      parentText = text;
      break;
    }
    if (parent === -1 || !dependencyChipIsTaskLine(parentText)) {
      return false;
    }
    // Ownership walks only from the candidate up to its parent item, so
    // the scan stays O(depth) (contract §7.4).
    return true;
  } catch (error) {
    return true;
  }
}

// Reading-view helpers. `dependencyReadingOwnText` returns an li's own
// text with nested lists excluded, so only an li whose own leading text
// is the Depends-On label is decorated — never the parent task row.
// `dependencyReadingAnchorOwner` finds the nearest owning li for an
// anchor. Never throws.
function dependencyReadingOwnText(li) {
  try {
    let out = "";
    const pushText = (node) => {
      try {
        out += String(node.nodeValue !== undefined && node.nodeValue !== null ? node.nodeValue : node.textContent || "");
      } catch (error) {
        // Best-effort.
      }
    };
    const walk = (parent) => {
      let children = [];
      try {
        children = Array.from(parent.childNodes || []);
      } catch (error) {
        return;
      }
      for (const child of children) {
        try {
          if (!child) {
            continue;
          }
          if (child.nodeType === 3) {
            pushText(child);
            continue;
          }
          if (child.nodeType !== 1) {
            continue;
          }
          const tag = String(child.tagName || child.nodeName || "").toUpperCase();
          if (tag === "UL" || tag === "OL" || tag === "LI") {
            continue;
          }
          if (tag === "P") {
            walk(child);
            continue;
          }
          try {
            out += String(child.textContent || "");
          } catch (error) {
            // Best-effort.
          }
        } catch (error) {
          continue;
        }
      }
    };
    walk(li);
    return out;
  } catch (error) {
    return "";
  }
}

function dependencyReadingAnchorOwner(anchor, root) {
  try {
    let node = anchor && anchor.parentNode ? anchor.parentNode : null;
    let guard = 0;
    while (node && node !== root && guard < 50) {
      guard += 1;
      try {
        const tag = String((node.tagName || node.nodeName) || "").toUpperCase();
        if (tag === "LI") {
          return node;
        }
      } catch (error) {
        // Keep walking.
      }
      node = node.parentNode || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Owning `#task` item for a Reading-view Depends-On row: the row's
// parent list must hang directly off a `#task` list item (contract
// DP19). Returns the owner li, or null. Never throws.
function dependencyReadingOwningTask(li, root) {
  try {
    if (!li || li.nodeType !== 1) {
      return null;
    }
    const list = li.parentNode || null;
    if (!list || list === root) {
      return null;
    }
    const listTag = String((list.tagName || list.nodeName) || "").toUpperCase();
    if (listTag !== "UL" && listTag !== "OL") {
      return null;
    }
    const owner = list.parentNode || null;
    if (!owner || owner.nodeType !== 1) {
      return null;
    }
    const ownerTag = String((owner.tagName || owner.nodeName) || "").toUpperCase();
    if (ownerTag !== "LI") {
      return null;
    }
    // The owner's own text (nested lists excluded) must carry the task
    // tag, so a row under a Work Log entry or a prose item never counts.
    if (!/#task(?![A-Za-z0-9_/-])/.test(dependencyReadingOwnText(owner))) {
      return null;
    }
    return owner;
  } catch (error) {
    return null;
  }
}

// True when a Reading-view row's own non-link text holds only the
// Depends-On label shape (contract §2/R10): the emoji, the bold label,
// and separators. Trailing prose (DP16), a half-typed link (DP15), a
// VS16 link emoji (DP24), or a lowercase label (DP27) fail. Anchors
// carry the links (their hrefs are validated separately) and nested
// lists are not part of the line. Never throws.
function dependencyReadingRowShapeOk(li) {
  try {
    if (!li) {
      return false;
    }
    let hasLabel = false;
    let residue = "";
    let guard = 0;
    const walk = (parent) => {
      let children = [];
      try {
        children = Array.from(parent.childNodes || []);
      } catch (error) {
        return;
      }
      for (const child of children) {
        guard += 1;
        if (guard > 500) {
          return;
        }
        try {
          if (!child) {
            continue;
          }
          if (child.nodeType === 3) {
            residue += String(child.nodeValue !== undefined && child.nodeValue !== null ? child.nodeValue : child.textContent || "");
            continue;
          }
          if (child.nodeType !== 1) {
            continue;
          }
          const tag = String(child.tagName || child.nodeName || "").toUpperCase();
          if (tag === "UL" || tag === "OL" || tag === "LI") {
            continue;
          }
          if (tag === "A") {
            try {
              const classes = String(child.className || "").split(/\s+/);
              if (classes.includes("internal-link")) {
                continue;
              }
            } catch (error) {
              // Fall through to residue.
            }
          }
          if ((tag === "STRONG" || tag === "B") && /(?:DEPENDS ON|DEPENDENCIES)/.test(String(child.textContent || ""))) {
            hasLabel = true;
            continue;
          }
          if (tag === "DIV" || tag === "SECTION" || tag === "TABLE") {
            continue;
          }
          walk(child);
        } catch (error) {
          continue;
        }
      }
    };
    walk(li);
    if (!hasLabel) {
      return false;
    }
    let full = "";
    try {
      full = String(li.textContent || "");
    } catch (error) {
      full = residue;
    }
    // DP24: the legacy link emoji never carries VS16.
    if (/🔗️/.test(full)) {
      return false;
    }
    return /^[\s•·,⛓🔗\uFE0F]*$/u.test(residue);
  } catch (error) {
    return false;
  }
}

// First bold label element (not inside a nested list) carrying the
// Depends-On label. Never throws.
function dependencyReadingLabelElement(li) {
  try {
    const stack = [li];
    let guard = 0;
    while (stack.length > 0 && guard < 500) {
      guard += 1;
      const node = stack.pop();
      if (!node || node.nodeType !== 1) {
        continue;
      }
      if (node !== li) {
        const tag = String(node.tagName || node.nodeName || "").toUpperCase();
        if (tag === "UL" || tag === "OL" || tag === "LI") {
          continue;
        }
        if ((tag === "STRONG" || tag === "B") && /DEPENDS ON|DEPENDENCIES/.test(String(node.textContent || ""))) {
          return node;
        }
      }
      let children = [];
      try {
        children = Array.from(node.childNodes || []);
      } catch (error) {
        continue;
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Block id carried by a Reading-view anchor's href. Empty when absent.
function dependencyReadingBlockId(anchor) {
  try {
    const raw = String((anchor.getAttribute && (anchor.getAttribute("data-href") || anchor.getAttribute("href"))) || "");
    const hashAt = raw.indexOf("#");
    if (hashAt === -1) {
      return "";
    }
    const after = raw.slice(hashAt + 1);
    const id = after.charAt(0) === "^" ? after.slice(1) : "";
    return decodeURIComponent(id || "");
  } catch (error) {
    return "";
  }
}

// Dependency chips: cleaned task text for a chip (about 40ch in the
// chip, full text in the tooltip). Strips wiki links to alias/basename,
// Markdown emphasis, and Tasks suffix fields. Never throws.
function dependencyCleanTaskText(text) {
  try {
    let out = String(text || "");
    out = out.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, alias) => {
      if (alias !== undefined && alias !== null && String(alias).trim()) {
        return String(alias);
      }
      const base = String(target || "").split("#")[0].split("/").pop() || target;
      return String(base).replace(/\.md$/i, "");
    });
    out = out.replace(/(\*\*|__)(.*?)\1/g, "$2");
    out = out.replace(/(^|\s)[*_~]{1,2}([^ *_~]+)[*_~]{1,2}(\s|$)/g, "$1$2$3");
    out = out.replace(/\s*\[[a-zA-Z]+\s*::\s*[^\]]*\]/g, "");
    out = out.replace(/\s+\^[A-Za-z0-9-]+(\s|$)/g, "$1");
    out = out.replace(/#[A-Za-z0-9_/-]+/g, "");
    out = out.replace(/\s+/g, " ").trim();
    return out;
  } catch (error) {
    return String(text || "").slice(0, 80);
  }
}

function dependencyStatusName(state) {
  if (state === "todo") {
    return "Todo";
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
  if (state === "broken") {
    return "Missing";
  }
  return "Not a task";
}

function dependencyStateFromSymbol(symbol, task) {
  try {
    if (task && typeof task === "object") {
      if (task.isTask === false) {
        return "not-task";
      }
      const type = task.status && task.status.type;
      if (type === "NON_TASK") {
        return "not-task";
      }
    }
    const s = String(symbol || "")[0] || "";
    if (s === "x" || s === "X") {
      return "done";
    }
    if (s === "-") {
      return "cancelled";
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
    return "todo";
  } catch (error) {
    return "todo";
  }
}

function dependencySymbolForState(state) {
  if (state === "next") {
    return "*";
  }
  if (state === "in-progress") {
    return "/";
  }
  if (state === "blocked") {
    return "?";
  }
  if (state === "done") {
    return "✓";
  }
  if (state === "cancelled") {
    return "✕";
  }
  if (state === "broken" || state === "not-task") {
    return "⚠";
  }
  return "○";
}

// Dependency chips: pure chip model for one Depends-On line.
// `docs/task-dependencies.md` §§7, 11.5 (DC vectors) is authoritative.
// `lookup(linkpath, blockId)` returns a Tasks-plugin task, `{isTask:false}`
// for a resolved non-task block, or null for a missing target. `sourcePath`
// decides the `↗ note` label. Never throws.
function dependencyChipModel(lineText, sourcePath, lookup) {
  try {
    const parsed = parseDependencyLine(lineText);
    if (!parsed || parsed.verdict === "not-a-line" || parsed.verdict === "malformed") {
      return null;
    }
    const source = String(sourcePath || "");
    const targets = parsed.verdict === "empty" ? [] : parsed.targets || [];
    const lookupFn = typeof lookup === "function" ? lookup : () => null;
    const lookupMap = lookup instanceof Map ? lookup : null;
    const chips = [];
    const getTask = (linkpath, blockId) => {
      try {
        if (lookupMap) {
          const keys = [
            String(linkpath || "") + "\u0000" + String(blockId || ""),
            String(blockId || ""),
          ];
          for (const key of keys) {
            if (lookupMap.has(key)) {
              return lookupMap.get(key);
            }
          }
          return null;
        }
        return lookupFn(linkpath, blockId);
      } catch (error) {
        return null;
      }
    };
    for (const target of targets) {
      try {
        const linkpath = String(target.linkpath || "");
        const blockId = String(target.blockId || "");
        const task = getTask(linkpath, blockId);
        const linktext = target.linktext || ((linkpath ? linkpath : "") + "#^" + blockId);
        if (task === null || task === undefined) {
          const noteLabel = linkpath ? "↗ " + linkpath.split("/").pop().replace(/\.md$/i, "") : null;
          const text = "^" + blockId + " not found";
          chips.push({
            state: "broken",
            symbol: "⚠",
            text,
            fullText: text,
            noteLabel,
            linktext,
            blockId,
            tooltip: "⚠ ^" + blockId + " not found — " + (source || "this note"),
            ariaLabel: "Broken dependency ^" + blockId + " not found",
          });
          continue;
        }
        if (task && (task.isTask === false || (task.status && task.status.type === "NON_TASK"))) {
          const noteLabel = linkpath ? "↗ " + linkpath.split("/").pop().replace(/\.md$/i, "") : null;
          chips.push({
            state: "not-task",
            symbol: "⚠",
            text: "not a task",
            fullText: "not a task",
            noteLabel,
            linktext,
            blockId,
            tooltip: "⚠ not a task — " + (task.path || source || "this note") + " ^" + blockId,
            ariaLabel: "Dependency is not a task ^" + blockId,
          });
          continue;
        }
        let symbol = "";
        try {
          if (task && typeof task === "object") {
            symbol = planTaskStatusSymbol(task) || task.statusSymbol || task.symbol || "";
            if (!symbol && task.status && typeof task.status.symbol === "string") {
              symbol = task.status.symbol;
            }
          }
        } catch (error) {
          symbol = "";
        }
        if (!symbol) {
          try {
            const rawLine = (task && (task.originalMarkdown || task.rawLine)) || "";
            symbol = freshnessTaskStatus(rawLine) || "";
          } catch (error) {
            symbol = "";
          }
        }
        if (!symbol) {
          symbol = " ";
        }
        const state = dependencyStateFromSymbol(symbol, task);
        const sym = dependencySymbolForState(state);
        let rawText = "";
        try {
          rawText = planTaskDescription(task) || task.description || task.text || "";
        } catch (error) {
          rawText = "";
        }
        const fullText = dependencyCleanTaskText(rawText) || ("^" + blockId);
        let text = fullText;
        if (text.length > 40) {
          text = text.slice(0, 40) + "…";
        }
        let taskPath = "";
        try {
          taskPath = planTaskPath(task) || task.path || "";
        } catch (error) {
          taskPath = "";
        }
        let noteLabel = null;
        if (linkpath) {
          const base = linkpath.split("/").pop().replace(/\.md$/i, "");
          if (!taskPath || taskPath !== source) {
            noteLabel = "↗ " + base;
          } else {
            noteLabel = null;
          }
        }
        let scheduled = null;
        try {
          scheduled = task.scheduled || task.scheduledDate || null;
          if (scheduled && typeof scheduled !== "string") {
            scheduled = String(scheduled);
          }
        } catch (error) {
          scheduled = null;
        }
        const statusName = dependencyStatusName(state);
        let tooltip = fullText + " — " + (taskPath || source || "this note") + " · " + statusName;
        if (scheduled) {
          tooltip += " · " + scheduled;
        }
        chips.push({
          state,
          symbol: sym,
          text,
          fullText,
          noteLabel,
          linktext,
          blockId,
          tooltip,
          ariaLabel: "Dependency " + fullText + " (" + statusName + ")",
        });
      } catch (error) {
        continue;
      }
    }
    let doneCount = 0;
    for (const chip of chips) {
      if (chip.state === "done") {
        doneCount += 1;
      }
    }
    let doneCollapsed = null;
    let finalChips = chips;
    if (doneCount > 3) {
      doneCollapsed = { count: doneCount, text: "✓×" + doneCount };
      const kept = [];
      let inserted = false;
      for (const chip of chips) {
        if (chip.state === "done") {
          if (!inserted) {
            kept.push({
              state: "done-collapsed",
              symbol: "✓",
              text: "×" + doneCount,
              fullText: doneCount + " done",
              noteLabel: null,
              linktext: null,
              blockId: null,
              tooltip: "✓×" + doneCount + " done",
              ariaLabel: doneCount + " done dependencies",
              count: doneCount,
            });
            inserted = true;
          }
          continue;
        }
        kept.push(chip);
      }
      finalChips = kept;
    }
    let waiting = 0;
    for (const chip of finalChips) {
      if (chip.state === "todo" || chip.state === "next" || chip.state === "in-progress" || chip.state === "blocked") {
        waiting += 1;
      }
      if (chip.state === "done-collapsed") {
        continue;
      }
    }
    if (doneCount > 3) {
      waiting = 0;
      for (const chip of chips) {
        if (chip.state === "todo" || chip.state === "next" || chip.state === "in-progress" || chip.state === "blocked") {
          waiting += 1;
        }
      }
    }
    const summary = waiting > 0 ? "waiting on " + waiting : "✓ all clear";
    return { label: "depends on", chips: finalChips, doneCollapsed, summary };
  } catch (error) {
    return null;
  }
}

