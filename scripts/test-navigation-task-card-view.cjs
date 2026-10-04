// Card-view coverage for the Task Card renderer and modal mode/stage
// boundaries (bob-cli-42.3). Rendering is pure: no rolls and no writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { ElementStub, ModalStub } = require("./modal-harness.cjs");

global.window = { setTimeout: (callback) => callback() };

const openedModals = [];
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
    result[match[1].trim()] = match[2].trim() || null;
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
      Notice: class {},
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
  BulletPropertyPickerModal,
  ChildNotePickerModal,
  TaskMoveDestinationPickerModal,
  PomodoroBulletMovePickerModal,
  FilteredPickerModal,
  FreshnessDecayCardModal,
  planTaskCard,
  renderTaskCardView,
  orderedTaskCardRows,
  validateBulletPropertyConfig,
} = helpers;

const BASE_DATE = new Date(2026, 9, 3);
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

function dispatchCardKey(modal, key, modifiers = {}) {
  const list = modal.taskCardListEl;
  let prevented = false;
  let stopped = false;
  list.listeners.keydown({
    key,
    target: list,
    ...modifiers,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });
  return { prevented, stopped };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function buildConfig() {
  const config = validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
          { label: "P5", value: "later", min_days: 366, max_days: 400 },
        ],
      },
      { name: "dependsOn", values: "local_task_id" },
      { name: "effort", values: ["small", "large"] },
    ],
  });
  assert.ok(config);
  return config;
}

function freshnessApi() {
  return {
    setRefreshLine() {},
    config() {
      return { interval: 7 };
    },
  };
}

function makeModel(overrides = {}) {
  const content =
    overrides.content ||
    "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] [effort:: small] ^ship";
  return planTaskCard({
    config: buildConfig(),
    content,
    lineText: overrides.lineText || content.split(/\r?\n/)[0],
    cursorLine: 0,
    filePath: overrides.filePath || "Areas/Work_ship.md",
    propertyContext: { isObsidianTask: true },
    baseDate: BASE_DATE,
    random: sequence([0.1, 0.35, 0.6, 0.8, 0.95, 0.2, 0.45, 0.7]),
    freshnessApi: freshnessApi(),
    ...overrides,
  });
}

function makeEditor(content) {
  const lines = String(content || "").split(/\n/);
  let writes = 0;
  return {
    getValue: () => content,
    getLine: (line) => (line >= 0 && line < lines.length ? lines[line] : null),
    setValue() {
      writes += 1;
    },
    replaceRange() {
      writes += 1;
    },
    writes: () => writes,
  };
}

function openPropertyPicker(options = {}) {
  openedModals.length = 0;
  const content =
    options.content ||
    "- [*] #task Write the onboarding guide [priority:: medium] [scheduled:: 2026-10-06] [effort:: small] ^guide";
  const editor = options.editor || makeEditor(content);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = options.app || {};
  plugin.getFreshnessApi = () =>
    Object.prototype.hasOwnProperty.call(options, "freshnessApi")
      ? options.freshnessApi
      : freshnessApi();
  const modal = new BulletPropertyPickerModal(
    plugin.app,
    plugin,
    editor,
    { line: 0, ch: 0 },
    content.split(/\n/)[0],
    options.config || buildConfig(),
    {
      filePath: options.filePath || "Areas/Work_ship.md",
      propertyContext: { isObsidianTask: true },
      baseDate: BASE_DATE,
      random: sequence([0.1, 0.35, 0.6, 0.8, 0.95, 0.2, 0.45, 0.7]),
      taskSession: options.taskSession || null,
      linkSession: options.linkSession || null,
      ...options.context,
    },
  );
  modal.open();
  return { modal, editor, plugin };
}

function openTaskCardLinkWriter(options = {}) {
  const notes = {
    "Tasks/Alpha.md": "- [ ] #task Alpha [priority:: medium] [scheduled:: 2026-10-12] ^alpha",
    "Tasks/Beta.md": "- [ ] #task Beta [priority:: medium] [scheduled:: 2026-10-13] ^beta",
  };
  const files = new Map(
    Object.keys(notes).map((path) => [path, { path, basename: path.split("/").pop(), extension: "md" }]),
  );
  const writeAttempts = [];
  let failedPathWrite = false;
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()],
      cachedRead: async (file) => notes[file.path] ?? null,
      read: async (file) => notes[file.path] ?? null,
      process: async (file, transform) => {
        writeAttempts.push(file.path);
        if (options.failWritePath === file.path && !failedPathWrite) {
          failedPathWrite = true;
          throw new Error("injected note write failure");
        }
        notes[file.path] = transform(notes[file.path]);
      },
    },
    workspace: { getLeavesOfType: () => [] },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getFreshnessApi = () => freshnessApi();
  plugin.getOpenMarkdownEditorForPath = () => null;
  const resolved = ["Alpha", "Beta"].map((name) => {
    const path = `Tasks/${name}.md`;
    const rawLine = notes[path];
    return {
      path,
      file: files.get(path),
      content: rawLine,
      line: 0,
      rawLine,
      blockId: name.toLowerCase(),
      displayText: name,
    };
  });
  const source = "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]";
  const editor = makeEditor(source);
  const session = {
    kind: "task-link",
    valid: true,
    requestedCount: 2,
    actualCount: 2,
    clamped: false,
    targets: [{ line: 0 }, { line: 1 }],
    resolved,
  };
  const modal = new BulletPropertyPickerModal(
    app,
    plugin,
    editor,
    { line: 0, ch: 0 },
    source.split("\n")[0],
    buildConfig(),
    {
      filePath: "2026/20261003.md",
      propertyContext: { isObsidianTask: false },
      linkSession: session,
      baseDate: BASE_DATE,
      random: () => 0,
    },
  );
  plugin.activeBulletPropertyPicker = modal;
  modal.open();
  return { app, editor, files, modal, notes, plugin, writeAttempts };
}

test("styles share key-card tokens and compact Task Card dimensions", () => {
  assert.match(STYLES, /\.bob-key-card-key/);
  assert.match(STYLES, /\.bob-key-card-row/);
  assert.match(STYLES, /\.modal\.bob-cnp-modal\.bob-task-card-modal/);
  assert.match(STYLES, /min\(600px, 92vw\)/);
  assert.match(STYLES, /75vh/);
  assert.match(STYLES, /\.bob-task-card-wide/);
});

