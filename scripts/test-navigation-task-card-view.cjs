// Card-view coverage for the Task Card renderer and modal mode/stage
// boundaries (bob-cli-42.3). Rendering is pure: no rolls and no writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { ElementStub, ModalStub, click, defer, flushDeferred, pressKey } = require("./modal-harness.cjs");

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
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = NavigationHotkeysPlugin;
const ledgerHelpers = LedgerToolsPlugin.helpers;
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
  const event = pressKey(modal, key, modifiers);
  return {
    prevented: event.defaultPrevented,
    stopped: event.propagationStopped,
  };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("Modal harness models Obsidian 1.14 attachment and idempotent close", () => {
  let opens = 0;
  let closes = 0;
  class LifecycleModal extends ModalStub {
    onOpen() { opens += 1; }
    onClose() { closes += 1; }
  }
  const modal = new LifecycleModal({});
  assert.equal(Object.hasOwn(modal, "isOpen"), true);
  assert.equal(modal.isOpen, false);
  modal.open();
  modal.open();
  assert.equal(modal.attached, true);
  assert.equal(modal.isOpen, true);
  assert.equal(opens, 1);
  modal.close();
  modal.close();
  assert.equal(modal.attached, false);
  assert.equal(modal.isOpen, false);
  assert.equal(closes, 1);
});

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
  let cursor = { line: 0, ch: 0 };
  return {
    getValue: () => content,
    getLine: (line) => (line >= 0 && line < lines.length ? lines[line] : null),
    getCursor: () => cursor,
    setCursor(line, ch) {
      if (line && typeof line === "object") {
        cursor = { line: line.line, ch: line.ch };
      } else {
        cursor = { line, ch };
      }
    },
    setValue() {
      writes += 1;
    },
    replaceRange() {
      writes += 1;
    },
    writes: () => writes,
  };
}

function makeStatefulEditor(initialContent) {
  let content = String(initialContent || "");
  let cursor = { line: 0, ch: 0 };
  let transactions = 0;
  let replacements = 0;
  const offsetAt = (position) => {
    const lines = content.split("\n");
    const line = Math.max(0, Math.min(Number(position && position.line) || 0, lines.length - 1));
    const ch = Math.max(0, Number(position && position.ch) || 0);
    let offset = 0;
    for (let index = 0; index < line; index += 1) offset += lines[index].length + 1;
    return Math.min(content.length, offset + ch);
  };
  const replace = (text, from, to) => {
    const start = offsetAt(from);
    const end = offsetAt(to);
    content = `${content.slice(0, start)}${String(text || "")}${content.slice(end)}`;
  };
  return {
    getValue: () => content,
    getLine: (line) => content.split("\n")[line] ?? null,
    getCursor: () => ({ ...cursor }),
    setCursor(line, ch) {
      cursor = line && typeof line === "object" ? { line: line.line, ch: line.ch } : { line, ch };
    },
    replaceRange(text, from, to) {
      replacements += 1;
      replace(text, from, to);
    },
    transaction(spec = {}) {
      transactions += 1;
      const changes = Array.isArray(spec.changes) ? spec.changes.slice() : [];
      changes.sort((left, right) => offsetAt(right.from) - offsetAt(left.from));
      for (const change of changes) replace(change.text, change.from, change.to);
      const selection = spec.selection && spec.selection.from;
      if (selection) cursor = { line: selection.line, ch: selection.ch };
    },
    writeCounts: () => ({ transactions, replacements }),
  };
}

function noteTheme(name, stem = "sase_blog", hue = "green") {
  return {
    theme: { key: name.toLowerCase(), name, known: true },
    source: "note",
    label: `from ${stem}`,
    from: { path: `Areas/${stem}.md`, stem, hue },
  };
}

function makeTaskThemeHarness(options = {}) {
  const listeners = new Set();
  const apiCalls = [];
  const api = {
    version: 1,
    snapshot() {
      return {
        themes: options.catalog || [],
        configured_themes: options.configured || [],
      };
    },
    historyRows({ query = "" } = {}) {
      const normalized = String(query).trim().toLowerCase();
      return (options.recent || []).filter((entry) =>
        !normalized || `${entry.key} ${entry.name}`.toLowerCase().includes(normalized),
      );
    },
    hueFor(key) {
      const found = [...(options.catalog || []), ...(options.configured || [])]
        .find((entry) => String(entry.key).toLowerCase() === String(key).toLowerCase());
      return { hue: found && found.hue ? found.hue : null };
    },
    isKnownTheme(key) {
      if (typeof options.isKnownTheme === "function") return options.isKnownTheme(key);
      const known = [...(options.catalog || []), ...(options.configured || [])]
        .some((entry) => String(entry.key).toLowerCase() === String(key).toLowerCase());
      return known;
    },
    suggestFor(request) {
      apiCalls.push({ ...request });
      return typeof options.suggestFor === "function" ? options.suggestFor(request) : null;
    },
    taskThemeOf: (line) => ledgerHelpers.pomodoroThemeTaskFieldState(line),
    setTaskTheme: (line, name) => ledgerHelpers.pomodoroThemeSetTaskTheme(line, name),
    clearTaskTheme: (line) => ledgerHelpers.pomodoroThemeClearTaskTheme(line),
    fetch: () => options.fetch ? options.fetch() : Promise.resolve(),
    onChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  const ledgerApi = {
    themes: api,
    caps: () => typeof options.caps === "function"
      ? options.caps()
      : { exempt: ["PLAN"] },
  };
  return {
    api,
    apiCalls,
    app: { plugins: { plugins: { "bob-ledger-tools": { api: ledgerApi } } } },
    notify: () => { for (const listener of [...listeners]) listener(); },
  };
}

function openPickerRoute(content, pickerOptions = {}, extras = {}) {
  const editor = extras.editor || makeEditor(content);
  if (Number.isInteger(extras.line)) {
    editor.setCursor(extras.line, 0);
  }
  const plugin = extras.plugin || new NavigationHotkeysPlugin();
  plugin.app = extras.app || plugin.app || {};
  plugin.getFreshnessApi = () =>
    Object.prototype.hasOwnProperty.call(extras, "freshnessApi")
      ? extras.freshnessApi
      : freshnessApi();
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: extras.filePath || "Tasks.md" },
  });
  const opened = plugin.openBulletPropertyPicker(editor, {
    config: extras.config || buildConfig(),
    ...pickerOptions,
  });
  return { plugin, editor, modal: plugin.activeBulletPropertyPicker, opened };
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

function openTaskThemeStage(options = {}) {
  const themeHarness = options.themeHarness || makeTaskThemeHarness(options.themeOptions);
  const content = options.content || "- [ ] #task Theme task ^theme-task";
  const editor = options.editor || makeStatefulEditor(content);
  const opened = openPropertyPicker({
    ...options,
    content,
    editor,
    app: options.app || themeHarness.app,
  });
  dispatchCardKey(opened.modal, "t");
  return { ...opened, editor, themeHarness };
}

function installThemeVault(themeHarness, notes, options = {}) {
  const files = new Map(Object.keys(notes).map((path) => [path, { path, basename: path.split("/").pop(), extension: "md" }]));
  const writes = [];
  let reads = 0;
  themeHarness.app.vault = {
    getAbstractFileByPath: (path) => files.get(path) || null,
    getMarkdownFiles: () => [...files.values()],
    cachedRead: async (file) => {
      reads += 1;
      if (options.readGate) await options.readGate;
      return notes[file.path] ?? null;
    },
    process: async (file, transform) => {
      writes.push(file.path);
      if (options.failPath === file.path) throw new Error("injected note write failure");
      notes[file.path] = transform(notes[file.path]);
    },
  };
  themeHarness.app.workspace = { getLeavesOfType: () => [] };
  return {
    files,
    notes,
    reads: () => reads,
    writes,
  };
}

function linkSessionForTargets(targets) {
  const links = targets.map((target) => `- [[${target.path}#^${target.blockId}]]`);
  return {
    kind: "task-link",
    valid: true,
    requestedCount: targets.length,
    actualCount: targets.length,
    clamped: false,
    targets: links.map((_line, line) => ({ line })),
    resolved: targets,
  };
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
  assert.match(STYLES, /\.bob-task-card-theme-value\.is-unknown/);
  assert.match(STYLES, /\.bob-task-card-theme-value\.is-repair/);
  assert.match(STYLES, /\.bob-task-card-theme-pill/);
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
  assert.match(text, /Blocks…/);
  assert.match(text, /Linked from…/);
  assert.match(text, /Review every…/);
  assert.match(text, /Cancel/);
  assert.match(text, /effort/);
  assert.match(text, /Ctrl\+D clear selected property/);
  assert.match(text, /Esc \/ q \/ Ctrl\+\[ close/);
  assert.doesNotMatch(text, /type to search/i);
  assert.equal(byClass(root, "bob-task-card-close").length, 1);
  assert.equal(byClass(root, "bob-task-card-banner").length, 1);
  assert.equal(byClass(root, "bob-task-card-strip").length, 1);
  assert.ok(byClass(root, "bob-task-card-row").length >= 5);
  const rows = orderedTaskCardRows(model).map((row) => row.id);
  assert.deepEqual(rows, [
    "schedule",
    "depends-on",
    "blocks",
    "links-to",
    "linked-from",
    "review-every",
    "lane",
    "theme",
    "cancel",
  ]);
  assert.equal(orderedTaskCardRows(model).find((row) => row.id === "blocks").shortcut, "⇧B");
  assert.equal(orderedTaskCardRows(model).find((row) => row.id === "theme").shortcut, "t");
  const list = byClass(root, "bob-task-card-actions")[0];
  assert.equal(list.attributes.role, "listbox");
  const strip = byClass(root, "bob-task-card-strip")[0];
  assert.equal(strip.attributes.role, "radiogroup");
  assert.ok(list.focused);
});

