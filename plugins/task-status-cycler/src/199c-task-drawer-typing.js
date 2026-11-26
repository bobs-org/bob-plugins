// Drawer marker typing (bob-cli-ph.7.1.3): scoped `*` expansion, overtype,
// atomic Backspace, smart Enter, and Toggle Drawer beside the requirement
// typing assist. Stable bundle marker: bob-task-drawer-typing-v1
//
// Eligibility is an empty non-checkbox bullet directly under a real task,
// outside frontmatter, fences, quotes, and another note/drawer/requirement.
// The position is decided through the shared contextual reader with a
// hypothetical valid header (`**x**`), so no content is required before
// marker entry. Typing `*` produces `- ****` with the caret in the middle;
// one Undo returns the literal `- *` so the user can continue an italic
// note. The handler dispatches its own plain `*` and never chains Obsidian's
// `insert`, so `autoPairMarkdown` on and off behave identically.
//
// Vim insert-mode typing flows through the same CodeMirror adapter. Vim
// normal-mode bindings are preserved: normal-mode `*` never reaches the
// input handler, and the Backspace/Enter keymaps only fire at the exact
// drawer caret shapes a normal-mode cursor cannot occupy.

const DRAWER_TYPING_EMPTY_BULLET_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+$/;
const DRAWER_TYPING_AFTER_SPACES_RE = /^[ \t]*$/;
const DRAWER_TYPING_TOGGLE_ID = "toggle-task-drawer";

const DRAWER_TOGGLE_CHECKBOX_COPY = "Toggle Drawer needs a plain bullet · checkboxes stay requirements and tasks";
const DRAWER_TOGGLE_MANAGED_COPY = "Managed line · not a drawer";
const DRAWER_TOGGLE_PLAIN_COPY = "Toggle Drawer needs a plain bullet under the task";
const DRAWER_TOGGLE_DIRECT_COPY = "Toggle Drawer needs a direct child of the task";
const DRAWER_TOGGLE_TASK_COPY = "Toggle Drawer needs a direct child bullet under a task";

// Cheap line-shape check for the pre-insert `*` position: `before` is the
// line start through the caret, `after` the caret through the line end.
function drawerTypingEmptyPrefix(before, after) {
  if (!DRAWER_TYPING_EMPTY_BULLET_RE.test(String(before == null ? "" : before))) {
    return false;
  }
  return DRAWER_TYPING_AFTER_SPACES_RE.test(String(after == null ? "" : after));
}

// True when the line sits in frontmatter or a fenced code block, where the
// drawer assist never fires. Mirrors the requirement typing guard.
function drawerTypingBlockedLine(text, lineIndex) {
  const doc = taskReqDocument(text);
  const logical = doc.texts.map((line, index) => (doc.bodies[index] !== null ? doc.bodies[index] : line));
  const frontmatterEnd = taskReqFrontmatterEnd(logical);
  if (frontmatterEnd !== null && lineIndex <= frontmatterEnd) {
    return true;
  }
  return taskReqDocListFenced(doc).has(lineIndex);
}

// The owning task for a direct-child bullet: the structural parent must be
// a real `#task` line whose block contains the line. Returns
// `{doc, task}` or null.
function drawerTypingOwnerTask(contents, lineIndex) {
  try {
    const text = String(contents == null ? "" : contents);
    const doc = taskReqDocument(text);
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= doc.texts.length) {
      return null;
    }
    if (doc.bodies[lineIndex] === null) {
      return null;
    }
    const parent = taskReqDocParent(doc, lineIndex);
    if (parent === null) {
      return null;
    }
    const tasks = taskReqScanIn(doc, taskReqOptions(null));
    const task = tasks.find((entry) => entry.lineIndex === parent) || null;
    if (!task) {
      return null;
    }
    if (lineIndex > taskReqBlockLastLine(doc, task)) {
      return null;
    }
    return { doc, task };
  } catch (error) {
    return null;
  }
}

