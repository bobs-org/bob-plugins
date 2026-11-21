// --- Task requirements (RQ mirror) ---------------------------------------
// Mirrors bob-cli `src/native/task_reqs.rs` for display only. The shared
// RQ fixture remains owned by bob-cli and is copied byte for byte into the
// plugin. Nothing in this fragment writes Markdown.

const TASK_REQ_MAX_DEPTH = 16;
const TASK_REQ_GLOBAL_FILTER = "#task";
const TASK_REQ_TEACHING_COPY =
  "Part of this task's scope. Met when the task closes. Drop it or make it a task.";

function taskReqIndent(line) {
  try {
    return (String(line || "").match(/^[ \t]*/) || [""])[0].length;
  } catch (error) {
    return 0;
  }
}

// `list_item_body` twin: only list markers followed by whitespace count.
function taskReqListItem(line) {
  try {
    const text = String(line || "");
    const indent = taskReqIndent(text);
    const afterIndent = text.slice(indent);
    let markerLength = 0;
    if (/^[-*+]/.test(afterIndent)) {
      markerLength = 1;
    } else {
      const ordered = /^(\d+)[.)]/.exec(afterIndent);
      if (!ordered) return null;
      markerLength = ordered[0].length;
    }
    if (markerLength <= 0) return null;
    let cursor = indent + markerLength;
    const gap = (text.slice(cursor).match(/^[ \t]+/) || [""])[0].length;
    if (gap === 0) return null;
    cursor += gap;
    return { body: text.slice(cursor), bodyFrom: cursor, indent };
  } catch (error) {
    return null;
  }
}

function taskReqParseCheckbox(body) {
  try {
    const text = String(body || "");
    if (!text.startsWith("[")) return null;
    const afterOpen = text.slice(1);
    const mark = Array.from(afterOpen)[0];
    if (!mark) return null;
    const afterMark = afterOpen.slice(mark.length);
    if (!afterMark.startsWith("]")) return null;
    const afterClose = afterMark.slice(1);
    if (afterClose !== "" && !/^[ \t]/.test(afterClose)) return null;
    return {
      mark,
      rest: afterClose.replace(/^[ \t]+/, ""),
      markerLength: 1 + mark.length + 1,
    };
  } catch (error) {
    return null;
  }
}

function taskReqCarriesGlobalFilter(rest) {
  try {
    return String(rest || "").split(/\s+/).includes(TASK_REQ_GLOBAL_FILTER);
  } catch (error) {
    return false;
  }
}

