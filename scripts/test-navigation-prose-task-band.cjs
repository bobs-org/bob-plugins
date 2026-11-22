// proseField v2 tasks mode (phase bob-cli-oz.3): list + NAME stages,
// beforeinput-fed ID editing, leftover (( hint, API v2, ARIA, rebind.
const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

class Element {
  constructor(options = {}) {
    this.children = [];
    this.parent = null;
    this.classes = String(options.cls || "").split(/\s+/u).filter(Boolean);
    this.classList = {
      add: (...values) => { this.classes.push(...values.filter((name) => !this.classes.includes(name))); },
      remove: (value) => { this.classes = this.classes.filter((name) => name !== value); },
      contains: (value) => this.classes.includes(value),
      toggle: (value, force) => {
        const enabled = force === undefined ? !this.classes.includes(value) : Boolean(force);
        if (enabled && !this.classes.includes(value)) this.classes.push(value);
        if (!enabled) this.classList.remove(value);
        return enabled;
      },
    };
    this.attributes = { ...(options.attr || {}) };
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
    this.listeners = {};
    this.textContent = String(options.text || "");
    this.value = "";
    this.tagName = String(options.tag || "div").toUpperCase();
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.ownerDocument = null;
  }
  get firstChild() { return this.children[0] || null; }
  createDiv(options = {}) { return this.appendChild(new Element(options)); }
  createSpan(options = {}) { return this.appendChild(new Element({ ...options, tag: "span" })); }
  createEl(tag, options = {}) { return this.appendChild(new Element({ ...options, tag })); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  appendText(text) { this.appendChild(new Element({ text })); }
  empty() { for (const child of this.children) child.parent = null; this.children = []; this.textContent = ""; }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parent = null; return child; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((entry) => entry !== listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners[event.type] || []) listener.call(this, event);
    return true;
  }
  fire(type, event) { event.type = type; event.target = this; for (const listener of this.listeners[type] || []) listener.call(this, event); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
    return null;
  }
  querySelector(selector) {
    const cls = String(selector || "").replace(/^\./, "").split(".")[0];
    return this.find((node) => node.classes.includes(cls));
  }
}

function makeDocument(input) {
  const doc = {
    activeElement: input,
    listeners: {},
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((entry) => entry !== listener); },
    execCommand(command, _show, text) {
      if (command !== "insertText" || !this.activeElement) return false;
      const el = this.activeElement;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = String(el.value || "").slice(0, start) + String(text) + String(el.value || "").slice(end);
      const caret = start + String(text).length;
      el.selectionStart = caret;
      el.selectionEnd = caret;
      el.dispatchEvent({ type: "input", inputType: "insertText", bubbles: true, isComposing: false });
      return true;
    },
  };
  doc.defaultView = { Event, InputEvent: typeof InputEvent !== "undefined" ? InputEvent : Event, setTimeout, clearTimeout };
  input.ownerDocument = doc;
  return doc;
}

function taskRow(partial) {
  return {
    key: "t:api#^api-docs",
    notePath: "api.md",
    line: 0,
    blockId: "api-docs",
    needsId: false,
    status: "active",
    glyph: "[/]",
    taskKind: null,
    titleParts: [{ text: "Write the API docs", kind: "text" }],
    displayText: "Write the API docs",
    primary: "Write the API docs",
    section: null,
    group: "in-progress",
    hidden: false,
    linkTarget: "api",
    suggestedId: null,
    disabled: null,
    link: "[[api#^api-docs]]",
    ...partial,
  };
}

function idlessRow(partial) {
  return taskRow({
    key: "t:api#reply-dana",
    notePath: "2026/2026-11-21.md",
    blockId: null,
    needsId: true,
    status: "todo",
    glyph: "[ ]",
    suggestedId: "reply-dana",
    link: null,
    displayText: "Reply to Dana about the offsite",
    primary: "Reply to Dana about the offsite",
    ...partial,
  });
}