test("Task Card theme header shows unknown and repair signals without invoking setters", () => {
  const line = "- [ ] #task Historical [theme:: OLD] ^old";
  let writes = 0;
  const model = makeModel({
    content: line,
    lineText: line,
    themeApi: {
      version: 1,
      taskThemeOf: () => ({
        state: "set",
        value: "OLD",
        key: "old",
        fields: [{ start: 27, end: 41 }],
      }),
      suggestFor: () => ({
        theme: { name: "OLD", key: "old", known: false },
        source: "task",
        label: "this task",
        inherited: {
          theme: { name: "WRITE", key: "write", known: true },
          source: "note",
          label: "from sase_blog",
          from: {
            path: "Areas/sase_blog.md",
            stem: "sase_blog",
            hue: "green",
          },
        },
      }),
      isKnownTheme: () => false,
      hueFor: () => ({ hue: "orange" }),
      setTaskTheme: () => { writes += 1; },
      clearTaskTheme: () => { writes += 1; },
    },
  });
  const root = new ElementStub();
  renderTaskCardView(root, model);
  const themeLine = byClass(root, "bob-task-card-theme-line")[0];
  const themeValue = byClass(root, "bob-task-card-theme-value")[0];
  const themePill = byClass(root, "bob-task-card-theme-pill")[0];
  const themeDot = byClass(root, "bob-task-card-theme-dot")[0];
  const themeRow = descendants(root).find(
    (item) => item.attributes.id === "bob-task-card-row-theme",
  );
  assert.ok(themeLine.classes.includes("is-unknown"));
  const themeText = flattenText(themeLine).replace(/\s+/g, " ");
  assert.match(themeText, /Theme \[OLD\] this task/);
  assert.match(themeText, /sase_blog suggests WRITE/);
  assert.ok(themeValue.classes.includes("is-unknown"));
  assert.equal(themeValue.attributes.title.includes("not in the catalog"), true);
  assert.ok(themePill);
  assert.match(flattenText(themePill), /\[OLD\]/);
  assert.ok(byClass(themePill, "bob-cnp-theme-swatch")[0].classes.includes("is-orange"));
  assert.ok(themeDot.classes.includes("is-green"));
  assert.match(flattenText(themeDot), /●/);
  assert.ok(themeRow);
  assert.equal(themeRow.attributes["aria-disabled"], "false");
  assert.match(flattenText(themeRow), /t Theme/);
  assert.equal(writes, 0);
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

test("Task Link relation rows use the linked task's content and index", () => {
  const targetContent = [
    "- [ ] #task Alpha ^alpha",
    "  - 🪢 **LINKS:** see [[Tasks/Other#^other]]",
  ].join("\n");
  const target = {
    path: "Tasks/Alpha.md",
    line: 0,
    rawLine: "- [ ] #task Alpha ^alpha",
    content: targetContent,
    blockId: "alpha",
  };
  const incomingCalls = [];
  const app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            relationIndex: {
              version: 1,
              ready: () => true,
              incoming: (path, blockId) => {
                incomingCalls.push([path, blockId]);
                return [{ source: { text: "- [ ] #task Source task", blockId: "source" } }];
              },
            },
          },
        },
      },
    },
  };
  const linked = makeModel({
    content: "- [[Tasks/Alpha#^alpha]]",
    lineText: "- [[Tasks/Alpha#^alpha]]",
    filePath: "Daily/2026-10-28.md",
    app,
    taskCache: { ready: true, tasks: [{ blockId: "other", displayText: "Other task" }] },
    linkSession: {
      kind: "task-link",
      requestedCount: 1,
      targets: [{ line: 0 }],
      resolved: [target],
    },
  });
  const linksTo = linked.rows.find((row) => row.id === "links-to");
  const linkedFrom = linked.rows.find((row) => row.id === "linked-from");
  assert.equal(linksTo.enabled, true);
  assert.equal(linksTo.detail, "1 · see Other task");
  assert.equal(linkedFrom.enabled, true);
  assert.equal(linkedFrom.detail, "1 · Source task");
  assert.deepEqual(incomingCalls, [["Tasks/Alpha.md", "alpha"]]);

  const second = { ...target, path: "Tasks/Beta.md", blockId: "beta" };
  const counted = makeModel({
    content: "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]",
    lineText: "- [[Tasks/Alpha#^alpha]]",
    filePath: "Daily/2026-10-28.md",
    app,
    linkSession: {
      kind: "task-link",
      requestedCount: 2,
      targets: [{ line: 0 }, { line: 1 }],
      resolved: [target, second],
    },
  });
  assert.equal(counted.rows.find((row) => row.id === "links-to").enabled, true);
  const countedLinkedFrom = counted.rows.find((row) => row.id === "linked-from");
  assert.equal(countedLinkedFrom.enabled, false);
  assert.equal(countedLinkedFrom.unavailableReason, "Linked from needs a single task");
});

