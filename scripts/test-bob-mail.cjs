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

function makeMailApp(lines, cursor, files) {
  const editor = new Editor(lines, cursor);
  const view = makeView("daily.md", editor);
  const app = makeApp(view);
  app.workspace.app = app;
  app.metadataCache.getFirstLinkpathDest = (target) => {
    const key = String(target || "").replace(/\.md$/i, "");
    return files[key] ? { path: `${key}.md`, basename: key.split("/").pop() } : null;
  };
  app.metadataCache.getFileCache = (file) => {
    const key = String(file.path || "").replace(/\.md$/i, "");
    return { frontmatter: files[key] || null };
  };
  return { app, view, editor };
}

const GMAIL_URL = "https://mail.google.com/mail/u/0/#all/0123456789abcdef";
const MAIL_FRONTMATTER = { type: "[[mail]]", gmail_url: GMAIL_URL };

test("line-borne context works anywhere on the line and ignores task status", () => {
  const lines = ["- [ ] #task [[mail/thread|Subject]] trailing"];
  const { app } = makeMailApp(lines, { line: 0, ch: 2 }, { "mail/thread": MAIL_FRONTMATTER });
  const context = mail.mailEmailContext(app);
  assert.equal(context.file.path, "mail/thread.md");
  assert.equal(mail.mailGmailUrlFor(context), GMAIL_URL);

  const done = makeMailApp(["- [x] #task [[mail/thread|Subject]]"], { line: 0, ch: 0 }, { "mail/thread": MAIL_FRONTMATTER });
  assert.equal(mail.mailEmailContext(done.app).file.path, "mail/thread.md");

  const plain = makeMailApp(["A plain log bullet [[mail/thread|Subject]]"], { line: 0, ch: 0 }, { "mail/thread": MAIL_FRONTMATTER });
  assert.equal(mail.mailEmailContext(plain.app).file.path, "mail/thread.md");
});

test("child hop opens from the task row through a link-only child", () => {
  const lines = ["- [ ] #task Follow up", "  - [[mail/thread|Subject]]", "  - [[other/note|Other]]"];
  const { app } = makeMailApp(lines, { line: 0, ch: 4 }, { "mail/thread": MAIL_FRONTMATTER });
  const context = mail.mailEmailContext(app);
  assert.equal(context.file.path, "mail/thread.md");

  const onChild = makeMailApp(lines, { line: 1, ch: 2 }, { "mail/thread": MAIL_FRONTMATTER });
  assert.equal(mail.mailEmailContext(onChild.app).file.path, "mail/thread.md");
});

test("code, non-mail links, and bad URLs stay silent", () => {
  const inline = makeMailApp(["- [ ] #task `[[mail/thread|Subject]]`"], { line: 0, ch: 5 }, { "mail/thread": MAIL_FRONTMATTER });
  assert.equal(mail.mailEmailContext(inline.app), null);

  const fenced = makeMailApp(["```", "[[mail/thread|Subject]]", "```"], { line: 1, ch: 2 }, { "mail/thread": MAIL_FRONTMATTER });
  assert.equal(mail.mailEmailContext(fenced.app), null);

  const nonMail = makeMailApp(["- [ ] #task [[other/note|Other]]"], { line: 0, ch: 5 }, { "other/note": { type: "note" } });
  assert.equal(mail.mailEmailContext(nonMail.app), null);

  const missingUrl = makeMailApp(["- [ ] #task [[mail/thread|Subject]]"], { line: 0, ch: 5 }, { "mail/thread": { type: "[[mail]]" } });
  assert.equal(mail.mailEmailContext(missingUrl.app), null);
  assert.equal(mail.mailGmailUrlFor({ frontmatter: { type: "[[mail]]" } }), null);

  const badUrl = makeMailApp(["- [ ] #task [[mail/thread|Subject]]"], { line: 0, ch: 5 }, { "mail/thread": { type: "[[mail]]", gmail_url: "https://example.com/x" } });
  assert.equal(mail.mailEmailContext(badUrl.app), null);
});

