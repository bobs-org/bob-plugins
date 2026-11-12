// Copy card view coverage: rendering, keys, clipboard, snapshot, guards,
// and yank-block-id. Modelled on test-navigation-task-card-view.cjs and
// test-navigation-delete-guard.cjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { ElementStub, ModalStub, click, defer, flushDeferred } = require("./modal-harness.cjs");

global.window = { setTimeout: defer };

const openedModals = [];
const notices = [];
const originalLoad = Module._load;
function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    const key = match[1].trim();
    let value = match[2].trim();
    if (value === "" || value === "null" || value === "~") {
      result[key] = null;
    } else {
      result[key] = value;
    }
  }
  return result;
}

Module._load = function loadWithModalHarness(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class extends ModalStub {
        constructor(app) {
          super(app);
          openedModals.push(this);
        }
      },
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: class {},
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  CopyCardModal,
  buildCopyCardModel,
  resolveCopyCardKey,
  formatCopiedNotice,
  resetCopyCardTemplatesCache,
} = helpers;

const STYLES = fs.readFileSync(
  path.join(__dirname, "../plugins/bob-navigation-hotkeys/styles.css"),
  "utf8",
);

function flattenText(element) {
  return [element.textContent, ...element.children.map(flattenText)]
    .filter(Boolean)
    .join(" ");
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function byClass(element, className) {
  return descendants(element).filter(
    (item) => item.classes && item.classes.includes(className),
  );
}

function keyEvent(key, extras = {}) {
  return {
    key,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    defaultPrevented: false,
    propagationStopped: false,
    ...extras,
  };
}

function bryanModel(overrides = {}) {
  return buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: {
      state: "ready",
      line: 1,
      blockId: "bank-records",
      title: "Use records to start tracking bank transactions",
    },
    templates: [
      { label: "Task ref", key: "t", template: "the ^{block_id} task in the {path}" },
    ],
    ...overrides,
  });
}