test("card renderer paints header, banner, strip, stable rows, more, and footer from the model", () => {
  const model = makeModel();
  const root = new ElementStub();
  let rolls = 0;
  const wrappedRandom = model.priorityStrip;
  assert.ok(wrappedRandom);
  renderTaskCardView(root, model);
  assert.equal(rolls, 0);
  const text = flattenText(root);
  assert.match(text, /Ship report/);
  assert.match(text, /Work_ship/);
  assert.match(text, /READY/);
  assert.match(text, /P2/);
  assert.match(text, /Ctrl\+Enter/);
  assert.match(text, /Schedule…/);
  assert.match(text, /Blocked by…/);
  assert.match(text, /Review every…/);
  assert.match(text, /Cancel/);
  assert.match(text, /effort/);
  assert.match(text, /Ctrl\+D clear selected property/);
  assert.match(text, /Esc \/ q \/ Ctrl\+\] close/);
  assert.doesNotMatch(text, /type to search/i);
  assert.equal(byClass(root, "bob-task-card-close").length, 1);
  assert.equal(byClass(root, "bob-task-card-banner").length, 1);
  assert.equal(byClass(root, "bob-task-card-strip").length, 1);
  assert.ok(byClass(root, "bob-task-card-row").length >= 5);
  const rows = orderedTaskCardRows(model).map((row) => row.id);
  assert.deepEqual(rows, [
    "schedule",
    "depends-on",
    "review-every",
    "lane",
    "cancel",
  ]);
  const list = byClass(root, "bob-task-card-actions")[0];
  assert.equal(list.attributes.role, "listbox");
  const strip = byClass(root, "bob-task-card-strip")[0];
  assert.equal(strip.attributes.role, "radiogroup");
  assert.ok(list.focused);
});

test("renderer does not consume randomness or invent recommendation data", () => {
  let draws = 0;
  const model = makeModel({
    random: () => {
      draws += 1;
      return 0.2;
    },
  });
  const before = draws;
  const root = new ElementStub();
  renderTaskCardView(root, model);
  assert.equal(draws, before);
  assert.match(flattenText(root), new RegExp(model.recommendation.preview.action));
});

test("no-recommendation, cancel, mixed, long text, missing API, and error states render", () => {
  const root = new ElementStub();
  const noRec = makeModel({
    content: "- [ ] #task Unknown [priority:: urgent] ^unknown",
    lineText: "- [ ] #task Unknown [priority:: urgent] ^unknown",
  });
  renderTaskCardView(root, noRec);
  assert.equal(byClass(root, "bob-task-card-banner").length, 0);

  const cancelModel = {
    ...makeModel(),
    recommendation: {
      kind: "single",
      available: true,
      source: { kind: "cancel", level: { label: "P4" }, streak: 2 },
      preview: {
        kind: "cancel",
        tone: "danger",
        action: "Cancel task",
        dateText: "",
        meta: "decayed past P4",
      },
      effects: { roll: 0, decay: 0, cancel: 1 },
      targetCount: 1,
    },
    timeline: null,
  };
  renderTaskCardView(root, cancelModel);
  const banner = byClass(root, "bob-task-card-banner")[0];
  assert.ok(banner.classes.includes("is-danger") || banner.classes.includes("is-cancel"));
  assert.match(flattenText(banner), /Cancel task/);

  const long =
    "Write the onboarding guide for every workspace operator who needs a very long title that wraps past two lines and still remains available";
  const longModel = makeModel({
    content: `- [ ] #task ${long} [priority:: medium] [scheduled:: 2026-10-12] ^long`,
    lineText: `- [ ] #task ${long} [priority:: medium] [scheduled:: 2026-10-12] ^long`,
  });
  renderTaskCardView(root, longModel);
  const title = byClass(root, "bob-task-card-title")[0];
  assert.equal(title.attributes.title, long);

  const noApi = makeModel({ freshnessApi: null });
  renderTaskCardView(root, noApi);
  assert.match(flattenText(root), /Freshness API/);

  const errorModel = planTaskCard({
    config: buildConfig(),
    content: "",
    lineText: "",
    cursorLine: 0,
    filePath: "Areas/Empty.md",
    baseDate: BASE_DATE,
  });
  renderTaskCardView(root, errorModel);
  assert.equal(byClass(root, "bob-task-card-error").length, 1);
  assert.match(flattenText(root), /No task or bullet is selected/);
});

test("counted and linked cards disclose mixed values and Task Link notes", () => {
  const content = [
    "- [/] #task A [priority:: high] [scheduled:: 2026-10-10] ^a",
    "- [*] #task B [priority:: medium] [scheduled:: 2026-10-11] ^b",
  ].join("\n");
  const counted = makeModel({
    content,
    lineText: content.split("\n")[0],
    taskSession: {
      valid: true,
      explicit: true,
      requestedCount: 2,
      actualCount: 2,
      targets: [
        { line: 0, rawLine: content.split("\n")[0] },
        { line: 1, rawLine: content.split("\n")[1] },
      ],
    },
  });
  const root = new ElementStub();
  renderTaskCardView(root, counted);
  assert.match(flattenText(root), /2 tasks|mixed/);
  assert.ok(byClass(root, "bob-task-card-disclosure").length >= 1);

  const linked = makeModel({
    content: "- [[A#^alpha]]",
    lineText: "- [[A#^alpha]]",
    filePath: "2026/20261003.md",
    linkSession: {
      kind: "task-link",
      requestedCount: 2,
      targets: [{ line: 0 }, { line: 1 }],
      resolved: [
        {
          path: "Tasks/Alpha.md",
          line: 0,
          rawLine: "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha",
        },
        {
          path: "Tasks/Beta.md",
          line: 4,
          rawLine: "- [ ] #task Beta [priority:: medium] [scheduled:: 2026-10-18] ^beta",
        },
      ],
    },
  });
  renderTaskCardView(root, linked);
  const linkedText = flattenText(root);
  assert.match(linkedText, /via Task Link/);
  assert.match(linkedText, /Alpha/);
  assert.match(linkedText, /Beta/);
});

const CLASSIC_LIST_TEXT = /Set bullet property|Filter properties|Filter bullet properties|No matching properties/;

function assertNoClassicList(modal) {
  assert.doesNotMatch(flattenText(modal.contentEl), CLASSIC_LIST_TEXT);
  assert.notEqual(modal.title, "Set bullet property");
  assert.notEqual(modal.placeholder, "Filter properties");
  assert.notEqual(modal.stage, "properties");
  // The property list footer was Navigate / Move / Choose / Delete / Dismiss.
  assert.doesNotMatch(flattenText(modal.contentEl), /↵ Choose|\^D Delete/);
}