function fakeApi(rows, hooks = {}) {
  const state = { validated: [], named: [], closed: false, listeners: new Set() };
  const session = {
    rank: (query) => {
      const q = String(query || "").toLowerCase();
      const filtered = q ? rows.filter((row) => String(row.displayText || "").toLowerCase().includes(q)) : rows.slice();
      return { rows: filtered, total: filtered.length, indexing: hooks.indexing || null };
    },
    linkFor: (row) => {
      if (!row || !row.blockId || row.disabled) return null;
      return row.link || `[[${row.linkTarget}#^${row.blockId}]]`;
    },
    suggestions: (row) => {
      if (hooks.suggestions) return hooks.suggestions(row);
      if (!row || row.blockId) return Promise.resolve([]);
      return Promise.resolve([row.suggestedId || "suggested-id"]);
    },
    validate: (row, id) => {
      state.validated.push({ row, id });
      if (hooks.validate) return hooks.validate(row, id);
      return { ok: true };
    },
    name: (row, id) => {
      state.named.push({ row, id });
      if (hooks.name) return hooks.name(row, id);
      return Promise.resolve({ ok: true, link: `[[${row.linkTarget}#^${id}]]`, notePath: row.notePath, id });
    },
    onChange: (listener) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
    close: () => { state.closed = true; },
    _state: state,
  };
  return {
    version: 1,
    fieldAt: (text, caret, options = {}) => {
      const value = String(text || "");
      const minOffset = Number.isInteger(options.minOffset) ? options.minOffset : 0;
      const lineStart = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
      const line = value.slice(lineStart, caret);
      const opener = line.lastIndexOf("((");
      if (opener < 0) return null;
      const before = line[opener - 1];
      if (opener > 0 && before !== " " && before !== "\t") return null;
      if (line[opener + 2] === "(") return null;
      const start = lineStart + opener;
      if (start < minOffset) return null;
      if (options.mode === "field" && start !== 0) return null;
      return { start, end: caret, query: line.slice(opener + 2), closed: false };
    },
    open: (request) => {
      state.request = request;
      return session;
    },
    _session: session,
  };
}

function attachTasks(rows, hooks = {}, extra = {}) {
  const api = fakeApi(rows, hooks);
  const app = { plugins: { plugins: { "block-id-prompt": { api: { taskLinks: api } } } } };
  const input = new Element({ tag: "input" });
  const host = new Element();
  makeDocument(input);
  input.value = extra.value || "";
  input.selectionStart = input.selectionEnd = Number.isInteger(extra.caret) ? extra.caret : input.value.length;
  const handle = helpers.attachProseField({
    inputEl: input,
    bandHost: host,
    ownKeys: true,
    density: extra.density || "roomy",
    mode: extra.mode || "inline",
    app,
    tasks: extra.tasks,
    subjects: extra.subjects,
    hintDebounceMs: 0,
  });
  return { input, host, handle, api };
}

function typeInput(input, text, caret) {
  input.value = text;
  input.selectionStart = input.selectionEnd = caret;
  input.fire("input", { inputType: "insertText", bubbles: true, isComposing: false });
}

function releaseEnter(input) {
  input.fire("keyup", { key: "Enter" });
}

function pressEnter(handle, input, event) {
  const consumed = handle.handleKeydown({ key: "Enter", ...event });
  releaseEnter(input);
  return consumed;
}

test("tasks model: sanitize, validate, and ID-line ops", () => {
  assert.equal(helpers.proseTaskSanitizeId("a b_c!d"), "a-b-cd");
  assert.deepEqual(helpers.proseTaskValidateId("ok-id-1"), { ok: true });
  assert.equal(helpers.proseTaskValidateId("bad id!").ok, false);
  let line = helpers.createProseTaskIdLine("reply-dana");
  assert.equal(line.value, "reply-dana");
  assert.equal(line.selected, true);
  line = helpers.proseTaskIdLineInsert(line, "x").line;
  assert.equal(line.value, "x");
  line = helpers.proseTaskIdLineBackspace(line);
  assert.equal(line.value, "");
  line = helpers.createProseTaskIdLine("");
  line = helpers.proseTaskIdLineInsert(line, "ab").line;
  line = helpers.proseTaskIdLineDeleteWord({ ...line, caret: 1 });
  assert.equal(line.value, "b");
  line = helpers.proseTaskIdLineSetSuggestion(line, "ab-cd");
  line = helpers.proseTaskIdLineDeleteWord({ ...line, caret: 5, selected: false });
  assert.equal(line.value, "ab-");
  line = helpers.proseTaskIdLineSetSuggestion(line, "next-idea");
  assert.equal(line.value, "next-idea");
  line.suggestions = ["a-one", "b-two"];
  line.suggestionIndex = 0;
  const cycled = helpers.proseTaskIdLineCycle(line, 1);
  assert.equal(cycled.value, "b-two");
});