test("Task Link Task Card relation actions focus resolved tasks and clear by ref", async () => {
  const first = {
    path: "Tasks/Alpha.md",
    line: 3,
    rawLine: "- [ ] #task Alpha ^alpha",
    content: "head\nhead\nhead\n- [ ] #task Alpha ^alpha",
    blockId: "alpha",
  };
  const second = {
    path: "Tasks/Beta.md",
    line: 7,
    rawLine: "- [ ] #task Beta ^beta",
    content: "- [ ] #task Beta ^beta",
    blockId: "beta",
  };
  const linkSession = {
    kind: "task-link",
    requestedCount: 2,
    targets: [{ line: 0 }, { line: 1 }],
    resolved: [first, second],
  };

  const linksCard = openPropertyPicker({
    content: "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]",
    linkSession,
    filePath: "Daily/2026-10-28.md",
  });
  const opened = [];
  linksCard.plugin.openLinkedRelationStage = async (...args) => {
    opened.push(args);
    return true;
  };
  assert.equal(await linksCard.modal.openTaskCardAction("links-to", "links"), true);
  await nextTurn();
  assert.deepEqual(opened, [[linkSession.resolved, "to"]]);
  assert.equal(linksCard.modal.isOpen, false);

  const linkedFromCard = openPropertyPicker({
    content: "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]",
    linkSession,
    filePath: "Daily/2026-10-28.md",
  });
  linkedFromCard.plugin.openLinkedRelationStage = async (...args) => {
    opened.push(args);
    return true;
  };
  assert.equal(
    await linkedFromCard.modal.openTaskCardAction("linked-from", "linked-from"),
    true,
  );
  await nextTurn();
  assert.deepEqual(opened[1], [linkSession.resolved, "from"]);

  const clearCard = openPropertyPicker({
    content: "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]",
    linkSession,
    filePath: "Daily/2026-10-28.md",
  });
  const removed = [];
  clearCard.plugin.removeAllRelationLinksByRef = async (ref) => {
    removed.push(ref);
    return { ok: true, removed: 1 };
  };
  assert.equal(await clearCard.modal.clearTaskCardRelations("links-to"), true);
  assert.deepEqual(removed, [
    { path: "Tasks/Alpha.md", line: 3, blockId: "alpha" },
    { path: "Tasks/Beta.md", line: 7, blockId: "beta" },
  ]);
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

test("Theme property row is selectable while its editor remains read-only", () => {
  const { modal, editor } = openPropertyPicker();
  const row = descendants(modal.contentEl).find(
    (item) => item.attributes.id === "bob-task-card-row-theme",
  );
  assert.ok(row);
  assert.equal(row.attributes["aria-disabled"], "true");
  click(row);
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.taskCardSelectedRowId, "theme");
  assert.equal(editor.writes(), 0);
});

test("Task Card theme stage shows a typed new theme on input and commits the real Enter callback", async () => {
  let releaseFetch;
  const fetchPending = new Promise((resolve) => { releaseFetch = resolve; });
  const source = "- [ ] #task Typed theme [[Notes/Keep]] [fresh:: today] [root:: project] ^typed";
  const themeHarness = makeTaskThemeHarness({
    catalog: [{ key: "write", name: "WRITE", hue: "green" }],
    recent: [{ key: "write", name: "WRITE" }],
    suggestFor: () => noteTheme("WRITE"),
    fetch: () => fetchPending,
  });
  const editor = makeStatefulEditor(source);
  const { modal } = openTaskThemeStage({ content: source, editor, themeHarness });
  assert.equal(modal.stage, "value");

  modal.inputEl.value = "Brand New";
  modal.inputEl.listeners.input({});
  assert.deepEqual(modal.visibleItems.map((item) => item.themeKind), ["new"]);
  assert.equal(modal.visibleItems[0].themeName, "BRAND NEW");

  pressKey(modal, "Enter");
  pressKey(modal, "Enter");
  await nextTurn();
  const after = editor.getValue();
  assert.match(after, /\[type:: BRAND NEW\]/);
  assert.match(after, /\[\[Notes\/Keep\]\]/);
  assert.match(after, /\[fresh:: today\]/);
  assert.match(after, /\[root:: project\]/);
  assert.ok(after.endsWith("^typed"));
  assert.equal(editor.writeCounts().replacements, 1, "base picker Enter owns one commit");
  assert.equal(modal.isOpen, false);
  releaseFetch();
  await nextTurn();
  assert.equal(modal.contentEl.children.length, 0, "a late catalog fetch cannot repaint a closed stage");
});

test("Task Card theme row click and Ctrl+D use real setters and keep repair history safe", async () => {
  const source = "- [ ] #task Click theme [root:: work] ^click-theme";
  const clickHarness = makeTaskThemeHarness({
    catalog: [{ key: "fix", name: "FIX", hue: "blue" }],
    recent: [{ key: "fix", name: "FIX" }],
    suggestFor: () => noteTheme("WRITE"),
  });
  const clickEditor = makeStatefulEditor(source);
  const clicked = openTaskThemeStage({ content: source, editor: clickEditor, themeHarness: clickHarness });
  const rowIndex = clicked.modal.visibleItems.findIndex((item) => item.themeKind === "recent");
  assert.ok(rowIndex >= 0);
  click(byClass(clicked.modal.resultsEl, "bob-cnp-row")[rowIndex]);
  await nextTurn();
  assert.match(clickEditor.getValue(), /\[type:: FIX\]/);
  assert.match(clickEditor.getValue(), /\[root:: work\]/);
  assert.equal(clicked.modal.isOpen, false);

  const repairLine = "- [ ] #task Repair [theme:: bad] [theme:: ALSO] [root:: repair-root] ^repair";
  const clearHarness = makeTaskThemeHarness({
    caps: () => { throw new Error("caps unavailable"); },
    suggestFor: () => noteTheme("PLAN"),
  });
  const clearEditor = makeStatefulEditor(repairLine);
  const cleared = openTaskThemeStage({ content: repairLine, editor: clearEditor, themeHarness: clearHarness });
  assert.ok(cleared.modal.taskCardThemeStageRows.some((item) => item.themeKind === "default"));
  pressKey(cleared.modal, "d", { ctrlKey: true });
  await nextTurn();
  assert.doesNotMatch(clearEditor.getValue(), /\[theme::/);
  assert.match(clearEditor.getValue(), /\[root:: repair-root\]/);
  assert.ok(clearEditor.getValue().endsWith("^repair"));
  assert.equal(cleared.modal.isOpen, false);
});

test("Task Card theme catalog repaint keeps query and keyboard selection; changed defaults refuse", async () => {
  const recent = [
    { key: "write", name: "WRITE" },
    { key: "build", name: "BUILD" },
  ];
  const themeHarness = makeTaskThemeHarness({
    catalog: recent.map((entry) => ({ ...entry, hue: "blue" })),
    recent,
    suggestFor: () => noteTheme("WRITE"),
  });
  const source = "- [ ] #task Refresh [root:: refresh] ^refresh";
  const { modal, editor } = openTaskThemeStage({ content: source, themeHarness });
  pressKey(modal, "ArrowDown");
  assert.equal(modal.visibleItems[modal.selectedIndex].themeKey, "write");
  themeHarness.notify();
  assert.equal(modal.visibleItems[modal.selectedIndex].themeKey, "write");

  modal.inputEl.value = "bui";
  modal.inputEl.listeners.input({});
  assert.equal(modal.inputEl.value, "bui");
  assert.equal(modal.visibleItems[modal.selectedIndex].themeKey, "build");
  themeHarness.notify();
  assert.equal(modal.inputEl.value, "bui");
  assert.equal(modal.visibleItems[modal.selectedIndex].themeKey, "build");
  modal.close();
  assert.equal(editor.writeCounts().replacements, 0);

  let inherited = "WRITE";
  const staleHarness = makeTaskThemeHarness({
    catalog: [{ key: "build", name: "BUILD" }],
    recent: [{ key: "build", name: "BUILD" }],
    suggestFor: () => noteTheme(inherited),
  });
  const staleEditor = makeStatefulEditor("- [ ] #task Stale default ^stale");
  const stale = openTaskThemeStage({ content: staleEditor.getValue(), editor: staleEditor, themeHarness: staleHarness });
  inherited = "OTHER";
  staleHarness.notify();
  const buildIndex = stale.modal.visibleItems.findIndex((item) => item.themeKey === "build");
  assert.ok(buildIndex >= 0);
  click(byClass(stale.modal.resultsEl, "bob-cnp-row")[buildIndex]);
  await nextTurn();
  assert.equal(staleEditor.getValue(), "- [ ] #task Stale default ^stale");
  assert.equal(stale.modal.isOpen, true);
  assert.ok(notices.some((message) => message.includes("Default changed; reopen the card")));
});

test("counted Task Card theme edits use one editor transaction for all selected tasks", async () => {
  const first = "- [ ] #task First [root:: one] ^first";
  const second = "- [/] #task Second [root:: two] ^second";
  const content = `${first}\n${second}`;
  const themeHarness = makeTaskThemeHarness({
    catalog: [{ key: "fix", name: "FIX" }],
    recent: [{ key: "fix", name: "FIX" }],
    suggestFor: (request) => noteTheme(request.line === 1 ? "WRITE" : "BUILD"),
  });
  const editor = makeStatefulEditor(content);
  const { modal } = openTaskThemeStage({
    content,
    editor,
    themeHarness,
    context: {
      taskSession: {
        valid: true,
        explicit: true,
        requestedCount: 2,
        actualCount: 2,
        targets: [
          { line: 0, rawLine: first },
          { line: 1, rawLine: second },
        ],
      },
    },
  });
  const fixIndex = modal.visibleItems.findIndex((item) => item.themeKey === "fix");
  click(byClass(modal.resultsEl, "bob-cnp-row")[fixIndex]);
  await nextTurn();
  const after = editor.getValue();
  assert.match(after, /First .*\[type:: FIX\].*\[root:: one\].*\^first/);
  assert.match(after, /Second .*\[type:: FIX\].*\[root:: two\].*\^second/);
  assert.deepEqual(editor.writeCounts(), { transactions: 1, replacements: 0 });
  assert.equal(modal.isOpen, false);
});

test("linked Task Card theme edits recompute full-note inheritance and write two targets in one note", async () => {
  const first = "- [ ] #task Alpha [root:: alpha-root] ^alpha";
  const second = "- [ ] #task Beta [root:: beta-root] ^beta";
  const note = `${first}\n${second}`;
  const targets = [
    { path: "Tasks/Shared.md", content: note, line: 0, rawLine: first, blockId: "alpha", displayText: "Alpha" },
    { path: "Tasks/Shared.md", content: note, line: 1, rawLine: second, blockId: "beta", displayText: "Beta" },
  ];
  const themeHarness = makeTaskThemeHarness({
    catalog: [{ key: "fix", name: "FIX" }],
    recent: [{ key: "fix", name: "FIX" }],
    suggestFor: (request) => noteTheme(request.line === 1 ? "WRITE" : "BUILD"),
  });
  const vault = installThemeVault(themeHarness, { "Tasks/Shared.md": note });
  const source = "- [[Tasks/Shared.md#^alpha]]\n- [[Tasks/Shared.md#^beta]]";
  const { modal } = openTaskThemeStage({
    content: source,
    filePath: "Daily/2026-10-29.md",
    themeHarness,
    context: { propertyContext: { isObsidianTask: false }, linkSession: linkSessionForTargets(targets) },
  });
  const fixIndex = modal.visibleItems.findIndex((item) => item.themeKey === "fix");
  click(byClass(modal.resultsEl, "bob-cnp-row")[fixIndex]);
  await nextTurn();
  assert.match(vault.notes["Tasks/Shared.md"], /Alpha .*\[type:: FIX\].*\[root:: alpha-root\].*\^alpha/);
  assert.match(vault.notes["Tasks/Shared.md"], /Beta .*\[type:: FIX\].*\[root:: beta-root\].*\^beta/);
  assert.deepEqual(vault.writes, ["Tasks/Shared.md", "Tasks/Shared.md"]);
  assert.ok(themeHarness.apiCalls.some((call) => call.text === note), "suggestFor receives the full matched note");
  assert.equal(modal.isOpen, false);
});

test("linked Task Card theme writes report a later-note failure as a partial save", async () => {
  const alpha = "- [ ] #task Alpha [root:: alpha-root] ^alpha";
  const beta = "- [ ] #task Beta [root:: beta-root] ^beta";
  const targets = [
    { path: "Tasks/Alpha.md", content: alpha, line: 0, rawLine: alpha, blockId: "alpha", displayText: "Alpha" },
    { path: "Tasks/Beta.md", content: beta, line: 0, rawLine: beta, blockId: "beta", displayText: "Beta" },
  ];
  const themeHarness = makeTaskThemeHarness({
    catalog: [{ key: "fix", name: "FIX" }],
    recent: [{ key: "fix", name: "FIX" }],
    suggestFor: () => noteTheme("WRITE"),
  });
  const vault = installThemeVault(themeHarness, {
    "Tasks/Alpha.md": alpha,
    "Tasks/Beta.md": beta,
  }, { failPath: "Tasks/Beta.md" });
  const source = "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]";
  const { modal } = openTaskThemeStage({
    content: source,
    filePath: "Daily/2026-10-29.md",
    themeHarness,
    context: { propertyContext: { isObsidianTask: false }, linkSession: linkSessionForTargets(targets) },
  });
  const fixIndex = modal.visibleItems.findIndex((item) => item.themeKey === "fix");
  click(byClass(modal.resultsEl, "bob-cnp-row")[fixIndex]);
  await nextTurn();
  assert.match(vault.notes["Tasks/Alpha.md"], /\[type:: FIX\]/);
  assert.doesNotMatch(vault.notes["Tasks/Beta.md"], /\[theme:: FIX\]/);
  assert.ok(notices.some((message) => /Theme saved on 1 task · failed in 1 note/.test(message)));
  assert.equal(modal.isOpen, false);
});

test("closing a linked theme stage during note reads cancels the pending write and duplicate Enter", async () => {
  const targetLine = "- [ ] #task Wait for read ^wait";
  const targetNote = `# Heading\n${targetLine}`;
  let releaseRead;
  const readGate = new Promise((resolve) => { releaseRead = resolve; });
  const targets = [{
    path: "Tasks/Wait.md",
    content: targetNote,
    line: 1,
    rawLine: targetLine,
    blockId: "wait",
    displayText: "Wait for read",
  }];
  const themeHarness = makeTaskThemeHarness({
    catalog: [{ key: "fix", name: "FIX" }],
    recent: [{ key: "fix", name: "FIX" }],
    suggestFor: () => noteTheme("WRITE"),
  });
  const vault = installThemeVault(themeHarness, { "Tasks/Wait.md": targetNote }, { readGate });
  const source = "- [[Tasks/Wait.md#^wait]]";
  const { modal } = openTaskThemeStage({
    content: source,
    filePath: "Daily/2026-10-29.md",
    themeHarness,
    context: { propertyContext: { isObsidianTask: false }, linkSession: linkSessionForTargets(targets) },
  });
  const fixIndex = modal.visibleItems.findIndex((item) => item.themeKey === "fix");
  click(byClass(modal.resultsEl, "bob-cnp-row")[fixIndex]);
  await nextTurn();
  assert.equal(vault.reads(), 1);
  pressKey(modal, "Enter");
  assert.equal(vault.reads(), 1, "the base picker keeps the pending action single-flight");
  pressKey(modal, "Escape");
  assert.equal(modal.isOpen, false);
  releaseRead();
  await nextTurn();
  assert.equal(vault.notes["Tasks/Wait.md"], targetNote);
  assert.deepEqual(vault.writes, []);
});

test("a More row opens that property's value stage, never a filter list, and Back restores the card", () => {
  const { modal, editor } = openPropertyPicker();
  const rows = byClass(modal.contentEl, "bob-task-card-more-row");
  assert.equal(rows.length, 1);
  assert.match(flattenText(rows[0]), /effort/);
  click(rows[0]);
  assert.equal(modal.stage, "value");
  assert.equal(modal.selectedPropertyItem.property.name, "effort");
  assert.equal(modal.title, "effort");
  assert.ok(modal.modalEl.classes.includes("bob-task-card-modal"));
  assert.equal(modal.inputEl.value, "");
  assert.equal(modal.inputEl.focused, true);
  assert.equal(modal.contentEl.getAttribute("tabindex"), undefined);
  assert.deepEqual(
    modal.items.map((item) => item.value),
    ["small", "large"],
  );
  assertNoClassicList(modal);
  const back = byClass(modal.contentEl, "bob-task-card-back")[0];
  assert.ok(back);
  click(back);
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.taskCardListEl.focused, true);
  assert.match(flattenText(modal.contentEl), /Schedule…/);
  assert.equal(editor.writes(), 0);
});

test("after open the actions list, not the Close button, has focus", () => {
  const { modal } = openPropertyPicker({
    content: "- [ ] #task Ship report [priority:: medium] [scheduled:: 2026-10-12] ^ship",
  });
  assert.equal(modal.taskCardListEl.focused, true);
  assert.equal(modal.contentEl.getAttribute("tabindex"), "-1");
  assert.equal(byClass(modal.contentEl, "bob-task-card-close")[0].focused, false);
  const enter = dispatchCardKey(modal, "Enter");
  assert.equal(enter.prevented, true);
  assert.equal(enter.stopped, true);
  assert.equal(modal.stage, "value");
  assert.equal(modal.selectedPropertyItem.property.name, "scheduled");
  assert.equal(modal.inputEl.focused, true);

  pressStageKey(modal, modal.inputEl, "Backspace");
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

test("clicking card text keeps the card key router active exactly once", async () => {
  const { modal, plugin } = openPropertyPicker({
    content: "- [ ] #task Clicked card [priority:: medium] [scheduled:: 2026-10-12] ^clicked",
  });
  let writes = 0;
  plugin.setBulletPriorityValue = async () => {
    writes += 1;
    return true;
  };
  click(byClass(modal.contentEl, "bob-task-card-title")[0]);
  assert.equal(modal.contentEl.focused, true);
  pressKey(modal, "1");
  await nextTurn();
  assert.equal(writes, 1);
  assert.equal(modal.isOpen, false);
});

test("Ready card writes close from a key, P1 click, recommendations, and Alt+N", async () => {
  const ready = "- [ ] #task Ready [priority:: medium] [scheduled:: 2026-10-12] ^ready";
  for (const gesture of ["key", "priority-click", "recommendation-key", "recommendation-meta", "recommendation-click", "lane"]) {
    const { modal, plugin } = openPropertyPicker({ content: ready });
    let writes = 0;
    plugin.setBulletPriorityValue = async () => { writes += 1; return true; };
    plugin.setBulletPropertyValue = async () => { writes += 1; return true; };
    plugin.applyTaskCancelFromPicker = async () => { writes += 1; return true; };
    plugin.applyLaneToggleFromPicker = async () => { writes += 1; return true; };
    if (gesture === "key") {
      dispatchCardKey(modal, "1");
    } else if (gesture === "priority-click") {
      click(byClass(modal.contentEl, "bob-task-card-level")[0]);
    } else if (gesture === "recommendation-key") {
      dispatchCardKey(modal, "Enter", { ctrlKey: true });
    } else if (gesture === "recommendation-meta") {
      dispatchCardKey(modal, "Enter", { metaKey: true });
    } else if (gesture === "recommendation-click") {
      const banner = byClass(modal.contentEl, "bob-task-card-banner")[0];
      assert.ok(banner, "recommendation banner is visible");
      click(banner);
    } else {
      dispatchCardKey(modal, "n", { altKey: true });
    }
    await nextTurn();
    assert.equal(writes, 1, gesture);
    assert.equal(modal.isOpen, false, gesture);
  }
});

test("Next and Pending priority gestures open a focused Work summary; Enter writes once and Escape writes nothing", async () => {
  for (const status of ["*", "/"]) {
    const { modal, plugin } = openPropertyPicker({
      content: `- [${status}] #task Schedule me [priority:: medium] [scheduled:: 2026-10-06] ^work`,
    });
    const calls = [];
    plugin.setBulletPriorityValue = async (...args) => {
      calls.push(args);
      return true;
    };
    const displayedDate = modal.taskCardModel.priorityStrip.levels[0].date;
    dispatchCardKey(modal, "1");
    await nextTurn();
    assert.equal(modal.stage, "schedule-work-log", status);
    assert.equal(modal.title, "Schedule task");
    assert.equal(modal.inputEl.getAttribute("aria-label"), "Work summary");
    assert.equal(modal.inputEl.focused, true);
    assert.equal(calls.length, 0);
    pressKey(modal, "Enter");
    await nextTurn();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][6].precomputedRoll.date, displayedDate);
    assert.equal(calls[0][6].schedulingWorkLog, null);
    assert.equal(modal.isOpen, false);
  }

  const cancelled = openPropertyPicker({
    content: "- [/] #task Pending work [priority:: medium] [scheduled:: 2026-10-06] ^cancelled",
  });
  let writes = 0;
  cancelled.plugin.setBulletPriorityValue = async () => { writes += 1; return true; };
  click(byClass(cancelled.modal.contentEl, "bob-task-card-level")[0]);
  await nextTurn();
  assert.equal(cancelled.modal.stage, "schedule-work-log");
  pressKey(cancelled.modal, "Escape");
  assert.equal(writes, 0);
  assert.equal(cancelled.modal.isOpen, false);
});

test("Ctrl+Enter on overdue Next and counted tasks paints the Work summary stage", async () => {
  const overdueNext = openPropertyPicker({
    content: "- [*] #task Overdue [priority:: medium] [scheduled:: 2026-10-01] ^overdue",
  });
  let writes = 0;
  overdueNext.plugin.setBulletPropertyValue = async () => { writes += 1; return true; };
  dispatchCardKey(overdueNext.modal, "Enter", { ctrlKey: true });
  await nextTurn();
  assert.equal(overdueNext.modal.stage, "schedule-work-log");
  assert.equal(overdueNext.modal.inputEl.focused, true);
  assert.equal(writes, 0);
  overdueNext.modal.close();

  const content = [
    "- [/] #task First [priority:: medium] [scheduled:: 2026-10-01] ^first",
    "- [*] #task Second [priority:: medium] [scheduled:: 2026-10-02] ^second",
  ].join("\n");
  const counted = openPropertyPicker({
    content,
    taskSession: {
      valid: true,
      explicit: true,
      requestedCount: 2,
      actualCount: 2,
      targets: content.split("\n").map((rawLine, line) => ({ line, rawLine })),
    },
  });
  counted.plugin.setCountedBulletPriorityValue = async () => { writes += 1; return true; };
  dispatchCardKey(counted.modal, "Enter", { ctrlKey: true });
  await nextTurn();
  assert.equal(counted.modal.stage, "schedule-work-log");
  assert.equal(counted.modal.inputEl.focused, true);
  assert.equal(writes, 0);
});

test("Ctrl+R recomputes and repaints the card recommendation", () => {
  let randomCalls = 0;
  const { modal } = openPropertyPicker({
    content: "- [ ] #task Reroll [priority:: medium] [scheduled:: 2026-10-12] ^reroll",
    context: { random: () => (++randomCalls % 2 === 0 ? 0.95 : 0.05) },
  });
  const before = modal.taskCardModel;
  const callsBefore = randomCalls;
  dispatchCardKey(modal, "r", { ctrlKey: true });
  assert.ok(randomCalls > callsBefore);
  assert.notEqual(modal.taskCardModel, before);
  assert.equal(modal.stage, "task-card");
});

test("Task Card action keys enter the retained property, refresh, dependency, cancel, and lane stages", async () => {
  const scenarios = [
    {
      key: "Enter",
      content: "- [ ] #task Schedule me [priority:: medium] [scheduled:: 2026-10-12] ^schedule",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.selectedPropertyItem.property.name, "scheduled");
        assert.equal(modal.inputEl.focused, true);
      },
    },
    {
      key: "b",
      content: "- [ ] #task Add a dependency [priority:: medium] ^dependency",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.selectedPropertyItem.property.values, "local_task_id");
        assert.equal(modal.inputEl.focused, true);
      },
    },
    {
      key: "B",
      modifiers: { shiftKey: true },
      content: "- [ ] #task Block another task [id:: source] ^source",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.blocksStage, true);
        assert.equal(modal.selectedPropertyItem.property.values, "local_task_id");
      },
    },
    {
      key: "f",
      content: "- [ ] #task Change review [priority:: medium] ^refresh",
      check(modal) {
        assert.equal(modal.stage, "value");
        assert.equal(modal.selectedPropertyItem.kind, "refresh-interval");
        assert.equal(modal.inputEl.focused, true);
      },
    },
    {
      key: "x",
      content: "- [ ] #task Cancel me [priority:: medium] ^cancel",
      check(modal) {
        assert.equal(modal.stage, "cancel-reason");
        assert.equal(modal.inputEl.focused, true);
      },
    },
    {
      key: "n",
      modifiers: { altKey: true },
      content: "- [/] #task Release me [priority:: medium] ^release",
      check(modal) {
        assert.equal(modal.stage, "lane-release-reason");
        assert.equal(modal.inputEl.focused, true);
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
  click(byClass(configuredList.modal.contentEl, "bob-task-card-more-row")[0]);
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
  let writes = 0;
  plugin.applyLinkPickerPriorityValue = async () => { writes += 1; return true; };
  dispatchCardKey(modal, "1");
  await nextTurn();
  assert.equal(writes, 1);
  assert.equal(modal.isOpen, false);
});

