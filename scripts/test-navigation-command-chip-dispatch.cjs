// ⌘↵ (Meta+Enter) with command chips: the dispatcher asks the real
// bob-chips rule first, stops when it handled the key (run, open, or a
// refusal), and otherwise runs the Highlights → Gmail → new-tab chain
// exactly as before. Every old target is pinned with bob-chips installed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { NavigationHotkeysPlugin, helpers, notices } = require("./navigation-hotkeys-harness.cjs");
const { BobCopyChipsPlugin, FakeNotice } = require("./copy-chips-test-helpers.cjs");

const BASE = "/vault";
const SIG_PLAN = JSON.stringify(["plan"]);
const SIG_RECONCILE = JSON.stringify(["task-reconcile"]);

function fakeEngine() {
  const verdicts = {
    "bob plan": { ok: true, state: "ready", signature: SIG_PLAN, steps: [{ index: 1, text: "bob plan" }], reason: null, step: null },
    "bob task reconcile": {
      ok: true, state: "ready", signature: SIG_RECONCILE, steps: [{ index: 1, text: "bob task reconcile" }], reason: null, step: null,
    },
  };
  const engine = {
    version: 1,
    runs: [],
    resolve: (text) => verdicts[text] || { ok: false, state: "invalid", signature: null, steps: [], reason: "bob has no command `" + text.replace(/^bob /, "") + "`", step: 1 },
    runText(text, opts) {
      engine.runs.push({ text, opts });
      return Promise.resolve({ ok: true, stage: "run", outcome: "completed", runId: "r" + engine.runs.length });
    },
    openText: () => Promise.resolve({ ok: true, stage: "review" }),
    openOutput: () => Promise.resolve({ ok: true }),
    catalogInfo: () => ({ token: "t" }),
  };
  return engine;
}

function refNoteWithBlock() {
  return [
    "# Example",
    "",
    "- [ ] #task #ref [[lib/chat/x.pdf]] ^ref",
    "",
    "## Highlights",
    "",
    "<!-- highlights:begin -->",
    "",
    "### Page 12",
    "",
    "> [!quote] Latency is not throughput.",
    ">",
    "> > [!note] Comment Compare.",
    "",
    "^h-2b91f0a4c7de",
    "",
    "<!-- highlights:end -->",
  ].join("\n");
}