test("first mail link wins and own links beat the child hop", () => {
  const lines = ["- [ ] #task [[mail/first|A]] [[mail/second|B]]"];
  const { app } = makeMailApp(lines, { line: 0, ch: 0 }, {
    "mail/first": MAIL_FRONTMATTER,
    "mail/second": { type: "[[mail]]", gmail_url: "https://mail.google.com/mail/u/0/#all/second" },
  });
  assert.equal(mail.mailEmailContext(app).file.path, "mail/first.md");

  const parentWithOwn = ["- [ ] #task [[mail/first|A]]", "  - [[mail/second|B]]"];
  const own = makeMailApp(parentWithOwn, { line: 0, ch: 0 }, {
    "mail/first": MAIL_FRONTMATTER,
    "mail/second": { type: "[[mail]]", gmail_url: "https://mail.google.com/mail/u/0/#all/second" },
  });
  assert.equal(mail.mailEmailContext(own.app).file.path, "mail/first.md");
});

test("inside a mail note the whole-note fallback still opens", () => {
  const editor = new Editor(["body text"], { line: 0, ch: 2 });
  const view = makeView("mail/thread.md", editor, "thread");
  const app = makeApp(view, MAIL_FRONTMATTER);
  app.workspace.app = app;
  const context = mail.mailEmailContext(app);
  assert.equal(context.file.path, "mail/thread.md");
  assert.equal(mail.mailGmailUrlFor(context), GMAIL_URL);
});

test("vim Cmd+Enter mapping registers once and opens exactly gmail_url", async () => {
  const actions = new Map();
  const mappings = [];
  const originalWindow = global.window;
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (...args) => mappings.push(args),
      },
    },
  };
  try {
    const { app, view } = makeMailApp(["- [ ] #task [[mail/thread|Subject]]"], { line: 0, ch: 0 }, { "mail/thread": MAIL_FRONTMATTER });
    const plugin = Object.create(BobMailPlugin.prototype);
    plugin.app = app;
    plugin.mailVimMappingsRegistered = false;
    assert.equal(plugin.registerMailVimMappings(), true);
    assert.equal(plugin.mailGmailOpenKeymap, 1);
    assert.equal(plugin.registerMailVimMappings(), true);
    assert.deepEqual(mappings.map((args) => args[0]).sort(), ["<M-CR>", "<M-Enter>"]);
    for (const args of mappings) {
      assert.equal(args[1], "action");
      assert.equal(args[2], "bobMailOpenGmail");
      assert.equal(args[4].context, "normal");
    }
    let opened = null;
    plugin.mailOpenGmail = (context) => {
      opened = mail.mailGmailUrlFor(context);
      return true;
    };
    await actions.get("bobMailOpenGmail")();
    assert.equal(opened, GMAIL_URL);

    const silent = makeMailApp(["no links here"], { line: 0, ch: 0 }, {});
    const silentPlugin = Object.create(BobMailPlugin.prototype);
    silentPlugin.app = silent.app;
    silentPlugin.mailOpenGmail = () => { throw new Error("must not open"); };
    await silentPlugin.handleMailVimOpenGmail();
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});