test("Ctrl+Shift+B on a Task Link opens the linked Depends on stage and closes the card", async () => {
  const content = "- [[Tasks/Alpha#^alpha]]";
  const editor = makeEditor(content);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
  const target = {
    path: "Tasks/Alpha.md",
    file: { path: "Tasks/Alpha.md" },
    content: "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha\n",
    line: 0,
    rawLine: "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha",
    blockId: "alpha",
    displayText: "Alpha",
  };
  plugin.resolveLinkPickerTargets = async () => ({ error: null, targets: [target] });
  const linked = [];
  plugin.openLinkedDependencyStage = async (resolved) => {
    linked.push(resolved);
    return true;
  };
  const result = await plugin.openLinkPicker(editor, {
    config: buildConfig(),
    baseDate: BASE_DATE,
    initialTaskCardRow: "depends-on",
  });
  assert.equal(result, true);
  assert.equal(linked.length, 1);
  assert.equal(linked[0], target);
  assert.equal(plugin.activeBulletPropertyPicker, null);
});

test("Ctrl+Shift+Alt+B on a Task Link opens the linked Blocks stage", async () => {
  const content = "- [[Tasks/Alpha#^alpha]]";
  const editor = makeEditor(content);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Projects/Work.md" } });
  const target = {
    path: "Tasks/Alpha.md",
    file: { path: "Tasks/Alpha.md" },
    content: "- [ ] #task Alpha [id:: alpha] ^alpha\n",
    line: 0,
    rawLine: "- [ ] #task Alpha [id:: alpha] ^alpha",
    blockId: "alpha",
    displayText: "Alpha",
  };
  plugin.resolveLinkPickerTargets = async () => ({ error: null, targets: [target] });
  const opened = [];
  plugin.openLinkedBlocksStage = async (resolved) => {
    opened.push(resolved);
    return true;
  };

  const result = await plugin.openLinkPicker(editor, {
    config: buildConfig(),
    baseDate: BASE_DATE,
    initialTaskCardRow: "blocks",
  });
  assert.equal(result, true);
  assert.deepEqual(opened, [target]);
  assert.equal(plugin.activeBulletPropertyPicker, null);
});