function taskReqFenceMarker(line) {
  try {
    const value = String(line || "").replace(/^ {0,3}/, "");
    const match = /^(`{3,}|~{3,})(.*)$/.exec(value);
    if (!match) return null;
    if (match[1][0] === "`" && match[2].includes("`")) return null;
    return { char: match[1][0], length: match[1].length };
  } catch (error) {
    return null;
  }
}

function taskReqClosesFence(line, marker) {
  try {
    if (!marker) return false;
    const value = String(line || "").replace(/^ {0,3}/, "");
    const escaped = marker.char === "`" ? "`" : "~";
    const match = new RegExp("^" + escaped + "{" + marker.length + ",}[\\t ]*$");
    return match.test(value);
  } catch (error) {
    return false;
  }
}

function taskReqFencedLines(lines) {
  const fenced = new Set();
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = taskReqFenceMarker(lines[index]);
    if (open) {
      fenced.add(index);
      if (taskReqClosesFence(lines[index], open)) open = null;
    } else if (marker) {
      fenced.add(index);
      open = marker;
    }
  }
  return fenced;
}

function taskReqFrontmatterEnd(lines) {
  try {
    if (!lines.length || String(lines[0]).replace(/[ \t]+$/, "") !== "---") return null;
    for (let index = 1; index < lines.length; index += 1) {
      if (String(lines[index]).replace(/[ \t]+$/, "") === "---") return index;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function taskReqIsDrawerTitle(title) {
  try {
    const value = String(title || "").trim();
    return /^[A-Z0-9][A-Z0-9\t &'(),.\/-?!;]*(?::)?$/.test(value) && /[A-Z]/.test(value);
  } catch (error) {
    return false;
  }
}

function taskReqIsStructuralContainer(line) {
  try {
    const item = taskReqListItem(line);
    if (!item) return false;
    const body = item.body.trim();
    if (taskReqIsDrawerTitle(body)) return true;
    if (/^(?:⛓️\s*)?\*\*(?:DEPENDS ON|BLOCKS|SUB-PROJECTS|LINKS|LINKED FROM)(?::)?\*\*/i.test(body)) return true;
    if (body.startsWith("❌") && body.includes("CANCEL LOG")) return true;
    if (/^(?:🗓️?\s*|🛠️\s*|🥀\uFE0F?\s*)?\*\*(?:SCHEDULE|WORK|ROTTEN) LOG(?::)?\*\*$/.test(body)) return true;
    return false;
  } catch (error) {
    return false;
  }
}

function taskReqNearestParent(lines, childIndex) {
  try {
    const childIndent = taskReqIndent(lines[childIndex]);
    for (let index = childIndex - 1; index >= 0; index -= 1) {
      if (!String(lines[index] || "").trim()) continue;
      if (taskReqIndent(lines[index]) >= childIndent) continue;
      if (taskReqListItem(lines[index])) return index;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function taskReqStateFor(mark, ownerStatus) {
  if (mark === "-") return "dropped";
  if (mark === ">") return "carried";
  if (mark === "x" || mark === "X") return "met";
  if (ownerStatus === "done") return "met";
  if (ownerStatus === "cancelled") return "moot";
  return "pending";
}

function taskReqCleanText(rest) {
  try {
    const value = String(rest || "").trimEnd();
    const match = /(?:^|[ \t])\^([\p{L}\p{N}_-]+)$/u.exec(value);
    if (!match) return { text: value.trim(), anchor: null };
    const suffixStart = match.index + (match[0].startsWith(" ") || match[0].startsWith("\t") ? 1 : 0);
    return {
      text: value.slice(0, suffixStart).trimEnd(),
      anchor: match[1],
    };
  } catch (error) {
    return { text: String(rest || "").trim(), anchor: null };
  }
}

function taskReqOwnerName(line) {
  try {
    const item = taskReqListItem(line);
    const parsed = item && taskReqParseCheckbox(item.body);
    if (!parsed) return "Task";
    return parsed.rest
      .replace(/(?:^|\s)#task(?=\s|$)/g, " ")
      .replace(/\[(?:type|theme|created|priority|scheduled|due|completion|cancelled|repeat|onCompletion|id|dependsOn|fresh|refresh|keeps|unblocked)\s*::[^\]]*\]/g, " ")
      .replace(/\([^)]*::[^)]*\)/g, " ")
      .replace(/(?:^|\s)\^[\p{L}\p{N}_-]+\s*$/u, " ")
      .replace(/[ \t]+/g, " ")
      .trim() || "Task";
  } catch (error) {
    return "Task";
  }
}

// Build the subset of the RQ forest needed by the display surfaces. Rows
// retain source line numbers and the owner line so the glyph can follow the
// owner's task type. Fences, quotes, structural containers, and nested task
// boundaries follow the Rust recognizer.
function taskReqForest(contents) {
  try {
    const text = String(contents || "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const logical = lines.map((line) => {
      const item = taskReqListItem(line);
      return item ? item.body : line;
    });
    const fenced = taskReqFencedLines(logical);
    const frontmatterEnd = taskReqFrontmatterEnd(logical);
    const owners = new Map();
    const reqs = new Map();
    const rows = [];
    for (let index = 0; index < lines.length; index += 1) {
      if ((frontmatterEnd !== null && index <= frontmatterEnd) || fenced.has(index)) continue;
      const item = taskReqListItem(lines[index]);
      if (!item) continue;
      const checkbox = taskReqParseCheckbox(item.body);
      if (!checkbox) continue;
      if (taskReqCarriesGlobalFilter(checkbox.rest)) {
        owners.set(index, {
          line: index + 1,
          status: checkbox.mark === "x" || checkbox.mark === "X"
            ? "done"
            : checkbox.mark === "-"
              ? "cancelled"
              : "open",
          text: lines[index],
        });
        continue;
      }
      if (taskReqIsStructuralContainer(lines[index])) continue;
      const parentLine = taskReqNearestParent(lines, index);
      if (parentLine === null || taskReqIsStructuralContainer(lines[parentLine])) continue;
      const parentReq = reqs.get(parentLine);
      const owner = owners.get(parentLine) || (parentReq && owners.get(parentReq.ownerLine - 1));
      if (!owner) continue;
      let depth = 1;
      let state = taskReqStateFor(checkbox.mark, owner.status);
      let excludedBy = null;
      let excludedBecause = null;
      if (parentReq) {
        depth = parentReq.depth + 1;
        if (state !== "dropped" && state !== "carried") {
          if (parentReq.state === "dropped" || parentReq.state === "carried" || parentReq.state === "excluded") {
            state = "excluded";
            excludedBy = parentReq.line;
            excludedBecause = parentReq.state === "excluded" ? parentReq.excludedBecause : parentReq.state;
          }
        }
      }
      const cleaned = taskReqCleanText(checkbox.rest);
      const req = {
        line: index + 1,
        lineIndex: index,
        depth,
        parent: parentReq ? parentReq.line : null,
        owner: owner.line,
        ownerLine: owner.line,
        ownerText: owner.text,
        ownerName: taskReqOwnerName(owner.text),
        mark: checkbox.mark === " " ? "open" : checkbox.mark === "-" ? "dropped" : checkbox.mark === ">" ? "carried" : checkbox.mark === "x" || checkbox.mark === "X" ? "legacy-met" : "unknown",
        markChar: checkbox.mark,
        state,
        text: cleaned.text,
        anchor: cleaned.anchor,
        depth_exceeded: depth > TASK_REQ_MAX_DEPTH,
        excludedBy,
        excludedBecause,
        markerFrom: item.bodyFrom + item.body.indexOf("["),
        markerTo: item.bodyFrom + checkbox.markerLength,
      };
      reqs.set(index, req);
      rows.push(req);
    }
    return rows;
  } catch (error) {
    return [];
  }
}

function taskReqInfoAtLine(contents, lineIndex) {
  try {
    return taskReqForest(contents).find((row) => row.lineIndex === lineIndex) || null;
  } catch (error) {
    return null;
  }
}
