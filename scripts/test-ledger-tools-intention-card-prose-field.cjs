// Intention card editor wikilink completion (S14, phase bob-cli-om.6): the
// intention, summary, and reflection stages attach nav's proseField LINK band
// under the field, rebind it on every repaint (surviving Chromium's blur on
// removal), offer stage keys to it first, close it as the first back-out
// rung, follow [ / ] travel through the sourcePath getter, and fail open.
const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers: nav } = require("./navigation-hotkeys-harness.cjs");
const {
  loadLedgerTools, flush, fakeVault, installBobSimulator, FakeNode, FakeDocument,
} = require("./intention-card-test-helpers.cjs");
const { createTaskLinksApi, taskLinksApp } = require("./prose-task-links-harness.cjs");

const LedgerToolsPlugin = loadLedgerTools();
const H = LedgerToolsPlugin.helpers;
const DAY = "2026/20261119.md";
const NEXT_DAY = "2026/20261120.md";

// ---- DOM additions the band renderer needs (this process only) ------------

FakeNode.prototype.createEl = function createEl(tag, options = {}) {
  const child = this.ownerDocument.createElement(tag);
  if (options.cls) child.className = options.cls;
  if (options.text) child.textContent = options.text;
  return this.appendChild(child);
};
FakeNode.prototype.createDiv = function createDiv(options) { return this.createEl("div", options); };
FakeNode.prototype.createSpan = function createSpan(options) { return this.createEl("span", options); };
FakeNode.prototype.appendText = function appendText(text) { return this.createEl("span", { text }); };
FakeNode.prototype.empty = function empty() { while (this.firstChild) this.removeChild(this.firstChild); this.text = ""; };
FakeNode.prototype.addClass = function addClass(name) { this.classList.add(name); };
FakeNode.prototype.removeClass = function removeClass(name) { this.classList.remove(name); };

// Listeners in registration order, honoring stopImmediatePropagation; bubbling
// events then walk the parents (the card's own input listener).
function fire(node, type, extra = {}, bubbles = false) {
  const event = {
    type, target: node, defaultPrevented: false, immediate: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() { this.immediate = true; },
    ...extra,
  };
  let current = node;
  while (current) {
    for (const callback of [...(current.listeners?.get?.(type) || [])]) {
      callback(event);
      if (event.immediate) return event;
    }
    if (!bubbles) break;
    current = current.parentNode;
  }
  return event;
}

FakeNode.prototype.dispatchEvent = function dispatchEvent(event) {
  fire(this, event.type, { ...event }, event.bubbles !== false);
  return true;
};

// Chromium blurs a focused element when an ancestor is removed; toggleable.
let blurOnRemoval = true;
const removeChild = FakeNode.prototype.removeChild;
FakeNode.prototype.removeChild = function removeChildWithBlur(child) {
  const doc = this.ownerDocument;
  const active = doc && doc.activeElement;
  if (blurOnRemoval && active && child && typeof child.contains === "function" && child.contains(active)) {
    doc.activeElement = null;
    fire(active, "blur");
  }
  return removeChild.call(this, child);
};

FakeDocument.prototype.addEventListener = function addEventListener() {};
FakeDocument.prototype.removeEventListener = function removeEventListener() {};
FakeDocument.prototype.execCommand = function execCommand(command, _show, text) {
  const el = this.activeElement;
  if (command !== "insertText" || !el) return false;
  const value = String(el.value || "");
  el.value = value.slice(0, el.selectionStart) + String(text) + value.slice(el.selectionEnd);
  const caret = el.selectionStart + String(text).length;
  el.setSelectionRange(caret, caret);
  fire(el, "input", { inputType: "insertText", isComposing: false }, true);
  return true;
};
Object.defineProperty(FakeDocument.prototype, "defaultView", {
  get() { return { setTimeout: (callback) => { callback(); return 0; }, clearTimeout() {} }; },
});

// ---- notes and the nav API ------------------------------------------------

function note(path, extra = {}) {
  const stem = path.split("/").pop().replace(/\.md$/, "");
  return {
    path, tier: extra.tier || "living", insertTarget: path.replace(/\.md$/, ""), stem,
    aliases: extra.aliases || [], headings: extra.headings || [{ title: "Overview", level: 2, ordinal: 0 }],
    blocks: extra.blocks || [], inbound: extra.inbound || 0,
  };
}

const NOTES = [
  note("sase.md", { inbound: 4 }),
  note("sase_blog_zettel.md", { inbound: 2 }),
  note("sase_blog.md"),
  note(DAY),
];

