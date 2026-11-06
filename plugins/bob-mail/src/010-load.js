const { MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, openExternal } = require("obsidian");

const MAIL_BOB_CANDIDATES = [
  ".cargo/bin/bob",
  ".local/bin/bob",
  "/opt/homebrew/bin/bob",
  "/usr/local/bin/bob",
];
const MAIL_BOB_TIMEOUT_MS = 30000;
const MAIL_BOB_MAX_BUFFER = 8 * 1024 * 1024;

function mailOptionalModule(name) {
  try {
    return require(name);
  } catch (error) {
    return null;
  }
}