// The ref-pdf harness plus a real bob-chips, a fake Command Mode, and a
// recording bob-mail. `options.chips: false` leaves bob-chips out;
// `options.engine: false` leaves Command Mode out.
async function makeHarness(content, options = {}) {
  FakeNotice.messages.length = 0;
  notices.length = 0;
  const files = new Map();
  const addFile = (filePath, body = "", frontmatter = {}) => {
    const file = { path: filePath, extension: path.extname(filePath).slice(1).toLowerCase(), content: body };
    files.set(filePath, { file, body, frontmatter });
    return file;
  };
  const currentFile = addFile(options.currentPath || "gtd_daily.md", content, options.currentFrontmatter || {});
  for (const entry of options.files || []) addFile(entry.path, entry.content, entry.frontmatter);
  const pdfs = new Set(options.pdfs || ["lib/chat/x.pdf"]);
  for (const pdfPath of pdfs) if (!files.has(pdfPath)) addFile(pdfPath);
  const editorElement = {};
  const view = {
    file: currentFile,
    editor: {
      getValue: () => content,
      getCursor: () => ({ line: options.line || 0, ch: options.ch || 0 }),
      replaceRange() {
        throw new Error("⌘↵ must never write the editor");
      },
    },
    getMode: () => options.mode || "source",
    containerEl: {
      ownerDocument: { activeElement: { closest: () => editorElement }, body: {} },
      contains: (element) => element === editorElement,
    },
  };
  const delegates = [];
  const launches = [];
  const gmail = [];
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin._highlightsLaunchActive = false;
  plugin._highlightsLastLaunchEnd = 0;
  plugin.commandChipDispatch = 1;
  plugin.api = { taskScope: helpers.createDependencyNavApi(plugin).taskScope };
  const engine = options.engine === false ? null : fakeEngine();
  const registry = {
    "bob-navigation-hotkeys": plugin,
    "bob-mail": {
      api: {
        mailOpen: {
          version: 1,
          openAtCursor: async () => {
            const line = content.split("\n")[options.line || 0] || "";
            const opens = /\[\[mail\//.test(line);
            if (opens) gmail.push(line);
            return opens;
          },
        },
      },
    },
  };
  if (engine) registry["bob-command-mode"] = { api: { commandMode: engine } };
  plugin.app = {
    workspace: { getActiveViewOfType: () => view },
    commands: { executeCommandById: (id) => delegates.push(id) },
    metadataCache: {
      getFileCache: (file) => {
        const entry = file && files.get(file.path);
        return entry ? { frontmatter: entry.frontmatter } : null;
      },
      getFirstLinkpathDest: () => null,
    },
    vault: {
      adapter: { exists: async (filePath) => pdfs.has(filePath), getBasePath: () => BASE },
      getAbstractFileByPath: (filePath) => (files.get(filePath) || {}).file || null,
      getMarkdownFiles: () => [...files.values()].map((entry) => entry.file).filter((file) => file.extension === "md"),
      cachedRead: async (file) => (files.get(file.path) || {}).body || null,
      modify() {
        throw new Error("⌘↵ must never modify the vault");
      },
      process() {
        throw new Error("⌘↵ must never process the vault");
      },
    },
    plugins: { plugins: registry, enabledPlugins: new Set(["bob-command-mode", "bob-chips"]) },
  };
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.getVaultBasePath = () => BASE;
  plugin.resolveLinkTargetFile = (target, sourcePath) => {
    const targetPath = String(target || "").split("#", 1)[0].trim();
    if (!targetPath) return (files.get(sourcePath) || {}).file || null;
    return [targetPath, `${targetPath}.md`].map((candidate) => (files.get(candidate) || {}).file).find(Boolean) || null;
  };
  plugin.readLinkPickerNoteContent = async (filePath, file) => (files.get(filePath || (file && file.path)) || {}).body || null;
  const execFile = (executable, args, execOptions, callback) => {
    launches.push({ executable, args: [...args] });
    queueMicrotask(() => callback(null, "", ""));
  };
  const boundOpen = plugin.openReferencePdfPath.bind(plugin);
  plugin.openReferencePdfPath = (filePath, openOptions = {}) =>
    boundOpen(filePath, { execFile, isMacOS: true, basePath: BASE, exists: async (p) => pdfs.has(p), ...openOptions });
  if (options.chips !== false) {
    const chips = new BobCopyChipsPlugin(plugin.app);
    await chips.onload();
    registry["bob-chips"] = chips;
  }
  return { plugin, view, engine, delegates, launches, gmail };
}

async function press(harness) {
  await harness.plugin.openReferencePdfInHighlightsOrLink();
}

function untouched(harness) {
  assert.deepEqual(harness.delegates, [], "no new-tab delegate");
  assert.deepEqual(harness.launches, [], "no Highlights launch");
  assert.deepEqual(harness.gmail, [], "no Gmail open");
}

test("⌘↵ runs the line's command chip and stops the chain", async () => {
  const h = await makeHarness("- [ ] #task #gtd **Reconcile**: `run: bob task reconcile` ^rec");
  await press(h);
  assert.equal(h.engine.runs.length, 1);
  assert.equal(h.engine.runs[0].text, "bob task reconcile");
  assert.deepEqual(h.engine.runs[0].opts.source, { path: "gtd_daily.md", line: 0 });
  untouched(h);
});

test("⌘↵ falls back to the task's only command chip", async () => {
  const h = await makeHarness("- [ ] #task #gtd **Reconcile** ^rec\n    - `run: bob task reconcile`");
  await press(h);
  assert.deepEqual(h.engine.runs.map((run) => [run.text, run.opts.source.line]), [["bob task reconcile", 1]]);
  untouched(h);
});

test("an ambiguous line or task refuses once and never falls through", async () => {
  const line = await makeHarness("- [ ] #task Two `run: bob plan` and `run: bob task reconcile`");
  await press(line);
  assert.deepEqual(FakeNotice.messages, ["2 command chips on this line · move onto one"]);
  assert.equal(line.engine.runs.length, 0);
  untouched(line);

  const task = await makeHarness("- [ ] #task Parent ^p\n    - `run: bob plan`\n    - `run: bob task reconcile`");
  await press(task);
  assert.deepEqual(FakeNotice.messages, ["2 command chips in this task · move onto one"]);
  untouched(task);
});

test("a refused chip shows bob's reason and never falls through to a link", async () => {
  const h = await makeHarness("- [ ] #task Broken `run: bob gcal synk` and [a link](https://example.com)");
  await press(h);
  assert.deepEqual(FakeNotice.messages, ["Can't run: bob has no command `gcal synk`"]);
  assert.equal(h.engine.runs.length, 0);
  untouched(h);
});

test("the Bank-shaped row runs its chip, but a cursor on its links keeps the chain", async () => {
  const row = "- [ ] #task #gtd **Bank**: [Wells Fargo](https://www.wellsfargo.com) → `run[Import bank files]: bob plan` · in [[bank]]";
  const chip = await makeHarness(row, { ch: 0 });
  await press(chip);
  assert.deepEqual(chip.engine.runs.map((run) => run.text), ["bob plan"]);
  untouched(chip);

  const onLink = await makeHarness(row, { ch: row.indexOf("Wells") });
  await press(onLink);
  assert.equal(onLink.engine.runs.length, 0);
  assert.deepEqual(onLink.delegates, ["editor:open-link-in-new-leaf"], "the link opens as before");

  const linked = await makeHarness("- [ ] #task Pay [[bank]] ^b\n    - `run: bob plan`", { line: 0 });
  await press(linked);
  assert.equal(linked.engine.runs.length, 0, "a line with a link keeps its own target");
  assert.deepEqual(linked.delegates, ["editor:open-link-in-new-leaf"]);
});

test("every old ⌘↵ target still works with bob-chips installed", async () => {
  const reading = await makeHarness("- [ ] #task #ref [[ref/chat/x]] ^ref-x", {
    files: [{ path: "ref/chat/x.md", content: "# Reference", frontmatter: { source_pdf: "lib/chat/x.pdf" } }],
  });
  await press(reading);
  assert.equal(reading.launches.length, 1, "a Highlights reading task");
  assert.deepEqual(reading.delegates, []);

  const block = await makeHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]] `run: bob plan`", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [{ path: "ref/chat/x.md", content: refNoteWithBlock(), frontmatter: { source_pdf: "lib/chat/x.pdf" } }],
  });
  await press(block);
  assert.ok(block.launches.length >= 1, "a highlight block link in a ref/ note (chips never run there)");
  assert.equal(block.engine.runs.length, 0);

  const mail = await makeHarness("- [ ] #task Reply [[mail/thread|Subject]]");
  await press(mail);
  assert.equal(mail.gmail.length, 1, "a Gmail mail link");
  assert.deepEqual(mail.delegates, []);

  const plain = await makeHarness("- see [docs](https://example.com)");
  await press(plain);
  assert.deepEqual(plain.delegates, ["editor:open-link-in-new-leaf"], "a plain link in a new tab");
});

