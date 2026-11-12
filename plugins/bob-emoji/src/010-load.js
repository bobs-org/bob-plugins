// Keep the plugin inert if an optional Obsidian or CodeMirror API is missing.
let EmojiPluginBase = class {};
let EmojiEditorSuggestBase = class {};
let EmojiEditorSuggestAvailable = false;
let EmojiSyntaxTree = null;

try {
  const obsidian = require("obsidian");
  if (obsidian && typeof obsidian.Plugin === "function") {
    EmojiPluginBase = obsidian.Plugin;
  }
  if (obsidian && typeof obsidian.EditorSuggest === "function") {
    EmojiEditorSuggestBase = obsidian.EditorSuggest;
    EmojiEditorSuggestAvailable = true;
  }
} catch (error) {
  EmojiPluginBase = class {};
  EmojiEditorSuggestBase = class {};
  EmojiEditorSuggestAvailable = false;
}

try {
  const language = require("@codemirror/language");
  EmojiSyntaxTree = language && typeof language.syntaxTree === "function"
    ? language.syntaxTree
    : null;
} catch (error) {
  EmojiSyntaxTree = null;
}
