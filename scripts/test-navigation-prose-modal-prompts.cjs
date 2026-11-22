// Standalone modal prompts opt into the LINK band (phase bob-cli-om.4):
// S2 Move to Next, S3 Release task, S4 batch Keep reason, S5 Rotten keep /
// decay Stay stage, S12 Notebook Summary, S13 Task from email. Each surface
// passes `links: true` (or attaches proseField) with its sourcePath, keeps
// its host guards, and closes the Ctrl+[ gap. The DOM stand-in honors
// capture-before-bubble at the target and an Obsidian-like window keymap, so
// Esc/Ctrl+[ layering runs through the real controller.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");
const { ModalStub } = require("./modal-harness.cjs");
const { createTaskLinksApi } = require("./prose-task-links-harness.cjs");

const originalLoad = Module._load;
Module._load = function loadWithMailStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class TestPlugin {
      constructor(app) { this.app = app; }
      registerEvent() {}
    }
    return {
      MarkdownView: class {},
      Modal: class extends ModalStub {},
      Notice: class {},
      Plugin: TestPlugin,
      PluginSettingTab: class {},
      Setting: class {},
      openExternal: () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const mail = require("../plugins/bob-mail/main.js").helpers;
Module._load = originalLoad;

class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, {
      key: "",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      isComposing: false,
      repeat: false,
    }, init);
    this.type = type;
    this.defaultPrevented = false;
    this.stopped = false;
    this.immediate = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; this.immediate = true; }
}

function makeDocument() {
  const listeners = {};
  const doc = {
    activeElement: null,
    keymap: null,
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] || []).filter((entry) => entry !== listener);
    },
    execCommand(command, _show, text) {
      const el = this.activeElement;
      if (command !== "insertText" || !el) return false;
      const value = String(el.value || "");
      el.value = value.slice(0, el.selectionStart) + String(text) + value.slice(el.selectionEnd);
      const caret = el.selectionStart + String(text).length;
      el.selectionStart = caret;
      el.selectionEnd = caret;
      el.dispatchEvent(new FakeEvent("input", { inputType: "insertText" }));
      return true;
    },
  };
  doc.defaultView = {
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    setTimeout: (callback) => { callback(); return 0; },
    clearTimeout: () => {},
  };
  return doc;
}