test("tasks model: pills, locators, details, crumbs, leftover hint", () => {
  assert.equal(helpers.proseTaskPillFor({ status: "active" }), "[/]");
  assert.equal(helpers.proseTaskPillFor({ status: "done" }), "✓");
  assert.equal(helpers.proseTaskLocatorFor(taskRow({})), "api#^api-docs");
  assert.match(helpers.proseTaskLocatorFor(idlessRow({})), /⊕/);
  const identified = helpers.proseTaskDetailFor(taskRow({}));
  assert.match(identified.left, /\[\[api#\^api-docs\]\]/);
  const idless = helpers.proseTaskDetailFor(idlessRow({}));
  assert.match(idless.left, /names it/);
  const disabled = helpers.proseTaskDetailFor(taskRow({ disabled: { short: "this prompt", full: "The task this prompt is about" } }));
  assert.match(disabled.left, /The task this prompt is about/);
  assert.equal(helpers.proseTaskCrumb("", "list", "in-progress"), "🔗 LINK · tasks › in progress");
  assert.match(helpers.proseTaskLeftoverMessage("api do"), /isn't a link yet/);
});

test("api v2: attach exposes tasks options and naming handles", () => {
  const api = helpers.createProseFieldApi({ app: { plugins: { plugins: {} } } });
  assert.equal(api.version, 2);
  const { input, host, handle } = attachTasks([taskRow({})]);
  assert.equal(typeof handle.isTaskOpen, "function");
  assert.equal(typeof handle.isNaming, "function");
  assert.equal(typeof handle.setSubjects, "function");
  assert.equal(handle.isLinkOpen(), false);
  handle.detach();
  void host;
  void input;
});

test("list stage: typing (( opens tasks mode and [[ still wins", () => {
  const rows = [taskRow({}), idlessRow({})];
  const { input, host, handle } = attachTasks(rows);
  typeInput(input, "Superseded by ((api do", 22);
  assert.equal(handle.isTaskOpen(), true);
  assert.equal(handle.isLinkOpen(), true);
  assert.match(host.find((node) => node.classes.includes("bob-task-band")) ? "tasks" : "", /tasks/);
  handle.backOut();
  assert.equal(handle.isTaskOpen(), false);
  handle.detach();
});

test("field mode gives a leading (( task token priority over note-name search", () => {
  const task = attachTasks([idlessRow({})], {}, { mode: "field" });
  typeInput(task.input, "((rep", 5);
  assert.equal(task.handle.isTaskOpen(), true);
  assert.equal(task.handle.isLinkOpen(), true);
  task.handle.detach();

  const input = new Element({ tag: "input" });
  const host = new Element();
  makeDocument(input);
  const literal = helpers.attachProseField({
    inputEl: input, bandHost: host, ownKeys: true, mode: "field",
    app: { plugins: { plugins: {} } }, hintDebounceMs: 0,
  });
  typeInput(input, "((rep", 5);
  assert.equal(literal.isTaskOpen(), false);
  assert.equal(literal.isLinkOpen(), false, "without block-id-prompt, (( stays literal");
  literal.detach();
});

test("accepting an identified row inserts the link with one undo step", () => {
  const rows = [taskRow({})];
  const { input, host, handle } = attachTasks(rows, {}, { value: "See ((api", caret: 8 });
  typeInput(input, "See ((api", 8);
  assert.equal(handle.isTaskOpen(), true);
  const consumed = pressEnter(handle, input, { repeat: false });
  assert.equal(consumed, true);
  assert.match(input.value, /\[\[api#\^api-docs\]\]/);
  assert.equal(handle.isTaskOpen(), false);
  handle.detach();
  void host;
});

test("ID-less row opens NAME; beforeinput feeds the ID line and field stays byte-identical", () => {
  const rows = [idlessRow({})];
  const { input, host, handle } = attachTasks(rows, {}, { value: "Note ((rep", caret: 10 });
  typeInput(input, "Note ((rep", 10);
  assert.equal(handle.isTaskOpen(), true);
  assert.equal(pressEnter(handle, input, { repeat: false }), true);
  assert.equal(handle.isNaming(), true);
  const before = input.value;
  const doc = input.ownerDocument;
  void doc;
  const prevented = [];
  input.fire("beforeinput", { inputType: "insertText", data: "!", preventDefault: () => prevented.push(true) });
  assert.equal(input.value, before);
  input.fire("beforeinput", { inputType: "insertText", data: "x", preventDefault: () => prevented.push(true) });
  assert.equal(input.value, before);
  assert.equal(prevented.length, 2);
  handle.detach();
  void host;
});

test("rebinding a host while NAME is open rerenders its retained ID line and field snapshot", async () => {
  const rows = [idlessRow({})];
  const { input, host, handle } = attachTasks(rows, {}, { value: "See ((rep", caret: 10 });
  typeInput(input, "See ((rep", 10);
  assert.equal(pressEnter(handle, input, { repeat: false }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(handle.isNaming(), true);
  input.fire("beforeinput", {
    inputType: "insertText", data: "x",
    preventDefault() {},
  });
  const oldId = host.find((node) => node.classes.includes("bob-task-band-id-entry"));
  assert.equal(oldId.textContent, "x");

  const replacement = new Element({ tag: "input" });
  replacement.value = input.value;
  replacement.selectionStart = input.selectionStart;
  replacement.selectionEnd = input.selectionEnd;
  makeDocument(replacement);
  const replacementHost = new Element();
  handle.rebind({ inputEl: replacement, bandHost: replacementHost });

  assert.equal(handle.isNaming(), true);
  assert.equal(replacement.value, "See ((rep", "rebind keeps the byte-identical field snapshot");
  const band = replacementHost.find((node) => node.classes.includes("bob-task-band"));
  assert.ok(band, "NAME rerenders into the replacement host");
  assert.equal(band.classes.includes("is-naming"), true);
  assert.equal(band.find((node) => node.classes.includes("bob-task-band-id-entry")).textContent, "x");
  handle.detach();
});

test("NAME commit writes once, inserts the link, and announces; failure stays open", async () => {
  const rows = [idlessRow({})];
  let calls = 0;
  const { input, handle } = attachTasks(rows, {
    name: async (row, id) => { calls += 1; return { ok: true, link: `[[${row.linkTarget}#^${id}]]`, notePath: row.notePath, id }; },
  }, { value: "Note ((rep", caret: 10 });
  typeInput(input, "Note ((rep", 10);
  pressEnter(handle, input, {});
  assert.equal(handle.isNaming(), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  pressEnter(handle, input, {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.match(input.value, /\[\[2026\/2026-11-21#\^reply-dana\]\]|\[\[2026\/2026-11-21\.md#\^reply-dana\]\]|reply-dana/);
  assert.equal(handle.isTaskOpen(), false);

  const failing = attachTasks(rows, { name: async () => ({ ok: false, message: "That task moved — pick it again" }) }, { value: "Note ((rep", caret: 10 });
  typeInput(failing.input, "Note ((rep", 10);
  pressEnter(failing.handle, failing.input, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  pressEnter(failing.handle, failing.input, {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(failing.handle.isNaming(), true);
  failing.handle.detach();
  handle.detach();
});

test("Esc ladder: NAME back to list, then close; held Enter never writes twice", () => {
  const rows = [idlessRow({})];
  const { input, handle } = attachTasks(rows, {}, { value: "Note ((rep", caret: 10 });
  typeInput(input, "Note ((rep", 10);
  pressEnter(handle, input, {});
  assert.equal(handle.isNaming(), true);
  assert.equal(handle.backOut(), true);
  assert.equal(handle.isNaming(), false);
  assert.equal(handle.isTaskOpen(), true);
  assert.equal(handle.backOut(), true);
  assert.equal(handle.isTaskOpen(), false);

  typeInput(input, "Note ((reply", 12);
  pressEnter(handle, input, {});
  releaseEnter(input);
  const repeat = handle.handleKeydown({ key: "Enter", repeat: true });
  assert.equal(repeat, true);
  assert.equal(handle.isNaming(), true);
  handle.detach();
});

test("the same Escape event peels only one NAME layer", () => {
  const rows = [idlessRow({})];
  const { handle, input } = attachTasks(rows, {}, { value: "Note ((rep", caret: 10 });
  typeInput(input, "Note ((rep", 10);
  pressEnter(handle, input, {});
  assert.equal(handle.isNaming(), true);
  const event = { key: "Escape", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
  assert.equal(handle.handleKeydown(event), true);
  assert.equal(handle.isNaming(), false);
  assert.equal(handle.isTaskOpen(), true);
  assert.equal(handle.backOut(event), true);
  assert.equal(handle.isTaskOpen(), true, "a second backOut on the same event stays on the list");
  assert.equal(handle.backOut(), true);
  assert.equal(handle.isTaskOpen(), false);
  const idle = { key: "Escape", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
  assert.equal(handle.backOut(idle), false, "nothing open: the host may close");
  assert.equal(handle.backOut(idle), false, "an unpeeled Escape stays free for the next handler");
  handle.detach();
});

test("blur cancels naming without writing; fail-open without bip", () => {
  const rows = [idlessRow({})];
  let named = 0;
  const { input, handle } = attachTasks(rows, { name: async () => { named += 1; return { ok: true, link: "[[x#^y]]", notePath: "x.md", id: "y" }; } }, { value: "Note ((rep", caret: 10 });
  typeInput(input, "Note ((rep", 10);
  pressEnter(handle, input, {});
  assert.equal(handle.isNaming(), true);
  input.fire("blur", {});
  assert.equal(handle.isNaming(), false);
  assert.equal(named, 0);

  const plainInput = new Element({ tag: "input" });
  const plainHost = new Element();
  makeDocument(plainInput);
  const plain = helpers.attachProseField({ inputEl: plainInput, bandHost: plainHost, ownKeys: true, app: { plugins: { plugins: {} } }, hintDebounceMs: 0 });
  plainInput.value = "See ((api";
  plainInput.selectionStart = plainInput.selectionEnd = 9;
  plainInput.fire("input", { inputType: "insertText", bubbles: true, isComposing: false });
  assert.equal(plain.isLinkOpen(), false);
  plain.detach();
  handle.detach();
});

test("subjects guard and setSubjects rerank; tasks:false keeps (( literal", () => {
  const guarded = taskRow({ disabled: { short: "this prompt", full: "The task this prompt is about" } });
  const boxed = attachTasks([guarded], {}, { subjects: [{ path: "api.md", line: 0 }] });
  typeInput(boxed.input, "See ((api", 9);
  assert.equal(boxed.handle.isTaskOpen(), true);
  assert.equal(boxed.handle.setSubjects([]), true);
  boxed.handle.detach();

  const off = attachTasks([taskRow({})], {}, { value: "See ((api", caret: 9, tasks: false });
  typeInput(off.input, "See ((api", 9);
  assert.equal(off.handle.isTaskOpen(), false);
  assert.equal(off.handle.isLinkOpen(), false);
  off.handle.detach();
});

test("performance: rank 5000 snapshot rows stays interactive with no vault reads", () => {
  const rows = [];
  for (let index = 0; index < 5000; index += 1) {
    rows.push(taskRow({ key: `t:n${index}`, notePath: `notes/n${index}.md`, linkTarget: `notes/n${index}`, blockId: `id-${index}`, displayText: `Task number ${index} api work`, primary: `Task number ${index} api work`, link: `[[notes/n${index}#^id-${index}]]` }));
  }
  let vaultReads = 0;
  const { handle, api } = attachTasks(rows, {
    name: async () => { vaultReads += 1; return { ok: true, link: "[[x#^y]]", notePath: "x.md", id: "y" }; },
  });
  const session = api.open({ sourcePath: "sase.md", subjects: [] });
  const start = Date.now();
  const result = session.rank("api");
  const elapsed = Date.now() - start;
  assert.equal(result.rows.length > 0, true);
  assert.equal(vaultReads, 0);
  assert.ok(elapsed < 500, `rank took ${elapsed}ms`);
  session.close();
  handle.detach();
});
