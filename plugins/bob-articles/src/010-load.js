const {
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
} = require("obsidian");

let ArticleEditorView = null;
let ArticleTransaction = null;
let ArticleViewPlugin = null;
let ArticleDecoration = null;
let ArticleRangeSetBuilder = null;
let ArticlePrec = null;
let ArticleEditorInfoField = null;
try {
  const state = require("@codemirror/state");
  const view = require("@codemirror/view");
  ArticleTransaction = state.Transaction || null;
  ArticleRangeSetBuilder = state.RangeSetBuilder || null;
  ArticlePrec = state.Prec || null;
  ArticleEditorView = view.EditorView || null;
  ArticleViewPlugin = view.ViewPlugin || null;
  ArticleDecoration = view.Decoration || null;
} catch (error) {
  ArticleEditorView = null;
  ArticleTransaction = null;
  ArticleViewPlugin = null;
  ArticleDecoration = null;
  ArticleRangeSetBuilder = null;
  ArticlePrec = null;
}
try {
  const obsidian = require("obsidian");
  ArticleEditorInfoField = obsidian.editorInfoField || null;
} catch (error) {
  ArticleEditorInfoField = null;
}