// Hypothetical header check: would `**x**` at this empty bullet be a real
// drawer header? Rebuilds the note with the hypothetical line so the shared
// contextual reader decides fences, managed lines, reserved keys, and
// structural containers. Returns the owner task or null.
function drawerTypingHypotheticalTask(contents, lineIndex) {
  try {
    const text = String(contents == null ? "" : contents);
    const owned = drawerTypingOwnerTask(text, lineIndex);
    if (!owned) {
      return null;
    }
    const lines = text.split("\n");
    const item = taskReqListItem(lines[lineIndex] || "");
    if (!item) {
      return null;
    }
    const prefix = (lines[lineIndex] || "").slice(0, item.bodyFrom);
    const hypothetical = lines.slice();
    hypothetical[lineIndex] = `${prefix}**x**`;
    const hypotheticalText = hypothetical.join("\n");
    const hypotheticalDoc = taskReqDocument(hypotheticalText);
    const tasks = taskReqScanIn(hypotheticalDoc, taskReqOptions(null));
    const task = tasks.find((entry) => entry.lineIndex === owned.task.lineIndex) || null;
    if (!task) {
      return null;
    }
    const header = recognize_drawer_header(hypotheticalText, task, lineIndex);
    return header ? task : null;
  } catch (error) {
    return null;
  }
}

// Full eligibility for star expansion at an empty bullet.
function drawerTypingEligible(contents, lineIndex) {
  try {
    const text = String(contents == null ? "" : contents);
    const lines = text.split("\n");
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return false;
    }
    if (drawerTypingBlockedLine(text, lineIndex)) {
      return false;
    }
    const item = taskReqListItem(lines[lineIndex] || "");
    if (!item) {
      return false;
    }
    // Empty means no checkbox and no text: the body is blank.
    if (taskReqParseCheckbox(item.body) !== null || !taskReqIsBlank(item.body)) {
      return false;
    }
    return drawerTypingHypotheticalTask(text, lineIndex) !== null;
  } catch (error) {
    return false;
  }
}

// Cheap expansion shape for the typed `*`: empty bullet before the caret,
// only spaces after it. The adapter also requires full eligibility.
function drawerTypingExpansion(before, after) {
  if (!drawerTypingEmptyPrefix(before, after)) {
    return null;
  }
  return { secondInsert: "***" };
}

// Full overtype eligibility: the line is a recognized drawer header and the
// caret sits immediately before the closing `**`. Typing one `*` steps over
// both stars with no document change.
function drawerTypingOvertypePlan(contents, lineIndex, caretCh) {
  try {
    const text = String(contents == null ? "" : contents);
    const lines = text.split("\n");
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }
    if (!Number.isInteger(caretCh) || caretCh < 0) {
      return null;
    }
    const line = lines[lineIndex] || "";
    if (caretCh > line.length) {
      return null;
    }
    if (drawerTypingBlockedLine(text, lineIndex)) {
      return null;
    }
    const owned = drawerTypingOwnerTask(text, lineIndex);
    if (!owned) {
      return null;
    }
    const header = recognize_drawer_header(text, owned.task, lineIndex);
    if (!header) {
      return null;
    }
    const before = line.slice(0, caretCh);
    const after = line.slice(caretCh);
    if (!after.startsWith("**")) {
      return null;
    }
    if (!before.endsWith(header.title)) {
      return null;
    }
    // The caret must be exactly at the title end: the prefix plus `**`
    // plus the title.
    const item = taskReqListItem(line);
    if (!item) {
      return null;
    }
    const expectedBefore = line.slice(0, item.bodyFrom) + "**" + header.title;
    if (before !== expectedBefore) {
      return null;
    }
    return { advance: 2 };
  } catch (error) {
    return null;
  }
}