test("vim registration fails closed without an adapter", () => {
  const originalWindow = global.window;
  global.window = {};
  try {
    const plugin = Object.create(BobMailPlugin.prototype);
    plugin.app = {};
    plugin.mailVimMappingsRegistered = false;
    plugin.mailGmailOpenKeymap = 0;
    assert.equal(plugin.registerMailVimMappings(), false);
    assert.equal(plugin.mailGmailOpenKeymap, 0);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
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

function makeHopApp(dailyLines, dailyCursor, jobLines, jobBlockId) {
  const dailyEditor = new Editor(dailyLines, dailyCursor);
  const dailyView = makeView("2026/20261113.md", dailyEditor, "20261113");
  const app = makeApp(dailyView);
  app.workspace.app = app;
  const jobPath = "job.md";
  const jobFile = { path: jobPath, basename: "job" };
  const mailFile = { path: "mail/thread.md", basename: "thread" };
  app.metadataCache.getFirstLinkpathDest = (target, source) => {
    const key = String(target || "").replace(/\.md$/i, "");
    if (key === "job" || key === jobPath.replace(/\.md$/i, "")) return jobFile;
    if (key === "mail/thread") return mailFile;
    return null;
  };
  app.metadataCache.getFileCache = (file) => {
    if (!file) return { frontmatter: null };
    if (file.path === jobPath) {
      return {
        frontmatter: null,
        blocks: { [jobBlockId]: { position: { start: { line: 0 } } } },
      };
    }
    if (file.path === "mail/thread.md") return { frontmatter: MAIL_FRONTMATTER };
    return { frontmatter: null };
  };
  app.vault = {
    cachedRead: async (file) => {
      if (file && file.path === jobPath) return jobLines.join("\n");
      if (file && file.path === "2026/20261113.md") return dailyLines.join("\n");
      return "";
    },
  };
  return { app, dailyView };
}

test("task-link hop opens the Gmail thread from the daily-note bullet", async () => {
  const jobBlockId = "ecogpt-founding-engineer-roeje-2";
  const jobLines = [
    `- [*] #task [[mail/thread|\u2709\uFE0F EcoGPT - Founding Engineer \u00B7 Roejean Hollon]] follow up ^${jobBlockId}`,
  ];
  const dailyLines = [`\t- [[job#^${jobBlockId}]]`];
  const { app, dailyView } = makeHopApp(dailyLines, { line: 0, ch: 3 }, jobLines, jobBlockId);
  assert.deepEqual(mail.mailTaskLinkHopTarget(dailyLines[0]), { path: "job", blockId: jobBlockId });
  const context = await mail.mailEmailContextAsync(app, dailyView);
  assert.equal(context && context.file.path, "mail/thread.md");
  assert.equal(mail.mailGmailUrlFor(context), GMAIL_URL);
});

test("task-link hop rejects multi-link, embed, struck, and non-gmail targets", async () => {
  const jobBlockId = "ecogpt-founding-engineer-roeje-2";
  const jobLines = [`- [*] #task [[mail/thread|Subject]] ^${jobBlockId}`];
  const multi = [`- [[job#^${jobBlockId}]] [[job#^${jobBlockId}]]`];
  assert.equal(mail.mailTaskLinkHopTarget(multi[0]), null);
  const embed = [`- ![[job#^${jobBlockId}]]`];
  assert.equal(mail.mailTaskLinkHopTarget(embed[0]), null);
  const struck = [`- ~~[[job#^${jobBlockId}]]~~`];
  assert.equal(mail.mailTaskLinkHopTarget(struck[0]), null);
  const checkbox = [`- [ ] [[job#^${jobBlockId}]]`];
  assert.equal(mail.mailTaskLinkHopTarget(checkbox[0]), null);

  const plainTarget = [`- [ ] #task Just a task ^${jobBlockId}`];
  const { app: plainApp, dailyView: plainView } = makeHopApp(
    [`- [[job#^${jobBlockId}]]`], { line: 0, ch: 3 }, plainTarget, jobBlockId,
  );
  plainApp.metadataCache.getFileCache = (file) => {
    if (file && file.path === "job.md") {
      return { frontmatter: null, blocks: { [jobBlockId]: { position: { start: { line: 0 } } } } };
    }
    if (file && file.path === "mail/thread.md") return { frontmatter: MAIL_FRONTMATTER };
    return { frontmatter: null };
  };
  assert.equal(await mail.mailEmailContextAsync(plainApp, plainView), null);
});

test("task-link hop supports hop-then-child-hop targets", async () => {
  const jobBlockId = "ecogpt-founding-engineer-roeje-2";
  const jobLines = [
    `- [ ] #task Follow up ^${jobBlockId}`,
    `  - [[mail/thread|Subject]]`,
  ];
  const dailyLines = [`- [[job#^${jobBlockId}]]`];
  const { app, dailyView } = makeHopApp(dailyLines, { line: 0, ch: 3 }, jobLines, jobBlockId);
  const context = await mail.mailEmailContextAsync(app, dailyView);
  assert.equal(context && context.file.path, "mail/thread.md");
});

test("mailOpen api v1 opens at the cursor and degrades to false", async () => {
  const jobBlockId = "ecogpt-founding-engineer-roeje-2";
  const jobLines = [`- [*] #task [[mail/thread|Subject]] ^${jobBlockId}`];
  const { app, dailyView } = makeHopApp(
    [`- [[job#^${jobBlockId}]]`], { line: 0, ch: 3 }, jobLines, jobBlockId,
  );
  const plugin = new BobMailPlugin(app);
  await plugin.onload();
  let opened = null;
  plugin.mailOpenGmail = (context) => {
    opened = mail.mailGmailUrlFor(context);
    return true;
  };
  assert.equal(await plugin.mailOpenGmailAtCursor(dailyView), true);
  assert.equal(opened, GMAIL_URL);
  assert.equal(plugin.api.mailOpen.version, 1);
  assert.equal(await plugin.api.mailOpen.openAtCursor(dailyView), true);

  const emptyEditor = new Editor(["no links"], { line: 0, ch: 1 });
  const emptyView = makeView("2026/20261113.md", emptyEditor, "20261113");
  assert.equal(await plugin.mailOpenGmailAtCursor(emptyView), false);
});