function openCard(model, onCopy, onSuccess) {
  openedModals.length = 0;
  const modal = new CopyCardModal(
    {},
    {
      model,
      onCopy: onCopy || (async () => ({ ok: true })),
      onSuccess,
    },
  );
  modal.open();
  return modal;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("styles: copy card tokens exist and shared key-card rules are untouched", () => {
  for (const token of [
    ".modal.bob-copy-card-modal",
    ".bob-copy-card-row",
    "grid-template-columns: 28px 9.5em minmax(0, 1fr) 20px",
    ".bob-copy-card-divider",
    ".bob-copy-card-live",
    "@media (max-width: 480px)",
    "is-nudge",
    "overflow: auto",
  ]) {
    assert.ok(STYLES.includes(token), token);
  }
  assert.match(
    STYLES,
    /\.bob-copy-card-rows\s*\{[^}]*overflow:\s*auto/s,
    "the row list scrolls while the status and footer stay pinned",
  );
  assert.match(
    STYLES,
    /@media \(max-width: 480px\)[\s\S]*?\.bob-copy-card-label\s*\{[^}]*white-space: normal/s,
    "narrow labels wrap instead of truncating",
  );
  assert.ok(STYLES.includes("width: min(600px, 92vw)"));
  assert.ok(STYLES.includes("max-height: min(75vh, 840px)"));
  assert.ok(STYLES.includes(".bob-key-card-key"));
  assert.ok(STYLES.includes(".bob-cnp-hint"));
});

test("render: rows, keycaps, ARIA, divider, and footer chip", () => {
  const modal = openCard(bryanModel());
  assert.ok(modal.modalEl.classes.includes("bob-copy-card-modal"));
  assert.equal(modal.modalEl.attributes.role, "dialog");
  assert.equal(modal.modalEl.attributes["aria-modal"], "true");
  assert.equal(modal.rowsEl.attributes.role, "listbox");
  assert.ok(modal.rowsEl.attributes["aria-activedescendant"]);

  const rows = byClass(modal.contentEl, "bob-copy-card-row");
  assert.equal(rows.length, 6);
  const keys = byClass(modal.contentEl, "bob-copy-card-key").map((el) => el.textContent);
  assert.deepEqual(keys, ["P", "A", "F", "N", "I", "T"]);
  for (const row of rows) {
    assert.equal(row.attributes.role, "option");
    assert.ok(row.attributes["aria-selected"] === "true" || row.attributes["aria-selected"] === "false");
  }
  const selected = rows.filter((row) => row.classes.includes("is-selected"));
  assert.equal(selected.length, 1);
  assert.match(flattenText(selected[0]), /Path/);

  const dividers = byClass(modal.contentEl, "bob-copy-card-divider");
  assert.equal(dividers.length, 1);
  assert.match(flattenText(dividers[0]), /TASK/);
  assert.match(flattenText(dividers[0]), /Use records/);

  const enters = byClass(modal.contentEl, "bob-copy-card-enter");
  assert.equal(enters.filter((el) => el.textContent === "↵").length, 1);

  const footerText = flattenText(modal.footerEl);
  assert.match(footerText, /copy path/);
  modal.close();
});

test("render: dimmed, error, and collision rows", () => {
  const noId = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: { state: "no-id", line: 0, blockId: null, title: "Add event note" },
    templates: [
      { label: "Task ref", key: "t", template: "the ^{block_id} task in the {path}" },
      { label: "Wiki link", key: null, template: "[[{task_id}]]" },
      { label: "Twin", key: "p", template: "[[{note_name}]]" },
    ],
  });
  const modal = openCard(noId);
  const rows = byClass(modal.contentEl, "bob-copy-card-row");
  const idRow = rows.find((row) => flattenText(row).includes("Block ID"));
  assert.ok(idRow.classes.includes("is-unavailable"));
  assert.equal(idRow.attributes["aria-disabled"], "true");
  assert.match(flattenText(idRow), /Ctrl\+6/);

  const taskRef = rows.find((row) => flattenText(row).includes("Task ref"));
  assert.ok(taskRef.classes.includes("is-unavailable"));
  assert.match(flattenText(taskRef), /needs a block ID/);

  const errorRow = rows.find((row) => flattenText(row).includes("Wiki link"));
  assert.ok(errorRow);
  assert.ok(errorRow.classes.includes("is-error"));
  assert.equal(errorRow.attributes["aria-disabled"], "true");
  assert.match(flattenText(errorRow), /did you mean/);

  const collision = rows.find((row) => flattenText(row).includes("Twin"));
  assert.ok(collision.classes.includes("is-collision"));
  assert.match(flattenText(collision), /key p is Path's/);
  assert.equal(collision.children.length, 4, "collision reason stays in the value column");
  assert.equal(byClass(collision, "bob-copy-card-reason").length, 1);
  modal.close();
});

test("footer chip follows the highlight", () => {
  const modal = openCard(bryanModel());
  assert.match(flattenText(modal.footerEl), /copy path/);
  modal.handleCopyCardKey(keyEvent("ArrowDown"));
  assert.match(flattenText(modal.footerEl), /copy absolute path/);
  for (let step = 0; step < 4; step += 1) {
    modal.handleCopyCardKey(keyEvent("ArrowDown"));
  }
  assert.equal(modal.highlightId, "template-1");
  assert.match(flattenText(modal.footerEl), /copy task ref/);
  modal.close();
});

test("key copies and closes after the write resolves, then notices", async () => {
  notices.length = 0;
  const writes = [];
  let noticed = null;
  const modal = openCard(
    bryanModel(),
    async (row) => {
      writes.push(row.value);
      return { ok: true };
    },
    async (row) => {
      noticed = formatCopiedNotice(row.value);
      notices.push(noticed);
    },
  );
  modal.handleCopyCardKey(keyEvent("t"));
  await nextTurn();
  await nextTurn();
  assert.deepEqual(writes, ["the ^bank-records task in the ~/bob/bob.md"]);
  assert.equal(modal.isOpen, false);
  assert.match(noticed, /Copied the \^bank-records task/);
  assert.ok(notices.length >= 1);
});

