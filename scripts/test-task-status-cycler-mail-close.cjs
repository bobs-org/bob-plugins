const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
  MarkdownView,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  installTasksCloseCommand,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

const cyclerTwin = path.join(__dirname, "../plugins/task-status-cycler/src/186-mail-close-model-twin.js");
const navTwin = path.join(__dirname, "../plugins/bob-navigation-hotkeys/src/061-mail-close-model-twin.js");
const cyclerVectors = path.join(__dirname, "../plugins/task-status-cycler/scripts/fixtures/mail_close/vectors.json");
const navVectors = path.join(__dirname, "../plugins/bob-navigation-hotkeys/scripts/fixtures/mail_close/vectors.json");
const vectors = JSON.parse(fs.readFileSync(cyclerVectors, "utf8"));

const MAIL_LINE = "- [ ] #task Reply [[mail/2026/lease]]";
const EMBED_LINE = "- [ ] #task See ![[mail/2026/lease]]";
const PLAIN_LINE = "- [ ] #task No links here";
const OTHER_LINE = "- [ ] #task See [[notes/other]]";
const MAIL_NOTE = "---\ntype: [[mail]]\ntitle: Lease renewal\nwho: Ada\nturn: yours\n---\n";
const OTHER_NOTE = "---\ntype: [[note]]\n---\n";

function mailFile(pathName, text) {
  return { path: pathName, basename: path.basename(pathName, ".md") };
}

function makePlugin(options = {}) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.referenceMutationQueue = Promise.resolve();
  const files = options.files || {};
  const caches = options.caches || {};
  const fileObjs = {};
  for (const [filePath, text] of Object.entries(files)) {
    fileObjs[filePath] = mailFile(filePath, text);
  }
  const confirmCalls = [];
  const nav = options.nav === false
    ? null
    : {
        settleReviewWalkLock() {},
        api: {
          mailCloseGuard: {
            version: 1,
            async confirm(targets, confirmOptions) {
              confirmCalls.push({ targets, options: confirmOptions });
              if (typeof options.confirm === "function") {
                return options.confirm(targets, confirmOptions);
              }
              return options.confirmResult || { confirmed: true, guarded: true, token: "tok123456789" };
            },
          },
        },
      };
  plugin.app = {
    plugins: { plugins: nav ? { "bob-navigation-hotkeys": nav } : {} },
    vault: {
      getAbstractFileByPath: (filePath) => fileObjs[filePath] || null,
      getMarkdownFiles: () => Object.values(fileObjs),
      cachedRead: async (file) => files[file.path] || "",
      read: async (file) => files[file.path] || "",
      modify: async (file, sourceText) => { files[file.path] = sourceText; },
      process: async (file, update) => { files[file.path] = update(files[file.path]); },
    },
    metadataCache: {
      getFirstLinkpathDest(link) {
        const exact = link.endsWith(".md") ? link : `${link}.md`;
        if (fileObjs[exact]) return fileObjs[exact];
        if (fileObjs[link]) return fileObjs[link];
        for (const file of Object.values(fileObjs)) {
          if (file.basename === link || file.path === link) return file;
        }
        return null;
      },
      getFileCache: (file) => {
        if (options.coldCache) return null;
        if (!file) return null;
        if (Object.prototype.hasOwnProperty.call(caches, file.path)) return caches[file.path];
        return null;
      },
    },
    workspace: {
      getActiveFile: () => fileObjs[options.activePath || "job.md"] || null,
      getActiveViewOfType: () => null,
    },
    commands: { commands: {}, executeCommandById: () => false },
  };
  plugin._confirmCalls = confirmCalls;
  plugin.getFreshnessStampLine = () => (line) => line;
  return plugin;
}

function closeTarget(lineText, after = "x", pathName = "job.md") {
  const taskStatus = helpers.getTaskStatusForLine(lineText, 0);
  return {
    path: pathName,
    line: 1,
    lineText,
    before: taskStatus ? taskStatus.symbol : " ",
    after,
    children: [],
  };
}

test("cycler Mail Close twin is a byte-for-byte copy of the nav model", () => {
  assert.ok(fs.readFileSync(cyclerTwin).equals(fs.readFileSync(navTwin)));
});

test("cycler Mail Close vectors are a byte-for-byte copy of the nav vectors", () => {
  assert.ok(fs.readFileSync(cyclerVectors).equals(fs.readFileSync(navVectors)));
});

for (const vector of vectors.vectors.filter((entry) => entry.kind === "predicate")) {
  test(`${vector.id}: cycler Gmail Task predicate`, () => {
    const actual = helpers.mailCloseVectorPredicate(vector);
    assert.equal(actual.gmail_task, vector.expect_gmail_task);
    assert.deepEqual(actual.notes, vector.expect_notes);
  });
}