class El {
  constructor(doc, options = {}) {
    this.ownerDocument = doc;
    this.children = [];
    this.parent = null;
    this.classes = String(options.cls || "").split(/\s+/u).filter(Boolean);
    this.classList = {
      add: (...names) => this.addClass(...names),
      remove: (...names) => this.removeClass(...names),
      contains: (name) => this.classes.includes(name),
      toggle: (name, force) => this.toggleClass(name, force),
    };
    this.attributes = { ...(options.attr || {}) };
    this.textContent = options.text == null ? "" : String(options.text);
    this.tagName = String(options.tag || "div").toUpperCase();
    this.value = options.value == null ? "" : String(options.value);
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.disabled = false;
    this.style = { setProperty() {} };
    this.capture = {};
    this.bubble = {};
  }
  get parentElement() { return this.parent; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createEl(tag, options = {}) { return this.appendChild(new El(this.ownerDocument, { ...options, tag })); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  appendText(text) { this.appendChild(new El(this.ownerDocument, { text })); }
  empty() { for (const child of this.children) child.parent = null; this.children = []; this.textContent = ""; }
  setText(text) { this.textContent = String(text); }
  addClass(...names) { for (const name of names) if (!this.classes.includes(name)) this.classes.push(name); }
  removeClass(...names) { this.classes = this.classes.filter((name) => !names.includes(name)); }
  toggleClass(name, force) {
    const on = force === undefined ? !this.classes.includes(name) : Boolean(force);
    if (on) this.addClass(name);
    else this.removeClass(name);
    return on;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener, options) {
    const capture = options === true || Boolean(options && options.capture);
    ((capture ? this.capture : this.bubble)[type] ||= []).push(listener);
  }
  removeEventListener(type, listener) {
    for (const table of [this.capture, this.bubble]) {
      table[type] = (table[type] || []).filter((entry) => entry !== listener);
    }
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  select() { this.selectionStart = 0; this.selectionEnd = String(this.value || "").length; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  contains(node) {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
  querySelector(selector) {
    const cls = String(selector || "").replace(/^\./u, "").split(".")[0];
    return this.find((node) => node.classes.includes(cls));
  }
  dispatchEvent(event) {
    event.target = this;
    const path = [];
    for (let current = this; current; current = current.parent) path.unshift(current);
    const run = (node, table) => {
      for (const listener of [...(table[event.type] || [])]) {
        listener.call(node, event);
        if (event.immediate) return;
      }
    };
    for (const node of path.slice(0, -1)) {
      run(node, node.capture);
      if (event.stopped) return true;
    }
    run(this, this.capture);
    if (!event.immediate) run(this, this.bubble);
    for (const node of path.slice(0, -1).reverse()) {
      if (event.stopped) return true;
      run(node, node.bubble);
    }
    if (!event.stopped && event.type === "keydown" && typeof this.ownerDocument.keymap === "function") {
      this.ownerDocument.keymap(event);
    }
    return true;
  }
}

function makeScope() {
  return {
    handlers: [],
    register(modifiers, key, func) {
      const handler = { modifiers, key, func };
      this.handlers.push(handler);
      return handler;
    },
    unregister(handler) { this.handlers = this.handlers.filter((entry) => entry !== handler); },
  };
}

// Obsidian's window keymap: the modal scope sees keys DOM listeners did not
// stop; an unconsumed Esc closes the modal.
function mount(modal, doc) {
  modal.contentEl = new El(doc);
  modal.modalEl = new El(doc);
  modal.modalEl.appendChild(modal.contentEl);
  modal.scope = makeScope();
  modal.isOpen = true;
  modal.attached = true;
  doc.keymap = (event) => {
    if (!modal.isOpen) return;
    for (const handler of [...modal.scope.handlers]) {
      if (handler.key !== null && handler.key !== event.key) continue;
      if (handler.func(event) === false) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape") modal.close();
  };
  modal.onOpen();
  return modal;
}

const FILES = ["sase.md", "sase_blog.md", "projects/plan.md", "2026/2026-11-21.md"].map((path) => ({
  path,
  basename: path.split("/").pop().replace(/\.md$/u, ""),
  extension: "md",
}));

function makeApp(options = {}) {
  const attached = [];
  const proseAttached = [];
  const app = {
    walks: 0,
    vault: {
      getMarkdownFiles: () => { app.walks += 1; return FILES; },
      getFiles: () => FILES,
      getAbstractFileByPath: (path) => FILES.find((file) => file.path === path) || null,
    },
    metadataCache: {
      resolvedLinks: {},
      getFileCache: () => ({}),
      getFirstLinkpathDest: (linkpath) =>
        FILES.find((file) => file.path === `${linkpath}.md` || file.basename === linkpath) || null,
      on: () => ({}),
    },
    workspace: { getLastOpenFiles: () => [] },
    plugins: { plugins: {} },
  };
  const nav = { app, registerEvent() {} };
  if (options.nav !== false) {
    const api = helpers.createDependencyNavApi(nav);
    nav.api = options.spy === false ? api : {
      ...api,
      logRecall: {
        version: 2,
        attach(attachOptions) { attached.push(attachOptions); return api.logRecall.attach(attachOptions); },
        noteUsed: () => true,
      },
      proseField: {
        version: 1,
        attach(attachOptions) { proseAttached.push(attachOptions); return api.proseField.attach(attachOptions); },
      },
    };
    app.plugins.plugins["bob-navigation-hotkeys"] = nav;
  }
  return { app, nav, attached, proseAttached };
}

function type(input, value, caret = value.length) {
  input.focus();
  input.value = value;
  input.selectionStart = caret;
  input.selectionEnd = caret;
  input.dispatchEvent(new FakeEvent("input", { inputType: "insertText" }));
}

function press(target, key, modifiers = {}) {
  const event = new FakeEvent("keydown", { key, ...modifiers });
  target.dispatchEvent(event);
  if (key === "Enter") target.dispatchEvent(new FakeEvent("keyup", { key }));
  return event;
}

function linkBandOpen(host) {
  const slot = host.querySelector("bob-prose-link-slot");
  return Boolean(slot && slot.find((node) => node.classes.includes("bob-link-band") && !node.classes.includes("is-hidden")));
}

test("logRecall-attached prose fields reuse nav's one link index across keystrokes", () => {
  const { app, nav } = makeApp({ spy: false });
  const doc = makeDocument();
  const root = new El(doc);
  const input = root.createEl("input");
  const bandHost = root.createDiv();
  const handle = nav.api.logRecall.attach({ inputEl: input, bandHost, kind: "work", links: true, ownKeys: true });
  type(input, "See [[sa");
  assert.equal(handle.isLinkOpen(), true);
  type(input, "See [[sas");
  type(input, "See [[sase");
  assert.equal(app.walks, 1, "the vault is walked once, not on every keystroke");
  assert.ok(nav._bobProseLinkIndex, "the index is cached on nav's plugin instance");
  handle.detach();
});

test("S2 Move to Next opts into links with the tasks' shared note", () => {
  const { app, attached } = makeApp();
  const doc = makeDocument();
  const results = [];
  const modal = mount(new helpers.TaskLinkLanePromptModal(app, {
    tasks: [
      { displayText: "Ship", path: "projects/plan.md", line: 3, blockId: "ship" },
      { displayText: "Test", path: "projects/plan.md", line: 7 },
    ],
    sourcePaths: ["projects/plan.md", "projects/plan.md"],
    onDone: (value) => results.push(value),
  }), doc);
  assert.equal(attached.at(-1).links, true);
  assert.equal(attached.at(-1).kind, "work");
  assert.equal(attached.at(-1).sourcePath(), "projects/plan.md");
  // T10/T11: every moved task is the prompt's subject, so `((` shows it disabled.
  assert.deepEqual(attached.at(-1).subjects(), [
    { path: "projects/plan.md", line: 3, blockId: "ship" },
    { path: "projects/plan.md", line: 7 },
  ]);

  type(modal.inputEl, "Outlined [[sa");
  assert.equal(modal.logRecall.isLinkOpen(), true);
  press(modal.inputEl, "Enter");
  assert.equal(modal.inputEl.value, "Outlined [[sase]]", "Enter inserts the link");
  assert.deepEqual(results, [], "Enter with the band open never submits");

  type(modal.inputEl, "Outlined [[sase]] and [[sa");
  press(modal.inputEl, "[", { ctrlKey: true });
  assert.equal(modal.logRecall.isLinkOpen(), false, "Ctrl+[ closes only the band");
  assert.equal(modal.isOpen, true);
  press(modal.inputEl, "[", { ctrlKey: true });
  assert.equal(modal.isOpen, false, "the next Ctrl+[ reaches Esc's close");
  assert.deepEqual(results, [null]);

  const mixed = new helpers.TaskLinkLanePromptModal(app, { tasks: [], sourcePaths: ["a.md", "b.md"] });
  assert.equal(mixed.taskLinkLaneSourcePath(), null, "mixed notes leave same-note links unresolved");
  assert.equal(new helpers.TaskLinkLanePromptModal(app, {}).taskLinkLaneSourcePath(), null);
});

test("S3 Release task passes the released task's note and keeps Esc layering", () => {
  const { app, attached } = makeApp();
  const doc = makeDocument();
  const results = [];
  const modal = mount(new helpers.LaneReleaseSummaryModal(
    app,
    (value) => results.push(value),
    {
      sourcePath: "projects/plan.md",
      subjects: [{ path: "projects/plan.md", line: 4, blockId: "work" }],
    },
  ), doc);
  assert.equal(attached.at(-1).links, true);
  assert.equal(attached.at(-1).sourcePath(), "projects/plan.md");
  assert.deepEqual(attached.at(-1).subjects(), [{ path: "projects/plan.md", line: 4, blockId: "work" }],
    "the released task is the prompt's subject");
  type(modal.inputEl, "Blocked on [[sa");
  assert.equal(modal.logRecall.isLinkOpen(), true);
  press(modal.inputEl, "Escape");
  assert.equal(modal.isOpen, true, "Esc with the band open closes only the band");
  assert.equal(modal.logRecall.isLinkOpen(), false);
  press(modal.inputEl, "Enter");
  assert.deepEqual(results, ["Blocked on [[sa"], "Enter with the band closed submits the draft");
  const bare = new helpers.LaneReleaseSummaryModal(app, () => {});
  assert.equal(bare.sourcePath, null);
  assert.deepEqual(helpers.proseTaskSubjects(bare.subjectTasks), [], "no declared subjects, none guarded");
});

function batchTarget(path, raw, line) {
  return {
    kind: "counted",
    raw,
    entry: path ? { path } : {},
    ...(Number.isInteger(line) ? { target: { line, raw } } : {}),
    history: { status: "ok", entries: [] },
  };
}

test("S4 batch Keep reason links against the shared entry note and Ctrl+[ cancels", () => {
  const { app, attached } = makeApp();
  const doc = makeDocument();
  const results = [];
  const modal = mount(new helpers.FreshnessRefreshSummaryModal(app, {
    dateText: "2026-11-21",
    keepTargets: [batchTarget("projects/plan.md", "- [ ] #task A ^a", 2), batchTarget("projects/plan.md", "- [ ] #task B", 5)],
    totalCount: 2,
    onDone: (value) => results.push(value),
  }), doc);
  assert.equal(attached.at(-1).links, true);
  assert.equal(attached.at(-1).kind, "rotten");
  assert.equal(attached.at(-1).sourcePath(), "projects/plan.md");
  assert.deepEqual(attached.at(-1).subjects(), [
    { path: "projects/plan.md", line: 2, blockId: "a" },
    { path: "projects/plan.md", line: 5 },
  ], "every kept entry is a subject");

  type(modal.keepInputEl, "Waiting on [[sa");
  assert.equal(modal.keepRecall.isLinkOpen(), true);
  const altF = press(modal.keepInputEl, "f", { altKey: true });
  assert.equal(altF.defaultPrevented, true, "the Alt+F swallow stays authoritative");
  assert.equal(modal.isOpen, true);
  press(modal.keepInputEl, "Escape");
  assert.equal(modal.isOpen, true, "Esc with the band open closes only the band");
  press(modal.keepInputEl, "[", { ctrlKey: true });
  assert.equal(modal.isOpen, false, "Ctrl+[ mirrors Esc's cancel");
  assert.deepEqual(results, [null]);

  const mixed = new helpers.FreshnessRefreshSummaryModal(app, {
    keepTargets: [batchTarget("a.md", "- [ ] #task A"), batchTarget("b.md", "- [ ] #task B")],
  });
  assert.equal(mixed.batchKeepSourcePath(), null);
  const missing = new helpers.FreshnessRefreshSummaryModal(app, {
    keepTargets: [batchTarget("a.md", "- [ ] #task A"), batchTarget(null, "- [ ] #task B")],
  });
  assert.equal(missing.batchKeepSourcePath(), null);
  const explicit = new helpers.FreshnessRefreshSummaryModal(app, {
    sourcePath: "x.md",
    keepTargets: [batchTarget("a.md", "- [ ] #task A")],
  });
  assert.equal(explicit.batchKeepSourcePath(), "x.md");
});

function rottenStageOptions(extra = {}) {
  return {
    raw: "- [ ] #task Keep me [fresh:: 2026-10-01]",
    entry: { path: "projects/plan.md", fresh: "2026-10-01", ageDays: 51, tierLabel: "ROTTEN" },
    rung: "Ready",
    keepsBefore: 1,
    keepsAfter: 2,
    history: { status: "none", entries: [] },
    dateText: "2026-11-21",
    ...extra,
  };
}

test("S5 Rotten keep stage links against the kept task's note and Ctrl+[ cancels", () => {
  const { app, attached } = makeApp();
  const doc = makeDocument();
  const container = new El(doc);
  const events = [];
  const stage = new helpers.RottenKeepReasonStage(container, rottenStageOptions({
    app,
    onSubmit: (value) => events.push(["submit", value]),
    onCancel: () => events.push(["cancel"]),
  }));
  assert.equal(attached.at(-1).links, true);
  assert.equal(attached.at(-1).kind, "rotten");
  assert.equal(attached.at(-1).sourcePath(), "projects/plan.md");
  assert.deepEqual(attached.at(-1).subjects(), [], "no line known: no subject is guessed");

  type(stage.inputEl, "Still [[sa");
  assert.equal(stage.logRecall.isLinkOpen(), true);
  press(stage.inputEl, "Enter");
  assert.equal(stage.inputEl.value, "Still [[sase]]");
  assert.deepEqual(events, [], "accepting a link never submits the keep");
  press(stage.inputEl, "[", { ctrlKey: true });
  assert.deepEqual(events, [["cancel"]], "Ctrl+[ mirrors Esc once the band is closed");
  stage.destroy();

  assert.equal(helpers.RottenKeepReasonStage.length >= 1, true);
  const decay = new helpers.RottenKeepReasonStage(new El(doc), rottenStageOptions({
    app,
    decayCard: true,
    sourcePath: "areas/home.md",
  }));
  assert.equal(attached.at(-1).sourcePath(), "areas/home.md", "the host's explicit note wins");
  decay.destroy();

  // A single keep carries its line and raw task line: that task is the subject.
  const single = new helpers.RottenKeepReasonStage(new El(doc), rottenStageOptions({
    app,
    line: 8,
    raw: "- [ ] #task Keep me [fresh:: 2026-10-01] ^keep-me",
  }));
  assert.deepEqual(attached.at(-1).subjects(), [{ path: "projects/plan.md", line: 8, blockId: "keep-me" }]);
  single.destroy();
  // Queue entries count lines from 1; the guard's lines count from 0.
  const queued = new helpers.RottenKeepReasonStage(new El(doc), rottenStageOptions({
    app,
    entry: { path: "projects/plan.md", line: 9, fresh: "2026-10-01" },
  }));
  assert.deepEqual(attached.at(-1).subjects(), [{ path: "projects/plan.md", line: 8 }]);
  queued.destroy();
});

test("S5 decay card Stay stage: Ctrl+[ returns to the choices, the band layer first", () => {
  const { app } = makeApp();
  const doc = makeDocument();
  const modal = mount(new helpers.FreshnessDecayCardModal(app, {
    title: "Kept 3 reviews in a row",
    rows: [{ action: "stay", label: "Stay", detail: "", available: true, recommended: true }],
    rotten: rottenStageOptions({ sourcePath: "projects/plan.md" }),
    onStayReason: () => {},
    onChoose: () => {},
  }), doc);
  assert.equal(modal.showKeepStage(), true);
  const input = modal.keepStage.inputEl;
  type(input, "Because [[sa");
  assert.equal(modal.keepStage.logRecall.isLinkOpen(), true);
  press(input, "[", { ctrlKey: true });
  assert.equal(modal.keepStageActive, true, "Ctrl+[ closes the band first");
  press(input, "[", { ctrlKey: true });
  assert.equal(modal.keepStageActive, false, "then backs out to the choices like Esc");
  assert.equal(modal.isOpen, true);
  modal.close();
});

test("S12 Notebook Summary attaches proseField with no home note; Enter accepts, Esc layers", () => {
  const { app, nav, proseAttached } = makeApp();
  const doc = makeDocument();
  const submits = [];
  nav.commitNotebookCreate = async (request) => { submits.push(request); return { ok: false }; };
  const modal = mount(new helpers.NotebookCreateModal(app, nav, {
    parentPath: "projects/plan.md",
    parentStem: "plan",
    basenames: [],
  }), doc);
  const options = proseAttached.at(-1);
  assert.equal(options.inputEl, modal.summaryInput);
  assert.equal(options.recall, null);
  assert.equal(options.sourcePath, null);
  assert.deepEqual(options.subjects, [], "S12 declares no subject: a notebook is not a task");
  assert.equal(options.ownKeys, true);
  assert.equal(options.scope, modal.scope);
  assert.equal(modal.summaryInput.parent.contains(options.bandHost), true, "the band sits under the Summary field");

  type(modal.summaryInput, "Notes on [[sa");
  assert.equal(modal.summaryProse.isLinkOpen(), true);
  press(modal.summaryInput, "Enter");
  assert.equal(modal.summaryInput.value, "Notes on [[sase]]");
  assert.deepEqual(submits, [], "Enter with the band open never creates");
  type(modal.summaryInput, "Notes on [[sase]] [[sa");
  press(modal.summaryInput, "Escape");
  assert.equal(modal.isOpen, true, "Esc closes only the band");
  assert.equal(linkBandOpen(options.bandHost), false);
  press(modal.summaryInput, "[", { ctrlKey: true });
  assert.equal(modal.isOpen, false, "Ctrl+[ mirrors Esc's close");
  assert.equal(modal.summaryProse, null, "close detaches the band");
});

test("S12 Ctrl+[ closes from the literal ID and Title fields too", () => {
  const { app, nav } = makeApp();
  const doc = makeDocument();
  const modal = mount(new helpers.NotebookCreateModal(app, nav, { parentPath: "p.md", parentStem: "p" }), doc);
  type(modal.idInput, "my-[[sa");
  assert.equal(modal.summaryProse.isLinkOpen(), false, "the ID field never completes");
  press(modal.idInput, "[", { ctrlKey: true });
  assert.equal(modal.isOpen, false);
});

test("S13 Task from email completes notes and tasks without capturing, and fails open without nav", async () => {
  const taskLinks = createTaskLinksApi();
  const { app, proseAttached } = makeApp({ taskLinks });
  app.plugins.plugins["block-id-prompt"] = { api: { taskLinks } };
  const doc = makeDocument();
  const captured = [];
  const plugin = { mailCaptureTask: async (text) => { captured.push(text); return true; } };
  const modal = mount(new mail.BobMailTaskModal(app, plugin, {}, "Follow up: Launch", "[[mail/x]]"), doc);
  const options = proseAttached.at(-1);
  assert.equal(options.inputEl, modal.input);
  assert.equal(options.recall, null);
  assert.equal(options.sourcePath, null);
  assert.equal(options.scope, modal.scope);
  assert.equal(options.tasks, true);

  type(modal.input, "Follow up: Launch per [[sa");
  assert.equal(modal.prose.isLinkOpen(), true);
  press(modal.input, "Enter");
  assert.equal(modal.input.value, "Follow up: Launch per [[sase]]");
  assert.deepEqual(captured, [], "Enter never captures");
  assert.equal(modal.isOpen, true);
  press(modal.input, "Enter");
  assert.equal(modal.isOpen, true, "Enter with the band closed still does nothing");

  type(modal.input, "Follow up: ((reply");
  assert.equal(modal.prose.isTaskOpen(), true);
  press(modal.input, "Enter");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(modal.prose.isNaming(), true);
  const name = press(modal.input, "Enter", { ctrlKey: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(name.defaultPrevented, true, "NAME Enter is consumed before any capture action");
  assert.equal(taskLinks.state.named.at(-1).id, "reply-dana");
  assert.equal(modal.input.value, "Follow up: [[2026/2026-11-21#^reply-dana]]");
  assert.deepEqual(captured, [], "task linking never captures the email task");
  assert.equal(modal.isOpen, true);

  type(modal.input, "Follow up: [[sa");
  press(modal.input, "[", { ctrlKey: true });
  assert.equal(modal.isOpen, true, "Ctrl+[ closes the band first");
  press(modal.input, "[", { ctrlKey: true });
  assert.equal(modal.isOpen, false, "then mirrors Esc's close");
  assert.equal(modal.prose, null);

  const bare = makeApp({ nav: false });
  const plain = mount(new mail.BobMailTaskModal(bare.app, plugin, {}, "Follow up", ""), makeDocument());
  assert.equal(plain.prose, null, "no nav means plain typing");
  press(plain.input, "[", { ctrlKey: true });
  assert.equal(plain.isOpen, false);

  assert.equal(mail.mailProseFieldApi({ plugins: { plugins: { "bob-navigation-hotkeys": { api: { version: 3 } } } } }), null);
  assert.equal(mail.mailIsCtrlLeftBracket({ key: "[", ctrlKey: true }), true);
  assert.equal(mail.mailIsCtrlLeftBracket({ key: "[", ctrlKey: true, shiftKey: true }), false);
});