test("Ctrl+Shift+P always opens the Task Card, never the classic property list", () => {
  const { modal } = openPropertyPicker();
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.hasTaskCard, true);
  assert.ok(modal.modalEl.classes.includes("bob-task-card-modal"));
  assertNoClassicList(modal);
  assert.match(flattenText(modal.contentEl), /Schedule…/);
  assert.equal(modal.inputEl, null);
});

test("the plugin carries no Task Card pilot setting, date gate, or classic preference", () => {
  const source = require("fs").readFileSync(
    require("path").join(__dirname, "../plugins/bob-navigation-hotkeys/main.js"),
    "utf8",
  );
  for (const name of [
    "taskCardDefaultEnabled",
    "taskCardPilotEnabled",
    "taskCardPreferenceValue",
    "mergeTaskCardPilotPreference",
    "TaskCardPilotSettingTab",
    "isTaskCardPilotEnabled",
    "loadTaskCardSettings",
    "setTaskCardPreference",
    "showSearchFromCard",
    "open-search",
    "Set bullet property",
    "Filter properties",
  ]) {
    assert.equal(source.includes(name), false, `${name} must be gone`);
  }
  const plugin = new NavigationHotkeysPlugin();
  assert.equal(typeof plugin.isTaskCardPilotEnabled, "undefined");
  assert.equal(typeof plugin.addSettingTab, "undefined");
});

test("a leftover persisted taskCard flag is ignored and never rewritten", async () => {
  for (const taskCard of [true, false, null, "unexpected"]) {
    const content = "- [ ] #task Ship report [priority:: medium] ^ship";
    const editor = makeEditor(content);
    editor.getCursor = () => ({ line: 0, ch: 0 });
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {};
    plugin.getFreshnessApi = () => freshnessApi();
    plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });
    let loaded = 0;
    let saved = 0;
    plugin.loadData = async () => {
      loaded += 1;
      return { taskCard };
    };
    plugin.saveData = async () => {
      saved += 1;
    };
    openedModals.length = 0;
    assert.equal(plugin.openBulletPropertyPicker(editor, { config: buildConfig() }), true);
    const modal = plugin.activeBulletPropertyPicker;
    assert.equal(modal.stage, "task-card");
    assertNoClassicList(modal);
    modal.close();
    assert.equal(loaded, 0);
    assert.equal(saved, 0);
  }
});

test("palette command is named Task card (set properties)", () => {
  const source = require("fs").readFileSync(
    require("path").join(__dirname, "../plugins/bob-navigation-hotkeys/main.js"),
    "utf8",
  );
  assert.match(
    source,
    /id: "set-bullet-property"[\s\S]{0,80}name: "Task card \(set properties\)"/,
  );
});

test("Task Card opens the compact card with dialog semantics and a close control", () => {
  const { modal, editor } = openPropertyPicker();
  assert.equal(modal.stage, "task-card");
  assert.ok(modal.modalEl.classes.includes("bob-cnp-modal"));
  assert.ok(modal.modalEl.classes.includes("bob-task-card-modal"));
  assert.equal(modal.modalEl.attributes.role, "dialog");
  assert.equal(modal.modalEl.attributes["aria-modal"], "true");
  const text = flattenText(modal.contentEl);
  assert.match(text, /Write the onboarding guide/);
  assert.match(text, /Schedule…/);
  assert.match(text, /Blocked by…/);
  assert.equal(editor.writes(), 0);
  const close = byClass(modal.contentEl, "bob-task-card-close")[0];
  close.listeners.click({ preventDefault() {} });
  assert.equal(modal.isOpen, false);
});

test("a More row opens that property's value stage, never a filter list, and Back restores the card", () => {
  const { modal, editor } = openPropertyPicker();
  const rows = byClass(modal.contentEl, "bob-task-card-more-row");
  assert.equal(rows.length, 1);
  assert.match(flattenText(rows[0]), /effort/);
  rows[0].listeners.click({ preventDefault() {} });
  assert.equal(modal.stage, "value");
  assert.equal(modal.selectedPropertyItem.property.name, "effort");
  assert.equal(modal.title, "effort");
  assert.ok(modal.modalEl.classes.includes("bob-task-card-modal"));
  assert.equal(modal.inputEl.value, "");
  assert.deepEqual(
    modal.items.map((item) => item.value),
    ["small", "large"],
  );
  assertNoClassicList(modal);
  const back = byClass(modal.contentEl, "bob-task-card-back")[0];
  assert.ok(back);
  back.listeners.click({ preventDefault() {} });
  assert.equal(modal.stage, "task-card");
  assert.match(flattenText(modal.contentEl), /Schedule…/);
  assert.equal(editor.writes(), 0);
});

test("card focus is synchronous; action keys and Back route through the existing stages", () => {
  const { modal } = openPropertyPicker({
    content: "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship",
  });
  assert.equal(modal.taskCardListEl.focused, true);
  const enter = dispatchCardKey(modal, "Enter");
  assert.equal(enter.prevented, true);
  assert.equal(enter.stopped, true);
  assert.equal(modal.stage, "value");
  assert.equal(modal.selectedPropertyItem.property.name, "scheduled");

  const backspace = {
    key: "Backspace",
    target: modal.inputEl,
    preventDefault() {},
    stopPropagation() {},
  };
  modal.inputEl.listeners.keydown(backspace);
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.taskCardListEl.focused, true);

  for (const key of ["p", "/", "z", "5", "6", "9"]) {
    const result = dispatchCardKey(modal, key);
    assert.equal(modal.stage, "task-card", `${key} must not leave the card`);
    assertNoClassicList(modal);
    assert.equal(modal.inputEl, null);
    assert.equal(result.stopped, key === "5" || key === "6" || key === "9");
  }
  assert.equal(byClass(modal.contentEl, "bob-task-card-back").length, 0);
});

