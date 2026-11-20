// Guarded imports for the Obsidian and CM6 APIs actually used.
// Reading view and the pure API stay available when editor APIs are missing;
// Live Preview registers only when every editor piece exists.
let CopyChipsPluginBase = class {};
let CopyChipsNotice = null;
let CopyChipsMarkdownRenderChild = null;
let CopyChipsSetIcon = null;
let CopyChipsEditorLivePreviewField = null;
let CopyChipsEditorInfoField = null;
let CopyChipsModal = class {
  constructor(app) {
    this.app = app;
    this.containerEl = null;
    this.modalEl = null;
    this.contentEl = null;
    this.scope = {
      register() {
        return {};
      },
      unregister() {},
    };
  }
  open() {
    try {
      this.onOpen();
    } catch (error) {
      // Fake modal open never throws.
    }
  }
  close() {
    try {
      this.onClose();
    } catch (error) {
      // Fake modal close never throws.
    }
  }
  onOpen() {}
  onClose() {}
};

try {
  const obsidian = require("obsidian");
  if (obsidian && typeof obsidian.Plugin === "function") {
    CopyChipsPluginBase = obsidian.Plugin;
  }
  if (obsidian && typeof obsidian.Notice === "function") {
    CopyChipsNotice = obsidian.Notice;
  }
  if (obsidian && typeof obsidian.MarkdownRenderChild === "function") {
    CopyChipsMarkdownRenderChild = obsidian.MarkdownRenderChild;
  }
  if (obsidian && typeof obsidian.setIcon === "function") {
    CopyChipsSetIcon = obsidian.setIcon;
  }
  if (obsidian && obsidian.editorLivePreviewField) {
    CopyChipsEditorLivePreviewField = obsidian.editorLivePreviewField;
  }
  if (obsidian && obsidian.editorInfoField) {
    CopyChipsEditorInfoField = obsidian.editorInfoField;
  }
  if (obsidian && typeof obsidian.Modal === "function") {
    CopyChipsModal = obsidian.Modal;
  }
} catch (error) {
  CopyChipsPluginBase = class {};
  CopyChipsNotice = null;
  CopyChipsMarkdownRenderChild = null;
  CopyChipsSetIcon = null;
  CopyChipsEditorLivePreviewField = null;
  CopyChipsEditorInfoField = null;
}

let CopyChipsViewPlugin = null;
let CopyChipsDecoration = null;
let CopyChipsWidgetType = null;
let CopyChipsEditorView = null;
try {
  const viewMod = require("@codemirror/view");
  CopyChipsViewPlugin = (viewMod && viewMod.ViewPlugin) || null;
  CopyChipsDecoration = (viewMod && viewMod.Decoration) || null;
  CopyChipsWidgetType = (viewMod && viewMod.WidgetType) || null;
  CopyChipsEditorView = (viewMod && viewMod.EditorView) || null;
} catch (error) {
  CopyChipsViewPlugin = null;
  CopyChipsDecoration = null;
  CopyChipsWidgetType = null;
  CopyChipsEditorView = null;
}

let CopyChipsStateEffect = null;
let CopyChipsStateField = null;
let CopyChipsRangeSetBuilder = null;
let CopyChipsPrec = null;
let CopyChipsTransaction = null;
try {
  const stateMod = require("@codemirror/state");
  CopyChipsStateEffect = (stateMod && stateMod.StateEffect) || null;
  CopyChipsStateField = (stateMod && stateMod.StateField) || null;
  CopyChipsRangeSetBuilder = (stateMod && stateMod.RangeSetBuilder) || null;
  CopyChipsPrec = (stateMod && stateMod.Prec) || null;
  CopyChipsTransaction = (stateMod && stateMod.Transaction) || null;
} catch (error) {
  CopyChipsStateEffect = null;
  CopyChipsStateField = null;
  CopyChipsRangeSetBuilder = null;
  CopyChipsPrec = null;
  CopyChipsTransaction = null;
}

let CopyChipsIsolateHistory = null;
try {
  const commandsMod = require("@codemirror/commands");
  CopyChipsIsolateHistory = (commandsMod && commandsMod.isolateHistory) || null;
} catch (error) {
  CopyChipsIsolateHistory = null;
}
if (!CopyChipsIsolateHistory) {
  try {
    const historyMod = require("@codemirror/history");
    CopyChipsIsolateHistory = (historyMod && historyMod.isolateHistory) || null;
  } catch (error) {
    CopyChipsIsolateHistory = null;
  }
}

let CopyChipsSyntaxTree = null;
try {
  const languageMod = require("@codemirror/language");
  CopyChipsSyntaxTree =
    (languageMod && languageMod.syntaxTree) || null;
} catch (error) {
  CopyChipsSyntaxTree = null;
}

function copyChipsEditorAvailable() {
  return Boolean(
    CopyChipsViewPlugin &&
      typeof CopyChipsViewPlugin.fromClass === "function" &&
      CopyChipsDecoration &&
      CopyChipsWidgetType &&
      CopyChipsRangeSetBuilder &&
      CopyChipsStateEffect &&
      CopyChipsEditorLivePreviewField &&
      CopyChipsSyntaxTree &&
      typeof CopyChipsSyntaxTree === "function",
  );
}