test("rejected write keeps the card open with the error", async () => {
  const modal = openCard(
    bryanModel(),
    async () => ({ ok: false, reason: "denied" }),
  );
  const statusScrolls = [];
  modal.statusEl.scrollIntoView = function scrollStatus(options) {
    statusScrolls.push(options);
  };
  modal.handleCopyCardKey(keyEvent("p"));
  await nextTurn();
  await nextTurn();
  assert.equal(modal.isOpen, true);
  assert.match(flattenText(modal.statusEl), /Couldn't copy: denied/);
  assert.deepEqual(statusScrolls[0], { block: "nearest", inline: "nearest" });
  modal.close();
});

test("double press during an in-flight write writes once", async () => {
  let writes = 0;
  let release = null;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const modal = openCard(bryanModel(), async () => {
    writes += 1;
    await gate;
    return { ok: true };
  });
  modal.handleCopyCardKey(keyEvent("p"));
  modal.handleCopyCardKey(keyEvent("a"));
  assert.equal(writes, 1);
  release();
  await nextTurn();
  await nextTurn();
  assert.equal(writes, 1);
  assert.equal(modal.isOpen, false);
});

test("snapshot: the card copies the frozen file after the active file switches", async () => {
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copy-card-snap-"));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousHome = process.env.HOME;
  const writes = [];
  global.navigator = global.navigator || {};
  const previousClipboard = global.navigator.clipboard;
  try {
    process.env.XDG_CONFIG_HOME = tmp;
    process.env.HOME = "/Users/bbugyi";
    fs.mkdirSync(path.join(tmp, "bob"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "bob", "config.yml"), "plan:\n  max_ready_per_note: 5\n");
    resetCopyCardTemplatesCache();
    global.navigator.clipboard = {
      writeText: async (text) => {
        writes.push(text);
      },
    };

    const state = {
      activeFile: { path: "a.md", extension: "md" },
      editor: singleCursorEditor("- [ ] #task Ship A ^ship-a\n", [
        { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
      ]),
    };
    state.view = {
      file: state.activeFile,
      editor: state.editor,
      getMode: () => "source",
    };
    openedModals.length = 0;
    const { plugin } = makePluginForGuards({
      activeFile: state.activeFile,
      editor: state.editor,
      view: state.view,
    });
    plugin.app.workspace.getActiveFile = () => state.activeFile;
    plugin.app.workspace.getActiveViewOfType = () => state.view;

    plugin.openCopyCard();
    assert.equal(openedModals.length, 1);
    const modal = openedModals[0];
    const pathRow = modal.copyCardModel.rows.find((entry) => entry.id === "path");
    const blockRow = modal.copyCardModel.rows.find((entry) => entry.id === "block-id");
    assert.equal(pathRow.value, "~/bob/a.md");
    assert.equal(blockRow.value, "^ship-a");
    assert.equal(modal.copyCardModel.task.state, "ready");

    const switchToB = () => {
      state.activeFile = { path: "b.md", extension: "md" };
      state.editor = singleCursorEditor("- [ ] #task Ship B ^ship-b\n", [
        { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
      ]);
      state.view = {
        file: state.activeFile,
        editor: state.editor,
        getMode: () => "source",
      };
    };
    switchToB();
    assert.equal(
      modal.copyCardModel.rows.find((entry) => entry.id === "path").value,
      "~/bob/a.md",
    );
    assert.equal(
      modal.copyCardModel.rows.find((entry) => entry.id === "block-id").value,
      "^ship-a",
    );
    modal.handleCopyCardKey(keyEvent("p"));
    await nextTurn();
    await nextTurn();
    assert.deepEqual(writes, ["~/bob/a.md"]);
    assert.equal(modal.isOpen, false);

    state.activeFile = { path: "a.md", extension: "md" };
    state.editor = singleCursorEditor("- [ ] #task Ship A ^ship-a\n", [
      { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    ]);
    state.view = {
      file: state.activeFile,
      editor: state.editor,
      getMode: () => "source",
    };
    openedModals.length = 0;
    writes.length = 0;
    plugin.openCopyCard();
    const second = openedModals[0];
    switchToB();
    assert.equal(
      second.copyCardModel.rows.find((entry) => entry.id === "block-id").value,
      "^ship-a",
    );
    second.handleCopyCardKey(keyEvent("i"));
    await nextTurn();
    await nextTurn();
    assert.deepEqual(writes, ["^ship-a"]);
    assert.equal(second.isOpen, false);
  } finally {
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    global.navigator.clipboard = previousClipboard;
    resetCopyCardTemplatesCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("refused key moves the highlight and fills the live region", () => {
  const noId = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: { state: "no-id", line: 0, blockId: null, title: "Add event note" },
    templates: [],
  });
  const modal = openCard(noId);
  assert.equal(modal.highlightId, "path");
  modal.handleCopyCardKey(keyEvent("i"));
  assert.equal(modal.highlightId, "block-id");
  assert.match(modal.liveEl.textContent, /Ctrl\+6/);
  assert.equal(modal.isOpen, true);
  modal.close();
});

test("Esc closes without writing", async () => {
  let writes = 0;
  const modal = openCard(bryanModel(), async () => {
    writes += 1;
    return { ok: true };
  });
  modal.handleCopyCardKey(keyEvent("Escape"));
  await nextTurn();
  assert.equal(writes, 0);
  assert.equal(modal.isOpen, false);
});

test("q and Ctrl+[ close without writing", async () => {
  for (const event of [
    keyEvent("q"),
    keyEvent("[", { ctrlKey: true }),
    keyEvent("x", { ctrlKey: true, code: "BracketLeft" }),
  ]) {
    let writes = 0;
    const modal = openCard(bryanModel(), async () => {
      writes += 1;
      return { ok: true };
    });
    modal.handleCopyCardKey(event);
    await nextTurn();
    assert.equal(writes, 0);
    assert.equal(modal.isOpen, false);
  }
});

test("footer shows q as a close key", () => {
  const modal = openCard(bryanModel());
  const footer = flattenText(modal.footerEl);
  assert.match(footer, /esc.*q.*close/i);
  modal.close();
});

test("clicking a copyable row copies it; clicking a dimmed row refuses", async () => {
  const writes = [];
  const noId = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: { state: "no-id", line: 0, blockId: null, title: "Add event note" },
    templates: [],
  });
  const modal = openCard(noId, async (row) => {
    writes.push(row.value);
    return { ok: true };
  });
  const rows = byClass(modal.contentEl, "bob-copy-card-row");
  const pathRow = rows.find((row) => flattenText(row).includes("Path"));
  click(pathRow);
  await nextTurn();
  await nextTurn();
  assert.deepEqual(writes, ["~/bob/bob.md"]);

  const second = openCard(noId, async (row) => {
    writes.push(row.value);
    return { ok: true };
  });
  const dimmed = byClass(second.contentEl, "bob-copy-card-row").find((row) =>
    flattenText(row).includes("Block ID"),
  );
  click(dimmed);
  await nextTurn();
  assert.equal(writes.length, 1);
  assert.equal(second.isOpen, true);
  assert.match(second.liveEl.textContent, /Ctrl\+6/);
  second.close();
  modal.close();
});

function makePluginForGuards(options = {}) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const activeFile = options.activeFile === undefined ? { path: "bob.md", extension: "md" } : options.activeFile;
  const editor = options.editor === undefined ? null : options.editor;
  const view =
    options.view === undefined
      ? editor
        ? { file: activeFile, editor, getMode: () => "source" }
        : null
      : options.view;
  plugin.app = {
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: () => view,
    },
    vault: { adapter: { getBasePath: () => "/Users/bbugyi/bob" } },
  };
  plugin.isMarkdownFile = (file) => Boolean(file) && file.extension === "md";
  plugin.getActiveMarkdownFile = function () {
    const file = this.app.workspace.getActiveFile();
    if (!this.isMarkdownFile(file)) {
      return null;
    }
    return file;
  };
  return { plugin, editor, view };
}

function singleCursorEditor(content, selections) {
  return {
    getValue: () => content,
    listSelections: () => selections,
  };
}

test("openCopyCard: reading view, multiple cursors, and no editor yield no TASK group", () => {
  const content = "- [ ] #task Ship it ^ship\n";
  const selections = [{ anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } }];

  for (const variant of [
    { view: { file: { path: "bob.md" }, editor: singleCursorEditor(content, selections), getMode: () => "preview" } },
    {
      view: {
        file: { path: "bob.md" },
        editor: singleCursorEditor(content, [
          { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
          { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 1 } },
        ]),
        getMode: () => "source",
      },
    },
    { view: null, editor: null },
  ]) {
    openedModals.length = 0;
    const { plugin } = makePluginForGuards({
      activeFile: { path: "bob.md", extension: "md" },
      editor: variant.editor || null,
      view: variant.view === undefined ? null : variant.view,
    });
    plugin.openCopyCard();
    assert.equal(openedModals.length, 1);
    const modal = openedModals[0];
    assert.ok(modal instanceof CopyCardModal);
    assert.equal(modal.copyCardModel.task.state, "none");
    assert.ok(modal.copyCardModel.rows.every((row) => row.group === "file"));
    modal.close();
  }
});