test("without Command Mode or bob-chips, a chip line keeps today's behavior", async () => {
  const noEngine = await makeHarness("- [ ] #task `run: bob plan`", { engine: false });
  await press(noEngine);
  assert.deepEqual(noEngine.delegates, ["editor:open-link-in-new-leaf"]);
  assert.deepEqual(FakeNotice.messages, []);

  const noChips = await makeHarness("- [ ] #task `run: bob plan`", { chips: false });
  await press(noChips);
  assert.equal(noChips.engine.runs.length, 0);
  assert.deepEqual(noChips.delegates, ["editor:open-link-in-new-leaf"]);

  const refNote = await makeHarness("- [ ] #task `run: bob plan`", { currentPath: "ref/x.md" });
  await press(refNote);
  assert.equal(refNote.engine.runs.length, 0);
  assert.deepEqual(refNote.delegates, ["editor:open-link-in-new-leaf"]);

  const reading = await makeHarness("- [ ] #task `run: bob plan`", { mode: "preview" });
  await press(reading);
  assert.equal(reading.engine.runs.length, 0, "Reading view never runs through ⌘↵");
});

test("an older bob-chips without runAtCursor falls through", async () => {
  const h = await makeHarness("- [ ] #task `run: bob plan`", { chips: false });
  h.plugin.app.plugins.plugins["bob-chips"] = { api: { commandChips: { version: 1, chipAt: () => ({ state: "none" }) } } };
  await press(h);
  assert.deepEqual(h.delegates, ["editor:open-link-in-new-leaf"]);
  const throwing = await makeHarness("- [ ] #task `run: bob plan`", { chips: false });
  throwing.plugin.app.plugins.plugins["bob-chips"] = {
    api: { commandChips: { version: 1, runAtCursor: () => Promise.reject(new Error("boom")), targetAt: () => { throw new Error("boom"); } } },
  };
  await press(throwing);
  assert.deepEqual(throwing.delegates, ["editor:open-link-in-new-leaf"]);
  assert.equal(throwing.plugin.commandChipClaimsCursor({ editor: throwing.view.editor, file: throwing.view.file }), false);
});