test("sync pre-check allows a close with no wikilinks", () => {
  const plugin = makePlugin({ nav: false });
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(PLAIN_LINE)]);
  assert.equal(decision.kind, "allow");
});

test("sync pre-check allows a close whose only links are embeds", () => {
  const plugin = makePlugin({
    nav: false,
    files: { "job.md": EMBED_LINE, "mail/2026/lease.md": MAIL_NOTE },
  });
  assert.deepEqual(helpers.mailCloseLineLinks(EMBED_LINE), []);
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(EMBED_LINE)]);
  assert.equal(decision.kind, "allow");
});

test("sync pre-check allows a close when a warm cache says every link is non-mail", () => {
  const plugin = makePlugin({
    nav: false,
    files: { "job.md": OTHER_LINE, "notes/other.md": OTHER_NOTE },
    caches: { "notes/other.md": { frontmatter: { type: "[[note]]" } } },
  });
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(OTHER_LINE)]);
  assert.equal(decision.kind, "allow");
});

test("sync pre-check asks nav when a Gmail Task is possible", () => {
  const plugin = makePlugin({
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
  });
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(MAIL_LINE)]);
  assert.equal(decision.kind, "ask");
});

test("missing nav fails closed on a possible Gmail Task", async () => {
  notices.length = 0;
  const plugin = makePlugin({
    nav: false,
    coldCache: true,
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
  });
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(MAIL_LINE)]);
  assert.equal(decision.kind, "classify");
  const result = await plugin.confirmCyclerMailClose([closeTarget(MAIL_LINE)]);
  assert.equal(result.confirmed, false);
  assert.ok(notices.some((message) => message.includes("Bob Navigation Hotkeys")));
});

test("missing nav fails closed immediately when a warm cache already names a Gmail Task", async () => {
  notices.length = 0;
  const plugin = makePlugin({
    nav: false,
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
  });
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(MAIL_LINE)]);
  assert.equal(decision.kind, "block");
  const result = await plugin.confirmCyclerMailClose([closeTarget(MAIL_LINE)]);
  assert.equal(result.confirmed, false);
  assert.ok(notices.some((message) => message.includes("Bob Navigation Hotkeys")));
});

test("missing nav allows a close whose line is not a Gmail Task even with wikilink children", async () => {
  notices.length = 0;
  const plugin = makePlugin({ nav: false, coldCache: true });
  const target = {
    path: "Daily.md",
    line: 1,
    lineText: "- [ ] (**1110-1135** [t:: 25m])",
    before: " ",
    after: "x",
    children: [
      "  - [[Tasks#^ordinary-one|Ordinary one]]",
      "  - [[Projects/Focus#^move-one|Move one]]#",
    ],
  };
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [target]);
  assert.equal(decision.kind, "allow");
  const result = await plugin.confirmCyclerMailClose([target]);
  assert.equal(result.confirmed, true);
  assert.equal(result.guarded, false);
  assert.equal(notices.length, 0);
});

test("missing nav classifies a #task through vault YAML and allows a non-mail link", async () => {
  notices.length = 0;
  const plugin = makePlugin({
    nav: false,
    coldCache: true,
    files: { "job.md": OTHER_LINE, "notes/other.md": OTHER_NOTE },
  });
  const decision = helpers.cyclerMailCloseSyncDecision(plugin, [closeTarget(OTHER_LINE)]);
  assert.equal(decision.kind, "classify");
  const result = await plugin.confirmCyclerMailClose([closeTarget(OTHER_LINE)]);
  assert.equal(result.confirmed, true);
  assert.equal(result.guarded, false);
  assert.equal(notices.length, 0);
});

test("a confirmed token skips a second card on the same gesture", async () => {
  const plugin = makePlugin({
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
    confirm(targets, options) {
      assert.equal(options.context.mailCloseConfirmed, "tok123456789");
      return { confirmed: true, guarded: true, token: "tok123456789" };
    },
  });
  const context = { mailCloseConfirmed: "tok123456789" };
  const first = await plugin.confirmCyclerMailCloseIfNeeded([closeTarget(MAIL_LINE)], context);
  const second = await plugin.confirmCyclerMailCloseIfNeeded([closeTarget(MAIL_LINE)], context);
  assert.equal(first.confirmed, true);
  assert.equal(second.confirmed, true);
  assert.equal(plugin._confirmCalls.length, 2);
  assert.equal(plugin._confirmCalls[1].options.context.mailCloseConfirmed, "tok123456789");
});

