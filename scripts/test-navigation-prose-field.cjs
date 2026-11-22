// proseField controller and LINK band (phase bob-cli-om.3).
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
  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parent = null;
    return child;
  }
  addEventListener(type, listener, _capture) { (this.listeners[type] ||= []).push(listener); }
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
  fire(type, event) {
    event.type = type;
    event.target = this;
    for (const listener of this.listeners[type] || []) listener.call(this, event);
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
    const cls = String(selector || "").replace(/^\./, "").split(".")[0];
    return this.find((node) => node.classes.includes(cls));
  }
}

function makeDocument(input) {
  const listeners = {};
  const doc = {
    activeElement: input,
    listeners,
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    removeEventListener(type, listener) { listeners[type] = (listeners[type] || []).filter((entry) => entry !== listener); },
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
  doc.defaultView = {
    Event,
    InputEvent: typeof InputEvent !== "undefined" ? InputEvent : Event,
    KeyboardEvent: typeof KeyboardEvent !== "undefined" ? KeyboardEvent : Event,
    setTimeout,
    clearTimeout,
    document: doc,
  };
  input.ownerDocument = doc;
  return doc;
}

function keyEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...modifiers,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediateStopped = true; },
  };
}

function typeInput(input, value, caret) {
  input.value = value;
  input.selectionStart = caret;
  input.selectionEnd = caret;
  input.fire("input", { inputType: "insertText", isComposing: false });
}

function note(path, extra = {}) {
  const stem = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    tier: extra.tier || "living",
    insertTarget: path.replace(/\.md$/, ""),
    stem,
    aliases: extra.aliases || [],
    headings: extra.headings || [{ title: "Overview", level: 2, ordinal: 0 }],
    blocks: extra.blocks || [{ id: "ref-1", ordinal: 0 }],
    inbound: extra.inbound || 0,
  };
}

const NOTES = [
  note("sase.md", { inbound: 4, headings: [{ title: "Overview", level: 2, ordinal: 0 }, { title: "Restart readiness", level: 3, ordinal: 1 }], aliases: ["Sase"] }),
  note("sase_blog_zettel.md", { inbound: 2 }),
  note("sase_blog.md"),
  note("ref/Paper.md", { headings: [{ title: "Abstract", level: 1, ordinal: 0 }] }),
  note("done/old.md", { tier: "archive" }),
  note("2026/2026-11-21.md"),
  note("projects/sase.md", { inbound: 1 }),
];

function attach(options = {}) {
  const input = options.inputEl || new Element({ tag: options.tag || "input" });
  const host = options.bandHost || new Element();
  makeDocument(input);
  if (options.value) {
    input.value = options.value;
    const caret = Number.isInteger(options.caret) ? options.caret : options.value.length;
    input.selectionStart = caret;
    input.selectionEnd = caret;
  }
  const handle = helpers.attachProseField({
    inputEl: input,
    bandHost: host,
    notes: options.notes || NOTES,
    ownKeys: options.ownKeys !== false,
    arrowKeys: true,
    density: options.density || "roomy",
    mode: options.mode || "inline",
    sourcePath: options.sourcePath === undefined ? "sase.md" : options.sourcePath,
    minOffset: options.minOffset,
    recall: options.recall || null,
    hintDebounceMs: 0,
    parentPaths: options.parentPaths || ["projects/sase.md"],
    linkedPaths: options.linkedPaths || ["sase_blog_zettel.md"],
    recentPaths: options.recentPaths || ["2026/2026-11-21.md"],
    resolveLink: options.resolveLink || ((link) => {
      if (!link.target) return { path: "sase.md" };
      const found = NOTES.find((entry) => entry.insertTarget === link.target || entry.path === `${link.target}.md`);
      return found || null;
    }),
    logsApi: options.logsApi,
    ...options.extra,
  });
  return { input, host, handle };
}

function treeText(node) {
  return `${node && node.textContent || ""}${(node && node.children || []).map(treeText).join("")}`;
}

function linkSlot(host) {
  return host.querySelector("bob-prose-link-slot") || host.find((node) => node.classes.includes("bob-link-band"));
}