test("Task Card action keys enter the retained property, refresh, dependency, cancel, and lane stages", async () => {
  const scenarios = [
    {
      key: "Enter",
      content: "- [ ] #task Schedule me [priority:: medium] [scheduled:: 2026-10-12] ^schedule",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.selectedPropertyItem.property.name, "scheduled");
      },
    },
    {
      key: "b",
      content: "- [ ] #task Add a dependency [priority:: medium] ^dependency",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.selectedPropertyItem.property.values, "local_task_id");
      },
    },
    {
      key: "f",
      content: "- [ ] #task Change review [priority:: medium] ^refresh",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.selectedPropertyItem.kind, "refresh-interval");
      },
    },
    {
      key: "x",
      content: "- [ ] #task Cancel me [priority:: medium] ^cancel",
      check(modal) {
        assert.equal(modal.stage, "cancel-reason");
      },
    },
    {
      key: "n",
      modifiers: { altKey: true },
      content: "- [/] #task Release me [priority:: medium] ^release",
      check(modal) {
        assert.equal(modal.stage, "lane-release-reason");
      },
    },
  ];

  for (const scenario of scenarios) {
    const { modal } = openPropertyPicker({
      taskCard: true,
      content: scenario.content,
    });
    dispatchCardKey(modal, scenario.key, scenario.modifiers || {});
    await nextTurn();
    modal.renderAll();
    scenario.check(modal);
    assert.ok(modal.contentEl.children.length > 0);
  }

  const configuredList = openPropertyPicker();
  byClass(configuredList.modal.contentEl, "bob-task-card-more-row")[0].listeners.click({
    preventDefault() {},
  });
  await nextTurn();
  configuredList.modal.renderAll();
  assert.equal(configuredList.modal.stage, "value");
  assert.equal(configuredList.modal.selectedPropertyItem.property.name, "effort");

  const blockId = openPropertyPicker();
  blockId.modal.ensureTaskCardStageChrome();
  blockId.modal.inputEl.select = () => {};
  blockId.modal.showBlockIdStage({
    path: "Tasks/Other.md",
    line: 2,
    rawLine: "- [ ] #task A dependency target",
    displayText: "A dependency target",
    existingIdField: "",
  });
  blockId.modal.renderAll();
  assert.equal(blockId.modal.stage, "blockid");
  assert.ok(blockId.modal.inputEl);
});

test("Task Link opens focused while resolving and consumes keys without replay", async () => {
  const content = "- [[Tasks/Alpha#^alpha]]";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
  let resolveTargets;
  plugin.resolveLinkPickerTargets = () => new Promise((resolve) => {
    resolveTargets = resolve;
  });

  const resolving = plugin.openLinkPicker(editor, {
    config: buildConfig(),
    baseDate: BASE_DATE,
  });
  const modal = plugin.activeBulletPropertyPicker;
  assert.ok(modal);
  assert.equal(modal.isOpen, true);
  assert.equal(modal.linkResolving, true);
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.taskCardListEl.focused, true);
  const enter = dispatchCardKey(modal, "x");
  assert.deepEqual(enter, { prevented: true, stopped: true });
  assert.equal(modal.stage, "task-card");
  assert.equal(editor.writes(), 0);

  resolveTargets({
    error: null,
    targets: [{
      path: "Tasks/Alpha.md",
      file: { path: "Tasks/Alpha.md" },
      content: "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha\n",
      line: 0,
      rawLine: "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha",
      blockId: "alpha",
      displayText: "Alpha",
    }],
  });
  assert.equal(await resolving, true);
  assert.equal(modal.linkResolving, false);
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.isOpen, true);
  assert.match(flattenText(modal.contentEl), /Alpha/);
});

test("Task Link count replacement and source edits invalidate old resolutions", async () => {
  let content = "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]";
  const editor = {
    getValue: () => content,
    getLine: (line) => content.split(/\r?\n/)[line] ?? null,
    getCursor: () => ({ line: 0, ch: 0 }),
    writes: 0,
    replaceRange() { this.writes += 1; },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
  const pending = [];
  plugin.resolveLinkPickerTargets = () => new Promise((resolve) => pending.push(resolve));

  const firstResolution = plugin.openLinkPicker(editor, {
    config: buildConfig(),
  });
  const firstModal = plugin.activeBulletPropertyPicker;
  const countedResolution = plugin.openLinkPicker(editor, {
    config: buildConfig(),
    countExplicit: true,
    additionalTaskCount: 1,
  });
  const countedModal = plugin.activeBulletPropertyPicker;
  assert.ok(countedModal);
  assert.notEqual(countedModal, firstModal);
  assert.equal(firstModal.isOpen, false);

  pending[0]({ error: null, targets: [] });
  assert.equal(await firstResolution, false);
  assert.equal(plugin.activeBulletPropertyPicker, countedModal);
  assert.equal(countedModal.linkResolving, true);

  content += "\nchanged while targets were loading";
  pending[1]({ error: null, targets: [] });
  assert.equal(await countedResolution, false);
  assert.equal(countedModal.isOpen, false);
  assert.equal(plugin.activeBulletPropertyPicker, null);
  assert.equal(editor.writes, 0);
});

test("Task Link resolution failure and plugin unload close their shells", async () => {
  const content = "- [[Tasks/Alpha#^alpha]]";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const failed = new NavigationHotkeysPlugin();
  failed.app = {};
  failed.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
  failed.resolveLinkPickerTargets = async () => ({ error: "target read failed", targets: null });
  const failure = failed.openLinkPicker(editor, { config: buildConfig() });
  const failedModal = failed.activeBulletPropertyPicker;
  assert.equal(failedModal.linkResolving, true);
  assert.equal(await failure, false);
  assert.equal(failedModal.isOpen, false);
  assert.equal(failed.activeBulletPropertyPicker, null);

  const unloading = new NavigationHotkeysPlugin();
  unloading.app = {};
  unloading.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
  let resolveTargets;
  unloading.resolveLinkPickerTargets = () => new Promise((resolve) => { resolveTargets = resolve; });
  const pendingResolution = unloading.openLinkPicker(editor, { config: buildConfig() });
  const unloadingModal = unloading.activeBulletPropertyPicker;
  unloading.onunload();
  resolveTargets({ error: null, targets: [] });
  assert.equal(await pendingResolution, false);
  assert.equal(unloadingModal.isOpen, false);
  assert.equal(unloading.activeBulletPropertyPicker, null);
});

test("direct Depends on entry opens the dependency stage without painting the card or the list", () => {
  const content = "- [ ] #task Parent [priority:: medium] ^parent";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });

  assert.equal(plugin.openBulletPropertyPicker(editor, {
    config: buildConfig(),
    initialProperty: "dependsOn",
  }), true);
  const modal = plugin.activeBulletPropertyPicker;
  assert.ok(modal);
  assert.equal(modal.hasTaskCard, false);
  assert.equal(modal.directStage, true);
  assert.equal(modal.stage, "value");
  assert.equal(modal.selectedPropertyItem.property.values, "local_task_id");
  assert.ok(!modal.modalEl.classes.includes("bob-task-card-modal"));
  assert.equal(byClass(modal.contentEl, "bob-task-card").length, 0);
  assert.equal(byClass(modal.contentEl, "bob-task-card-back").length, 0);
  assertNoClassicList(modal);
  assert.equal(editor.writes(), 0);
  modal.close();
});