test("LG18-LG20: Task Link relation chords resolve, guard, and open the selected target", async () => {
  const makeTarget = (path, blockId, rawLine) => ({
    path,
    line: 0,
    rawLine,
    content: rawLine,
    blockId,
    displayText: blockId,
  });
  const run = async ({ content, row, targets, countExplicit, additionalTaskCount, mutate }) => {
    let currentContent = content;
    const editor = {
      getValue: () => currentContent,
      getLine: (line) => currentContent.split(/\r?\n/)[line] ?? null,
      getCursor: () => ({ line: 0, ch: 0 }),
      setCursor(line, ch) {
        this.cursor = typeof line === "object" ? line : { line, ch };
      },
    };
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {};
    plugin.getActiveMarkdownView = () => ({ editor, file: { path: "Daily/2026-10-28.md" } });
    plugin.readDependencyVaultFileList = () => [];
    const resolveCalls = [];
    plugin.resolveLinkPickerTargets = async (...args) => {
      resolveCalls.push(args);
      if (mutate) currentContent = `${currentContent}\nchanged`;
      return { error: null, targets };
    };
    const opened = [];
    plugin.openLinkedDependencyStage = async (...args) => {
      opened.push(args);
      return true;
    };
    const openRelation = plugin.openTaskLinkRelationStage.bind(plugin);
    let pending;
    plugin.openTaskLinkRelationStage = (...args) => {
      pending = openRelation(...args);
      return pending;
    };
    const result = plugin.openBulletPropertyPicker(editor, {
      config: buildConfig(),
      initialTaskCardRow: row,
      countExplicit,
      additionalTaskCount,
    });
    assert.equal(result, true);
    await pending;
    return { opened, resolveCalls };
  };

  notices.length = 0;
  const alpha = makeTarget(
    "Tasks/Alpha.md",
    "alpha",
    "- [ ] #task Alpha ^alpha",
  );
  for (const [row, rowId] of [
    ["links-to", "links-to"],
    ["linked-from", "linked-from"],
  ]) {
    const { opened, resolveCalls } = await run({
      content: "- [[Tasks/Alpha#^alpha]]",
      row,
      targets: [alpha],
    });
    assert.deepEqual(resolveCalls[0][2], { allowClosed: true });
    assert.deepEqual(opened, [[alpha, { rowId }]]);
  }

  const closed = makeTarget(
    "Tasks/Closed.md",
    "closed",
    "- [x] #task Closed ✅ 2026-10-27 ^closed",
  );
  const closedResult = await run({
    content: "- [[Tasks/Closed#^closed]]",
    row: "links-to",
    targets: [closed],
  });
  assert.deepEqual(closedResult.opened, [[closed, { rowId: "links-to" }]]);

  const second = makeTarget("Tasks/Beta.md", "beta", "- [ ] #task Beta ^beta");
  notices.length = 0;
  const counted = await run({
    content: "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]",
    row: "links-to",
    countExplicit: true,
    additionalTaskCount: 1,
    targets: [alpha, second],
  });
  assert.deepEqual(counted.opened, [[alpha, { rowId: "links-to" }]]);
  assert.deepEqual(notices, [
    "🪢 Opened the first of 2 linked tasks; reopen Links to for the rest",
  ]);

  notices.length = 0;
  const linkedFromCounted = await run({
    content: "- [[Tasks/Alpha#^alpha]]\n- [[Tasks/Beta#^beta]]",
    row: "linked-from",
    targets: [alpha, second],
  });
  assert.deepEqual(linkedFromCounted.opened, []);
  assert.deepEqual(notices, ["Linked from needs a single task"]);

  notices.length = 0;
  const readOnly = makeTarget(
    "done/Alpha.md",
    "alpha",
    "- [ ] #task Alpha ^alpha",
  );
  const refused = await run({
    content: "- [[done/Alpha#^alpha]]",
    row: "links-to",
    targets: [readOnly],
  });
  assert.deepEqual(refused.opened, []);
  assert.deepEqual(notices, ["This task is in a read-only note"]);

  notices.length = 0;
  const stale = await run({
    content: "- [[Tasks/Alpha#^alpha]]",
    row: "links-to",
    targets: [alpha],
    mutate: true,
  });
  assert.deepEqual(stale.opened, []);
  assert.deepEqual(notices, ["Current note changed; no tasks were updated"]);
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

test("Ctrl+Shift+B lands on the Depends on stage with the same intent as card b", () => {
  const content =
    "- [ ] #task Parent [priority:: medium] [scheduled:: 2026-10-12] ^parent";
  const viaP = openPickerRoute(content);
  assert.equal(viaP.opened, true);
  const expectedIntent = helpers.resolveTaskCardKey(viaP.modal.taskCardModel, { key: "b" });
  dispatchCardKey(viaP.modal, "b");
  flushDeferred();
  assert.equal(viaP.modal.stage, "value");
  assert.equal(viaP.modal.selectedPropertyItem.property.values, "local_task_id");
  assert.equal(viaP.modal.hasTaskCard, true);
  assert.equal(viaP.modal.inputEl.focused, true);

  const viaB = openPickerRoute(content, { initialTaskCardRow: "depends-on" });
  assert.equal(viaB.opened, true);
  flushDeferred();
  assert.equal(viaB.modal.stage, "value");
  assert.equal(viaB.modal.selectedPropertyItem.property.values, "local_task_id");
  assert.equal(viaB.modal.hasTaskCard, true);
  assert.equal(viaB.modal.inputEl.focused, true);
  assert.equal(viaB.modal.stage, viaP.modal.stage);
  assert.equal(
    viaB.modal.selectedPropertyItem.property.values,
    viaP.modal.selectedPropertyItem.property.values,
  );
  assert.equal(viaB.modal.hasTaskCard, viaP.modal.hasTaskCard);
  assert.deepEqual(
    helpers.resolveTaskCardKey(viaB.modal.taskCardModel, { key: "b" }),
    expectedIntent,
  );
  assert.equal(expectedIntent.type, "open-action");
  assert.equal(expectedIntent.rowId, "depends-on");
});

test("Ctrl+Shift+B Back returns to the card without re-dispatching", () => {
  const content =
    "- [ ] #task Parent [priority:: medium] [scheduled:: 2026-10-12] ^parent";
  const { modal } = openPickerRoute(content, { initialTaskCardRow: "depends-on" });
  assert.equal(modal.stage, "value");
  assert.equal(modal.initialTaskCardRow, null);
  modal.returnToTaskCard();
  assert.equal(modal.stage, "task-card");
  assert.equal(modal.initialTaskCardRow, null);
  assert.equal(modal.isOpen, true);
});

test("Ctrl+Shift+B on a plain bullet notices and closes the card", () => {
  const content = "- Plain bullet [scheduled:: 2026-10-12]";
  const before = notices.length;
  const { plugin, opened } = openPickerRoute(content, {
    initialTaskCardRow: "depends-on",
  });
  assert.equal(opened, true);
  assert.match(notices[before], /Depends on requires a #task checkbox/);
  const modal = openedModals[openedModals.length - 1];
  assert.ok(modal);
  assert.equal(modal.isOpen, false);
  assert.equal(plugin.activeBulletPropertyPicker, null);
});

test("Ctrl+Shift+B on a Depends-On line opens the direct stage without auto-dispatch", () => {
  const content = [
    "- [ ] #task Parent [priority:: medium] ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^child]]",
    "- [ ] #task Child ^child",
  ].join("\n");
  const { modal, opened, editor } = openPickerRoute(
    content,
    { initialTaskCardRow: "depends-on" },
    { line: 1 },
  );
  assert.equal(opened, true);
  assert.ok(modal);
  assert.equal(modal.directStage, true);
  assert.equal(modal.hasTaskCard, false);
  assert.equal(modal.stage, "value");
  assert.equal(modal.selectedPropertyItem.property.values, "local_task_id");
  assert.equal(modal.initialTaskCardRow, "depends-on");
  assert.equal(editor.getCursor().line, 0);
});

test("Ctrl+Shift+Alt+B on Depends-On and BLOCKS lines opens the owner's stage directly", () => {
  for (const cursorLine of [1, 2]) {
    const content = [
      "- [ ] #task Owner [id:: owner] ^owner",
      "  - ⛓️ **DEPENDS ON:** [[#^prerequisite]]",
      "  - 🧱 **BLOCKS:** [[#^dependent]]",
    ].join("\n");
    const { modal, editor, opened } = openPickerRoute(
      content,
      { initialTaskCardRow: "blocks" },
      { line: cursorLine },
    );
    assert.equal(opened, true);
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 0 });
    assert.equal(modal.stage, "value");
    assert.equal(modal.blocksStage, true);
    assert.equal(modal.hasTaskCard, false);
  }
});

test("Ctrl+Shift+B captures review origin like Ctrl+Shift+P; a direct stage does not", () => {
  const content = "- [ ] #task Parent [priority:: medium] ^parent";
  const captures = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.captureReviewGesture = (cm) => {
    captures.push(cm);
    return { origin: "landing" };
  };

  const viaB = openPickerRoute(
    content,
    { initialTaskCardRow: "depends-on" },
    { plugin },
  );
  assert.equal(captures.length, 1);
  assert.equal(viaB.modal.reviewOrigin.origin, "landing");
  viaB.modal.close();

  captures.length = 0;
  const viaP = openPickerRoute(content, {}, { plugin });
  assert.equal(captures.length, 1);
  viaP.modal.close();

  captures.length = 0;
  const direct = openPickerRoute(
    content,
    { initialProperty: "dependsOn" },
    { plugin },
  );
  assert.equal(captures.length, 0);
  assert.equal(direct.modal.reviewOrigin, null);
  direct.modal.close();
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
  radios[0].focus();
  pressKey(modal, "2");
  pressKey(modal, "2", { repeat: true });
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
  banner.focus();
  pressKey(other.modal, "r", { ctrlKey: true });
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
  const press = (element, extra) => {
    element.focus();
    pressKey(modal, "Enter", extra);
  };
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

const CTRL_LEFT_BRACKET = { key: "[", code: "BracketLeft", ctrlKey: true };

function pressStageKey(modal, element, key, extra = {}) {
  element.focus();
  const event = pressKey(modal, key, extra);
  event.prevented = event.defaultPrevented;
  event.stopped = event.propagationStopped;
  return event;
}

test("Escape, q, Q, and Ctrl+[ close the card without writing", async () => {
  for (const [key, modifiers] of [
    ["Escape", {}],
    ["q", {}],
    ["Q", { shiftKey: true }],
    ["[", { ctrlKey: true, code: "BracketLeft" }],
    ["[", { ctrlKey: true }],
    ["x", { ctrlKey: true, code: "BracketLeft" }],
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
    const event = pressKey(modal, key, modifiers);
    await nextTurn();
    assert.equal(modal.isOpen, false, `${key} ${JSON.stringify(modifiers)}`);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    assert.equal(editor.writes(), 0);
    assert.equal(written, 0);
    assert.equal(plugin.activeBulletPropertyPicker, null);
  }
});

test("Ctrl+Q, Meta+Q, Alt+Q, and Ctrl+] do not close the card", () => {
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
  dispatchCardKey(modal, "]", { ctrlKey: true, code: "BracketRight" });
  dispatchCardKey(modal, "[", { ctrlKey: true, altKey: true });
  dispatchCardKey(modal, "[", { ctrlKey: true, shiftKey: true });
  dispatchCardKey(modal, "[", { ctrlKey: true, metaKey: true });
  dispatchCardKey(modal, "[", {});
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "task-card");
});

test("repeated close keys and a second close() are harmless", async () => {
  const { modal, editor } = openPropertyPicker();
  let closes = 0;
  const originalOnClose = modal.onClose.bind(modal);
  modal.onClose = () => {
    closes += 1;
    originalOnClose();
  };
  dispatchCardKey(modal, "q");
  dispatchCardKey(modal, "q", { repeat: true });
  dispatchCardKey(modal, "[", { ctrlKey: true });
  modal.close();
  modal.close();
  await nextTurn();
  assert.equal(modal.isOpen, false);
  assert.equal(closes, 1);
  assert.equal(editor.writes(), 0);
});

test("composition never closes the card or a stage", () => {
  const { modal } = openPropertyPicker();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    dispatchCardKey(modal, "q", extra);
    dispatchCardKey(modal, "[", { ctrlKey: true, ...extra });
    dispatchCardKey(modal, "Escape", extra);
  }
  assert.equal(modal.isOpen, true);

  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    pressStageKey(modal, modal.inputEl, "[", { ctrlKey: true, ...extra });
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

test("Ctrl+[ closes from a focused date field without writing", () => {
  const { modal, editor, plugin } = openPropertyPicker();
  let written = 0;
  plugin.setBulletPropertyValue = async () => {
    written += 1;
    return true;
  };
  dispatchCardKey(modal, "Enter");
  assert.equal(modal.stage, "value");
  modal.inputEl.value = "3 waiting on API";
  const event = pressStageKey(modal, modal.inputEl, "[", CTRL_LEFT_BRACKET);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.isOpen, false);
  assert.equal(written, 0);
  assert.equal(editor.writes(), 0);
});

test("Ctrl+[ closes the schedule review from its Reason and Work summary fields", async () => {
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
    const event = pressStageKey(modal, element, "[", CTRL_LEFT_BRACKET);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(modal.isOpen, false);
    assert.equal(modal.pendingScheduleReview, null);
    assert.equal(editor.writes(), 0);
  }
});

test("Ctrl+[ closes the summary-only schedule-work-log stage without writing", async () => {
  const { modal, editor, plugin } = openPropertyPicker({
    content: "- [/] #task Pending work [priority:: medium] [scheduled:: 2026-10-06] ^pending",
  });
  let written = 0;
  plugin.setBulletPriorityValue = async () => {
    written += 1;
    return true;
  };
  dispatchCardKey(modal, "1");
  await nextTurn();
  assert.equal(modal.stage, "schedule-work-log");
  modal.inputEl.value = "typed but uncommitted";
  const q = pressStageKey(modal, modal.inputEl, "q");
  assert.equal(q.prevented, false);
  assert.equal(modal.isOpen, true);
  const event = pressStageKey(modal, modal.inputEl, "[", CTRL_LEFT_BRACKET);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.isOpen, false);
  assert.equal(modal.pendingScheduleWorkLog, null);
  assert.equal(written, 0);
  assert.equal(editor.writes(), 0);
});

test("Ctrl+[ closes the lane-release Work summary without writing", async () => {
  const { modal, editor, plugin } = openPropertyPicker({
    content: "- [/] #task Release me [priority:: medium] ^release",
  });
  let written = 0;
  plugin.applyLaneToggleFromPicker = async () => {
    written += 1;
    return true;
  };
  dispatchCardKey(modal, "n", { altKey: true });
  await nextTurn();
  assert.equal(modal.stage, "lane-release-reason");
  modal.inputEl.value = "typed but uncommitted";
  const q = pressStageKey(modal, modal.inputEl, "q");
  assert.equal(q.prevented, false);
  assert.equal(modal.isOpen, true);
  const event = pressStageKey(modal, modal.inputEl, "[", CTRL_LEFT_BRACKET);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.isOpen, false);
  assert.equal(modal.pendingLaneRelease, null);
  assert.equal(written, 0);
  assert.equal(editor.writes(), 0);
});

