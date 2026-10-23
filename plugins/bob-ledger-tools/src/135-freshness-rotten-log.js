// Rotten Log tooltip line for freshness marks.
// Source of truth for the marker/entry grammar:
// `ROTTEN_LOG_PARENT_RE` / `ROTTEN_LOG_ENTRY_RE` in
// `plugins/bob-navigation-hotkeys/src/010-requires-and-config.js`, and
// `readRottenLog` / `findManagedTaskLogParents` in
// `plugins/bob-navigation-hotkeys/src/030-bullet-blocks-and-logs.js`.
// This file mirrors those byte-for-byte so Live Preview and reading view
// count exactly what nav counts. Do not diverge without updating nav,
// the Rust `parse_managed_task_log_marker` in
// `src/native/capture/sub_bullet.rs`, and `docs/freshness.md` §11.
const FRESHNESS_ROTTEN_PARENT_RE =
  /^(?<indent>\s*(?:>\s*)*)(?<marker>(?:[-*+]|\d+[.)]))[ \t]+(?<emoji>🥀\uFE0F?[ \t]+)?\*\*(?<label>ROTTEN LOG|Rotten log):?\*\*[ \t]*$/;
const FRESHNESS_ROTTEN_ENTRY_RE =
  /^(?<indent>\s*(?:>\s*)*)(?<marker>(?:[-*+]|\d+[.)]))[ \t]+\*(?<date>\d{4}-\d{2}-\d{2})\* — (?<reason>.+) · kept (?<keeps>\d{1,3})×$/;
const FRESHNESS_ROTTEN_LIST_ITEM_RE =
  /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s/;

function freshnessRottenIndentOf(line) {
  try {
    const match = /^(\s*(?:>\s*)*)/.exec(String(line || ""));
    return match ? match[1] : "";
  } catch (error) {
    return "";
  }
}

function freshnessRottenIndentWidth(line) {
  try {
    let width = 0;
    for (const character of freshnessRottenIndentOf(line)) {
      if (character === "\t") {
        width += 4 - (width % 4);
      } else if (character === ">") {
        width += 4;
      } else {
        width += 1;
      }
    }
    return width;
  } catch (error) {
    return 0;
  }
}