test("keeping a Gmail Task close writes nothing through completeTaskAtCursor", async () => {
  const editor = createTextEditor(MAIL_LINE, { line: 0, ch: 3 });
  const plugin = makePlugin({
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
    confirmResult: { confirmed: false, guarded: true, token: null },
  });
  plugin.app.workspace.getActiveFile = () => ({ path: "job.md" });
  installTasksCloseCommand(plugin, editor);
  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: false, reason: "mail-close-kept" });
  assert.equal(editor.getValue(), MAIL_LINE);
});

test("confirming a Gmail Task close writes Done through completeTaskAtCursor", async () => {
  const editor = createTextEditor(MAIL_LINE, { line: 0, ch: 3 });
  const plugin = makePlugin({
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
  });
  plugin.app.workspace.getActiveFile = () => ({ path: "job.md" });
  installTasksCloseCommand(plugin, editor);
  const result = await plugin.completeTaskAtCursor(editor);
  assert.equal(result.ok, true);
  assert.match(editor.getValue(), /\[[xX]\]/);
});

test("a counted range prompts once for every Gmail Task in the range", async () => {
  const source = `${MAIL_LINE}\n${MAIL_LINE}`;
  const editor = createTextEditor(source, { line: 0, ch: 3 });
  const plugin = makePlugin({
    files: { "job.md": source, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
  });
  const result = await plugin.cycleTaskStatusRange(editor, { path: "job.md" }, -1, 1);
  assert.equal(plugin._confirmCalls.length, 1);
  assert.equal(plugin._confirmCalls[0].targets.length, 2);
  assert.equal(result, true);
});

test("checkbox clicks skip Tasks and Dataview query results", () => {
  const plugin = makePlugin();
  assert.equal(plugin.cyclerMailCloseClickIsForeign({
    closest: (selector) => selector === "ul.plugin-tasks-query-result" ? {} : null,
  }), true);
  assert.equal(plugin.cyclerMailCloseClickIsForeign({
    closest: (selector) => selector === ".block-language-dataview" ? {} : null,
  }), true);
  assert.equal(plugin.cyclerMailCloseClickIsForeign({
    closest: () => null,
  }), false);
});

test("checkbox capture intercepts an open-to-done click on a Gmail Task", async () => {
  notices.length = 0;
  const editor = createTextEditor(MAIL_LINE, { line: 0, ch: 3 });
  const harness = createInMemoryObsidianApp({
    "job.md": MAIL_LINE,
    "mail/2026/lease.md": MAIL_NOTE,
  });
  const plugin = makePlugin({
    files: { "job.md": MAIL_LINE, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
    confirmResult: { confirmed: false, guarded: true, token: null },
  });
  attachActiveMarkdownView(plugin, { app: plugin.app }, editor, "job.md");
  plugin.app.vault.getAbstractFileByPath = () => ({ path: "job.md" });
  plugin.app.workspace.getActiveViewOfType = () => Object.assign(new MarkdownView(), {
    editor,
    file: { path: "job.md" },
  });
  plugin.app.workspace.getActiveFile = () => ({ path: "job.md" });
  let prevented = 0;
  const input = {
    closest: (selector) => selector === "input.task-list-item-checkbox" ? input : (
      selector === "li.task-list-item" ? { getAttribute: () => "0" } : null
    ),
    getAttribute: () => null,
  };
  const intercepted = plugin.cyclerMailCloseGuardClick({
    target: input,
    type: "click",
    preventDefault() { prevented += 1; },
    stopPropagation() {},
  });
  assert.equal(intercepted, true);
  assert.equal(prevented, 1);
  await flushAsyncActions();
  assert.equal(editor.getValue(), MAIL_LINE);
});

test("keeping an offer-close writes nothing", async () => {
  const plugin = makePlugin({
    files: { "job.md": `${MAIL_LINE} ^yogi`, "mail/2026/lease.md": MAIL_NOTE },
    caches: { "mail/2026/lease.md": { frontmatter: { type: "[[mail]]" } } },
    confirmResult: { confirmed: false, guarded: true, token: null },
  });
  const result = await plugin.confirmCyclerMailCloseForOfferCloses(
    [{ path: "job.md", line: 0, beforeLine: MAIL_LINE, expected: MAIL_LINE, status: " ", outcome: "done" }],
    new Map([["job.md", `${MAIL_LINE} ^yogi`]]),
    new Map([["job.md", `${MAIL_LINE} ^yogi`]]),
    {},
  );
  assert.equal(result.confirmed, false);
  assert.deepEqual(plugin.cyclerMailCloseEmptyOfferResult(), {
    offer_closes: [],
    offer_close_refused: null,
    undo: null,
    resolved: [],
    failures: null,
  });
});
