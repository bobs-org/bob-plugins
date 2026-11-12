const { Plugin } = require("obsidian");
const { StateEffect, StateField } = require("@codemirror/state");
const { Decoration, EditorView, ViewPlugin } = require("@codemirror/view");

// Briefly highlight exactly the text a Vim yank copies, then clear it. The
// wrapper runs after Obsidian's patched yank, so register contents, clipboard
// delivery, the cursor position, and the ">2 lines" notice behave exactly as
// with the plugin disabled. Any uncertainty means no flash, never a guess.
const FLASH_MS = 200;
const YANK_FLASH_CLASS = "bob-yank-flash";
const YANK_FLASH_LINE_CLASS = "bob-yank-flash-line";
const PUSH_TEXT_MARKER = "__bobVimYankFlashWrapped";

// The live selection text, built exactly as the flash check compares it:
// every range sliced and joined with "\n" (blockwise rows included).
function selectionText(state, ranges) {
  return ranges.map((range) => state.sliceDoc(range.from, range.to)).join("\n");
}

// Line starts covering [from, to). A `to` exactly on a line start belongs to
// the previous line (`yy` mid-document includes the trailing newline). An
// empty range decorates the line it sits on (a blank last line at end of
// document has nothing else to show).
function lineStartsForRange(doc, from, to) {
  if (!(to > from)) {
    return [doc.lineAt(from).from];
  }
  const first = doc.lineAt(from);
  let last = doc.lineAt(to);
  if (to === last.from) {
    last = doc.lineAt(to - 1);
  }
  const starts = [];
  let line = first;
  for (;;) {
    starts.push(line.from);
    if (line.from === last.from) {
      return starts;
    }
    line = doc.lineAt(line.to + 1);
  }
}

function lineRangeBounds(doc, from, to) {
  const first = doc.lineAt(from);
  if (!(to > from)) {
    return { from: first.from, to: first.from };
  }
  let last = doc.lineAt(to);
  if (to === last.from) {
    last = doc.lineAt(to - 1);
  }
  return { from: first.from, to: last.from };
}