test("a direct stage for an unconfigured property closes instead of leaving an empty modal", () => {
  const content = "- [ ] #task Parent [priority:: medium] ^parent";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });
  assert.equal(plugin.openBulletPropertyPicker(editor, {
    config: buildConfig(),
    initialProperty: "noSuchProperty",
  }), false);
  assert.equal(plugin.activeBulletPropertyPicker, null);
  assert.equal(editor.writes(), 0);
});

test("a refused direct stage closes instead of landing on a card or a list", () => {
  const content = "- [ ] #task Parent [priority:: medium] ^parent";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });
  assert.equal(plugin.openBulletPropertyPicker(editor, {
    config: buildConfig(),
    initialProperty: "dependsOn",
  }), true);
  const modal = plugin.activeBulletPropertyPicker;
  modal.returnHome();
  assert.equal(modal.isOpen, false);
  assert.equal(editor.writes(), 0);
});

test("priority gesture writes the frozen date and duplicate dispatch is single-flight", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ content });
  const preview = modal.taskCardModel.priorityStrip.levels[1];
  let writes = 0;
  let writtenContext = null;
  plugin.setBulletPriorityValue = async (...args) => {
    writes += 1;
    writtenContext = args[6];
    return true;
  };
  dispatchCardKey(modal, "2");
  dispatchCardKey(modal, "2");
  await nextTurn();
  assert.equal(writes, 1);
  assert.ok(writtenContext, "priority writer receives frozen writer options");
  assert.ok(writtenContext.precomputedRoll, JSON.stringify(writtenContext));
  assert.equal(writtenContext.precomputedRoll.date, preview.date);
  assert.equal(writtenContext.precomputedRoll.offset, preview.targetPreviews[0].offset);
  assert.equal(modal.isOpen, false);

  const clicked = openPropertyPicker({ content });
  let clickWrites = 0;
  clicked.plugin.setBulletPriorityValue = async () => { clickWrites += 1; return true; };
  const secondLevel = byClass(clicked.modal.contentEl, "bob-task-card-level")[1];
  secondLevel.listeners.click({ preventDefault() {} });
  secondLevel.listeners.click({ preventDefault() {} });
  await nextTurn();
  assert.equal(clickWrites, 1);
});

test("pending priority action passes its card preview through the Work Log adapter", async () => {
  const content = "- [/] #task Pending work [priority:: medium] ^pending";
  const { modal, plugin } = openPropertyPicker({ content });
  const preview = modal.taskCardModel.priorityStrip.levels[1];
  let writtenContext = null;
  plugin.setBulletPriorityValue = async (...args) => {
    writtenContext = args[6];
    return true;
  };
  modal.offerSchedulingWorkLogOrDispatch = async ({ dispatch }) => await dispatch("");

  dispatchCardKey(modal, "2");
  await nextTurn();
  assert.ok(writtenContext && writtenContext.precomputedRoll);
  assert.equal(writtenContext.precomputedRoll.date, preview.date);
  assert.equal(writtenContext.precomputedRoll.offset, preview.targetPreviews[0].offset);
});

test("Task Link priority action refuses a stale cross-note preflight before writes", async () => {
  const fixture = openTaskCardLinkWriter();
  const betaBefore = fixture.notes["Tasks/Beta.md"];
  fixture.notes["Tasks/Alpha.md"] += " — edited elsewhere";

  dispatchCardKey(fixture.modal, "2");
  await nextTurn();

  assert.equal(fixture.writeAttempts.length, 0);
  assert.match(fixture.notes["Tasks/Alpha.md"], /edited elsewhere/);
  assert.equal(fixture.notes["Tasks/Beta.md"], betaBefore);
  assert.equal(fixture.modal.isOpen, true);
});

test("Task Link priority action rolls back earlier note writes after a later write fails", async () => {
  const fixture = openTaskCardLinkWriter({ failWritePath: "Tasks/Beta.md" });
  const alphaBefore = fixture.notes["Tasks/Alpha.md"];
  const betaBefore = fixture.notes["Tasks/Beta.md"];

  dispatchCardKey(fixture.modal, "2");
  await nextTurn();

  assert.deepEqual(fixture.writeAttempts, [
    "Tasks/Alpha.md",
    "Tasks/Beta.md",
    "Tasks/Alpha.md",
  ]);
  assert.equal(fixture.notes["Tasks/Alpha.md"], alphaBefore);
  assert.equal(fixture.notes["Tasks/Beta.md"], betaBefore);
  assert.equal(fixture.modal.isOpen, true);
});

test("Task Link transaction reports a cleanup failure without implying global undo", async () => {
  const fixture = openTaskCardLinkWriter();
  const dailyPath = "2026/20261003.md";
  const dailyBefore = "## Pomodoros\n- [ ] Current\n  - [[Tasks/Alpha#^alpha]]";
  fixture.files.set(dailyPath, { path: dailyPath, basename: "20261003.md", extension: "md" });
  fixture.notes[dailyPath] = dailyBefore;
  const alpha = fixture.notes["Tasks/Alpha.md"];
  const alphaAfter = alpha.replace("[priority:: medium]", "[priority:: low]");
  const alphaFile = fixture.files.get("Tasks/Alpha.md");
  fixture.plugin.writeDeferredPomodoroCleanup = async () => false;

  const receipt = await fixture.plugin.commitLinkPickerNoteWrites(
    [{
      group: { path: "Tasks/Alpha.md", file: alphaFile, content: alpha },
      plan: { content: alphaAfter },
    }],
    {
      pomodoroSnapshot: {
        dailyPath,
        file: fixture.files.get(dailyPath),
        content: dailyBefore,
      },
      dailyCleanupPlan: {
        changed: true,
        content: dailyBefore.replace("  - [[Tasks/Alpha#^alpha]]", ""),
      },
    },
  );

  assert.deepEqual(receipt, { ok: true, reason: null, pomodoroPruneFailed: true });
  assert.equal(fixture.notes["Tasks/Alpha.md"], alphaAfter);
  assert.equal(fixture.notes[dailyPath], dailyBefore);
  assert.deepEqual(fixture.writeAttempts, ["Tasks/Alpha.md"]);
});

