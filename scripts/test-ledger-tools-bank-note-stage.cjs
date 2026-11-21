// Bank Category card note stage (bank_row_notes note-stage): Space opens an
// in-card input, Enter writes the row's inline `— note` and stays on the
// same row. Rows, categories, and notes are synthetic.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin, TestNotice } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const PATH = "bank/2026-11.md";
const CATEGORIES = [
  { key: "coffee", label: "Coffee", emoji: "☕", hotkey: "c", group: "Everyday", hidden: false },
  { key: "groceries", label: "Groceries", emoji: "🛒", hotkey: "g", group: "Everyday", hidden: false },
  { key: "dining", label: "Dining", emoji: "🍽", hotkey: "d", group: "Everyday", hidden: false },
];

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    this.disabled = false;
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  set className(value) { this.setAttribute("class", String(value || "")); }
  get className() { return this.getAttribute("class") || ""; }
  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
  }
  set id(value) { this.setAttribute("id", value); }
  get id() { return this.getAttribute("id") || ""; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
    child.parentNode = null;
    if (this.ownerDocument.activeElement && child.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = null;
    }
    return child;
  }
  replaceChildren(...nodes) {
    for (const child of this.children.slice()) this.removeChild(child);
    this._text = "";
    for (const child of nodes) this.appendChild(child);
  }
  empty() { this.replaceChildren(); }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  addEventListener(event, callback) {
    const handlers = this.listeners.get(event) || [];
    handlers.push(callback);
    this.listeners.set(event, handlers);
  }
  removeEventListener() {}
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  classTokens() { return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  matches(selector) {
    const tag = String(selector).match(/^([a-z]+)/i);
    if (tag && tag[1].toUpperCase() !== this.tagName) return false;
    const tokens = this.classTokens();
    const classOk = Array.from(String(selector).matchAll(/\.([\w-]+)/g)).every((m) => tokens.includes(m[1]));
    const attrOk = Array.from(String(selector).matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).every((m) => {
      const value = this.getAttribute(m[1]);
      return value !== null && (m[2] === undefined || m[2] === value);
    });
    return classOk && attrOk;
  }
  closest(selector) {
    for (let at = this; at; at = at.parentNode) {
      if (String(selector).split(",").some((part) => at.matches && at.matches(part.trim()))) return at;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function editorFor(source) {
  return {
    source,
    cursor: { line: 0, ch: 0 },
    replacements: [],
    getValue() { return this.source; },
    getLine(line) { return this.source.split("\n")[line] || ""; },
    getCursor() { return this.cursor; },
    setCursor(cursor) { this.cursor = cursor; },
    replaceRange(text, from, to) {
      this.replacements.push({ text, from, to });
      const lines = this.source.split("\n");
      lines[from.line] = text;
      this.source = lines.join("\n");
    },
  };
}

function keyEvent(key, options = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true,
    altKey: options.altKey === true,
    shiftKey: options.shiftKey === true,
    repeat: options.repeat === true,
    isComposing: options.isComposing === true,
    keyCode: options.keyCode,
    target: options.target || null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

const SOURCE = [
  "## Thu Nov 12",
  "- [ ] $23.21 Amazon Reta* 125dt ^bank-aaa111",
  "- [ ] $5.00 Corner Cafe",
  "- [ ] $2.00 Market ^bank-bbb222",
  "",
].join("\n");

// One real plugin, editor, and Category card wired exactly as
// bankCategoryOpenAtCursor wires them; only the DOM and bob are fakes.
function cardOn(line, options = {}) {
  const doc = { activeElement: null, createElement: (tag) => new FakeNode(tag, doc) };
  const editor = editorFor(options.source || SOURCE);
  editor.cursor = { line: line - 1, ch: 9 };
  const saves = [];
  const jumps = [];
  const app = {
    document: doc,
    workspace: { getActiveFile: () => ({ path: PATH }) },
    plugins: { plugins: { "bob-navigation-hotkeys": { api: { recordJump(from, to) { jumps.push({ from, to }); return true; } } } } },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.apiBankRefresh = async () => ({ report: { categories: CATEGORIES, days: [] }, error: null });
  if (options.isolate) plugin.bankNoteIsolateHistory = () => options.isolate;
  const context = plugin.bankCategoryContextAt(editor, { file: { path: PATH } }, line);
  assert.ok(context, "fixture row parses");
  const mode = options.mode || "close";
  const modal = new h.BankCategoryCardModal(app, {
    plugin,
    mode,
    context,
    categories: options.categories === undefined ? CATEGORIES : options.categories,
    onChoose: (key, kind, active, writeOptions) => plugin.bankCategoryCommit(active, key, kind, writeOptions),
    onNote: (text, active) => plugin.bankNoteCommit(active, text),
  });
  const content = new FakeNode("div", doc);
  modal.contentEl = content;
  modal.modalEl = content;
  modal.editor = editor;
  modal.view = {
    file: { path: PATH },
    async save() {
      saves.push(editor.getValue());
      if (options.saveError) throw new Error(options.saveError);
    },
  };
  modal.month = "2026-11";
  modal.session = mode === "close" ? h.bankCategorySessionStart(PATH, Date.now()) : null;
  plugin.bankCategorySession = modal.session;
  plugin.bankCategoryModal = modal;
  modal.highlightKey = options.highlightKey === undefined ? "coffee" : options.highlightKey;
  modal.paint();
  return { plugin, modal, editor, content, doc, saves, jumps };
}

function input(card) {
  return card.content.querySelector("input[data-bank-note-input]");
}

async function type(card, text) {
  for (const char of text) await card.modal.onKeyDown(keyEvent(char));
}

test("Space opens the stage without typing, flipping didInteract, or touching the row", async () => {
  const card = cardOn(2);
  const before = card.editor.getValue();
  await card.modal.onKeyDown(keyEvent(" "));
  assert.ok(card.modal.noteStage);
  assert.equal(card.modal.noteStage.draft, "");
  assert.equal(card.modal.didInteract, false);
  assert.equal(card.editor.getValue(), before);
  const field = input(card);
  assert.ok(field);
  assert.equal(field.value, "");
  assert.equal(field.getAttribute("placeholder"), "What was this for?");
  assert.equal(field.getAttribute("aria-label"), "Note for Amazon Reta* 125dt");
  assert.equal(card.doc.activeElement, field, "the input takes focus");
  // A held Space never types into the fresh stage.
  await card.modal.onKeyDown(keyEvent(" ", { repeat: true }));
  assert.equal(card.modal.noteStage.draft, "");
  // Tiles stay painted in place, dimmed and inert.
  const sections = card.content.querySelectorAll(".bob-bank-category-section");
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.ok(section.classTokens().includes("is-staged"));
    assert.ok(section.hasAttribute("inert"));
  }
  assert.equal(card.content.querySelector(".bob-bank-category-keys").textContent, "↵ back · esc back");
  assert.equal(card.content.querySelector(".bob-bank-category-note-consequence").textContent, "No change");
});

test("category hotkeys type while staged; q, -, +, and letters never file", async () => {
  const card = cardOn(2);
  await card.modal.onKeyDown(keyEvent(" "));
  // With focus outside the input, keys focus it and append; q alone backs
  // out there (decisions:q-and-ctrl-bracket-mirror-esc) and types inside.
  card.doc.activeElement = null;
  await type(card, "g-+= x/");
  assert.equal(card.modal.noteStage.draft, "g-+= x/");
  assert.equal(input(card).value, "g-+= x/");
  assert.equal(card.doc.activeElement, input(card));
  assert.match(card.editor.getLine(1), /^- \[ \]/);
  assert.equal(card.content.querySelector(".bob-bank-category-note-consequence").textContent,
    "Adds a note · stays on this row");
  assert.equal(card.content.querySelector(".bob-bank-category-keys").textContent, "↵ save · esc back");
  // Inside the input, printable keys and edit chords keep their native path.
  const field = input(card);
  for (const [key, mods] of [["q", {}], ["-", {}], ["Backspace", {}], ["v", { ctrlKey: true }], ["a", { metaKey: true }]]) {
    const event = keyEvent(key, { ...mods, target: field });
    assert.equal(card.modal.shouldPassNoteStageKey(event), true, `${key} passes to the input`);
    await card.modal.onKeyDown(event);
    assert.equal(event.defaultPrevented, false);
  }
  for (const [key, mods] of [["Enter", {}], ["Escape", {}], ["[", { ctrlKey: true }], ["p", { ctrlKey: true }], [" ", { repeat: true }]]) {
    assert.equal(card.modal.shouldPassNoteStageKey(keyEvent(key, { ...mods, target: field })), false, key);
  }
  assert.equal(card.modal.shouldPassNoteStageKey(keyEvent("Process", { isComposing: true, target: field })), true);
});

test("Esc, Ctrl+[, and q outside the input back out one layer; a second Esc closes", async () => {
  for (const back of [keyEvent("Escape"), keyEvent("[", { ctrlKey: true }), keyEvent("q")]) {
    const card = cardOn(2);
    await card.modal.onKeyDown(keyEvent(" "));
    await type(card, "draft");
    await card.modal.onKeyDown(back);
    assert.equal(card.modal.noteStage, null);
    assert.equal(card.modal.closed, false);
    assert.equal(card.editor.replacements.length, 0, "a discarded draft writes nothing");
    assert.ok(card.content.querySelector(".bob-bank-category-tile"));
    await card.modal.onKeyDown(keyEvent("Escape"));
    assert.equal(card.modal.closed, true);
  }
  // The Modal's own Escape path layers the same way.
  const card = cardOn(2);
  await card.modal.onKeyDown(keyEvent(" "));
  card.modal.onEscapeKey(keyEvent("Escape"));
  assert.equal(card.modal.noteStage, null);
  assert.equal(card.modal.closed, false);
});

for (const save of [keyEvent("Enter"), keyEvent("Enter", { ctrlKey: true })]) {
  test(`${save.ctrlKey ? "Ctrl+Enter" : "Enter"} saves and stays: no tick, no advance, no jump`, async () => {
    const card = cardOn(2);
    await card.modal.onKeyDown(keyEvent(" "));
    await type(card, "LEGO set for Max");
    const highlight = card.modal.highlightKey;
    await card.modal.onKeyDown(save);
    assert.equal(card.editor.getLine(1), "- [ ] $23.21 Amazon Reta* 125dt — LEGO set for Max ^bank-aaa111");
    assert.equal(card.editor.replacements.length, 1, "one whole-line edit");
    assert.equal(card.modal.noteStage, null);
    assert.equal(card.modal.closed, false);
    assert.equal(card.modal.context.cardRow.payee, "Amazon Reta* 125dt", "still the same row");
    assert.equal(card.modal.context.cardRow.note, "LEGO set for Max");
    assert.equal(card.modal.didInteract, false);
    assert.equal(card.modal.highlightKey, highlight);
    assert.equal(card.modal.summary, null);
    assert.deepEqual(card.jumps, []);
    assert.equal(card.modal.session.filed, 0);
    assert.equal(card.modal.session.notes, 1);
    assert.equal(card.editor.cursor.line, 1, "the cursor stays on the row");
    assert.equal(card.editor.cursor.ch, 9, "at its prior column");
    assert.equal(card.saves.length, 1);
    assert.equal(card.modal.liveText, "Note saved");
    const caption = card.content.querySelector("button[data-bank-note-caption]");
    assert.ok(caption);
    assert.ok(caption.classTokens().includes("is-fresh"));
    assert.equal(caption.getAttribute("title"), "LEGO set for Max");
    assert.equal(caption.getAttribute("aria-label"), "Note: LEGO set for Max");
    assert.match(card.content.querySelector(".bob-bank-category-keys").textContent, /␣ edit note/);
    // The save Enter's keyup re-arms nothing until it arrives.
    assert.equal(card.modal.chord.swallowEnter, true);
  });
}

test("the next key files the same ID-less row and advances; the walk anchor follows the text", async () => {
  const card = cardOn(3, { highlightKey: null });
  const anchors = [];
  card.plugin.bankWalkSnapshot = () => ({ available: false });
  const setAnchor = card.plugin.bankWalkSetAnchor.bind(card.plugin);
  card.plugin.bankWalkSetAnchor = (entry) => { anchors.push(entry && entry.text); setAnchor(entry); };
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "for the team");
  await card.modal.onKeyDown(keyEvent("Enter"));
  card.modal.onKeyUp(keyEvent("Enter"));
  assert.equal(card.editor.getLine(2), "- [ ] $5.00 Corner Cafe — for the team");
  assert.equal(card.modal.context.capture.lineText, "- [ ] $5.00 Corner Cafe — for the team");
  assert.deepEqual(anchors, ["- [ ] $5.00 Corner Cafe — for the team"]);
  assert.equal(card.plugin.bankWalkAnchor().text, "- [ ] $5.00 Corner Cafe — for the team");
  await card.modal.onKeyDown(keyEvent("d"));
  assert.equal(card.editor.getLine(2), "- [x] $5.00 Corner Cafe [cat:: dining] — for the team");
  assert.equal(card.editor.replacements.length, 2, "note and filing are separate edits");
  assert.equal(card.modal.context.cardRow.payee, "Market", "the filing advances");
  assert.equal(card.jumps.length, 1);
});

test("a held or rapid Enter after a save cannot accept a category before its keyup", async () => {
  const card = cardOn(2);
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "gift");
  await card.modal.onKeyDown(keyEvent("Enter"));
  await card.modal.onKeyDown(keyEvent("Enter", { repeat: true }));
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.match(card.editor.getLine(1), /^- \[ \]/, "still waiting");
  card.modal.onKeyUp(keyEvent("Enter"));
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.match(card.editor.getLine(1), /^- \[x\].*\[cat:: coffee\] — gift \^bank-aaa111$/);
});

test("edit prefills the raw note, replace keeps --, and an empty save removes it", async () => {
  const source = SOURCE.replace("Corner Cafe", "Corner Cafe -- with   Kelly");
  const card = cardOn(3, { source });
  await card.modal.onKeyDown(keyEvent(" "));
  assert.equal(input(card).value, "with   Kelly");
  assert.equal(card.content.querySelector(".bob-bank-category-note-consequence").textContent, "No change");
  card.modal.setNoteDraft("with Kelly and Max");
  assert.equal(card.content.querySelector(".bob-bank-category-note-consequence").textContent,
    "Updates the note · stays on this row");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(card.editor.getLine(2), "- [ ] $5.00 Corner Cafe -- with Kelly and Max");
  card.modal.onKeyUp(keyEvent("Enter"));
  await card.modal.onKeyDown(keyEvent(" "));
  card.modal.setNoteDraft("");
  const consequence = card.content.querySelector(".bob-bank-category-note-consequence");
  assert.equal(consequence.textContent, "Removes the note");
  assert.ok(consequence.classTokens().includes("is-remove"));
  assert.equal(card.content.querySelector(".bob-bank-category-keys").textContent, "↵ remove note · esc back");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(card.editor.getLine(2), "- [ ] $5.00 Corner Cafe");
  assert.equal(card.modal.liveText, "Note removed");
  assert.equal(card.content.querySelector("button[data-bank-note-caption]"), null);
});

test("an empty save with no note is a no-op that returns to the tiles", async () => {
  const card = cardOn(2);
  await card.modal.onKeyDown(keyEvent(" "));
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(card.modal.noteStage, null);
  assert.equal(card.editor.replacements.length, 0);
  assert.equal(card.saves.length, 0);
  assert.equal(card.modal.chord.swallowEnter, true);
});

test("normalizer changes show as chips before saving and the saved note is the cleaned text", async () => {
  const card = cardOn(2);
  await card.modal.onKeyDown(keyEvent(" "));
  card.modal.setNoteDraft("for [[people/max|Max]] !! #gift");
  const chips = card.content.querySelectorAll(".bob-bank-category-note-change").map((node) => node.textContent);
  assert.deepEqual(chips, ["!! → ‼", "[[people/max|Max]] → Max", "+1 more"]);
  assert.equal(card.content.querySelectorAll(".bob-bank-category-note-change")[0].getAttribute("title"),
    "!! would flag the row");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(card.editor.getLine(1), "- [ ] $23.21 Amazon Reta* 125dt — for Max ‼ gift ^bank-aaa111");
});

test("refusals keep the stage and draft open, show the reason, and announce it", async () => {
  const card = cardOn(3);
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "see #task");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.ok(card.modal.noteStage);
  assert.equal(card.modal.noteStage.draft, "see #task");
  assert.equal(card.content.querySelector(".bob-bank-category-note-refusal").textContent, "Bank: #task is not allowed in a row note");
  assert.equal(card.modal.liveText, "Bank: #task is not allowed in a row note");
  assert.equal(card.editor.replacements.length, 0);

  // A concurrent edit to the ID-less row refuses the write, keeping the draft.
  card.modal.setNoteDraft("for the team");
  card.editor.source = card.editor.source.replace("Corner Cafe", "Corner Café");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.ok(card.modal.noteStage);
  assert.equal(card.modal.noteStage.draft, "for the team");
  assert.equal(card.content.querySelector(".bob-bank-category-note-refusal").textContent, "Bank: the row changed — nothing written");
  assert.equal(card.editor.replacements.length, 0);
  // Typing again clears the refusal.
  await type(card, "!");
  assert.equal(card.content.querySelector(".bob-bank-category-note-refusal"), null);
});

test("an IME composition Enter never saves", async () => {
  const card = cardOn(2);
  await card.modal.onKeyDown(keyEvent(" "));
  card.modal.setNoteDraft("日本");
  await card.modal.onKeyDown(keyEvent("Enter", { isComposing: true, target: input(card) }));
  await card.modal.onKeyDown(keyEvent("Enter", { keyCode: 229, target: input(card) }));
  assert.ok(card.modal.noteStage);
  assert.equal(card.editor.replacements.length, 0);
});

test("a structured legacy note shows the hint instead of opening the stage", async () => {
  const source = SOURCE.replace("Corner Cafe", "Corner Cafe — with [[people/kelly|Kelly]] at lunch");
  const card = cardOn(3, { source });
  assert.equal(card.modal.context.cardRow.noteEditable, false);
  await card.modal.onKeyDown(keyEvent(" "));
  assert.equal(card.modal.noteStage, null);
  assert.equal(card.content.querySelector(".bob-bank-category-note-hint").textContent, h.BANK_NOTE_STAGE_HINT);
  assert.equal(card.modal.liveText, h.BANK_NOTE_STAGE_HINT);
  assert.ok(card.content.querySelector("button[data-bank-note-caption]").classTokens().includes("is-structured"));
});

test("clicking the caption opens the stage; a focused native button keeps Space", async () => {
  const source = SOURCE.replace("Corner Cafe", "Corner Cafe — oat latte");
  const card = cardOn(3, { source });
  const caption = card.content.querySelector("button[data-bank-note-caption]");
  assert.equal(caption.textContent, "— oat latte");
  card.modal.onClick({ target: caption, preventDefault() {}, stopPropagation() {} });
  assert.ok(card.modal.noteStage);
  assert.equal(input(card).value, "oat latte");
  // While staged, a click on a dimmed tile never files.
  const staged = card.content.querySelector("button[data-category-key]");
  card.modal.onClick({ target: staged, preventDefault() {}, stopPropagation() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(card.editor.getLine(2), /^- \[ \]/);
  assert.ok(card.modal.noteStage);

  const other = cardOn(2);
  const tile = other.content.querySelector("button[data-category-key]");
  const space = keyEvent(" ", { target: tile });
  assert.equal(other.modal.shouldPassNativeButtonSpace(space), true);
  await other.modal.onKeyDown(space);
  assert.equal(space.defaultPrevented, false);
  assert.equal(other.modal.noteStage, null);
});

test("Space is ignored while busy, refreshing, or on the summary", async () => {
  for (const state of [{ busy: true }, { waitingRefresh: true }, { summary: { line1: "done" } }]) {
    const card = cardOn(2);
    Object.assign(card.modal, state);
    await card.modal.onKeyDown(keyEvent(" "));
    assert.equal(card.modal.noteStage, null, JSON.stringify(Object.keys(state)));
  }
});

test("the restricted card writes notes offline and its Enter waits for the report", async () => {
  const card = cardOn(3, { categories: null, highlightKey: null });
  assert.equal(card.modal.loading, true);
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.match(card.editor.getLine(2), /^- \[ \]/, "Enter does nothing while loading");
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "cash tip");
  await card.modal.onKeyDown(keyEvent("Enter"));
  card.modal.onKeyUp(keyEvent("Enter"));
  assert.equal(card.editor.getLine(2), "- [ ] $5.00 Corner Cafe — cash tip");
  assert.equal(card.content.querySelector(".bob-bank-category-keys").textContent, "loading… · ␣ edit note · esc cancel");
  card.modal.setReason("bob bank failed.");
  assert.equal(card.content.querySelector(".bob-bank-category-keys").textContent, "↵ acknowledge · ␣ edit note · esc cancel");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(card.editor.getLine(2), "- [x] $5.00 Corner Cafe — cash tip");
});

test("the summary counts notes beside filings", async () => {
  const card = cardOn(3);
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "for the team");
  await card.modal.onKeyDown(keyEvent("Enter"));
  card.modal.onKeyUp(keyEvent("Enter"));
  await card.modal.onKeyDown(keyEvent("-"));
  await card.modal.onKeyDown(keyEvent("-"));
  await card.modal.onKeyDown(keyEvent("c"));
  assert.ok(card.modal.summary);
  assert.match(card.modal.summary.detail, /0 accepted · 1 picked · 2 without a category · 1 note$/);
});

test("the note write is isolated in CM6 history when the editor exposes cm", async () => {
  const dispatched = [];
  const isolate = { of: (value) => ({ isolate: value }) };
  const card = cardOn(2, { isolate });
  card.editor.cm = {
    state: {
      doc: {
        line: (n) => {
          const lines = card.editor.source.split("\n");
          const from = lines.slice(0, n - 1).reduce((sum, text) => sum + text.length + 1, 0);
          return { from, to: from + lines[n - 1].length, text: lines[n - 1] };
        },
      },
    },
    dispatch(spec) {
      dispatched.push(spec);
      const source = card.editor.source;
      card.editor.source = source.slice(0, spec.changes.from) + spec.changes.insert + source.slice(spec.changes.to);
    },
  };
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "gift");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0].annotations, { isolate: "full" });
  assert.equal(dispatched[0].changes.insert, "- [ ] $23.21 Amazon Reta* 125dt — gift ^bank-aaa111");
  assert.equal(card.editor.replacements.length, 0, "no second, mergeable edit");
});