function normalizedVisibleRanges(visibleRanges) {
  if (!Array.isArray(visibleRanges) || visibleRanges.length === 0) {
    return [];
  }
  const sorted = visibleRanges
    .filter((range) => range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to >= range.from)
    .map((range) => ({ from: range.from, to: range.to }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function visibleLineStarts(doc, visibleRanges) {
  const starts = new Set();
  for (const range of visibleRanges) {
    const bounds = lineRangeBounds(doc, range.from, range.to);
    let line = doc.lineAt(bounds.from);
    for (;;) {
      starts.add(line.from);
      if (line.from >= bounds.to || line.to >= doc.length) {
        break;
      }
      line = doc.lineAt(line.to + 1);
    }
  }
  return Array.from(starts).sort((left, right) => left - right);
}

// Decorations for one flash: whole lines for a linewise yank (blank lines
// included), one mark per visible non-empty range otherwise. Empty or
// unavailable viewports never broaden paint. Linewise work is bounded by the
// visible rows, even when the captured yank covers a very large document.
function buildFlashDecorations(doc, flash, visibleRanges) {
  const out = [];
  const visible = normalizedVisibleRanges(visibleRanges);
  if (!flash || visible.length === 0) {
    return Decoration.none;
  }
  if (flash.linewise) {
    const covered = flash.ranges.map((range) => lineRangeBounds(doc, range.from, range.to));
    const seen = new Set();
    for (const lineFrom of visibleLineStarts(doc, visible)) {
      if (covered.some((bounds) => bounds.from <= lineFrom && lineFrom <= bounds.to)) {
        if (seen.has(lineFrom)) {
          continue;
        }
        seen.add(lineFrom);
        out.push(
          Decoration.line({ class: YANK_FLASH_LINE_CLASS }).range(lineFrom),
        );
      }
    }
  } else {
    for (const range of flash.ranges) {
      if (!(range.to > range.from)) {
        continue;
      }
      for (const viewport of visible) {
        const from = Math.max(range.from, viewport.from);
        const to = Math.min(range.to, viewport.to);
        if (to > from) {
          out.push(Decoration.mark({ class: YANK_FLASH_CLASS }).range(from, to));
        }
      }
    }
  }
  return Decoration.set(out, true);
}

const setFlashEffect = StateEffect.define();

// A clear applies only when its id matches the current flash: the CM6
// version of a generation counter, so a stale timer never clears a newer
// flash. Any document change drops the flash outright.
function updateFlashState(current, tr) {
  if (tr && tr.docChanged) {
    return null;
  }
  let next = current;
  const effects = (tr && tr.effects) || [];
  for (const effect of effects) {
    if (effect && typeof effect.is === "function" && effect.is(setFlashEffect)) {
      const value = effect.value;
      if (value && value.clear) {
        if (next && value.id === next.id) {
          next = null;
        }
      } else if (value) {
        next = value;
      }
    }
  }
  return next;
}

const yankFlashField = StateField.define({
  create() {
    return null;
  },
  update: updateFlashState,
});

function buildDecorationsForView(view) {
  const flash = view.state.field(yankFlashField);
  if (!flash) {
    return Decoration.none;
  }
  return buildFlashDecorations(view.state.doc, flash, view.visibleRanges);
}

const YankFlashViewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorationsForView(view);
    }
    update(update) {
      if (update.state.field(yankFlashField)) {
        this.decorations = buildDecorationsForView(update.view);
      } else if (update.startState.field(yankFlashField)) {
        this.decorations = buildDecorationsForView(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

// Obsidian's Vim adapter behind `window.CodeMirrorAdapter`. Missing (Vim off,
// adapter replaced) means no hook and no flash, never an error.
function getRegisterController() {
  try {
    const scope = typeof window === "undefined" ? null : window;
    const adapter = scope && scope.CodeMirrorAdapter;
    const vim = adapter && adapter.Vim;
    if (!vim || typeof vim.getRegisterController !== "function") {
      return null;
    }
    const controller = vim.getRegisterController.call(vim);
    if (!controller || typeof controller.pushText !== "function") {
      return null;
    }
    return controller;
  } catch (error) {
    return null;
  }
}

// The focused editor behind the keypress. `activeDocument` keeps pop-out
// windows working; ex commands still resolve because the Vim prompt panel
// sits inside the editor DOM.
function findEditorView() {
  try {
    const scope = typeof window === "undefined" ? null : window;
    const doc =
      (scope && scope.activeDocument) ||
      (typeof document === "undefined" ? null : document);
    const active = doc && doc.activeElement;
    const editorEl =
      active && typeof active.closest === "function"
        ? active.closest(".cm-editor")
        : null;
    if (!editorEl) {
      return null;
    }
    const view = EditorView.findFromDOM(editorEl);
    return view || null;
  } catch (error) {
    return null;
  }
}

// Wrap one register controller. Each plugin load keeps at most one active
// wrapper per controller identity: an identity this load already hooked is
// skipped even when another plugin has since wrapped over ours. Returns true
// only when this call installed the wrapper.
function hookRegisterController(controller, plugin) {
  if (!controller || typeof controller.pushText !== "function") {
    return false;
  }
  const records = plugin._yankHookRecords;
  if (records.some((record) => record.rc === controller)) {
    return false;
  }
  const original = controller.pushText;
  const hadOwn = Object.prototype.hasOwnProperty.call(controller, "pushText");
  function wrappedPushText(...args) {
    const result = original.apply(this, args);
    try {
      if (plugin._yankFlashActive && args[1] === "yank" && args[0] !== "_") {
        plugin._flashYankRange(args[2], args[3], args[4]);
      }
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.debug === "function") {
        console.debug("bob-vim-yank-flash: flash skipped");
      }
    }
    return result;
  }
  wrappedPushText[PUSH_TEXT_MARKER] = true;
  controller.pushText = wrappedPushText;
  records.push({ rc: controller, wrapped: wrappedPushText, original, hadOwn });
  return true;
}

// Restore every controller this load wrapped, but only where our wrapper is
// still the top frame. A wrapper someone else wrapped over stays inert inside
// their chain (the plugin is inactive, so it never flashes) and the outer
// chain still reaches the original. A prototype method is restored by
// `delete`, leaving no own property behind.
function unhookRegisterControllers(plugin) {
  const records = plugin._yankHookRecords.splice(0);
  for (const record of records) {
    try {
      if (record.rc.pushText === record.wrapped) {
        if (record.hadOwn) {
          record.rc.pushText = record.original;
        } else {
          delete record.rc.pushText;
        }
      }
    } catch (error) {
      // Leave the controller alone rather than break the yank path.
    }
  }
}

class BobVimYankFlashPlugin extends Plugin {
  onload() {
    this._yankFlashActive = false;
    this._yankFlashSeq = 0;
    this._yankHookRecords = [];
    this.registerEditorExtension([yankFlashField, YankFlashViewPlugin]);
    this._yankFlashActive = true;
    this._installYankHook();
    // The Vim adapter can be replaced on a vimrc reload, and Vim mode can be
    // turned on after load, so every layout and leaf change re-checks.
    this.app.workspace.onLayoutReady(() => {
      this._installYankHook();
    });
    const leafRef = this.app.workspace.on("active-leaf-change", () => {
      this._installYankHook();
    });
    this.registerEvent(leafRef);
  }

  onunload() {
    this._yankFlashActive = false;
    unhookRegisterControllers(this);
  }

  _installYankHook() {
    const controller = getRegisterController();
    if (!controller) {
      return false;
    }
    return hookRegisterController(controller, this);
  }

  // Flash the live selection when it exactly equals the pushed text. The
  // pushed text arrives before `pushText` appends its linewise "\n", so it
  // equals the raw selection text. Never searches the document, never keeps
  // the text: only {id, linewise, ranges} reaches the field.
  _flashYankRange(text, linewise, blockwise) {
    void blockwise;
    const view = findEditorView();
    if (!view || !view.state || typeof view.dispatch !== "function") {
      return false;
    }
    const state = view.state;
    const selection = state.selection && state.selection.ranges;
    if (!Array.isArray(selection) || selection.length === 0) {
      return false;
    }
    if (selectionText(state, selection) !== String(text)) {
      return false;
    }
    let ranges = selection.map((range) => ({ from: range.from, to: range.to }));
    if (!linewise) {
      ranges = ranges.filter((range) => range.to > range.from);
      if (ranges.length === 0) {
        return false;
      }
    }
    const flash = {
      id: (this._yankFlashSeq += 1),
      linewise: Boolean(linewise),
      ranges,
    };
    try {
      view.dispatch({ effects: [setFlashEffect.of(flash)] });
    } catch (error) {
      return false;
    }
    const dom = view.dom;
    const viewWindow = dom && dom.ownerDocument && dom.ownerDocument.defaultView;
    if (!viewWindow || typeof viewWindow.setTimeout !== "function") {
      return true;
    }
    viewWindow.setTimeout(() => {
      try {
        if (view.destroyed === true || typeof view.dispatch !== "function") {
          return;
        }
        view.dispatch({
          effects: [setFlashEffect.of({ id: flash.id, clear: true })],
        });
      } catch (error) {
        // A failed clear must never break the editor.
      }
    }, FLASH_MS);
    return true;
  }
}

BobVimYankFlashPlugin.__test = {
  FLASH_MS,
  YANK_FLASH_CLASS,
  YANK_FLASH_LINE_CLASS,
  PUSH_TEXT_MARKER,
  setFlashEffect,
  yankFlashField,
  selectionText,
  lineStartsForRange,
  lineRangeBounds,
  normalizedVisibleRanges,
  visibleLineStarts,
  buildFlashDecorations,
  updateFlashState,
  YankFlashViewPlugin,
  getRegisterController,
  findEditorView,
  hookRegisterController,
  unhookRegisterControllers,
};

module.exports = BobVimYankFlashPlugin;