// The real nav controller, with a fixed note list in place of the vault index.
function realProseApi(log = [], taskLinks = createTaskLinksApi()) {
  const app = taskLinksApp(taskLinks);
  return {
    version: 2,
    attach(options) {
      log.push(options);
      return nav.attachProseField({
        ...options,
        app,
        notes: NOTES,
        hintDebounceMs: 0,
        parentPaths: [],
        linkedPaths: [],
        recentPaths: [],
        resolveLink: (link) => NOTES.find((entry) => entry.insertTarget === link.target) || null,
      });
    },
  };
}

// A recording stand-in: every call the card makes on the handle.
function fakeProseApi() {
  const calls = { attach: [], rebind: [], detach: 0, setSourcePath: 0, keys: [], backOut: 0 };
  const api = {
    version: 1,
    open: false,
    attach(options) {
      calls.attach.push(options);
      return {
        handleKeydown(event) { calls.keys.push(event.key); return api.open && event.key === "Enter"; },
        backOut() { calls.backOut += 1; if (!api.open) return false; api.open = false; return true; },
        isLinkOpen: () => api.open,
        rebind(patch) { calls.rebind.push(patch); return true; },
        setSourcePath() { calls.setSourcePath += 1; return true; },
        detach() { calls.detach += 1; },
      };
    },
  };
  return { api, calls };
}

function setup(fields, proseField, options = {}) {
  const vault = fakeVault();
  vault.seed(DAY, fields);
  vault.seed(NEXT_DAY, options.nextFields || { intentions: ["Tomorrow"] });
  vault.app.plugins = { plugins: proseField === undefined ? {} : { "bob-navigation-hotkeys": { api: { proseField } } } };
  const plugin = new LedgerToolsPlugin(vault.app);
  plugin.albumSetTimeout = () => 0;
  plugin.albumClearTimeout = () => {};
  plugin.intentionCardEditorToday = () => "2026-11-19";
  plugin.setupIntentionUpdate();
  plugin.setupIntentionCardEditor();
  const calls = installBobSimulator(plugin, vault, { "2026-11-19": DAY, "2026-11-20": NEXT_DAY });
  const read = plugin.intentionCardEditorReadFields(DAY);
  const modal = new H.IntentionCardModal(vault.app, {
    plugin, subject: "2026-11-19", subjectPath: DAY, state: "open", fields: read.ok ? read.fields : null,
  });
  const scope = { handlers: [], register(_mods, _key, handler) { this.handlers.push(handler); return handler; }, unregister() {} };
  modal.scope = scope;
  modal.open();
  return { vault, plugin, modal, calls, scope, doc: vault.app.document };
}

const card = (modal) => modal.contentEl.querySelector(".bob-intention-card-editor");
const stageEl = (modal) => card(modal).querySelector(".bob-intention-editor-stage");
const input = (modal) => card(modal).querySelector("[data-intention-input]");
const bandHost = (modal) => card(modal).querySelector("[data-intention-band]");
const key = (name, target, extra = {}) => ({
  key: name, target, defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});
const applies = (calls) => calls.filter((call) => call.dryRun === false);

function type(modal, value, caret = value.length) {
  const el = input(modal);
  el.value = value;
  el.setSelectionRange(caret, caret);
  fire(el, "input", { inputType: "insertText", isComposing: false }, true);
}

function selectedRowText(modal) {
  const row = bandHost(modal)?.querySelector(".is-selected");
  return row ? row.textContent : "";
}

test("without nav's proseField the stage paints no band host and types [[ literally", async () => {
  const { modal, vault } = setup({ intentions: ["One"] });
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  assert.equal(modal.stage.kind, "intention");
  assert.equal(bandHost(modal), null);
  assert.equal(modal.intentionProse || null, null);
  type(modal, "Read [[sas");
  modal.intentionOnKeyDown(key("Enter", input(modal)));
  await flush();
  assert.deepEqual(vault.fields.get(DAY).intentions, ["Read [[sas"]);
  modal.close();
});

test("an old nav, a throwing attach, or a null handle fail open", async () => {
  for (const proseField of [
    { version: 0, attach: () => assert.fail("v0 is never attached") },
    { version: 1, attach: () => { throw new Error("boom"); } },
    { version: 1, attach: () => null },
  ]) {
    const { modal, vault } = setup({ intentions: ["One"] }, proseField);
    await flush();
    modal.intentionOnKeyDown(key("i", null));
    type(modal, "Two [[x]]");
    modal.intentionOnKeyDown(key("Enter", input(modal)));
    await flush();
    assert.deepEqual(vault.fields.get(DAY).intentions, ["Two [[x]]"]);
    modal.close();
  }
});