test("a failed save still keeps the note in the editor and reports it", async () => {
  TestNotice.messages.length = 0;
  const card = cardOn(2, { saveError: "disk full" });
  await card.modal.onKeyDown(keyEvent(" "));
  await type(card, "gift");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.match(card.editor.getLine(1), /— gift \^bank-aaa111$/);
  assert.ok(TestNotice.messages.some((message) => /not saved \(disk full\)/.test(message)));
  assert.equal(card.modal.liveText, "Note saved · not saved to disk yet");
});

test("direct mode opens the stage with no tiles, saves, and closes with a Notice", async () => {
  TestNotice.messages.length = 0;
  const card = cardOn(2, { mode: "set" });
  assert.equal(card.modal.openNoteStage({ direct: true }), true);
  assert.equal(card.content.querySelector(".bob-bank-category-title").textContent, "Note");
  assert.equal(card.content.querySelector(".bob-bank-category-tile"), null);
  assert.equal(card.content.querySelector(".bob-bank-category-progress"), null);
  assert.equal(card.content.querySelector(".bob-bank-category-keys").textContent, "↵ back · esc close");
  await type(card, "warranty");
  await card.modal.onKeyDown(keyEvent("Enter"));
  assert.equal(card.editor.getLine(1), "- [ ] $23.21 Amazon Reta* 125dt — warranty ^bank-aaa111");
  assert.equal(card.modal.closed, true);
  assert.deepEqual(TestNotice.messages, ["Bank: note saved"]);

  const escaped = cardOn(2, { mode: "set" });
  escaped.modal.openNoteStage({ direct: true });
  await escaped.modal.onKeyDown(keyEvent("Escape"));
  assert.equal(escaped.modal.closed, true, "Esc closes: no tile layer beneath");
});