test("yank-block-id copies ^id, and reports no task or no id", async () => {
  global.navigator = global.navigator || {};
  const writes = [];
  global.navigator.clipboard = {
    writeText: async (text) => {
      writes.push(text);
    },
  };
  const content = "- [ ] #task Ship it ^ship\n";
  const selections = [{ anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } }];
  const { plugin } = makePluginForGuards({
    editor: singleCursorEditor(content, selections),
    view: {
      file: { path: "bob.md" },
      editor: singleCursorEditor(content, selections),
      getMode: () => "source",
    },
  });
  notices.length = 0;
  const ok = await plugin.yankTaskBlockId();
  assert.equal(ok, true);
  assert.deepEqual(writes, ["^ship"]);
  assert.match(notices.at(-1), /Copied \^ship/);

  writes.length = 0;
  notices.length = 0;
  const noIdContent = "- [ ] #task Ship it\n";
  const noIdSelections = [{ anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } }];
  const noId = makePluginForGuards({
    editor: singleCursorEditor(noIdContent, noIdSelections),
    view: {
      file: { path: "bob.md" },
      editor: singleCursorEditor(noIdContent, noIdSelections),
      getMode: () => "source",
    },
  });
  const refused = await noId.plugin.yankTaskBlockId();
  assert.equal(refused, false);
  assert.equal(writes.length, 0);
  assert.match(notices.at(-1), /no block ID/i);

  notices.length = 0;
  const prose = makePluginForGuards({
    editor: singleCursorEditor("hello\n", [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }]),
    view: {
      file: { path: "bob.md" },
      editor: singleCursorEditor("hello\n", [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }]),
      getMode: () => "source",
    },
  });
  const none = await prose.plugin.yankTaskBlockId();
  assert.equal(none, false);
  assert.match(notices.at(-1), /No task at the cursor/);
  delete global.navigator.clipboard;
});