test("each stage attaches once under its field, rebinds on repaint, and detaches on cancel and close", async () => {
  const { api, calls } = fakeProseApi();
  const { modal } = setup({ intentions: ["One"] }, api);
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  assert.equal(calls.attach.length, 1);
  const opts = calls.attach[0];
  assert.equal(opts.inputEl, input(modal));
  assert.equal(opts.bandHost, bandHost(modal));
  assert.equal(opts.links, true);
  assert.equal(opts.tasks, true);
  assert.equal(opts.recall, null);
  assert.equal(opts.ownKeys, false, "the card routes keys itself");
  assert.equal(opts.mode, "inline");
  assert.equal(opts.sourcePath(), DAY);
  const order = stageEl(modal).children;
  assert.equal(order.indexOf(bandHost(modal)), order.indexOf(input(modal)) + 1, "band host sits directly under the field");
  assert.equal(bandHost(modal).getAttribute("data-intention-band"), "intention");

  // Repaint: same handle, new input and host.
  const before = input(modal);
  modal.paintIntentionCard();
  assert.notEqual(input(modal), before);
  assert.equal(calls.attach.length, 1, "a repaint never reattaches");
  assert.equal(calls.rebind.length, 1);
  assert.equal(calls.rebind[0].inputEl, input(modal));
  assert.equal(calls.rebind[0].bandHost, bandHost(modal));
  assert.equal(calls.setSourcePath, 1, "a closed band re-checks its hint on the fresh host");

  // Esc: the stage cancels (band closed), and the handle detaches.
  modal.onEscapeKey(key("Escape", input(modal)));
  assert.equal(modal.stage, null);
  assert.equal(calls.detach, 1);
  assert.equal(modal.intentionProse, null);

  // Reflection opens a textarea stage with its own handle; close detaches it.
  modal.intentionOnKeyDown(key("r", null));
  assert.equal(calls.attach.length, 2);
  assert.equal(calls.attach[1].inputEl.tagName, "TEXTAREA");
  assert.equal(bandHost(modal).getAttribute("data-intention-band"), "reflection");
  modal.close();
  assert.equal(calls.detach, 2);
});

test("the sourcePath getter follows [ / ] travel to the new subject", async () => {
  const { api, calls } = fakeProseApi();
  const { modal } = setup({ intentions: ["One"] }, api);
  await flush();
  await modal.intentionNavigateTo({ path: NEXT_DAY, id: "2026-11-20", kind: "day", state: "open" });
  await flush();
  assert.equal(modal.subjectPath, NEXT_DAY);
  modal.intentionOnKeyDown(key("i", null));
  assert.equal(calls.attach.length, 1);
  assert.equal(calls.attach[0].sourcePath(), NEXT_DAY);
  modal.close();
});

test("Shift+Enter with the band open never saves a half-typed link", async () => {
  const { api } = fakeProseApi();
  const { modal, calls: bob } = setup({ intentions: ["One"] }, api);
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  assert.equal(modal.stage.kind, "intention");
  modal.intentionProse.handle.handleKeydown = () => false;
  api.open = true;
  const shift = key("Enter", input(modal), { shiftKey: true });
  modal.intentionOnKeyDown(shift);
  assert.equal(shift.defaultPrevented, true, "a declined Enter is consumed");
  assert.ok(modal.stage, "the stage stays open");
  assert.equal(applies(bob).length, 0, "nothing saved");
  modal.close();
});

test("the band sees stage keys first; an open band is the first back-out rung", async () => {
  const { api, calls } = fakeProseApi();
  const { modal, calls: bob } = setup({ intentions: ["One"] }, api);
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  api.open = true;
  const enter = key("Enter", input(modal));
  modal.intentionOnKeyDown(enter);
  await flush();
  assert.equal(enter.defaultPrevented, true);
  assert.ok(modal.stage, "an Enter the band consumed never saves");
  assert.equal(applies(bob).length, 0);
  const esc = key("Escape", input(modal));
  modal.onEscapeKey(esc);
  assert.equal(esc.__schemaEscapeHandled, true);
  assert.equal(api.open, false);
  assert.ok(modal.stage, "Esc closed only the band");
  // Keys from outside the stage field never reach the band.
  calls.keys.length = 0;
  modal.intentionOnKeyDown(key("Enter", card(modal).querySelector(".bob-intention-stage-save")));
  assert.deepEqual(calls.keys, []);
  modal.close();
});