test("q closes from a focused More row and from the Close button", () => {
  for (const pick of [
    (modal) => byClass(modal.contentEl, "bob-task-card-more-row")[0],
    (modal) => byClass(modal.contentEl, "bob-task-card-close")[0],
  ]) {
    const { modal, editor } = openPropertyPicker();
    const element = pick(modal);
    const event = pressStageKey(modal, element, "q");
    assert.equal(modal.isOpen, false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(editor.writes(), 0);
  }
  const { modal } = openPropertyPicker();
  const row = byClass(modal.contentEl, "bob-task-card-more-row")[0];
  pressStageKey(modal, row, "z");
  pressStageKey(modal, row, "/");
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "task-card");
});

test("Ctrl+[ closes from focused card controls, the Back button, and the modal frame", () => {
  const { modal, editor } = openPropertyPicker();
  const more = byClass(modal.contentEl, "bob-task-card-more-row")[0];
  const event = pressStageKey(modal, more, "[", CTRL_LEFT_BRACKET);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.isOpen, false);
  assert.equal(editor.writes(), 0);

  const staged = openPropertyPicker();
  dispatchCardKey(staged.modal, "Enter");
  assert.equal(staged.modal.stage, "value");
  const back = byClass(staged.modal.contentEl, "bob-task-card-back")[0];
  assert.ok(back);
  const backEvent = pressStageKey(staged.modal, back, "[", CTRL_LEFT_BRACKET);
  assert.equal(backEvent.prevented, true);
  assert.equal(backEvent.stopped, true);
  assert.equal(staged.modal.isOpen, false);
  assert.equal(staged.editor.writes(), 0);

  const framed = openPropertyPicker();
  framed.modal.modalEl.focus();
  const frameEvent = pressKey(framed.modal, "[", CTRL_LEFT_BRACKET);
  assert.equal(frameEvent.defaultPrevented, true);
  assert.equal(frameEvent.propagationStopped, true);
  assert.equal(framed.modal.isOpen, false);

  const composing = openPropertyPicker();
  composing.modal.modalEl.focus();
  pressKey(composing.modal, "[", { ctrlKey: true, isComposing: true });
  pressKey(composing.modal, "q");
  assert.equal(composing.modal.isOpen, true);
});