// Full atomic-Backspace eligibility: an empty `- ****` drawer with the caret
// in the middle. Deletes all four stars and keeps the empty bullet.
function drawerTypingBackspacePlan(contents, lineIndex, caretCh) {
  try {
    const text = String(contents == null ? "" : contents);
    const lines = text.split("\n");
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }
    if (!Number.isInteger(caretCh) || caretCh < 0) {
      return null;
    }
    const line = lines[lineIndex] || "";
    if (caretCh > line.length) {
      return null;
    }
    const before = line.slice(0, caretCh);
    const after = line.slice(caretCh);
    if (!before.endsWith("**") || !after.startsWith("**")) {
      return null;
    }
    const prefix = before.slice(0, -2);
    const trailing = after.slice(2);
    if (!DRAWER_TYPING_EMPTY_BULLET_RE.test(prefix)) {
      return null;
    }
    if (!DRAWER_TYPING_AFTER_SPACES_RE.test(trailing)) {
      return null;
    }
    if (drawerTypingBlockedLine(text, lineIndex)) {
      return null;
    }
    // The empty drawer must sit directly under a real task.
    if (!drawerTypingOwnerTask(text, lineIndex)) {
      return null;
    }
    return { deleteBefore: 2, deleteAfter: 2 };
  } catch (error) {
    return null;
  }
}

// Smart-Enter eligibility: the caret sits at the end of a valid title,
// immediately before the closing `**` at the end of the line. Returns the
// nested note prefix to insert after stepping over the delimiters.
function drawerTypingEnterPlan(contents, lineIndex, caretCh) {
  try {
    const text = String(contents == null ? "" : contents);
    const lines = text.split("\n");
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }
    if (!Number.isInteger(caretCh) || caretCh < 0) {
      return null;
    }
    const line = lines[lineIndex] || "";
    if (caretCh > line.length) {
      return null;
    }
    const after = line.slice(caretCh);
    if (after !== "**") {
      return null;
    }
    if (drawerTypingBlockedLine(text, lineIndex)) {
      return null;
    }
    const owned = drawerTypingOwnerTask(text, lineIndex);
    if (!owned) {
      return null;
    }
    const header = recognize_drawer_header(text, owned.task, lineIndex);
    if (!header) {
      return null;
    }
    const before = line.slice(0, caretCh);
    const item = taskReqListItem(line);
    if (!item) {
      return null;
    }
    if (before !== line.slice(0, item.bodyFrom) + "**" + header.title) {
      return null;
    }
    const indent = line.slice(0, item.indent);
    const markerMatch = /^(?:[-*+]|\d+[.)])/.exec(line.slice(item.indent));
    let marker = "-";
    if (markerMatch) {
      const raw = markerMatch[0];
      marker = /^\d/.test(raw) ? "-" : raw;
    }
    return { nestedPrefix: `${indent}  ${marker} ` };
  } catch (error) {
    return null;
  }
}

// Where the cursor lands after a toggle: the same offset into the title,
// clamped to the landed line.
function drawerToggleLandingCh(prefixLength, preimageTitle, cursorCh, landedLine, landedTitle) {
  const offset = Math.max(0, Math.min(preimageTitle.length, (Number(cursorCh) || 0) - prefixLength));
  const start = landedLine.indexOf(landedTitle);
  const base = start === -1 ? prefixLength : start;
  return Math.max(0, Math.min(landedLine.length, base + offset));
}

