// `- [` typing assist (bob-cli-on.10.1.4): the cycler's first CodeMirror
// extension. Typing a space after a list item's lone `[` expands it to
// `- [ ] `, the next `]` and space typed at that caret are absorbed, and
// Backspace right after a list-item-start `[ ] ` removes the checkbox
// atomically. The planner functions are pure; `cyclerReqTypingBuild` is the
// thin CodeMirror adapter and `registerCyclerReqTyping` wires it in.
//
// The expansion lands as its own transaction, annotated with
// `isolateHistory`, so one Undo returns exactly the bytes a plain space would
// have produced (`- [ ` or, with autopair, `- [ ]` with the caret before `]`).
// Only user input events reach the input handler: paste, templates, and
// programmatic edits never trigger it. Normal-mode Vim is untouched; Vim
// insert-mode typing and Backspace flow through the same extension.

// A list-item start ending in a lone `[` (text before the caret).
const CYCLER_REQ_TYPING_BRACKET_RE = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[$/;
// A list-item start followed by an open checkbox and its space.
const CYCLER_REQ_TYPING_OPEN_BOX_RE = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[ \] $/;
const CYCLER_REQ_TYPING_BOX_LENGTH = 4;

// Expansion plan for a typed space with `before` / `after` the line text on
// either side of the caret, or null. `after` must be empty or a lone
// auto-paired `]`, so both `autoPairBrackets` settings behave alike.
function cyclerReqTypingExpansion(before, after) {
  const left = String(before == null ? "" : before);
  const right = String(after == null ? "" : after);
  if (!CYCLER_REQ_TYPING_BRACKET_RE.test(left)) {
    return null;
  }
  if (right !== "" && right !== "]") {
    return null;
  }
  return { removeAfter: right.length };
}

// Backspace plan for the text before an empty caret, or null: delete the
// four `[ ] ` bytes and keep the list marker.
function cyclerReqTypingBackspace(before) {
  return CYCLER_REQ_TYPING_OPEN_BOX_RE.test(String(before == null ? "" : before))
    ? { deleteLength: CYCLER_REQ_TYPING_BOX_LENGTH }
    : null;
}

// Overtype absorption after an expansion. `arm` is `{pos, stage}` (the
// caret the expansion left, and whether the next absorbed key is the `]` or
// the space after it). Returns `{swallow, next}`: swallow the typed text and
// carry `next` as the new arm, or let it type (next is always null then).
function cyclerReqTypingAbsorb(arm, text, from, to) {
  const none = { swallow: false, next: null };
  if (!arm || from !== to || from !== arm.pos) {
    return none;
  }
  if (arm.stage === "bracket" && text === "]") {
    return { swallow: true, next: { pos: arm.pos, stage: "space" } };
  }
  if (arm.stage === "space" && text === " ") {
    return { swallow: true, next: null };
  }
  return none;
}

// True when the line sits in frontmatter or a fenced code block, where the
// assist never fires. Only evaluated after a cheap line prefilter matched.
function cyclerReqTypingBlockedLine(text, lineIndex) {
  const doc = taskReqDocument(text);
  const logical = doc.texts.map((line, index) => (doc.bodies[index] !== null ? doc.bodies[index] : line));
  const frontmatterEnd = taskReqFrontmatterEnd(logical);
  if (frontmatterEnd !== null && lineIndex <= frontmatterEnd) {
    return true;
  }
  return taskReqDocListFenced(doc).has(lineIndex);
}

function cyclerReqTypingLoadCodeMirror() {
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

// Builds the extension array from the loaded CodeMirror pieces, or returns
// null (skip the extension silently) when any piece is missing.
function cyclerReqTypingBuild(cm) {
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

  const setArm = cm.StateEffect.define();
  const armField = cm.StateField.define({
    create: () => null,
    update(value, transaction) {
      let next = value;
      let armed = false;
      for (const effect of transaction.effects) {
        if (effect.is(setArm)) {
          next = effect.value;
          armed = true;
        }
      }
      if (armed) {
        return next;
      }
      // Any other edit or caret move disarms; effect-only transactions keep it.
      return next && (transaction.docChanged || transaction.selection) ? null : next;
    },
  });

  const lineParts = (state, from, to) => {
    const line = state.doc.lineAt(from);
    return {
      line,
      before: state.doc.sliceString(line.from, from),
      after: state.doc.sliceString(to, line.to),
    };
  };
  const singleEmptyCaret = (state) => {
    const selection = state.selection;
    return selection && selection.ranges.length === 1 && selection.main.empty ? selection.main.head : null;
  };

  const handleInput = (view, from, to, text, insert) => {
    if (view.composing || from !== to) {
      return false;
    }
    const state = view.state;
    if (singleEmptyCaret(state) !== from) {
      return false;
    }
    const arm = state.field(armField, false);
    if (arm) {
      const absorbed = cyclerReqTypingAbsorb(arm, text, from, to);
      if (absorbed.swallow) {
        view.dispatch({ effects: [setArm.of(absorbed.next)] });
        return true;
      }
      return false;
    }
    if (text !== " ") {
      return false;
    }
    const { line, before, after } = lineParts(state, from, to);
    const plan = cyclerReqTypingExpansion(before, after);
    if (!plan || cyclerReqTypingBlockedLine(state.doc.toString(), line.number - 1)) {
      return false;
    }
    // The space lands as its own ordinary input transaction, then the
    // expansion is a second, history-isolated transaction.
    view.dispatch(
      typeof insert === "function"
        ? insert()
        : { changes: { from, to, insert: " " }, selection: { anchor: from + 1 }, userEvent: "input.type" },
    );
    const head = singleEmptyCaret(view.state);
    if (head === null) {
      return true;
    }
    view.dispatch({
      changes: { from: head, to: head + plan.removeAfter, insert: "] " },
      selection: { anchor: head + 2 },
      effects: [setArm.of({ pos: head + 2, stage: "bracket" })],
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
    const { line, before } = lineParts(state, head, head);
    const plan = cyclerReqTypingBackspace(before);
    if (!plan || cyclerReqTypingBlockedLine(state.doc.toString(), line.number - 1)) {
      return false;
    }
    view.dispatch({
      changes: { from: head - plan.deleteLength, to: head },
      selection: { anchor: head - plan.deleteLength },
      userEvent: "delete.backward",
    });
    return true;
  };

  return [
    armField,
    cm.EditorView.inputHandler.of((view, from, to, text, insert) => {
      try {
        return handleInput(view, from, to, text, insert);
      } catch (error) {
        return false;
      }
    }),
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
      ]),
    ),
  ];
}

class TaskStatusCyclerReqTypingMixin {
  registerCyclerReqTyping() {
    try {
      if (typeof this.registerEditorExtension !== "function") {
        return false;
      }
      const extension = cyclerReqTypingBuild(cyclerReqTypingLoadCodeMirror());
      if (!extension) {
        return false;
      }
      this.registerEditorExtension(extension);
      return true;
    } catch (error) {
      return false;
    }
  }
}
