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
      taskCard: options.taskCard === true,
      taskSession: options.taskSession || null,
      linkSession: options.linkSession || null,
      ...options.context,
    },
  );
  modal.open();
  return { modal, editor, plugin };
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
  assert.match(text, /type to search/);
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
    "more-properties",
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

test("classic property picker stays on the generic modal width", () => {
  const { modal } = openPropertyPicker({ taskCard: false });
  assert.equal(modal.stage, "properties");
  assert.ok(modal.modalEl.classes.includes("bob-cnp-modal"));
  assert.ok(!modal.modalEl.classes.includes("bob-task-card-modal"));
  assert.match(flattenText(modal.contentEl), /Set bullet property|Filter/);
});

test("opt-in Task Card opens the compact card with dialog semantics and a close control", () => {
  const { modal, editor } = openPropertyPicker({ taskCard: true });
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

test("search transition keeps compact width, seeds the query, and Back restores the card", () => {
  const { modal } = openPropertyPicker({ taskCard: true });
  modal.showSearchFromCard("pr");
  assert.equal(modal.stage, "properties");
  assert.equal(modal.cardViewMode, "search");
  assert.ok(modal.modalEl.classes.includes("bob-task-card-modal"));
  assert.equal(modal.inputEl.value, "pr");
  assert.equal(modal.inputEl.attributes.role, "combobox");
  assert.match(flattenText(modal.contentEl), /priority/i);
  assert.ok(byClass(modal.contentEl, "bob-task-card-back").length >= 1);
  const back = byClass(modal.contentEl, "bob-task-card-back")[0];
  back.listeners.click({ preventDefault() {} });
  assert.equal(modal.stage, "task-card");
  assert.match(flattenText(modal.contentEl), /Schedule…/);
});

test("card focus is synchronous; action keys and Back route through the existing stages", () => {
  const { modal } = openPropertyPicker({
    taskCard: true,
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

  dispatchCardKey(modal, "p");
  assert.equal(modal.cardViewMode, "search");
  assert.equal(modal.inputEl.value, "p");
  assert.equal(byClass(modal.contentEl, "bob-task-card-back").length, 1);
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
    taskCard: true,
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
    taskCard: true,
    config: buildConfig(),
  });
  const firstModal = plugin.activeBulletPropertyPicker;
  const countedResolution = plugin.openLinkPicker(editor, {
    taskCard: true,
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
  const failure = failed.openLinkPicker(editor, { taskCard: true, config: buildConfig() });
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
  const pendingResolution = unloading.openLinkPicker(editor, { taskCard: true, config: buildConfig() });
  const unloadingModal = unloading.activeBulletPropertyPicker;
  unloading.onunload();
  resolveTargets({ error: null, targets: [] });
  assert.equal(await pendingResolution, false);
  assert.equal(unloadingModal.isOpen, false);
  assert.equal(unloading.activeBulletPropertyPicker, null);
});

test("Task Card pilot preserves direct Depends on entry", () => {
  const content = "- [ ] #task Parent [priority:: medium] ^parent";
  const editor = makeEditor(content);
  editor.getCursor = () => ({ line: 0, ch: 0 });
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.taskCardSettingsLoaded = true;
  plugin.taskCardData = { taskCard: true };
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Tasks.md" } });

  assert.equal(plugin.openBulletPropertyPicker(editor, {
    config: buildConfig(),
    initialProperty: "dependsOn",
  }), true);
  const modal = plugin.activeBulletPropertyPicker;
  assert.ok(modal);
  assert.equal(modal.taskCardEnabled, false);
  assert.notEqual(modal.stage, "task-card");
  modal.close();
});

test("priority gesture writes the frozen date and duplicate dispatch is single-flight", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ taskCard: true, content });
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

  const clicked = openPropertyPicker({ taskCard: true, content });
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
  const { modal, plugin } = openPropertyPicker({ taskCard: true, content });
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

test("selected-property deletion uses the existing writer; other card rows stay non-deletable", async () => {
  const content = "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship";
  const { modal, plugin } = openPropertyPicker({ taskCard: true, content });
  let deleted = null;
  plugin.deleteBulletPropertyValue = async (_editor, _cursor, propertyName) => {
    deleted = propertyName;
    return { deleted: true };
  };
  dispatchCardKey(modal, "d", { ctrlKey: true });
  await nextTurn();
  assert.equal(deleted, "scheduled");
  assert.equal(modal.isOpen, false);

  const next = openPropertyPicker({ taskCard: true, content });
  dispatchCardKey(next.modal, "ArrowDown");
  assert.equal(next.modal.taskCardSelectedRowId, "depends-on");
  dispatchCardKey(next.modal, "d", { ctrlKey: true });
  await nextTurn();
  assert.equal(next.modal.stage, "task-card");
  assert.equal(next.editor.writes(), 0);
});

test("Task Card pilot preference fails closed and preserves other plugin data", async () => {
  const { taskCardPilotEnabled, mergeTaskCardPilotPreference } = helpers;
  assert.equal(taskCardPilotEnabled({ taskCard: true }, false), false);
  assert.equal(taskCardPilotEnabled({}, true), false);
  assert.equal(taskCardPilotEnabled({ taskCard: true }, true), true);
  assert.deepEqual(
    mergeTaskCardPilotPreference({ unrelated: { kept: true } }, false),
    { unrelated: { kept: true }, taskCard: false },
  );

  const plugin = new NavigationHotkeysPlugin();
  plugin.taskCardSettingsGeneration = 1;
  plugin.taskCardSettingsLoaded = false;
  plugin.taskCardPluginUnloading = false;
  plugin.loadData = async () => ({ unrelated: "preserved", taskCard: true });
  await plugin.loadTaskCardSettings();
  assert.equal(plugin.isTaskCardPilotEnabled(), true);
  let saved = null;
  plugin.saveData = async (data) => { saved = data; };
  await plugin.setTaskCardPilotEnabled(false);
  assert.deepEqual(saved, { unrelated: "preserved", taskCard: false });
  assert.equal(plugin.isTaskCardPilotEnabled(), false);

  const unreadable = new NavigationHotkeysPlugin();
  unreadable.taskCardSettingsGeneration = 1;
  unreadable.taskCardSettingsLoaded = false;
  unreadable.taskCardPluginUnloading = false;
  unreadable.loadData = async () => { throw new Error("unreadable"); };
  await unreadable.loadTaskCardSettings();
  assert.equal(unreadable.isTaskCardPilotEnabled(), false);
});

test("missing freshness API disables Review every with an honest reason", () => {
  const { modal } = openPropertyPicker({
    taskCard: true,
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