// Toggle Drawer planner: wraps an eligible direct-child bullet as
// `- **Title**` or unwraps a drawer header to its plain title. Descendants
// are untouched; only the header line is rewritten. Returns
// `{ok:true, updated, lineIndex, cursorCh, wrapped, title}` or
// `{ok:false, message}` with no mutation.
function planDrawerToggle(contents, lineIndex, cursorCh) {
  try {
    const text = String(contents == null ? "" : contents);
    const lines = text.split("\n");
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return { ok: false, message: DRAWER_TOGGLE_TASK_COPY };
    }
    if (drawerTypingBlockedLine(text, lineIndex)) {
      return { ok: false, message: DRAWER_TOGGLE_TASK_COPY };
    }
    const line = lines[lineIndex] || "";
    const item = taskReqListItem(line);
    if (!item) {
      return { ok: false, message: DRAWER_TOGGLE_TASK_COPY };
    }
    if (taskReqParseCheckbox(item.body) !== null || taskBlockCarriesTaskFilter(line)) {
      return { ok: false, message: DRAWER_TOGGLE_CHECKBOX_COPY };
    }
    const owned = drawerTypingOwnerTask(text, lineIndex);
    if (!owned) {
      return { ok: false, message: DRAWER_TOGGLE_DIRECT_COPY };
    }
    const header = recognize_drawer_header(text, owned.task, lineIndex);
    if (header) {
      const prefix = line.slice(0, item.bodyFrom);
      const landed = prefix + header.title;
      const next = lines.slice();
      next[lineIndex] = landed;
      const titleStart = item.bodyFrom + 2;
      const ch = drawerToggleLandingCh(titleStart, header.title, cursorCh, landed, header.title);
      return { ok: true, updated: next.join("\n"), lineIndex, cursorCh: ch, wrapped: false, title: header.title };
    }
    // Not a drawer header: refuse managed lines before wrapping.
    if (
      taskReqIsSubprojectsLine(line) ||
      taskReqIsManagedLinkLine(line) ||
      taskReqIsCancelLog(line) ||
      taskReqManagedLogKind(line) !== null
    ) {
      return { ok: false, message: DRAWER_TOGGLE_MANAGED_COPY };
    }
    const title = taskReqTrim(item.body);
    if (!title) {
      return { ok: false, message: DRAWER_TOGGLE_PLAIN_COPY };
    }
    const refusal = drawer_title_refusal(title);
    if (refusal) {
      if (refusal === "reserved") {
        return { ok: false, message: `“${title}” is reserved · not a drawer title` };
      }
      return { ok: false, message: `“${title}” cannot be a drawer title` };
    }
    // A plain bullet that merely looks bold but is not a header (for
    // example nested bold notes) is a deeper position, never a wrap.
    if (item.body.trim().startsWith("**")) {
      return { ok: false, message: DRAWER_TOGGLE_DIRECT_COPY };
    }
    const prefix = line.slice(0, item.bodyFrom);
    const landed = `${prefix}**${title}**`;
    const next = lines.slice();
    next[lineIndex] = landed;
    const ch = drawerToggleLandingCh(item.bodyFrom, title, cursorCh, landed, title);
    return { ok: true, updated: next.join("\n"), lineIndex, cursorCh: ch, wrapped: true, title };
  } catch (error) {
    return { ok: false, message: DRAWER_TOGGLE_TASK_COPY };
  }
}

function drawerTypingLoadCodeMirror() {
  const cm = {};
  try {
    const viewMod = require("@codemirror/view");
    cm.EditorView = (viewMod && viewMod.EditorView) || null;
    cm.keymap = (viewMod && viewMod.keymap) || null;
  } catch (error) {}
  try {
    const stateMod = require("@codemirror/state");
    cm.StateField = (stateMod && stateMod.StateField) || null;
    cm.StateEffect = (stateMod && stateMod.StateEffect) || null;
    cm.Prec = (stateMod && stateMod.Prec) || null;
  } catch (error) {}
  let isolateHistory = null;
  try {
    const commandsMod = require("@codemirror/commands");
    isolateHistory = (commandsMod && commandsMod.isolateHistory) || null;
  } catch (error) {}
  if (!isolateHistory) {
    try {
      const historyMod = require("@codemirror/history");
      isolateHistory = (historyMod && historyMod.isolateHistory) || null;
    } catch (error) {}
  }
  cm.isolateHistory = isolateHistory;
  return cm;
}