test("the Highlights hint yields whenever the chip rule claims the cursor", async () => {
  const previous = global.Platform;
  global.Platform = { isMacOS: true };
  try {
    const target = Object.freeze({ kind: "reading", pdfPath: "lib/chat/x.pdf", page: null, title: "X", railLines: null });
    const claimed = await makeHarness("- [ ] #task #ref [[ref/chat/x]] `run: bob plan`");
    claimed.plugin.app.hotkeyManager = { getHotkeys: () => [{ modifiers: ["Meta"], key: "Enter" }] };
    const context = { editor: claimed.view.editor, file: claimed.view.file };
    assert.equal(claimed.plugin.commandChipClaimsCursor(context), true);
    claimed.plugin._paintHighlightsHints(target, context);
    assert.equal(claimed.plugin._highlightsHintTarget, null, "one ⌘↵ cue: the chip's");

    const free = await makeHarness("- [ ] #task #ref [[ref/chat/x]]");
    free.plugin.app.hotkeyManager = claimed.plugin.app.hotkeyManager;
    const freeContext = { editor: free.view.editor, file: free.view.file };
    assert.equal(free.plugin.commandChipClaimsCursor(freeContext), false);
    free.plugin._paintHighlightsHints(target, freeContext);
    assert.equal(free.plugin._highlightsHintTarget, target);

    const ambiguous = await makeHarness("- [ ] #task #ref [[ref/chat/x]] `run: bob plan` `run: bob task reconcile`");
    assert.equal(ambiguous.plugin.commandChipClaimsCursor({ editor: ambiguous.view.editor, file: ambiguous.view.file }), true, "a refusal claims the key too");
  } finally {
    if (previous === undefined) delete global.Platform;
    else global.Platform = previous;
  }
});

test("the dispatcher keeps its id, sets the capability flag, and names chips", () => {
  const source = fs.readFileSync(path.join(__dirname, "../plugins/bob-navigation-hotkeys/src/490-plugin-lifecycle.js"), "utf8");
  const start = source.indexOf('id: "open-reference-pdf-in-highlights"');
  assert.notEqual(start, -1);
  const command = source.slice(start, source.indexOf("    });", start));
  assert.match(command, /name: "Run command chip, or open in Highlights/);
  assert.doesNotMatch(command, /hotkeys:/);
  assert.match(source, /this\.commandChipDispatch = 1;/);
  assert.match(source, /onunload\(\) \{\n {4}this\.commandChipDispatch = 0;/);
});