test("Bank: note this row opens directly, skips the report, and refuses off-row", () => {
  TestNotice.messages.length = 0;
  const editor = editorFor(SOURCE);
  const plugin = new LedgerToolsPlugin({ workspace: { getActiveFile: () => ({ path: PATH }) } });
  let fetched = 0;
  plugin.apiBankRefresh = async () => { fetched += 1; return null; };
  plugin.setupBankActions();
  const command = plugin.commands.find((entry) => entry.id === "bank-note-row");
  editor.cursor = { line: 0, ch: 0 };
  command.editorCallback(editor, { file: { path: PATH }, editor });
  assert.deepEqual(TestNotice.messages, ["Bank: put the cursor on a bank row first"]);
  editor.cursor = { line: 1, ch: 0 };
  command.editorCallback(editor, { file: { path: PATH }, editor });
  const modal = plugin.bankCategoryModal;
  assert.ok(modal && modal.noteStage && modal.noteStage.direct);
  assert.equal(modal.mode, "set");
  assert.equal(fetched, 0, "no report fetch");
  modal.close();

  TestNotice.messages.length = 0;
  const legacy = editorFor(SOURCE.replace("Corner Cafe", "Corner Cafe — with [[kelly]] at lunch"));
  legacy.cursor = { line: 2, ch: 0 };
  command.editorCallback(legacy, { file: { path: PATH }, editor: legacy });
  assert.deepEqual(TestNotice.messages, ["Bank: this note has links or fields — edit it on the row"]);
  plugin.teardownBankActions();
});