test("render: tenth keyless template shows add key: to bind and stays copyable", async () => {
  const templates = [];
  for (let index = 0; index < 10; index += 1) {
    templates.push({
      label: `Row ${index + 1}`,
      template: `{note_name}-${index + 1}`,
    });
  }
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: { state: "none" },
    templates,
  });
  const tenth = model.rows.find((entry) => entry.id === "template-10");
  assert.equal(tenth.state, "ready");
  assert.equal(tenth.key, null);
  assert.equal(tenth.reason, "add key: to bind");
  assert.equal(tenth.value, "bob-10");
  const writes = [];
  const modal = openCard(model, async (row) => {
    writes.push(row.value);
    return { ok: true };
  });
  const rowEl = byClass(modal.contentEl, "bob-copy-card-row").find((entry) =>
    flattenText(entry).includes("Row 10"),
  );
  assert.match(flattenText(rowEl), /add key: to bind/);
  assert.equal(rowEl.classes.includes("is-unavailable"), false);
  assert.equal(byClass(rowEl, "bob-copy-card-reason").length, 1);
  modal.setHighlight("template-10");
  modal.handleCopyCardKey(keyEvent("Enter"));
  await nextTurn();
  await nextTurn();
  assert.deepEqual(writes, ["bob-10"]);
});