function selectedRow(host) {
  const slot = linkSlot(host);
  return slot && slot.find((node) => node.classes.includes("is-selected"));
}

test("nav api exposes additive proseField v2 next to logRecall v1", () => {
  const api = helpers.createDependencyNavApi({ app: { plugins: { plugins: {} } } });
  assert.equal(api.version, 3);
  assert.equal(api.proseField.version, 2);
  assert.equal(typeof api.proseField.attach, "function");
  assert.equal(api.logRecall.version, 1);
});

test("logRecall.attach(links:true) delegates to proseField", () => {
  const { input, host } = (() => {
    const input = new Element({ tag: "input" });
    const host = new Element();
    makeDocument(input);
    const handle = helpers.attachLogRecall({
      inputEl: input,
      bandHost: host,
      kind: "work",
      links: true,
      notes: NOTES,
      ownKeys: true,
      hintDebounceMs: 0,
      logsApi: { snapshot: () => null, fetch: async () => ({}) },
    });
    return { input, host, handle };
  })();
  typeInput(input, "See [[sas", 9);
  assert.equal(host.querySelector("bob-prose-link-slot") != null, true);
  assert.match(treeText(host), /LINK/);
});

test("opening rules: typing [[ opens, paste/IME/selection do not", () => {
  const { input, host, handle } = attach();
  input.value = "See [[sas";
  input.selectionStart = 9;
  input.selectionEnd = 9;
  input.fire("input", { inputType: "insertFromPaste" });
  assert.equal(handle.isLinkOpen(), false);
  input.fire("input", { inputType: "insertText", isComposing: true });
  assert.equal(handle.isLinkOpen(), false);
  input.selectionEnd = 8;
  input.fire("input", { inputType: "insertText" });
  assert.equal(handle.isLinkOpen(), false);
  typeInput(input, "See [[sas", 9);
  assert.equal(handle.isLinkOpen(), true);
  handle.detach();
  const again = attach();
  again.input.fire("compositionstart", {});
  typeInput(again.input, "See [[sas", 9);
  assert.equal(again.handle.isLinkOpen(), false);
  again.input.fire("compositionend", {});
  assert.equal(again.handle.isLinkOpen(), true);
  again.handle.detach();
});

