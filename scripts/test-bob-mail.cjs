const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
class TestMarkdownView {}
class TestPlugin {
  constructor(app) { this.app = app; this.commands = []; }
  async loadData() { return {}; }
  addCommand(command) { this.commands.push(command); }
  addSettingTab() {}
  registerEvent() {}
}
class TestModal { constructor(app) { this.app = app; this.contentEl = {}; } }
class TestPluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class TestSetting {}
class TestNotice { constructor(message) { notices.push(String(message)); } }

const originalLoad = Module._load;
Module._load = function loadWithMailStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: TestPlugin,
      PluginSettingTab: TestPluginSettingTab,
      Setting: TestSetting,
      openExternal: () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const BobMailPlugin = require("../plugins/bob-mail/main.js");
const mail = BobMailPlugin.helpers;
Module._load = originalLoad;

class Editor {
  constructor(lines, cursor = { line: 0, ch: 0 }, anchor = cursor) {
    this.lines = [...lines];
    this.head = { ...cursor };
    this.anchor = { ...anchor };
    this.transactions = [];
  }
  getLine(line) { return this.lines[line]; }
  getValue() { return this.lines.join("\n"); }
  getCursor(which) { return { ...(which === "anchor" ? this.anchor : this.head) }; }
  setCursor(position) { this.head = { ...position }; this.anchor = { ...position }; }
  transaction(spec) {
    this.transactions.push(spec);
    for (const change of spec.changes || []) {
      const line = this.lines[change.from.line];
      this.lines[change.from.line] = line.slice(0, change.from.ch) + change.text + line.slice(change.to.ch);
    }
    if (spec.selection && spec.selection.from) this.setCursor(spec.selection.from);
  }
  replaceRange(text, from, to = from) {
    const line = this.lines[from.line];
    this.lines[from.line] = line.slice(0, from.ch) + text + line.slice(to.ch);
  }
}

function makeView(path, editor, basename = path.split("/").pop().replace(/\.md$/, "")) {
  return { file: { path, basename }, editor };
}

function makeApp(view, frontmatter = null) {
  return {
    activeView: view,
    commands: [],
    workspace: {
      getActiveViewOfType() { return this.app.activeView; },
      on() { return {}; },
      app: null,
    },
    metadataCache: {
      getFileCache(file) { return { frontmatter: file.path === view.file.path ? frontmatter : null }; },
      getFirstLinkpathDest(target) { return target === "mail/thread" ? { path: "mail/thread.md", basename: "thread" } : null; },
    },
    vault: { adapter: { basePath: "/vault" } },
  };
}

test("picker insertion uses a rechecked editor transaction and aborts stale buffers", () => {
  const editor = new Editor(["Capture: ", "tail"], { line: 0, ch: 9 });
  const view = makeView("daily.md", editor);
  const app = makeApp(view);
  app.workspace.app = app;
  const snapshot = mail.mailCreateEditorSnapshot(view);
  assert.equal(mail.mailInsertLinkIfCurrent(app, snapshot, "[[mail/thread|Subject · Dana]]"), true);
  assert.equal(editor.getLine(0), "Capture: [[mail/thread|Subject · Dana]]");
  assert.equal(editor.transactions.length, 1);

  const stale = mail.mailCreateEditorSnapshot(view);
  editor.lines[0] = "Capture changed";
  assert.equal(mail.mailInsertLinkIfCurrent(app, stale, "[[mail/thread|Subject]]"), false);
});

test("paste conversion replaces only an unchanged Gmail URL in the original view and file", () => {
  const url = "https://mail.google.com/mail/u/0/#all/0123456789abcdef";
  const editor = new Editor(["before "], { line: 0, ch: 7 });
  const view = makeView("daily.md", editor);
  const app = makeApp(view);
  app.workspace.app = app;
  const snapshot = mail.mailCreatePasteSnapshot(view, editor, url);
  editor.replaceRange(url, { line: 0, ch: 7 });
  editor.setCursor({ line: 0, ch: 7 + url.length });
  assert.equal(mail.mailReplacePasteRangeIfCurrent(app, snapshot, "[[mail/thread|Subject · Dana]]"), true);
  assert.equal(editor.getLine(0), "before [[mail/thread|Subject · Dana]]");

  const anotherEditor = new Editor(["paste "], { line: 0, ch: 6 });
  const anotherView = makeView("daily.md", anotherEditor);
  const otherApp = makeApp(anotherView);
  otherApp.workspace.app = otherApp;
  const otherSnapshot = mail.mailCreatePasteSnapshot(anotherView, anotherEditor, url);
  anotherEditor.replaceRange(url, { line: 0, ch: 6 });
  anotherView.file.path = "another.md";
  assert.equal(mail.mailReplacePasteRangeIfCurrent(otherApp, otherSnapshot, "[[mail/thread|Subject]]"), false);

  const editedEditor = new Editor(["paste "], { line: 0, ch: 6 });
  const editedView = makeView("daily.md", editedEditor);
  const editedApp = makeApp(editedView);
  editedApp.workspace.app = editedApp;
  const editedSnapshot = mail.mailCreatePasteSnapshot(editedView, editedEditor, url);
  editedEditor.replaceRange(url, { line: 0, ch: 6 });
  editedEditor.lines[0] = editedEditor.lines[0].replace("0123456789abcdef", "fedcba9876543210");
  assert.equal(mail.mailReplacePasteRangeIfCurrent(editedApp, editedSnapshot, "[[mail/thread|Subject]]"), false);
});