test("real controller: [[ opens the band; Enter inserts the link, a held Enter never saves, then Enter saves", async () => {
  const { modal, vault, calls: bob } = setup({ intentions: ["One"] }, realProseApi());
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  type(modal, "Read [[sase_bl");
  const handle = modal.intentionProse.handle;
  assert.equal(handle.isLinkOpen(), true);
  assert.match(bandHost(modal).textContent, /LINK/);
  assert.match(selectedRowText(modal), /sase_blog/);

  const accept = key("Enter", input(modal));
  modal.intentionOnKeyDown(accept);
  assert.equal(accept.defaultPrevented, true);
  assert.equal(handle.isLinkOpen(), false);
  assert.match(input(modal).value, /^Read \[\[sase_blog(_zettel)?\]\]$/);
  assert.equal(modal.stageDraft, input(modal).value, "the inserted link reaches the draft");
  assert.ok(modal.stage, "accepting a row keeps the stage open");

  const held = key("Enter", input(modal), { repeat: true });
  modal.intentionOnKeyDown(held);
  await flush();
  assert.equal(held.defaultPrevented, true, "a held Enter is swallowed");
  assert.equal(applies(bob).length, 0);
  fire(input(modal), "keyup", { key: "Enter" });

  const linked = input(modal).value;
  modal.intentionOnKeyDown(key("Enter", input(modal)));
  await flush();
  assert.equal(modal.stage, null);
  assert.deepEqual(vault.fields.get(DAY).intentions, [linked]);
  assert.equal(modal.intentionProse, null, "saving the stage detaches the band");
  modal.close();
});

test("real controller: the open band, its selection, and the caret survive a repaint that blurs the old input", async () => {
  const { modal } = setup({ intentions: ["One"] }, realProseApi());
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  type(modal, "See [[sas");
  const handle = modal.intentionProse.handle;
  const down = key("ArrowDown", input(modal));
  modal.intentionOnKeyDown(down);
  assert.equal(down.defaultPrevented, true);
  const selected = selectedRowText(modal);
  assert.ok(selected, "a row is selected");
  const before = input(modal);
  modal.paintIntentionCard();
  assert.notEqual(input(modal), before, "the repaint rebuilt the input");
  assert.equal(modal.intentionProse.handle, handle, "same handle");
  assert.equal(handle.isLinkOpen(), true, "the repaint's blur never closed the band");
  assert.equal(selectedRowText(modal), selected, "selection kept");
  assert.deepEqual([input(modal).selectionStart, input(modal).selectionEnd], [9, 9]);
  assert.equal(input(modal).getAttribute("aria-expanded"), "true");
  assert.equal(before.getAttribute("aria-expanded"), null, "the old input's ARIA is cleared");
  assert.equal(bandHost(modal).querySelector(".bob-link-band").classList.contains("is-settled"), true, "no fade replay");

  // A real blur (focus leaving the field) still closes the band.
  fire(input(modal), "blur");
  assert.equal(handle.isLinkOpen(), false);
  modal.close();
});

test("real controller: Esc and Ctrl+[ close the band one layer at a time; dismissal survives a repaint", async () => {
  const { modal, scope } = setup({ intentions: ["One"] }, realProseApi());
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  type(modal, "See [[sas");
  const handle = modal.intentionProse.handle;
  modal.onEscapeKey(key("Escape", input(modal)));
  assert.equal(handle.isLinkOpen(), false);
  assert.ok(modal.stage, "the first Esc closes only the band");
  modal.paintIntentionCard();
  assert.equal(handle.isLinkOpen(), false, "dismissal memory survives the repaint");
  type(modal, "See [[sase");
  assert.equal(handle.isLinkOpen(), true, "editing the link reopens it");

  // Ctrl+[ through the card's scope wiring mirrors Esc.
  const bracket = key("[", input(modal), { ctrlKey: true, code: "BracketLeft" });
  const passed = scope.handlers.map((handler) => handler(bracket));
  assert.ok(passed.includes(false), "a scope handler consumed Ctrl+[");
  assert.equal(handle.isLinkOpen(), false);
  assert.ok(modal.stage);
  // q types in the field: never a back-out.
  const q = key("q", input(modal));
  assert.ok(scope.handlers.every((handler) => handler(q) !== false));
  modal.intentionOnKeyDown(q);
  assert.ok(modal.stage);

  modal.onEscapeKey(key("Escape", input(modal)));
  assert.equal(modal.stage, null, "the next Esc cancels the stage");
  assert.equal(modal.intentionProse, null);
  modal.close();
});