test("selected-property deletion uses the existing writer; other card rows stay non-deletable", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ content });
  let deleted = null;
  plugin.deleteBulletPropertyValue = async (_editor, _cursor, propertyName) => {
    deleted = propertyName;
    return { deleted: true };
  };
  dispatchCardKey(modal, "d", { ctrlKey: true });
  await nextTurn();
  assert.equal(deleted, "scheduled");
  assert.equal(modal.isOpen, false);

  const next = openPropertyPicker({ content });
  dispatchCardKey(next.modal, "ArrowDown");
  assert.equal(next.modal.taskCardSelectedRowId, "depends-on");
  dispatchCardKey(next.modal, "d", { ctrlKey: true });
  await nextTurn();
  assert.equal(next.modal.stage, "task-card");
  assert.equal(next.editor.writes(), 0);
});

test("failed deletions keep the card: 0 on unprioritized and Ctrl+D on unscheduled write nothing", async () => {
  const bare = "- [ ] #task Plain work ^plain";
  const zero = openPropertyPicker({ content: bare });
  zero.plugin.deleteBulletPropertyValue = async () => {
    throw new Error("no writer call expected");
  };
  dispatchCardKey(zero.modal, "0");
  await nextTurn();
  assert.equal(zero.modal.isOpen, true);
  assert.equal(zero.modal.stage, "task-card");
  assert.equal(zero.editor.writes(), 0);

  const unscheduled = openPropertyPicker({
    content: "- [ ] #task Plain work [priority:: medium] ^plain",
  });
  unscheduled.plugin.deleteBulletPropertyValue = async () => {
    throw new Error("no writer call expected");
  };
  assert.equal(unscheduled.modal.taskCardSelectedRowId, "schedule");
  dispatchCardKey(unscheduled.modal, "d", { ctrlKey: true });
  await nextTurn();
  assert.equal(unscheduled.modal.isOpen, true);
  assert.equal(unscheduled.modal.stage, "task-card");
  assert.equal(unscheduled.editor.writes(), 0);
  assert.ok(unscheduled.modal.taskCardListEl, "card list is rendered again");
});

test("a refused deletion rebuilds the card from the refreshed line", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const refreshed = "- [ ] #task Ship report [priority:: high] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ content });
  plugin.deleteBulletPropertyValue = async () => ({ deleted: false, line: refreshed });
  dispatchCardKey(modal, "0");
  await nextTurn();
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.lineText, refreshed);
  assert.equal(modal.taskCardModel.kind, "task-card");
  assert.equal(modal.taskCardModel.priorityStrip.levels.find((level) => level.value === "high") ? "high" : "", "high");
});

test("0 deletes only priority and keeps the scheduled field byte-for-byte", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  let current = content;
  const editor = {
    getValue: () => current,
    getLine: (line) => (line === 0 ? current : null),
    replaceRange(text) {
      current = text;
    },
    writes: () => 0,
  };
  const { modal, plugin } = openPropertyPicker({ content, editor });
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Areas/Work_ship.md" } });
  dispatchCardKey(modal, "0");
  await nextTurn();
  await nextTurn();
  assert.doesNotMatch(current, /priority::/);
  assert.match(current, /\[scheduled:: 2026-10-12\]/);
  assert.equal(modal.isOpen, false);
});

test("card keys pressed on a priority radio or the banner reach the resolver exactly once", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ content });
  let writes = 0;
  plugin.setBulletPriorityValue = async () => {
    writes += 1;
    return true;
  };
  const radios = byClass(modal.contentEl, "bob-task-card-level");
  const keyEvent = (key, extra = {}) => ({
    key,
    target: radios[0],
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  });
  radios[0].listeners.keydown(keyEvent("2"));
  radios[0].listeners.keydown(keyEvent("2", { repeat: true }));
  await nextTurn();
  assert.equal(writes, 1);
  assert.equal(modal.isOpen, false);

  const other = openPropertyPicker({ content });
  const seen = [];
  const original = other.modal.handleTaskCardKeydown.bind(other.modal);
  other.modal.handleTaskCardKeydown = (event) => {
    seen.push(event.key);
    original(event);
  };
  const banner = byClass(other.modal.contentEl, "bob-task-card-banner")[0];
  assert.ok(banner, "banner renders");
  banner.listeners.keydown({ key: "r", ctrlKey: true, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(seen, ["r"]);
  dispatchCardKey(other.modal, "r", { ctrlKey: true });
  assert.deepEqual(seen, ["r", "r"]);
  other.modal.close();
});

test("held or composing Enter on a radio or the banner never writes", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ content });
  let writes = 0;
  plugin.setBulletPriorityValue = async () => { writes += 1; return true; };
  plugin.setBulletPropertyValue = async () => { writes += 1; return true; };
  const radio = byClass(modal.contentEl, "bob-task-card-level")[1];
  const banner = byClass(modal.contentEl, "bob-task-card-banner")[0];
  const press = (element, extra) =>
    element.listeners.keydown({
      key: "Enter",
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    });
  press(radio, { repeat: true });
  press(radio, { isComposing: true });
  press(radio, { keyCode: 229 });
  press(banner, { repeat: true });
  press(banner, { isComposing: true });
  press(banner, { keyCode: 229 });
  await nextTurn();
  assert.equal(writes, 0);
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "task-card");

  press(radio, {});
  await nextTurn();
  assert.equal(writes, 1);
});

// Keyboard fixtures for the close keys. `target` decides whether a handler
// sees a text field; stopped/prevented record what a handler consumed.
function closeKeyEvent(key, extra = {}) {
  const event = {
    key,
    prevented: false,
    stopped: false,
    preventDefault() { event.prevented = true; },
    stopPropagation() { event.stopped = true; },
    ...extra,
  };
  return event;
}

const CTRL_RIGHT_BRACKET = { key: "]", code: "BracketRight", ctrlKey: true };

function pressStageKey(modal, element, key, extra = {}) {
  const event = closeKeyEvent(key, { target: element, ...extra });
  element.listeners.keydown(event);
  return event;
}

test("Escape, q, Q, and Ctrl+] close the card without writing", async () => {
  for (const [key, modifiers] of [
    ["Escape", {}],
    ["q", {}],
    ["Q", { shiftKey: true }],
    ["]", { ctrlKey: true, code: "BracketRight" }],
    ["]", { ctrlKey: true }],
    ["x", { ctrlKey: true, code: "BracketRight" }],
  ]) {
    const { modal, editor, plugin } = openPropertyPicker();
    plugin.activeBulletPropertyPicker = modal;
    let written = 0;
    for (const name of [
      "setBulletPriorityValue",
      "setBulletPropertyValue",
      "deleteBulletPropertyValue",
      "applyLaneToggleFromPicker",
      "applyTaskCancelFromPicker",
    ]) {
      plugin[name] = async () => {
        written += 1;
        return true;
      };
    }
    const event = closeKeyEvent(key, { target: modal.taskCardListEl, ...modifiers });
    modal.taskCardListEl.listeners.keydown(event);
    await nextTurn();
    assert.equal(modal.isOpen, false, `${key} ${JSON.stringify(modifiers)}`);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(editor.writes(), 0);
    assert.equal(written, 0);
    assert.equal(plugin.activeBulletPropertyPicker, null);
  }
});

