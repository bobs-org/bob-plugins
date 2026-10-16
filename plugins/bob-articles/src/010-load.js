const {
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} = require("obsidian");

let ArticleEditorView = null;
let ArticleTransaction = null;
try {
  const state = require("@codemirror/state");
  const view = require("@codemirror/view");
  ArticleTransaction = state.Transaction || null;
  ArticleEditorView = view.EditorView || null;
} catch (error) {
  ArticleEditorView = null;
  ArticleTransaction = null;
}