test("real controller: reflection keeps Shift+Enter a newline; Ctrl+Enter with the band open never saves", async () => {
  const { modal, calls: bob } = setup({ intentions: ["One"] }, realProseApi());
  await flush();
  modal.intentionOnKeyDown(key("r", null));
  assert.equal(input(modal).tagName, "TEXTAREA");
  type(modal, "Wrote [[sas");
  const handle = modal.intentionProse.handle;
  assert.equal(handle.isLinkOpen(), true);
  const shift = key("Enter", input(modal), { shiftKey: true });
  modal.intentionOnKeyDown(shift);
  assert.equal(shift.defaultPrevented, false, "Shift+Enter stays a native newline");
  assert.equal(handle.isLinkOpen(), false);
  assert.ok(modal.stage);

  type(modal, "Wrote [[sas");
  assert.equal(handle.isLinkOpen(), true);
  const ctrl = key("Enter", input(modal), { ctrlKey: true });
  modal.intentionOnKeyDown(ctrl);
  await flush();
  assert.equal(ctrl.defaultPrevented, true);
  assert.equal(modal.closed, false, "Ctrl+Enter accepted the row instead of saving and closing");
  assert.equal(applies(bob).length, 0);
  assert.match(input(modal).value, /^Wrote \[\[sase[^\]]*\]\]$/);
  fire(input(modal), "keyup", { key: "Enter" });
  modal.intentionOnKeyDown(key("Enter", input(modal), { ctrlKey: true }));
  await flush();
  assert.equal(modal.closed, true, "with the band closed, Ctrl+Enter saves and closes");
});

test("real controller: the summary stage completes links too", async () => {
  const { modal } = setup({ intentions: ["One"], summary: "Shipped." }, realProseApi());
  await flush();
  modal.intentionOnKeyDown(key("s", null));
  modal.intentionOnKeyDown(key("Enter", null));
  assert.equal(modal.stage.kind, "summary");
  assert.equal(bandHost(modal).getAttribute("data-intention-band"), "summary");
  type(modal, "Shipped [[sas");
  assert.equal(modal.intentionProse.handle.isLinkOpen(), true);
  modal.close();
  assert.equal(modal.intentionProse, null);
});