test("Ctrl+Q, Meta+Q, Alt+Q, and Ctrl+[ do not close the card", () => {
  const { modal } = openPropertyPicker();
  for (const extra of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { ctrlKey: true, shiftKey: true },
  ]) {
    dispatchCardKey(modal, "q", extra);
    dispatchCardKey(modal, "Q", extra);
    assert.equal(modal.isOpen, true, JSON.stringify(extra));
  }
  dispatchCardKey(modal, "[", { ctrlKey: true, code: "BracketLeft" });
  dispatchCardKey(modal, "]", { ctrlKey: true, altKey: true });
  dispatchCardKey(modal, "]", { ctrlKey: true, shiftKey: true });
  dispatchCardKey(modal, "]", {});
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "task-card");
});

test("repeated close keys and a second close() are harmless", async () => {
  const { modal, editor } = openPropertyPicker();
  dispatchCardKey(modal, "q");
  dispatchCardKey(modal, "q", { repeat: true });
  dispatchCardKey(modal, "]", { ctrlKey: true });
  modal.close();
  modal.close();
  await nextTurn();
  assert.equal(modal.isOpen, false);
  assert.equal(editor.writes(), 0);
});

test("composition never closes the card or a stage", () => {
  const { modal } = openPropertyPicker();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    dispatchCardKey(modal, "q", extra);
    dispatchCardKey(modal, "]", { ctrlKey: true, ...extra });
    dispatchCardKey(modal, "Escape", extra);
  }
  assert.equal(modal.isOpen, true);

  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    pressStageKey(modal, modal.inputEl, "]", { ctrlKey: true, ...extra });
  }
  assert.equal(modal.isOpen, true);
});

test("q typed into a stage's text field never closes the modal", () => {
  const { modal } = openPropertyPicker();
  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  for (const key of ["q", "Q"]) {
    const event = pressStageKey(modal, modal.inputEl, key);
    assert.equal(event.prevented, false);
  }
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "value");
});

test("Ctrl+] closes from a focused date field without writing", () => {
  const { modal, editor, plugin } = openPropertyPicker();
  let written = 0;
  plugin.setBulletPropertyValue = async () => {
    written += 1;
    return true;
  };
  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  modal.inputEl.value = "3 waiting on API";
  const event = pressStageKey(modal, modal.inputEl, "]", { ctrlKey: true, code: "BracketRight" });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.isOpen, false);
  assert.equal(written, 0);
  assert.equal(editor.writes(), 0);
});

test("Ctrl+] closes the schedule review from its Reason and Work summary fields", async () => {
  for (const field of ["reason", "summary"]) {
    const { modal, editor } = openPropertyPicker({
      content: "- [/] #task Pending work [priority:: medium] [scheduled:: 2026-10-12] ^pending",
    });
    dispatchCardKey(modal, "Enter");
    modal.inputEl.value = "3";
    modal.inputEl.listeners.input();
    modal.inputEl.listeners.keydown(closeKeyEvent("Enter", { target: modal.inputEl }));
    await nextTurn();
    assert.equal(modal.stage, "schedule-review");
    const element =
      field === "reason" ? modal.scheduleReviewReasonEl : modal.scheduleReviewSummaryEl;
    assert.ok(element, field);
    element.value = "typed but uncommitted";
    const q = pressStageKey(modal, element, "q");
    assert.equal(q.prevented, false);
    assert.equal(modal.isOpen, true);
    const event = pressStageKey(modal, element, "]", { ctrlKey: true, code: "BracketRight" });
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(modal.isOpen, false);
    assert.equal(modal.pendingScheduleReview, null);
    assert.equal(editor.writes(), 0);
  }
});

test("q closes from a focused More row and from the Close button", () => {
  for (const pick of [
    (modal) => byClass(modal.contentEl, "bob-task-card-more-row")[0],
    (modal) => byClass(modal.contentEl, "bob-task-card-close")[0],
  ]) {
    const { modal, editor } = openPropertyPicker();
    const element = pick(modal);
    const event = closeKeyEvent("q", { target: element });
    element.listeners.keydown(event);
    assert.equal(modal.isOpen, false);
    assert.equal(event.prevented, true);
    assert.equal(editor.writes(), 0);
  }
  const { modal } = openPropertyPicker();
  const row = byClass(modal.contentEl, "bob-task-card-more-row")[0];
  row.listeners.keydown(closeKeyEvent("z", { target: row }));
  row.listeners.keydown(closeKeyEvent("/", { target: row }));
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "task-card");
});

test("Ctrl+] closes from the Back button and the modal frame", () => {
  const { modal } = openPropertyPicker();
  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  assert.equal(typeof modal.modalEl.listeners.keydown, "function");
  const event = closeKeyEvent("]", { ctrlKey: true, code: "BracketRight" });
  modal.modalEl.listeners.keydown(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.isOpen, false);

  const other = openPropertyPicker();
  other.modal.modalEl.listeners.keydown(closeKeyEvent("]", { ctrlKey: true, isComposing: true }));
  other.modal.modalEl.listeners.keydown(closeKeyEvent("q"));
  assert.equal(other.modal.isOpen, true);
});

test("a More stage, a refresh stage, and a cancel stage close on Ctrl+] and Escape", () => {
  const stages = [
    (modal) => byClass(modal.contentEl, "bob-task-card-more-row")[0].listeners.click({ preventDefault() {} }),
    (modal) => dispatchCardKey(modal, "f"),
    (modal) => dispatchCardKey(modal, "x"),
  ];
  for (const open of stages) {
    for (const close of ["ctrl-bracket", "escape"]) {
      const { modal, editor } = openPropertyPicker();
      open(modal);
      assert.notEqual(modal.stage, "task-card");
      if (close === "escape") {
        modal.dispatchKey({ key: "Escape" });
      } else {
        modal.handleKeydown(closeKeyEvent("]", { ctrlKey: true, target: modal.inputEl }));
      }
      assert.equal(modal.isOpen, false, `${modal.stage} ${close}`);
      assert.equal(editor.writes(), 0);
    }
  }
});

