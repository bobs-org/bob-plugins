// Ctrl+] note/req toggle (bob-cli-on.10.1.4): route the cycler's Ctrl+]
// through the RW twin's `taskReqToggle` on req lines and on plain list items
// that live inside a `#task` block. Everything else (list items outside any
// task block, `#task` lines, pasted checklists) keeps today's
// `getTaskCheckboxMarkerToggle` behavior. Each write is one
// `applyDocumentLineReplacement` (one undo step); a refusal shows the
// writer's message and writes nothing.

function cyclerReqToggleFirstReqNotice(scooped) {
  const count = Number(scooped) || 0;
  if (count <= 0) {
    return "◇ First requirement";
  }
  return `◇ First requirement · filed ${count} ${count === 1 ? "note" : "notes"} under NOTES`;
}

// Index where the item's description starts: past the list marker and, when
// present, the checkbox and the whitespace after it.
function cyclerReqToggleContentFrom(lineText) {
  const item = taskReqListItem(lineText);
  if (!item) {
    return 0;
  }
  const checkbox = taskReqParseCheckbox(item.body);
  if (!checkbox) {
    return item.bodyFrom;
  }
  return item.bodyFrom + item.body.length - checkbox.rest.length;
}

// Where the cursor lands after the write: the same offset into the item's
// description, clamped to the landing line.
function cyclerReqToggleLandingCh(preimage, cursorCh, landedLine) {
  const offset = Math.max(0, (Number(cursorCh) || 0) - cyclerReqToggleContentFrom(preimage));
  const landed = String(landedLine == null ? "" : landedLine);
  return Math.max(0, Math.min(landed.length, cyclerReqToggleContentFrom(landed) + offset));
}

// True when `lineIndex` is a plain list item (no checkbox, no `#task`) outside
// fences and frontmatter whose structural ancestor chain reaches a real
// `#task` line.
function cyclerReqToggleNoteInTask(text, lineIndex) {
  const doc = taskReqDocument(text);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= doc.texts.length) {
    return false;
  }
  const body = doc.bodies[lineIndex];
  if (body === null || taskReqParseCheckbox(body) !== null) {
    return false;
  }
  if (taskBlockCarriesTaskFilter(doc.texts[lineIndex], TASK_REQ_GLOBAL_FILTER)) {
    return false;
  }
  const logical = doc.texts.map((line, index) => (doc.bodies[index] !== null ? doc.bodies[index] : line));
  const frontmatterEnd = taskReqFrontmatterEnd(logical);
  if (frontmatterEnd !== null && lineIndex <= frontmatterEnd) {
    return false;
  }
  const fenced = taskReqDocListFenced(doc);
  if (fenced.has(lineIndex)) {
    return false;
  }
  const taskLines = new Set(taskReqScanIn(doc, taskReqOptions(null)).map((task) => task.lineIndex));
  if (taskLines.size === 0) {
    return false;
  }
  let cursor = lineIndex;
  for (let steps = 0; steps <= doc.texts.length; steps += 1) {
    const parent = taskReqDocParent(doc, cursor);
    if (parent === null || fenced.has(parent)) {
      return false;
    }
    if (taskLines.has(parent)) {
      return true;
    }
    cursor = parent;
  }
  return false;
}

// "req" when the line is a requirement, "note" when it is a plain list item
// in a task block, otherwise null (legacy Ctrl+]).
function cyclerReqToggleKind(text, lineIndex) {
  try {
    const value = String(text == null ? "" : text);
    if (cyclerReqInfoForText(value, lineIndex)) {
      return "req";
    }
    return cyclerReqToggleNoteInTask(value, lineIndex) ? "note" : null;
  } catch (error) {
    return null;
  }
}

class TaskStatusCyclerReqToggleMixin {
  cyclerReqToggleKind(text, lineIndex) {
    return cyclerReqToggleKind(text, lineIndex);
  }

  // One-line route for the Ctrl+] command and Vim sites: true when the
  // gesture belongs to the requirement toggle (a write or a refusal), false
  // to fall through to the legacy checkbox-marker toggle.
  cyclerReqToggleRoute(editor, checking) {
    let cursor = null;
    let text = null;
    let kind = null;
    try {
      if (!editor || typeof editor.getCursor !== "function" || typeof editor.getValue !== "function") {
        return false;
      }
      cursor = editor.getCursor();
      text = editor.getValue();
      if (!cursor || !Number.isInteger(cursor.line) || typeof text !== "string") {
        return false;
      }
      kind = cyclerReqToggleKind(text, cursor.line);
    } catch (error) {
      return false;
    }
    if (!kind) {
      return false;
    }
    if (checking) {
      return true;
    }
    try {
      this.cyclerReqToggleApply(editor, text, cursor);
    } catch (error) {
      console.error("Could not toggle the requirement", error);
    }
    return true;
  }

  cyclerReqToggleApply(editor, text, cursor) {
    const lineIndex = cursor.line;
    const preimage = text.split("\n")[lineIndex];
    const result = taskReqToggle(text, { lineIndex, preimage });
    if (!result || result.ok === false) {
      new Notice(String((result && result.message) || CYCLER_REQ_LANE_COPY));
      return false;
    }
    const landedLine = result.updated.split("\n")[result.lineIndex];
    const ch = cyclerReqToggleLandingCh(preimage, cursor.ch, landedLine);
    if (!this.cyclerReqApplyWholeNote(editor, result.updated, result.lineIndex, ch)) {
      return false;
    }
    if (result.firstReq) {
      new Notice(cyclerReqToggleFirstReqNotice(result.scooped));
    }
    return true;
  }
}
