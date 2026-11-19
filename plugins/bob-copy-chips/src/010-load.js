// Guarded imports for the Obsidian and CM6 APIs actually used.
// Reading view and the pure API stay available when editor APIs are missing;
// Live Preview registers only when every editor piece exists.
let CopyChipsPluginBase = class {};
let CopyChipsNotice = null;
let CopyChipsMarkdownRenderChild = null;
let CopyChipsSetIcon = null;
let CopyChipsEditorLivePreviewField = null;
let CopyChipsEditorInfoField = null;

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
try {
  const stateMod = require("@codemirror/state");
  CopyChipsStateEffect = (stateMod && stateMod.StateEffect) || null;
  CopyChipsStateField = (stateMod && stateMod.StateField) || null;
  CopyChipsRangeSetBuilder = (stateMod && stateMod.RangeSetBuilder) || null;
  CopyChipsPrec = (stateMod && stateMod.Prec) || null;
} catch (error) {
  CopyChipsStateEffect = null;
  CopyChipsStateField = null;
  CopyChipsRangeSetBuilder = null;
  CopyChipsPrec = null;
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