test("a failed save leaves a pasted Gmail URL untouched", async () => {
  notices.length = 0;
  const url = "https://mail.google.com/mail/u/0/#all/0123456789abcdef";
  const editor = new Editor(["paste "], { line: 0, ch: 6 });
  const view = makeView("daily.md", editor);
  const app = makeApp(view);
  app.workspace.app = app;
  const snapshot = mail.mailCreatePasteSnapshot(view, editor, url);
  editor.replaceRange(url, { line: 0, ch: 6 });
  const plugin = Object.create(BobMailPlugin.prototype);
  plugin.app = app;
  plugin.mailOldBobNoticed = false;
  plugin.mailCall = async () => {
    plugin.mailReportError({ oldBob: false, error: "Gmail is offline" });
    return { ok: false, error: "Gmail is offline" };
  };
  assert.equal(await plugin.mailFinishPaste(snapshot), false);
  assert.equal(editor.getLine(0), `paste ${url}`);
  assert.ok(notices.includes("Gmail is offline"));
});

test("old Bob shows one update notice", () => {
  notices.length = 0;
  assert.equal(mail.mailIsOldBobError(new Error("unrecognized subcommand 'gmail'")), true);
  const plugin = Object.create(BobMailPlugin.prototype);
  plugin.mailOldBobNoticed = false;
  plugin.mailReportError({ oldBob: true });
  plugin.mailReportError({ oldBob: true });
  assert.deepEqual(notices, ["Update bob to use Bob Mail"]);
});

test("commands appear according to mail-note context", async () => {
  const editor = new Editor(["body"], { line: 0, ch: 2 });
  const view = makeView("mail/thread.md", editor, "thread");
  const app = makeApp(view, { type: "[[mail]]", gmail_thread_id: "0123456789abcdef", gmail_url: "https://mail.google.com/mail/u/0/#all/0123456789abcdef" });
  app.workspace.app = app;
  const plugin = new BobMailPlugin(app);
  await plugin.onload();
  const commands = Object.fromEntries(plugin.commands.map((command) => [command.id, command]));
  assert.equal(commands["link-email"].checkCallback(true), true);
  assert.equal(commands["open-in-gmail"].checkCallback(true), true);
  assert.equal(commands["refresh-this-email"].checkCallback(true), true);
  assert.equal(commands["task-from-this-email"].checkCallback(true), true);

  app.activeView = makeView("daily.md", new Editor(["normal note"], { line: 0, ch: 2 }));
  assert.equal(commands["link-email"].checkCallback(true), true);
  assert.equal(commands["open-in-gmail"].checkCallback(true), false);
  assert.equal(commands["refresh-this-email"].checkCallback(true), false);
  assert.equal(commands["task-from-this-email"].checkCallback(true), false);
});

test("a mail URL under the cursor exposes the email context", () => {
  const editor = new Editor(["Open [[mail/thread|this email]]"], { line: 0, ch: 14 });
  const view = makeView("daily.md", editor);
  const app = makeApp(view);
  app.workspace.app = app;
  app.metadataCache.getFileCache = (file) => file.path === "mail/thread.md"
    ? { frontmatter: { type: "[[mail]]", gmail_url: "https://mail.google.com/mail/u/0/#all/0123456789abcdef" } }
    : { frontmatter: null };
  const context = mail.mailEmailContext(app);
  assert.equal(context.file.path, "mail/thread.md");
  assert.equal(mail.mailGmailUrlFor(context), "https://mail.google.com/mail/u/0/#all/0123456789abcdef");
});

test("task links point to the message block under the cursor", () => {
  const note = [
    "## Conversation",
    "> [!mail+] **Dana** · Tue",
    "> Hello",
    "^m-AABBCCDD",
    "",
    "> [!mail-] **Me** · Tue",
    "> Reply",
    "^m-EEFF0011",
  ].join("\n");
  assert.equal(mail.mailFindCardMessageId(note, 2), "aabbccdd");
  assert.equal(mail.mailFindCardMessageId(note, 6), "eeff0011");
  assert.equal(mail.mailTaskLink({ file: { path: "mail/thread.md", basename: "thread" }, frontmatter: { title: "Subject" } }, "aabbccdd"),
    "[[mail/thread#^m-aabbccdd|Subject]]");
});