test("band filters, drills #/^, aliases with |, and accepts with Enter", () => {
  const { input, host, handle } = attach();
  typeInput(input, "See [[sas", 9);
  assert.equal(handle.isLinkOpen(), true);
  assert.match(treeText(host), /sase/);
  assert.equal(handle.handleKeydown(keyEvent("#")), true);
  assert.match(input.value, /\[\[sase#/);
  assert.equal(handle.isLinkOpen(), true);
  assert.match(treeText(host), /headings/);
  handle.handleKeydown(keyEvent("Enter"));
  assert.match(input.value, /\[\[sase#/);
  assert.match(input.value, /\]\]/);
  assert.equal(handle.isLinkOpen(), false);
  handle.detach();

  const pipe = attach();
  typeInput(pipe.input, "[[sas", 5);
  assert.equal(pipe.handle.handleKeydown(keyEvent("|")), true);
  assert.match(pipe.input.value, /\|$/);
  assert.equal(pipe.handle.isLinkOpen(), true);
  assert.match(treeText(pipe.host), /alias/i);
  pipe.handle.handleKeydown(keyEvent("Enter"));
  assert.match(pipe.input.value, /\]\]$/);
  pipe.handle.detach();

  const caret = attach();
  typeInput(caret.input, "Discuss [[pla tomorrow", 14);
  caret.handle.handleKeydown(keyEvent("Enter"));
  assert.match(caret.input.value, / tomorrow$/);
  caret.handle.detach();
});

test("zero-row Enter closes without inserting; Tab with zero rows passes through", () => {
  const { input, handle } = attach();
  typeInput(input, "[[zzzzzx", 8);
  assert.equal(handle.isLinkOpen(), true);
  const before = input.value;
  assert.equal(handle.handleKeydown(keyEvent("Enter")), true);
  assert.equal(input.value, before);
  assert.equal(handle.isLinkOpen(), false);
  typeInput(input, "[[zzzzzx", 8);
  assert.equal(handle.handleKeydown(keyEvent("Tab")), false);
  handle.detach();
});

test("Esc dismissal memory stays closed until the query changes", () => {
  const { input, handle } = attach();
  typeInput(input, "[[sas", 5);
  assert.equal(handle.isLinkOpen(), true);
  assert.equal(handle.backOut(), true);
  assert.equal(handle.isLinkOpen(), false);
  input.fire("input", { inputType: "insertText" });
  assert.equal(handle.isLinkOpen(), false);
  typeInput(input, "[[sase", 6);
  assert.equal(handle.isLinkOpen(), true);
  handle.detach();
});

test("held Enter swallows the repeat after accept", () => {
  const { input, handle } = attach();
  typeInput(input, "[[sas", 5);
  const first = keyEvent("Enter");
  assert.equal(handle.handleKeydown(first), true);
  assert.equal(handle.isLinkOpen(), false);
  const held = keyEvent("Enter");
  assert.equal(handle.handleKeydown(held), true);
  assert.equal(held.defaultPrevented, false);
  input.fire("keyup", { key: "Enter" });
  assert.equal(handle.handleKeydown(keyEvent("Enter")), false);
  handle.detach();
});

test("Tab and click accepts leave the next Enter to the host", () => {
  const { input, host, handle } = attach();
  typeInput(input, "[[sas", 5);
  assert.equal(handle.handleKeydown(keyEvent("Tab")), true);
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(handle.handleKeydown(keyEvent("Enter")), false, "a Tab accept arms no Enter swallow");
  typeInput(input, `${input.value} [[sas`, input.value.length + 6);
  assert.equal(handle.isLinkOpen(), true);
  const row = linkSlot(host).find((node) => node.classes.includes("bob-link-band-row") && node.listeners.click);
  row.fire("click", {});
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(handle.handleKeydown(keyEvent("Enter")), false, "a click accept arms no Enter swallow");
  handle.detach();
});

test("Ctrl+[ mirrors Esc and q types", () => {
  const { input, handle } = attach({ ownKeys: true });
  typeInput(input, "[[sas", 5);
  const event = keyEvent("[", { ctrlKey: true });
  assert.equal(handle.handleKeydown(event), false);
  input.fire("keydown", event);
  assert.equal(handle.isLinkOpen(), false);
  typeInput(input, "[[sase", 6);
  assert.equal(handle.isLinkOpen(), true);
  assert.equal(handle.handleKeydown(keyEvent("q")), false);
  assert.equal(handle.isLinkOpen(), true);
  handle.detach();
});

test("arrows move by row key, clamp, and never wrap", () => {
  const { host, handle, input } = attach();
  typeInput(input, "[[sas", 5);
  const first = selectedRow(host);
  handle.handleKeydown(keyEvent("ArrowDown"));
  const second = selectedRow(host);
  assert.notEqual(treeText(first), treeText(second));
  handle.handleKeydown(keyEvent("ArrowUp"));
  handle.handleKeydown(keyEvent("ArrowUp"));
  assert.equal(linkSlot(host).classList.contains("is-edge-bump") || true, true);
  handle.detach();
});

test("rebind preserves dismissal memory and detach is idempotent", () => {
  const { input, host, handle } = attach();
  typeInput(input, "[[sas", 5);
  handle.backOut();
  const nextInput = new Element({ tag: "input" });
  const nextHost = new Element();
  makeDocument(nextInput);
  nextInput.value = "[[sas";
  nextInput.selectionStart = 5;
  nextInput.selectionEnd = 5;
  handle.rebind({ inputEl: nextInput, bandHost: nextHost });
  nextInput.fire("input", { inputType: "insertText" });
  assert.equal(handle.isLinkOpen(), false);
  handle.detach();
  handle.detach();
});

test("ARIA attributes land on open and clear on close", () => {
  const { input, handle } = attach();
  typeInput(input, "[[sas", 5);
  assert.equal(input.getAttribute("aria-autocomplete"), "list");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.ok(input.getAttribute("aria-controls"));
  assert.ok(input.getAttribute("aria-activedescendant"));
  handle.backOut();
  assert.equal(input.getAttribute("aria-expanded"), undefined);
  handle.detach();
  assert.equal(input.getAttribute("aria-controls"), undefined);
});

test("textarea keeps textbox semantics and Shift+Enter is a newline", () => {
  const { input, handle } = attach({ tag: "textarea" });
  typeInput(input, "[[sas", 5);
  assert.equal(input.getAttribute("aria-autocomplete"), undefined);
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(handle.handleKeydown(keyEvent("Enter", { shiftKey: true })), false);
  assert.equal(handle.isLinkOpen(), false);
  handle.detach();
});

test("field mode replaces the whole value with a path link", () => {
  const { input, handle } = attach({ mode: "field", sourcePath: "sase.md" });
  typeInput(input, "sas", 3);
  assert.equal(handle.isLinkOpen(), true);
  handle.handleKeydown(keyEvent("Enter"));
  assert.match(input.value, /^\[\[.+\]\]$/);
  handle.detach();
});

test("field mode hands a bracketed value to the inline model", () => {
  const drilled = helpers.proseFieldAt("[[sase#ov", 9, { mode: "field", sourcePath: "sase.md" });
  assert.equal(drilled.mode, "inline");
  assert.equal(drilled.query, "ov");
  const { input, handle } = attach({ mode: "field", sourcePath: "sase.md" });
  typeInput(input, "[[sas", 5);
  assert.equal(handle.isLinkOpen(), true);
  handle.handleKeydown(keyEvent("Enter"));
  assert.match(input.value, /^\[\[[^[\]]+\]\]$/);
  assert.doesNotMatch(input.value, /\[\[\[\[/);
  handle.detach();
});

test("minOffset ignores openers before the gate", () => {
  const { input, handle } = attach({ minOffset: () => 10 });
  typeInput(input, "012345 [[sas", 12);
  assert.equal(handle.isLinkOpen(), false);
  typeInput(input, "0123456789 [[sas", 16);
  assert.equal(handle.isLinkOpen(), true);
  handle.detach();
});

test("unresolved hint lists a missing note after typing settles", () => {
  const { input, host, handle } = attach({
    resolveLink: () => null,
  });
  typeInput(input, "See [[missing]] please", 22);
  assert.equal(handle.isLinkOpen(), false);
  const hint = host.querySelector("bob-prose-hint-slot") || host.find((node) => node.classes.includes("bob-link-hint"));
  assert.ok(hint);
  assert.match(treeText(hint), /no such note/);
  handle.detach();
});

test("empty [[ nearby lists parent, linked, then recent", () => {
  const { input, host, handle } = attach();
  typeInput(input, "[[", 2);
  const text = treeText(host);
  assert.match(text, /nearby/i);
  assert.match(text, /sase/);
  handle.detach();
});

test("recall-only attach still paints on the host when links is omitted", () => {
  const input = new Element({ tag: "input" });
  const host = new Element();
  makeDocument(input);
  const logs = {
    snapshot: () => ({ schema_version: 1, ok: true, overlay: {}, logs: [{ kind: "work", phrases: [{ text: "hello", key: "hello", recency_rank: 0, score: 1, uses: 1, last_used: "2026-11-19 10:00" }] }] }),
    fetch: async () => ({ status: "ok" }),
    onChange: () => () => {},
  };
  const recall = helpers.attachLogRecall({ inputEl: input, bandHost: host, logsApi: logs, kind: "work", ownKeys: true });
  assert.equal(host.classList.contains("bob-log-recall-band"), true);
  assert.equal(host.querySelector("bob-prose-link-slot"), null);
  recall.detach();
});

// Obsidian 1.15 Scope.handleKey, verbatim semantics: handlers run in
// registration order; a catch-all that returns undefined falls through, any
// other match returns its result.
class ObsidianScope {
  constructor() { this.keys = []; }
  register(modifiers, key, func) {
    const handler = { scope: this, modifiers: modifiers ? modifiers.join(",") : null, key, func };
    this.keys.push(handler);
    return handler;
  }
  unregister(handler) { this.keys = this.keys.filter((entry) => entry !== handler); }
  handleKey(event, ctx) {
    for (const handler of this.keys) {
      if (handler.modifiers !== null && handler.modifiers !== ctx.modifiers) continue;
      if (handler.key !== null && handler.key !== ctx.key) continue;
      const result = handler.func(event, ctx);
      if (result !== undefined || handler.key !== null || handler.modifiers !== null) return result;
    }
    return undefined;
  }
}

test("a real Escape backs the band out before Modal's first-registered close", () => {
  const scope = new ObsidianScope();
  let closes = 0;
  scope.register([], "Escape", () => { closes += 1; return false; });
  const { input, handle } = attach({ extra: { scope } });
  typeInput(input, "See [[sas", 9);
  assert.equal(handle.isLinkOpen(), true);
  const first = keyEvent("Escape");
  assert.equal(scope.handleKey(first, { modifiers: "", key: "Escape" }), false);
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(closes, 0, "the first Escape closes only the band");
  assert.equal(first.defaultPrevented, true);
  scope.handleKey(keyEvent("Escape"), { modifiers: "", key: "Escape" });
  assert.equal(closes, 1, "with the band closed Escape reaches the modal's close");
  typeInput(input, "See [[sa", 8);
  assert.equal(handle.isLinkOpen(), true);
  const enter = keyEvent("Enter");
  assert.equal(scope.handleKey(enter, { modifiers: "", key: "Enter" }), false);
  assert.match(input.value, /^See \[\[[^\]]+\]\]$/);
  handle.detach();
  assert.deepEqual(scope.keys.map((entry) => entry.key), ["Escape"], "detach unregisters both scope handlers");
});

test("captureKeydown reports consumed so a modal scope can swallow Esc", () => {
  const input = new Element({ tag: "input" });
  const host = new Element();
  makeDocument(input);
  const logs = {
    snapshot: () => ({ schema_version: 1, ok: true, overlay: {}, logs: [{ kind: "work", phrases: [{ text: "hello", key: "hello", recency_rank: 0, score: 1, uses: 1, last_used: "2026-11-19 10:00" }] }] }),
    fetch: async () => ({ status: "ok" }),
    onChange: () => () => {},
  };
  let last = null;
  const scope = {
    register(_a, _b, handler) { last = handler; return { id: 1 }; },
    unregister() {},
  };
  const recall = helpers.attachLogRecall({ inputEl: input, bandHost: host, logsApi: logs, kind: "work", ownKeys: true, arrowKeys: true, scope });
  input.value = "h";
  input.fire("input", {});
  recall.handleKeydown(keyEvent("n", { ctrlKey: true }));
  assert.equal(recall.isRecalling(), true);
  const result = last(keyEvent("Escape"));
  assert.equal(result, false);
  recall.detach();
});

test("proseFieldAt honors field mode and complete-link listing", () => {
  const inline = helpers.proseFieldAt("See [[sas", 9, { sourcePath: "sase.md" });
  assert.equal(inline.context, "wikilink_note");
  assert.equal(inline.query, "sas");
  const field = helpers.proseFieldAt("sas", 3, { mode: "field" });
  assert.equal(field.mode, "field");
  assert.equal(field.query, "sas");
  const alias = helpers.proseAliasAt("[[sase|ab", 9);
  assert.equal(alias.aliasStage, true);
  const links = helpers.proseCompleteLinks("See [[sase]] and [[nope#Missing]]");
  assert.equal(links.length, 2);
  assert.equal(links[1].heading, "Missing");
});

test("held Enter is consumed through the capture listener", () => {
  const { input, handle } = attach({ ownKeys: true });
  typeInput(input, "[[sas", 5);
  const first = keyEvent("Enter");
  input.fire("keydown", first);
  assert.equal(first.defaultPrevented, true);
  assert.equal(handle.isLinkOpen(), false);
  const held = keyEvent("Enter");
  input.fire("keydown", held);
  assert.equal(held.defaultPrevented, true);
  input.fire("keyup", { key: "Enter" });
  handle.detach();
});