function freshnessRottenNearestParent(lines, childLine) {
  try {
    const source = Array.isArray(lines) ? lines : [];
    const childIndex = Math.floor(Number(childLine));
    if (!Number.isFinite(childIndex) || childIndex <= 0) return null;
    const childWidth = freshnessRottenIndentWidth(source[childIndex] || "");
    for (let line = childIndex - 1; line >= 0; line -= 1) {
      const text = String(source[line] || "");
      if (!text.trim() || freshnessRottenIndentWidth(text) >= childWidth) continue;
      if (FRESHNESS_ROTTEN_LIST_ITEM_RE.test(text)) return line;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function freshnessRottenChildBlock(lines, parentLine) {
  try {
    const source = Array.isArray(lines) ? lines : [];
    const parentIndex = Math.floor(Number(parentLine));
    if (!Number.isFinite(parentIndex) || parentIndex < 0) {
      return { startLine: 0, endLineExclusive: 0 };
    }
    const startLine = parentIndex + 1;
    const parentWidth = freshnessRottenIndentWidth(
      String(source[parentIndex] || ""),
    );
    let endLineExclusive = startLine;
    for (let index = startLine; index < source.length; index += 1) {
      const text = String(source[index] || "");
      if (text.trim() === "") continue;
      if (freshnessRottenIndentWidth(text) > parentWidth) {
        endLineExclusive = index + 1;
        continue;
      }
      break;
    }
    return { startLine, endLineExclusive };
  } catch (error) {
    return { startLine: 0, endLineExclusive: 0 };
  }
}

function freshnessRottenParseMarker(line) {
  try {
    const match = FRESHNESS_ROTTEN_PARENT_RE.exec(String(line || ""));
    if (!match) return null;
    const groups = (match && match.groups) || {};
    return { indent: groups.indent || "", marker: groups.marker || "-" };
  } catch (error) {
    return null;
  }
}

function freshnessRottenParseEntry(line) {
  try {
    const match = FRESHNESS_ROTTEN_ENTRY_RE.exec(String(line || ""));
    if (!match) return null;
    const groups = (match && match.groups) || {};
    const count = Number(groups.keeps);
    if (!Number.isInteger(count) || count < 1 || count > 999) return null;
    const reason = String(groups.reason || "").trim();
    if (!reason) return null;
    return { date: groups.date, reason, keeps: count };
  } catch (error) {
    return null;
  }
}

// Read one task's direct-child Rotten Log. Returns
// `{ status, entries }` with `status` one of `missing` (no marker),
// `empty` (marker but no valid entries), `ok`, or `unknown`
// (two or more direct-child markers). Only direct children of the task
// count as markers, and only direct children of the marker count as
// entries, each exactly `*YYYY-MM-DD* — <reason> · kept N×` with N
// from 1 to 999. Never throws.
function freshnessMarkRottenLogHistory(lines, taskLine) {
  try {
    const source = Array.isArray(lines)
      ? lines
      : String(lines || "").split(/\r?\n/);
    const taskIndex = Math.floor(Number(taskLine));
    if (!Number.isFinite(taskIndex) || taskIndex < 0) {
      return { status: "missing", entries: [] };
    }
    const block = freshnessRottenChildBlock(source, taskIndex);
    const parents = [];
    for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
      if (freshnessRottenNearestParent(source, index) !== taskIndex) continue;
      if (freshnessRottenParseMarker(source[index])) {
        parents.push(index);
      }
    }
    if (parents.length > 1) return { status: "unknown", entries: [] };
    if (parents.length === 0) return { status: "missing", entries: [] };
    const parent = parents[0];
    const childBlock = freshnessRottenChildBlock(source, parent);
    const entries = [];
    for (let index = childBlock.startLine; index < childBlock.endLineExclusive; index += 1) {
      if (freshnessRottenNearestParent(source, index) !== parent) continue;
      const parsed = freshnessRottenParseEntry(source[index]);
      if (parsed) entries.push(parsed);
    }
    if (!entries.length) return { status: "empty", entries: [] };
    return { status: "ok", entries };
  } catch (error) {
    return { status: "missing", entries: [] };
  }
}

// Short `Oct 16` date for the rotten line, using the same
// `FRESHNESS_MARK_MONTHS` names that `freshnessShortDate` uses but
// without the weekday, with `, YYYY` appended when the year differs
// from today's. Bad input yields null. Never throws.
function freshnessMarkRottenLogShortDate(dateText, todayText) {
  try {
    const date = String(dateText || "");
    const today = String(todayText || "");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    const name = FRESHNESS_MARK_MONTHS[month - 1];
    if (!name) return null;
    const base = `${name} ${day}`;
    const todayYear = /^(\d{4})-\d{2}-\d{2}$/.exec(today);
    if (!todayYear) return base;
    return todayYear[1] === match[1] ? base : `${base}, ${match[1]}`;
  } catch (error) {
    return null;
  }
}

// Truncate a reason to 48 characters plus `…`, counting code points
// so an emoji is never split. Never throws.
function freshnessMarkRottenTruncateReason(reason) {
  try {
    const points = Array.from(String(reason || ""));
    if (points.length <= 48) return points.join("");
    return points.slice(0, 48).join("") + "…";
  } catch (error) {
    return String(reason || "");
  }
}

// Display-only rotten line for a history:
// `🥀 N keeps logged · last <date> — <reason>`, or
// `🥀 1 keep logged · …` for one entry. `<date>` is `Oct 16`
// (with `, YYYY` when the year differs from today's); the newest
// entry's reason truncates to 48 characters plus `…`;
// `🤷 no reason given` shows as is. Returns null when there is
// nothing to show (missing, empty, or unknown/ambiguous logs).
// Never throws.
function freshnessMarkRottenLogLine(history, today) {
  try {
    const status = history && history.status;
    if (status === "unknown" || status === "ambiguous") return null;
    const entries = history && Array.isArray(history.entries)
      ? history.entries
      : [];
    if (!entries.length) return null;
    const latest = entries[0] || {};
    const date = freshnessMarkRottenLogShortDate(latest.date, today);
    if (!date) return null;
    const rawReason = String(latest.reason || "").trim() || "🤷 no reason given";
    const reason = freshnessMarkRottenTruncateReason(rawReason);
    const count = entries.length;
    const head = count === 1 ? "1 keep logged" : `${count} keeps logged`;
    return `🥀 ${head} · last ${date} — ${reason}`;
  } catch (error) {
    return null;
  }
}

// Display-only summary for one task's direct-child Rotten Log. `lines`
// is the raw source note and `taskLine` is zero-based. A malformed or
// duplicated marker is unknown, never an invented zero-count history.
function freshnessMarkRottenLogSummary(lines, taskLine, todayText) {
  try {
    const history = freshnessMarkRottenLogHistory(lines, taskLine);
    if (!history || history.status !== "ok") return null;
    return freshnessMarkRottenLogLine(history, todayText);
  } catch (error) {
    return null;
  }
}

function freshnessRottenEntryHasEmphasis(item, date) {
  try {
    if (!item) return false;
    const wanted = String(date || "");
    if (!wanted) return false;
    const stack = [item];
    let guard = 0;
    while (stack.length > 0 && guard < 200) {
      guard += 1;
      const node = stack.pop();
      if (!node) continue;
      const tag = String(node.tagName || node.nodeName || "").toUpperCase();
      if (tag === "EM" || tag === "I") {
        if (String(node.textContent || "").includes(wanted)) return true;
      }
      const kids = node.children || node.childNodes || [];
      for (const kid of Array.from(kids)) {
        if (kid && kid.nodeType !== 3) stack.push(kid);
      }
    }
    if (typeof item.querySelectorAll === "function") {
      for (const el of Array.from(item.querySelectorAll("em,i"))) {
        if (String(el.textContent || "").includes(wanted)) return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function freshnessMarkRottenLogSummaryFromListItem(taskItem, todayText) {
  try {
    const children = Array.from((taskItem && taskItem.children) || []);
    const lists = children.filter((node) => /^(UL|OL)$/i.test(node.tagName || ""));
    const markers = [];
    for (const list of lists) {
      for (const item of Array.from(list.children || [])) {
        if (!/^(LI)$/i.test(item.tagName || "")) continue;
        const label = String(item.childNodes && item.childNodes.length
          ? Array.from(item.childNodes).filter((child) => child.nodeType === 3 || !/^(UL|OL)$/i.test(child.tagName || "")).map((child) => child.textContent || child.nodeValue || "").join("")
          : item.textContent || "").trim();
        if (/^(?:🥀\uFE0F?[ \t]+)?(?:\*\*)?(?:ROTTEN LOG|Rotten log)(?:\*\*)?:?$/.test(label)) {
          markers.push(item);
        }
      }
    }
    if (markers.length !== 1) return null;
    const marker = markers[0];
    const nestedLists = Array.from(marker.children || []).filter((node) => /^(UL|OL)$/i.test(node.tagName || ""));
    const entries = [];
    for (const list of nestedLists) {
      for (const item of Array.from(list.children || [])) {
        if (!/^(LI)$/i.test(item.tagName || "")) continue;
        const text = String(item.textContent || "").trim();
        const match = text.match(
          /^(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\s+·\s+kept\s+(\d{1,3})×$/,
        );
        if (!match) continue;
        const count = Number(match[3]);
        if (!Number.isInteger(count) || count < 1 || count > 999) continue;
        const reason = String(match[2] || "").trim();
        if (!reason) continue;
        if (!freshnessRottenEntryHasEmphasis(item, match[1])) continue;
        entries.push({ date: match[1], reason, keeps: count });
      }
    }
    if (!entries.length) return null;
    return freshnessMarkRottenLogLine({ status: "ok", entries }, todayText);
  } catch (error) {
    return null;
  }
}

function freshnessMarkTaskListItem(node, root) {
  try {
    let current = node;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      if (/^(LI)$/i.test(current.tagName || "")) return current;
      current = current.parentNode || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function freshnessMarkInTaskQuery(node, root) {
  try {
    let current = node;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      const classes = String(current.className || (current.getAttribute && current.getAttribute("class")) || "");
      if (/(?:^|\s)(?:block-language-dataview|dataview-result-list|dataview-result-table|block-language-tasks|plugin-tasks-query-result)(?:\s|$)/.test(classes)) return true;
      current = current.parentNode || null;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Splice a rotten line before the action line (`Alt+F…`, checklist
// tiers, `complete or reschedule…`). When no action line is present
// the rotten line appends at the end (after the keeps line).
// Never throws; bad input returns the model unchanged.
function freshnessMarkWithRottenLine(model, rottenLine) {
  try {
    if (!model || !rottenLine) return model;
    const lines = String(model.tooltip || "").split("\n");
    const last = lines[lines.length - 1] || "";
    if (/^(?:Alt\+F|PRE checklist|POST closeout|complete or reschedule)/.test(last)) {
      lines.splice(lines.length - 1, 0, rottenLine);
    } else {
      lines.push(rottenLine);
    }
    model.tooltip = lines.join("\n");
    return model;
  } catch (error) {
    return model;
  }
}

// Read only the task's child block through the CodeMirror `Text` API
// (`doc.line(n)`, `doc.lines`), starting at the task line. Stops at
// the first nonblank line indented at or above the task's
// indentation. Caps at 5,000 lines. Never calls `doc.toString`.
// Returns an array with the task line first, or null. Never throws.
function freshnessRottenLinesFromDoc(doc, taskLine) {
  try {
    if (!doc || typeof doc.line !== "function") return null;
    if (!Number.isInteger(taskLine) || taskLine < 0) return null;
    const total = typeof doc.lines === "number" ? doc.lines : null;
    if (total !== null && (!Number.isFinite(total) || total <= 0)) return null;
    const taskOneBased = taskLine + 1;
    if (total !== null && taskOneBased > total) return null;
    let taskText = null;
    try {
      taskText = doc.line(taskOneBased).text;
    } catch (error) {
      return null;
    }
    if (typeof taskText !== "string") return null;
    const taskWidth = freshnessRottenIndentWidth(taskText);
    const out = [taskText];
    const limit = total !== null ? Math.min(total, taskOneBased + 5000) : taskOneBased + 5000;
    for (let n = taskOneBased + 1; n <= limit; n += 1) {
      let text = null;
      try {
        text = doc.line(n).text;
      } catch (error) {
        break;
      }
      if (typeof text !== "string") break;
      if (text.trim() === "") {
        out.push(text);
        continue;
      }
      if (freshnessRottenIndentWidth(text) <= taskWidth) break;
      out.push(text);
    }
    return out;
  } catch (error) {
    return null;
  }
}

function freshnessMarkModelWithRottenLog(input, docOrLines, taskLine) {
  try {
    const model = freshnessMarkModel(input);
    if (!model) return model;
    const today = input && typeof input.today === "string" ? input.today : undefined;
    let lines = null;
    if (Array.isArray(docOrLines)) {
      lines = docOrLines;
    } else if (typeof docOrLines === "string") {
      lines = String(docOrLines).split(/\r?\n/);
    } else if (docOrLines && typeof docOrLines.line === "function") {
      lines = freshnessRottenLinesFromDoc(docOrLines, taskLine);
      if (lines) {
        const history = freshnessMarkRottenLogHistory(lines, 0);
        if (!history || history.status !== "ok") return model;
        const line = freshnessMarkRottenLogLine(history, today);
        if (!line) return model;
        return freshnessMarkWithRottenLine(model, line);
      }
      return model;
    } else {
      return model;
    }
    const history = freshnessMarkRottenLogHistory(lines, taskLine);
    if (!history || history.status !== "ok") return model;
    const line = freshnessMarkRottenLogLine(history, today);
    if (!line) return model;
    return freshnessMarkWithRottenLine(model, line);
  } catch (error) {
    try {
      return freshnessMarkModel(input);
    } catch (inner) {
      return null;
    }
  }
}