// Builds the extension array from the loaded CodeMirror pieces, or null.
function drawerTypingBuild(cm) {
  if (
    !cm ||
    !cm.EditorView ||
    !cm.EditorView.inputHandler ||
    !cm.keymap ||
    !cm.StateField ||
    !cm.StateEffect ||
    !cm.Prec ||
    typeof cm.Prec.high !== "function" ||
    !cm.isolateHistory
  ) {
    return null;
  }
  // Real Obsidian `autoPairMarkdown` is another inputHandler. Without
  // highest precedence it wins, types `- **`, and the assist never runs
  // (reproduced 2026-11-25 on Obsidian 1.15.1).
  const inputPrec = typeof cm.Prec.highest === "function" ? cm.Prec.highest : cm.Prec.high;

  const lineParts = (state, from, to) => {
    const line = state.doc.lineAt(from);
    return {
      line,
      lineIndex: line.number - 1,
      before: state.doc.sliceString(line.from, from),
      after: state.doc.sliceString(to, line.to),
      caretCh: from - line.from,
    };
  };
  const singleEmptyCaret = (state) => {
    const selection = state.selection;
    return selection && selection.ranges.length === 1 && selection.main.empty ? selection.main.head : null;
  };

  const handleInput = (view, from, to, text, insert) => {
    if (view.composing || from !== to || text !== "*") {
      return false;
    }
    const state = view.state;
    if (singleEmptyCaret(state) !== from) {
      return false;
    }
    let parts = null;
    try {
      parts = lineParts(state, from, to);
    } catch (error) {
      return false;
    }
    const fullText = state.doc.toString();
    // Overtype at the end of a valid title comes first: the caret sits
    // before the closing `**` on a recognized header.
    try {
      if (drawerTypingOvertypePlan(fullText, parts.lineIndex, parts.caretCh)) {
        view.dispatch({ selection: { anchor: from + 2 }, userEvent: "input.type" });
        return true;
      }
    } catch (error) {}
    // Expansion at an eligible empty bullet.
    try {
      if (!drawerTypingExpansion(parts.before, parts.after)) {
        return false;
      }
      if (!drawerTypingEligible(fullText, parts.lineIndex)) {
        return false;
      }
    } catch (error) {
      return false;
    }
    // The star lands as its own ordinary transaction, then the completion
    // is a second, history-isolated transaction. Undo returns to `- *`.
    // The chained `insert` is intentionally unused: dispatching a plain
    // star keeps `autoPairMarkdown` on and off identical, so no paired
    // delimiters can duplicate.
    void insert;
    view.dispatch({
      changes: { from, to, insert: "*" },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
    });
    const head = singleEmptyCaret(view.state);
    if (head === null) {
      return true;
    }
    view.dispatch({
      changes: { from: head, to: head, insert: "***" },
      selection: { anchor: head + 1 },
      annotations: [cm.isolateHistory.of("full")],
      userEvent: "input.type",
    });
    return true;
  };

  const handleBackspace = (view) => {
    const state = view.state;
    const head = singleEmptyCaret(state);
    if (head === null) {
      return false;
    }
    let parts = null;
    try {
      parts = lineParts(state, head, head);
    } catch (error) {
      return false;
    }
    let plan = null;
    try {
      plan = drawerTypingBackspacePlan(state.doc.toString(), parts.lineIndex, parts.caretCh);
    } catch (error) {
      return false;
    }
    if (!plan) {
      return false;
    }
    view.dispatch({
      changes: { from: head - plan.deleteBefore, to: head + plan.deleteAfter },
      selection: { anchor: head - plan.deleteBefore },
      userEvent: "delete.backward",
    });
    return true;
  };

  const handleEnter = (view) => {
    const state = view.state;
    const head = singleEmptyCaret(state);
    if (head === null) {
      return false;
    }
    let parts = null;
    try {
      parts = lineParts(state, head, head);
    } catch (error) {
      return false;
    }
    let plan = null;
    try {
      plan = drawerTypingEnterPlan(state.doc.toString(), parts.lineIndex, parts.caretCh);
    } catch (error) {
      return false;
    }
    if (!plan) {
      return false;
    }
    view.dispatch({
      changes: { from: head + 2, to: head + 2, insert: `\n${plan.nestedPrefix}` },
      selection: { anchor: head + 2 + 1 + plan.nestedPrefix.length },
      userEvent: "input.type",
    });
    return true;
  };

  return [
    inputPrec(
      cm.EditorView.inputHandler.of((view, from, to, text, insert) => {
        try {
          return handleInput(view, from, to, text, insert);
        } catch (error) {
          return false;
        }
      }),
    ),
    cm.Prec.high(
      cm.keymap.of([
        {
          key: "Backspace",
          run: (view) => {
            try {
              return handleBackspace(view);
            } catch (error) {
              return false;
            }
          },
        },
        {
          key: "Enter",
          run: (view) => {
            try {
              return handleEnter(view);
            } catch (error) {
              return false;
            }
          },
        },
      ]),
    ),
  ];
}