test("a resolving Task Link closes on Escape, q, and Ctrl+] and swallows every other key", async () => {
  for (const [key, extra] of [
    ["Escape", {}],
    ["q", {}],
    ["Q", { shiftKey: true }],
    ["]", { ctrlKey: true, code: "BracketRight" }],
  ]) {
    const content = "- [[Tasks/Alpha#^alpha]]";
    const editor = makeEditor(content);
    editor.getCursor = () => ({ line: 0, ch: 0 });
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {};
    plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
    let resolveTargets;
    plugin.resolveLinkPickerTargets = () => new Promise((resolve) => {
      resolveTargets = resolve;
    });
    const resolving = plugin.openLinkPicker(editor, { config: buildConfig(), baseDate: BASE_DATE });
    const modal = plugin.activeBulletPropertyPicker;
    assert.equal(modal.linkResolving, true);
    assert.equal(modal.stage, "task-card");
    assertNoClassicList(modal);
    for (const swallowed of ["z", "/", "5", "Enter", "x"]) {
      const result = dispatchCardKey(modal, swallowed);
      assert.deepEqual(result, { prevented: true, stopped: true });
      assert.equal(modal.isOpen, true, swallowed);
    }
    const event = closeKeyEvent(key, { target: modal.taskCardListEl, ...extra });
    modal.taskCardListEl.listeners.keydown(event);
    assert.equal(modal.isOpen, false, key);
    assert.equal(editor.writes(), 0);
    resolveTargets({ error: null, targets: [] });
    assert.equal(await resolving, false);
  }
});

test("a direct dependency stage closes on Ctrl+] but keeps q as typed text", () => {
  const content = "- [ ] #task Parent [priority:: medium] ^parent";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });
  assert.equal(plugin.openBulletPropertyPicker(editor, {
    config: buildConfig(),
    initialProperty: "dependsOn",
  }), true);
  const modal = plugin.activeBulletPropertyPicker;
  assert.equal(modal.stage, "value");
  const q = pressStageKey(modal, modal.inputEl, "q");
  assert.equal(q.prevented, false);
  assert.equal(modal.isOpen, true);
  const event = pressStageKey(modal, modal.inputEl, "]", { ctrlKey: true, code: "BracketRight" });
  assert.equal(event.prevented, true);
  assert.equal(modal.isOpen, false);
  assert.equal(editor.writes(), 0);
});

test("q and Ctrl+] are not global closes: other modals and the decay card ignore them", () => {
  const app = {};
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  const child = new ChildNotePickerModal(app, plugin, [], { basename: "Parent" });
  child.open();
  child.inputEl.listeners.keydown(closeKeyEvent("q", { target: child.inputEl }));
  child.inputEl.listeners.keydown(closeKeyEvent("]", { ctrlKey: true, target: child.inputEl }));
  assert.equal(child.isOpen, true);

  const card = new FreshnessDecayCardModal({}, {
    rows: [
      { key: "1", label: "Not now", detail: "stamp only", action: "notNow", available: true },
    ],
  });
  card.open();
  card.contentEl.listeners.keydown(closeKeyEvent("q"));
  card.contentEl.listeners.keydown(closeKeyEvent("]", { ctrlKey: true }));
  assert.equal(card.isOpen, true);
  assert.equal(card.settled, false);
});

test("missing freshness API disables Review every with an honest reason", () => {
  const { modal } = openPropertyPicker({
    freshnessApi: null,
  });
  assert.match(flattenText(modal.contentEl), /Freshness API/);
  const disabled = byClass(modal.contentEl, "is-disabled");
  assert.ok(disabled.length >= 1);
});

test("child-note, task-move, and Pomodoro pickers keep generic bob-cnp-modal dimensions", () => {
  openedModals.length = 0;
  const app = {};
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  const child = new ChildNotePickerModal(app, plugin, [], { basename: "Parent" });
  child.open();
  assert.ok(child.modalEl.classes.includes("bob-cnp-modal"));
  assert.ok(!child.modalEl.classes.includes("bob-task-card-modal"));

  const move = new TaskMoveDestinationPickerModal(app, plugin, [], {
    discovery: { actualCount: 1, requestedCount: 1, clamped: false },
  });
  move.open();
  assert.ok(move.modalEl.classes.includes("bob-cnp-modal"));
  assert.ok(!move.modalEl.classes.includes("bob-task-card-modal"));

  const pomo = new PomodoroBulletMovePickerModal(app, plugin, {
    discovery: { actualCount: 1, requestedCount: 1, clamped: false },
    sourceEntry: { position: 1, entryLine: 2 },
    entries: [],
  });
  pomo.open();
  assert.ok(pomo.modalEl.classes.includes("bob-cnp-modal"));
  assert.ok(!pomo.modalEl.classes.includes("bob-task-card-modal"));

  const generic = new FilteredPickerModal(app, {
    items: [],
    title: "Open child note",
  });
  generic.open();
  assert.ok(generic.modalEl.classes.includes("bob-cnp-modal"));
  assert.ok(!generic.modalEl.classes.includes("bob-task-card-modal"));
});

test("decay card keeps its classes and shares key-card tokens", () => {
  openedModals.length = 0;
  const card = new FreshnessDecayCardModal(
    {},
    {
      title: "Kept 3 reviews in a row",
      rows: [
        {
          key: "1",
          label: "Not now",
          detail: "stamp only",
          action: "notNow",
          available: true,
        },
      ],
    },
  );
  card.open();
  assert.ok(card.modalEl.classes.includes("bob-decay-card-modal"));
  assert.ok(!card.modalEl.classes.includes("bob-task-card-modal"));
  assert.ok(card.contentEl.classes.includes("bob-key-card"));
  assert.ok(byClass(card.contentEl, "bob-decay-card-key").length >= 1);
  assert.ok(byClass(card.contentEl, "bob-key-card-key").length >= 1);
  assert.ok(byClass(card.contentEl, "bob-key-card-row").length >= 1);
});

test("decay card footer always names the X drop alias; the trial date is not this gate", () => {
  const createCard = (now) => new FreshnessDecayCardModal({}, {
    rows: [
      { key: "D", action: "drop", label: "Drop", detail: "cancel", available: true },
    ],
    now,
  });
  for (const now of [new Date(2026, 9, 3), new Date(2026, 9, 18), new Date(2026, 9, 19), undefined]) {
    const card = createCard(now);
    card.open();
    assert.match(flattenText(card.contentEl), /D \/ X drops/);
  }
});