test("selection and refusal scroll the row nearest into view", () => {
  const templates = [];
  for (let index = 0; index < 10; index += 1) {
    templates.push({
      label: `Row ${index + 1}`,
      template: `{note_name}-${index + 1}`,
    });
  }
  const model = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: { state: "no-id", line: 0, blockId: null, title: "Add event note" },
    templates,
  });
  const modal = openCard(model);
  const seen = [];
  const originalReveal = modal.revealCopyCardRow.bind(modal);
  modal.revealCopyCardRow = function reveal(rowId) {
    seen.push(rowId);
    originalReveal(rowId);
  };
  modal.setHighlight("template-10");
  assert.equal(modal.highlightId, "template-10");
  assert.equal(seen.at(-1), "template-10");
  const tenthEl = modal.rowEls.get("template-10");
  const tenthScrolls = [];
  tenthEl.scrollIntoView = function scrollRow(options) {
    tenthScrolls.push(options);
  };
  modal.revealCopyCardRow("template-10");
  assert.deepEqual(tenthScrolls[0], { block: "nearest", inline: "nearest" });
  modal.handleCopyCardKey(keyEvent("i"));
  assert.equal(modal.highlightId, "block-id");
  assert.equal(seen.at(-1), "block-id");
  modal.close();
});

test("hover does not move the keyboard highlight", () => {
  const modal = openCard(bryanModel());
  assert.equal(modal.highlightId, "path");
  const absolute = byClass(modal.contentEl, "bob-copy-card-row").find((entry) =>
    flattenText(entry).includes("Absolute"),
  );
  for (const type of ["mouseover", "mouseenter", "pointerover"]) {
    if (typeof absolute.listeners?.[type] === "function") {
      absolute.listeners[type]({ type });
    }
  }
  assert.equal(modal.highlightId, "path");
  modal.close();
});

test("keys wrap among copyable rows and refused T stays on the dimmed row", () => {
  const noId = buildCopyCardModel({
    filePath: "bob.md",
    basePath: "/Users/bbugyi/bob",
    homePath: "/Users/bbugyi",
    task: { state: "no-id", line: 0, blockId: null, title: "Add event note" },
    templates: [
      { label: "Task ref", key: "t", template: "the ^{block_id} task in the {path} file" },
    ],
  });
  const modal = openCard(noId);
  const copyable = noId.rows.filter((entry) => entry.state === "ready" || entry.state === "collision");
  modal.setHighlight(copyable[copyable.length - 1].id);
  modal.handleCopyCardKey(keyEvent("ArrowDown"));
  assert.equal(modal.highlightId, copyable[0].id);
  modal.handleCopyCardKey(keyEvent("ArrowUp"));
  assert.equal(modal.highlightId, copyable[copyable.length - 1].id);
  modal.handleCopyCardKey(keyEvent("t"));
  assert.equal(modal.highlightId, "template-1");
  assert.match(modal.liveEl.textContent, /needs a block ID/);
  assert.equal(modal.isOpen, true);
  modal.close();
});

test("openCopyCard and yank-block-id reject a fenced nested example", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "  ```",
    "  - [ ] #task Example ^example",
    "  ```",
    "  - code:",
    "    ~~~~",
    "    - [ ] #task Nested ^nested",
    "    ~~~~",
    "",
  ].join("\n");
  global.navigator = global.navigator || {};
  const writes = [];
  global.navigator.clipboard = {
    writeText: async (text) => {
      writes.push(text);
    },
  };
  for (const line of [2, 6]) {
    const selections = [{ anchor: { line, ch: 4 }, head: { line, ch: 4 } }];
    openedModals.length = 0;
    notices.length = 0;
    const { plugin } = makePluginForGuards({
      editor: singleCursorEditor(content, selections),
      view: {
        file: { path: "bob.md" },
        editor: singleCursorEditor(content, selections),
        getMode: () => "source",
      },
    });
    plugin.openCopyCard();
    const modal = openedModals[0];
    assert.equal(modal.copyCardModel.task.state, "none");
    assert.ok(modal.copyCardModel.rows.every((row) => row.group === "file"));
    modal.close();
    const yanked = await plugin.yankTaskBlockId();
    assert.equal(yanked, false);
    assert.match(notices.at(-1), /No task at the cursor/);
  }
  assert.equal(writes.length, 0);
  delete global.navigator.clipboard;
});