test("a More stage, a refresh stage, a cancel stage, and a dependency field close on Ctrl+[ and Escape", () => {
  const stages = [
    (modal) => byClass(modal.contentEl, "bob-task-card-more-row")[0].listeners.click({ preventDefault() {} }),
    (modal) => dispatchCardKey(modal, "f"),
    (modal) => dispatchCardKey(modal, "x"),
    (modal) => dispatchCardKey(modal, "b"),
  ];
  for (const open of stages) {
    for (const close of ["ctrl-bracket", "escape"]) {
      const { modal, editor } = openPropertyPicker();
      open(modal);
      assert.notEqual(modal.stage, "task-card");
      if (close === "escape") {
        pressKey(modal, "Escape");
      } else {
        pressStageKey(modal, modal.inputEl, "[", CTRL_LEFT_BRACKET);
      }
      assert.equal(modal.isOpen, false, `${modal.stage} ${close}`);
      assert.equal(editor.writes(), 0);
    }
  }
});

test("a resolving Task Link closes on Escape, q, and Ctrl+[ and swallows every other key", async () => {
  for (const [key, extra] of [
    ["Escape", {}],
    ["q", {}],
    ["Q", { shiftKey: true }],
    ["[", { ctrlKey: true, code: "BracketLeft" }],
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
    const event = pressKey(modal, key, extra);
    assert.equal(modal.isOpen, false, key);
    assert.equal(event.defaultPrevented, true);
    assert.equal(editor.writes(), 0);
    resolveTargets({ error: null, targets: [] });
    assert.equal(await resolving, false);
  }
});

test("a direct dependency stage closes on Ctrl+[ but keeps q as typed text", () => {
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
  const event = pressStageKey(modal, modal.inputEl, "[", CTRL_LEFT_BRACKET);
  assert.equal(event.prevented, true);
  assert.equal(modal.isOpen, false);
  assert.equal(editor.writes(), 0);
});

test("q and Ctrl+[ are not global closes: other modals and the decay card ignore them", () => {
  const app = {};
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  const child = new ChildNotePickerModal(app, plugin, [], { basename: "Parent" });
  child.open();
  assert.equal(child.inputEl.focused, true);
  child.inputEl.listeners.keydown(closeKeyEvent("q", { target: child.inputEl }));
  child.inputEl.listeners.keydown(closeKeyEvent("[", { ctrlKey: true, target: child.inputEl }));
  assert.equal(child.isOpen, true);

  const card = new FreshnessDecayCardModal({}, {
    rows: [
      { key: "1", label: "Not now", detail: "stamp only", action: "notNow", available: true },
    ],
  });
  card.open();
  card.contentEl.listeners.keydown(closeKeyEvent("q"));
  card.contentEl.listeners.keydown(closeKeyEvent("[", { ctrlKey: true }));
  assert.equal(card.attached, true);
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

test("task card level chips reuse the shared priority mark when available", () => {
  const calls = [];
  const priorityMarks = {
    version: 1,
    model: (value) => ({ value }),
    render: (host, value, options) => {
      calls.push({ value, options });
      const el = host.createSpan({ cls: "bob-priority-mark-stub" });
      el.setAttribute("data-priority", value);
      return el;
    },
  };
  const model = makeModel();
  const levelValues = (model.priorityStrip.levels || []).map((level) => level.value);
  assert.ok(levelValues.length > 0);
  const root = new ElementStub();
  renderTaskCardView(root, model, { priorityMarks });

  const glyphs = byClass(root, "bob-task-card-level-glyph");
  assert.equal(glyphs.length, levelValues.length);
  assert.deepEqual(
    calls.map((call) => call.value),
    levelValues,
  );
  for (const call of calls) {
    assert.deepEqual(call.options, { decorative: true, inheritColor: true });
  }
  const labels = byClass(root, "bob-task-card-level-label");
  assert.equal(labels.length, levelValues.length + 1);
  for (const label of labels.slice(0, levelValues.length)) {
    assert.equal(label.children[0].classes.includes("bob-task-card-level-glyph"), true);
  }
  const p0Label = labels[labels.length - 1];
  assert.ok(!p0Label.children.some((child) => child.classes.includes("bob-task-card-level-glyph")));
  const text = flattenText(root);
  for (const level of model.priorityStrip.levels) {
    assert.match(text, new RegExp(level.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("task card labels are unchanged without the priority mark api", () => {
  const model = makeModel();
  const expected = flattenText((() => {
    const root = new ElementStub();
    renderTaskCardView(root, model);
    return root;
  })());

  for (const options of [
    undefined,
    {},
    { app: {} },
    { priorityMarks: null },
    { priorityMarks: { version: 0, render: () => { throw new Error("unused"); } } },
    { priorityMarks: { version: 1 } },
    { priorityMarks: { version: 1, render: () => null } },
    {
      priorityMarks: {
        version: 1,
        render: () => { throw new Error("glyph failed"); },
      },
    },
  ]) {
    const root = new ElementStub();
    if (options === undefined) {
      renderTaskCardView(root, model);
    } else {
      renderTaskCardView(root, model, options);
    }
    assert.equal(byClass(root, "bob-task-card-level-glyph").length, 0);
    assert.equal(flattenText(root), expected);
  }
});

function jobThemeSuggestion() {
  return {
    source: "note", theme: { key: "write", name: "WRITE", known: true },
    from: { stem: "job", kind: "area", path: "job.md" },
  };
}

function jobThemeHarness() {
  return makeTaskThemeHarness({
    catalog: [{ key: "write", name: "WRITE", hue: "violet" }, { key: "meet", name: "MEET", hue: "blue" }],
    recent: [{ key: "write", name: "WRITE" }, { key: "meet", name: "MEET" }],
    suggestFor: () => jobThemeSuggestion(),
  });
}

function clickTheme(modal, key) {
  const index = modal.visibleItems.findIndex((item) => item.themeKey === key);
  assert.ok(index >= 0, `theme ${key} is visible`);
  click(byClass(modal.resultsEl, "bob-cnp-row")[index]);
}

test("job.md inherited theme no-op explains the source, writes nothing, and closes", async () => {
  const content = "- [ ] #task Job task ^job";
  const { modal, editor } = openTaskThemeStage({ content, filePath: "job.md", themeHarness: jobThemeHarness() });
  clickTheme(modal, "write");
  await nextTurn();
  assert.equal(editor.getValue(), content);
  assert.deepEqual(editor.writeCounts(), { transactions: 0, replacements: 0 });
  assert.equal(notices.at(-1), "WRITE is already inherited from area note job; nothing was written");
  assert.equal(modal.isOpen, false);
});

test("choosing the inherited theme removes an override and reports its source", async () => {
  const content = "- [ ] #task Job task [theme:: MEET] ^job";
  const { modal, editor } = openTaskThemeStage({ content, themeHarness: jobThemeHarness() });
  clickTheme(modal, "write");
  await nextTurn();
  assert.equal(editor.getValue(), "- [ ] #task Job task ^job");
  assert.equal(editor.writeCounts().replacements, 1);
  assert.equal(notices.at(-1), "Override removed; WRITE is inherited from area note job");
  assert.equal(modal.isOpen, false);
});

test("Ctrl+D with no override and selecting the explicit theme explain unchanged tasks", async () => {
  for (const same of [false, true]) {
    const content = `- [ ] #task Job task${same ? " [theme:: MEET]" : ""} ^job`;
    const { modal, editor } = openTaskThemeStage({ content, themeHarness: jobThemeHarness() });
    if (same) clickTheme(modal, "meet");
    else pressKey(modal, "d", { ctrlKey: true });
    await nextTurn();
    assert.equal(editor.getValue(), content);
    assert.deepEqual(editor.writeCounts(), { transactions: 0, replacements: 0 });
    assert.equal(notices.at(-1), same
      ? "MEET is already set on this task; nothing was written"
      : "Already using the default (WRITE from area note job); nothing was written");
    assert.equal(modal.isOpen, false);
  }
});

test("counted and linked unchanged batches explain the inherited source without writes", async () => {
  for (const linked of [false, true]) {
    const lines = ["- [ ] #task Alpha ^alpha", "- [/] #task Beta ^beta", "- [ ] #task Gamma ^gamma"];
    const content = lines.join("\n");
    const themeHarness = jobThemeHarness();
    const vault = installThemeVault(themeHarness, { "job.md": content });
    const targets = lines.map((rawLine, line) => ({ path: "job.md", content, line, rawLine, blockId: ["alpha", "beta", "gamma"][line] }));
    const context = linked
      ? { propertyContext: { isObsidianTask: false }, linkSession: linkSessionForTargets(targets) }
      : { taskSession: { valid: true, explicit: true, requestedCount: 3, actualCount: 3, targets } };
    const source = linked ? "- [[job#^alpha]]\n- [[job#^beta]]\n- [[job#^gamma]]" : content;
    const { modal, editor } = openTaskThemeStage({ content: source, themeHarness, context });
    clickTheme(modal, "write");
    await nextTurn();
    assert.equal(notices.at(-1), "WRITE is already inherited from area note job by all 3 tasks; nothing was written");
    assert.equal(editor.getValue(), source);
    assert.deepEqual(editor.writeCounts(), { transactions: 0, replacements: 0 });
    assert.equal(vault.notes["job.md"], content);
    assert.deepEqual(vault.writes, []);
    assert.equal(modal.isOpen, false);
  }
});

test("a single linked theme edit uses fresh source-specific no-op and saved notices", async () => {
  for (const override of [false, true]) {
    const content = `- [ ] #task Job task${override ? " [theme:: MEET]" : ""} ^job`;
    const themeHarness = jobThemeHarness();
    const vault = installThemeVault(themeHarness, { "job.md": content });
    const target = { path: "job.md", content, line: 0, rawLine: content, blockId: "job" };
    const { modal, editor } = openTaskThemeStage({
      content: "- [[job#^job]]", themeHarness,
      context: { propertyContext: { isObsidianTask: false }, linkSession: linkSessionForTargets([target]) },
    });
    clickTheme(modal, "write");
    await nextTurn();
    assert.equal(notices.at(-1), override
      ? "Override removed; WRITE is inherited from area note job"
      : "WRITE is already inherited from area note job; nothing was written");
    assert.equal(vault.notes["job.md"], "- [ ] #task Job task ^job");
    assert.equal(vault.writes.length, override ? 1 : 0);
    assert.deepEqual(editor.writeCounts(), { transactions: 0, replacements: 0 });
    assert.equal(modal.isOpen, false);
  }
});

test("theme menu uses colored pills, grey PLAN, source markers, and distinct kind badges", () => {
  const catalog = [
    { key: "build", name: "BUILD", hue: "yellow", today: true },
    { key: "plan", name: "PLAN", hue: null },
    { key: "write", name: "WRITE", hue: "violet" },
  ];
  const { modal } = openTaskThemeStage({ themeOptions: { catalog, recent: catalog, suggestFor: jobThemeSuggestion } });
  const rowFor = (key) => byClass(modal.resultsEl, "bob-cnp-row")[modal.visibleItems.findIndex((item) => item.themeKey === key)];
  for (const [key, hue] of [["build", "yellow"], ["plan", "muted"]]) {
    const row = rowFor(key);
    assert.ok(row.classes.includes("bob-task-card-theme-option"));
    const pill = byClass(row, "bob-task-card-theme-option-pill")[0];
    const swatch = byClass(pill, "bob-cnp-theme-swatch")[0];
    assert.ok(pill.classes.includes(`is-${hue}`));
    assert.ok(swatch.classes.includes(`is-${hue}`));
    assert.equal(pill.attributes["data-theme-hue"], hue === "muted" ? "none" : hue);
    assert.equal(swatch.attributes["aria-hidden"], "true");
    assert.equal(swatch.attributes.title, hue === "muted" ? "No theme color" : "Theme hue: yellow");
    assert.equal(flattenText(pill), key.toUpperCase());
    assert.equal(byClass(row, "bob-cnp-row-path").length, 0);
    assert.equal(byClass(row, "bob-cnp-row-status").length, 1);
  }
  const write = rowFor("write");
  const badges = byClass(write, "bob-cnp-row-status");
  assert.deepEqual(badges.map(flattenText), ["Recent", "Default"]);
  assert.equal(badges[1].attributes.title, "Inherited default; choosing it removes this task's override");
  assert.equal(flattenText(byClass(write, "bob-cnp-row-path")[0]), "inherited from area note job");
  const defaultRow = rowFor("__default");
  assert.equal(byClass(defaultRow, "bob-task-card-theme-option-pill").length, 0);
  assert.equal(flattenText(defaultRow), "Use default WRITE from job");
  for (const row of byClass(modal.resultsEl, "bob-cnp-row")) {
    assert.doesNotMatch(flattenText(row), /Today · Today|Recent · Recent|Use default · Use default/);
  }
  modal.inputEl.value = "bui";
  modal.inputEl.listeners.input({});
  assert.equal(flattenText(byClass(rowFor("build"), "bob-cnp-hl")[0]), "BUI");
  modal.close();
});

test("theme menu stays grey when hueFor is missing or throws, and header matches null hues", () => {
  for (const hueFor of [undefined, () => { throw new Error("unavailable hue"); }]) {
    const themeHarness = jobThemeHarness();
    themeHarness.api.hueFor = hueFor;
    const { modal } = openTaskThemeStage({ themeHarness });
    const pill = byClass(modal.resultsEl, "bob-task-card-theme-option-pill")[0];
    assert.ok(pill.classes.includes("is-muted"));
    assert.ok(byClass(pill, "bob-cnp-theme-swatch")[0].classes.includes("is-muted"));
    modal.close();
  }
  const themeHarness = makeTaskThemeHarness({
    catalog: [{ key: "plan", name: "PLAN", hue: null }], suggestFor: () => noteTheme("PLAN"),
  });
  const { modal } = openPropertyPicker({ content: "- [ ] #task Plan ^plan", app: themeHarness.app });
  const pill = byClass(modal.contentEl, "bob-task-card-theme-pill")[0];
  assert.ok(pill.classes.includes("is-muted"));
  assert.ok(byClass(pill, "bob-cnp-theme-swatch")[0].classes.includes("is-muted"));
  modal.close();
  assert.match(STYLES, /\.bob-task-card-theme-option-pill\.is-blue/);
  assert.match(STYLES, /--bob-theme-option-hue/);
  assert.match(STYLES, /\.bob-task-card-theme-option-pill\s*\{[^}]*display: inline-flex/s);
  assert.match(STYLES, /\.bob-task-card-theme-pill\.is-muted\s*\{[^}]*border-color: color-mix/s);
  assert.match(STYLES, /\.bob-task-card-theme-option-pill \.bob-cnp-theme-swatch\.is-muted,\s*\.bob-task-card-theme-pill \.bob-cnp-theme-swatch\.is-muted\s*\{\s*background-color: var\(--text-faint\);\s*border-color: transparent;/s);
});