test("real controller: (( NAME paste, key routing, and card repaint keep the task snapshot", async () => {
  const taskLinks = createTaskLinksApi();
  const { modal, vault, calls: bob } = setup({ intentions: ["One"] }, realProseApi([], taskLinks));
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  type(modal, "Read ((reply");
  const handle = modal.intentionProse.handle;
  assert.equal(handle.isTaskOpen(), true);
  const opener = key("Enter", input(modal));
  modal.intentionOnKeyDown(opener);
  fire(input(modal), "keyup", { key: "Enter" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(handle.isNaming(), true);
  assert.equal(input(modal).value, "Read ((reply");

  const tab = key("Tab", input(modal));
  modal.intentionOnKeyDown(tab);
  assert.equal(tab.defaultPrevented, true, "Tab cycles the NAME suggestions before card navigation");
  assert.match(bandHost(modal).textContent, /follow-up/);
  const shiftTab = key("Tab", input(modal), { shiftKey: true });
  modal.intentionOnKeyDown(shiftTab);
  assert.equal(shiftTab.defaultPrevented, true, "Shift+Tab cycles back through NAME suggestions");

  const draft = modal.stageDraft;
  const pasteText = "fresh\nid";
  const clipboardData = { getData: (kind) => kind === "text/plain" ? pasteText : "" };
  const pasteEvent = fire(input(modal), "paste", { clipboardData }, true);
  assert.equal(pasteEvent.defaultPrevented, false, "the card's one-line paste handler leaves NAME paste alone");
  let inputEvents = 0;
  input(modal).addEventListener("input", () => { inputEvents += 1; });
  const beforeinput = {
    inputType: "insertFromPaste", clipboardData,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  };
  const beforeinputEvent = fire(input(modal), "beforeinput", beforeinput, true);
  assert.equal(beforeinputEvent.defaultPrevented, true, "proseField routes the paste into the ID line");
  assert.equal(inputEvents, 0, "a cancelled beforeinput has no input event");
  assert.equal(modal.stageDraft, draft, "NAME paste does not edit the intention draft");
  assert.equal(input(modal).value, draft, "the task field stays byte-identical to its snapshot");
  assert.match(bandHost(modal).textContent, /freshid/);

  const beforePaint = input(modal);
  const caret = [beforePaint.selectionStart, beforePaint.selectionEnd];
  modal.paintIntentionCard();
  assert.notEqual(input(modal), beforePaint);
  assert.equal(modal.intentionProse.handle, handle, "the same prose session is rebound");
  assert.equal(handle.isNaming(), true, "NAME survives the card repaint");
  assert.equal(input(modal).value, draft, "the task field snapshot survives repaint");
  assert.deepEqual([input(modal).selectionStart, input(modal).selectionEnd], caret);
  assert.match(bandHost(modal).textContent, /freshid/, "the ID line and its caret state survive repaint");

  const confirm = key("Enter", input(modal), { ctrlKey: true });
  modal.intentionOnKeyDown(confirm);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(confirm.defaultPrevented, true, "Ctrl+Enter is owned by NAME, not the card save");
  assert.equal(taskLinks.state.named.at(-1).id, "freshid");
  assert.equal(handle.isTaskOpen(), false);
  assert.ok(modal.stage, "naming a task leaves the intention stage open");
  assert.equal(applies(bob).length, 0, "task naming never saves the card field");
  assert.equal(vault.fields.get(DAY).intentions[0], "One");
  modal.close();
});

test("task list keeps the pending-write guard and one-line paste behavior", async () => {
  const { modal } = setup({ intentions: ["One"] }, realProseApi());
  await flush();
  modal.intentionOnKeyDown(key("i", null));
  type(modal, "Read ((reply");
  const handle = modal.intentionProse.handle;
  assert.equal(handle.isTaskOpen(), true);

  modal.pendingApply = true;
  const tab = key("Tab", input(modal));
  modal.intentionOnKeyDown(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(handle.isNaming(), false, "the pending write guard runs before task selection");
  assert.equal(handle.isTaskOpen(), true);
  modal.pendingApply = false;

  const pasteText = "tomorrow\nwith Dana";
  const paste = {
    target: input(modal),
    clipboardData: { getData: (kind) => kind === "text/plain" ? pasteText : "" },
    preventDefault() { this.defaultPrevented = true; },
  };
  const pasteEvent = fire(input(modal), "paste", paste, true);
  assert.equal(pasteEvent.defaultPrevented, true, "list-stage intention paste keeps its one-line normalization");
  assert.match(modal.stageDraft, /tomorrow with Dana$/);
  assert.doesNotMatch(modal.stageDraft, /[\r\n]/);
  modal.close();
});

test("blurOnRemoval off: repaints keep the band open as well", async () => {
  blurOnRemoval = false;
  try {
    const { modal } = setup({ intentions: ["One"] }, realProseApi());
    await flush();
    modal.intentionOnKeyDown(key("i", null));
    type(modal, "See [[sas");
    modal.paintIntentionCard();
    assert.equal(modal.intentionProse.handle.isLinkOpen(), true);
    modal.close();
  } finally {
    blurOnRemoval = true;
  }
});

test("S14 NAME accept resolving after keyup: one Enter saves the reflection stage", async () => {
  const taskLinks = createTaskLinksApi();
  const { modal, vault, calls: bob } = setup({ intentions: ["One"] }, realProseApi([], taskLinks));
  await flush();
  try {
    modal.intentionOnKeyDown(key("i", null));
    type(modal, "Read ((reply");
    const handle = modal.intentionProse.handle;
    assert.equal(handle.isTaskOpen(), true);
    const toName = key("Enter", input(modal));
    modal.intentionOnKeyDown(toName);
    fire(input(modal), "keyup", { key: "Enter" });
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(handle.isNaming(), true);
    const commit = key("Enter", input(modal));
    modal.intentionOnKeyDown(commit);
    fire(input(modal), "keyup", { key: "Enter" });
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(handle.isTaskOpen(), false, "NAME commit closes the band");
    assert.match(input(modal).value, /\[\[2026\/2026-11-21#\^reply-dana\]\]/);
    const save = key("Enter", input(modal));
    modal.intentionOnKeyDown(save);
    fire(input(modal), "keyup", { key: "Enter" });
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(applies(bob).length, 1, "a single Enter saves without a retry press");
  } finally { modal.close(); }
});