class TaskStatusCyclerDrawerTypingMixin {
  registerCyclerDrawerTyping() {
    try {
      if (typeof this.registerEditorExtension !== "function") {
        return false;
      }
      const extension = drawerTypingBuild(drawerTypingLoadCodeMirror());
      if (!extension) {
        return false;
      }
      this.registerEditorExtension(extension);
      return true;
    } catch (error) {
      return false;
    }
  }

  cyclerDrawerToggleKind(text, lineIndex) {
    try {
      const value = String(text == null ? "" : text);
      const lines = value.split("\n");
      if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
        return null;
      }
      const owned = drawerTypingOwnerTask(value, lineIndex);
      if (!owned) {
        // Nested list items inside a task block are still Toggle Drawer
        // positions: refuse with a notice instead of falling through.
        const nested = taskReqListItem(lines[lineIndex] || "");
        if (!nested) {
          return null;
        }
        try {
          const doc = taskReqDocument(value);
          const tasks = taskReqScanIn(doc, taskReqOptions(null));
          for (const task of tasks) {
            if (lineIndex > task.lineIndex && lineIndex <= taskReqBlockLastLine(doc, task)) {
              return "deeper";
            }
          }
        } catch (error) {
          return null;
        }
        return null;
      }
      if (recognize_drawer_header(value, owned.task, lineIndex)) {
        return "drawer";
      }
      const item = taskReqListItem(lines[lineIndex] || "");
      if (!item) {
        return null;
      }
      // Checkbox and plain direct children both belong to the Toggle
      // Drawer gesture: the planner writes the eligible ones and refuses
      // the rest with an actionable notice.
      if (taskReqParseCheckbox(item.body) !== null) {
        return "checkbox";
      }
      return "note";
    } catch (error) {
      return null;
    }
  }

  cyclerDrawerToggleRoute(editor, checking) {
    let cursor = null;
    let text = null;
    try {
      if (!editor || typeof editor.getCursor !== "function" || typeof editor.getValue !== "function") {
        return false;
      }
      cursor = editor.getCursor();
      text = editor.getValue();
      if (!cursor || !Number.isInteger(cursor.line) || typeof text !== "string") {
        return false;
      }
    } catch (error) {
      return false;
    }
    let plan = null;
    try {
      plan = planDrawerToggle(text, cursor.line, cursor.ch);
    } catch (error) {
      return false;
    }
    if (!plan || plan.ok === false) {
      // A refusal still claims the gesture when the cursor sits on a
      // drawer-shaped position, so the legacy checkbox toggle never runs
      // there. Plain ineligible lines fall through.
      const kind = (() => {
        try {
          return this.cyclerDrawerToggleKind(text, cursor.line);
        } catch (error) {
          return null;
        }
      })();
      if (!kind) {
        return false;
      }
      if (checking) {
        return true;
      }
      try {
        new Notice(String((plan && plan.message) || DRAWER_TOGGLE_TASK_COPY));
      } catch (error) {}
      return true;
    }
    if (checking) {
      return true;
    }
    try {
      this.cyclerDrawerToggleApply(editor, plan);
    } catch (error) {
      console.error("Could not toggle the drawer", error);
    }
    return true;
  }

  cyclerDrawerToggleApply(editor, plan) {
    if (!plan || plan.ok !== true) {
      return false;
    }
    if (typeof this.cyclerReqApplyWholeNote !== "function") {
      return false;
    }
    return this.cyclerReqApplyWholeNote(editor, plan.updated, plan.lineIndex, plan.cursorCh);
  }
}
