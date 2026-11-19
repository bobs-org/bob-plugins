const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/log-recall-vectors.json"), "utf8"));

for (const vector of vectors.normalize) {
  test(`log recall normalization: ${vector.name}`, () => {
    assert.equal(helpers.normalizeLogRecallQuery(vector.input), vector.expected);
  });
}

for (const vector of vectors.rank) {
  test(`log recall ranking: ${vector.name}`, () => {
    const rows = helpers.rankLogRecall(vector.catalog, vector.overlay || [], vector.query);
    assert.deepEqual(rows.map((row) => row.key), vector.expected);
  });
}

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
  }
  createDiv(options = {}) { return this.appendChild(new Element(options)); }
  createSpan(options = {}) { return this.createDiv(options); }
  createEl(tag, options = {}) { return this.appendChild(new Element({ ...options, tag })); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  appendText(text) { this.appendChild(new Element({ text })); }
  empty() { for (const child of this.children) child.parent = null; this.children = []; this.textContent = ""; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((entry) => entry !== listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  dispatchEvent(event) { for (const listener of this.listeners[event.type] || []) listener.call(this, event); return true; }
  fire(type, event) { event.type = type; for (const listener of this.listeners[type] || []) listener.call(this, event); }
  find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const found = child.find(predicate); if (found) return found; } return null; }
}

function phrase(text, key, recency_rank, score = 1) {
  return { text, key, recency_rank, score, uses: 3, last_used: "2026-11-19 10:00", match: null };
}

function makeLogsApi(phrases) {
  let snapshot = { schema_version: 1, ok: true, overlay: {}, logs: [{ kind: "work", phrases: phrases.slice() }] };
  const listeners = new Set();
  return {
    api: {
      snapshot: () => snapshot,
      fetch: async () => ({ status: "ok", catalog: snapshot, fetchedAt: Date.now() }),
      onChange: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
      noteUsed() { return true; },
    },
    replace(next) { snapshot = next; for (const listener of [...listeners]) listener(snapshot, "test"); },
  };
}

function keyEvent(key, modifiers = {}) {
  return { key, ...modifiers, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediateStopped = true; } };
}

function treeText(node) {
  return `${node && node.textContent || ""}${(node && node.children || []).map(treeText).join("")}`;
}

test("log recall reducer enters at the top, clamps, and restores the draft", () => {
  const rows = [phrase("alpha", "alpha", 0), phrase("beta", "beta", 1)];
  let state = helpers.logRecallInitialState({ draft: "a", rows });
  state = helpers.logRecallReduce(state, { type: "enter", rows });
  assert.equal(state.mode, "recalling");
  assert.equal(state.selectedKey, "alpha");
  state = helpers.logRecallReduce(state, { type: "previous", rows });
  assert.equal(state.mode, "draft");
  assert.equal(state.selectedKey, null);
  state = helpers.logRecallReduce({ ...state, mode: "recalling", selectedKey: "beta" }, { type: "next", rows });
  assert.equal(state.selectedKey, "beta");
  assert.equal(state.edge, "bottom");
});

test("log recall age follows day and minute precision", () => {
  const now = new Date(2026, 10, 19, 12, 0);
  assert.equal(helpers.formatLogRecallAge("2026-11-19", "day", now), "today");
  assert.equal(helpers.formatLogRecallAge("2026-11-18", "day", now), "yesterday");
  assert.equal(helpers.formatLogRecallAge("2026-11-19 10:00", "minute", now), "2h");
});

test("nav api exposes an additive logRecall v1 namespace", () => {
  const noted = [];
  const logs = { version: 1, noteUsed: (kind, text) => { noted.push([kind, text]); return true; }, fetch: async () => ({}), snapshot: () => null };
  const plugin = { app: { plugins: { plugins: { "bob-ledger-tools": { api: { logs } } } } } };
  const api = helpers.createDependencyNavApi(plugin);
  assert.equal(api.version, 3);
  assert.equal(api.logRecall.version, 1);
  assert.equal(api.logRecall.noteUsed("work", "saved phrase"), true);
  assert.deepEqual(noted, [["work", "saved phrase"]]);
  const input = new Element({ tag: "input" });
  const host = new Element();
  const controller = api.logRecall.attach({ inputEl: input, bandHost: host, kind: "work", ownKeys: false });
  assert.equal(typeof controller.handleKeydown, "function");
  controller.detach();
});

test("LaneReleaseSummaryModal attaches recall and keeps its live Work Log preview", () => {
  const attached = [];
  let detached = 0;
  const recallApi = { version: 1, attach(options) { attached.push(options); return { detach() { detached += 1; } }; } };
  const modal = new helpers.LaneReleaseSummaryModal(
    { plugins: { plugins: { "bob-navigation-hotkeys": { api: { logRecall: recallApi } } } } },
    () => {},
  );
  modal.open();
  assert.equal(attached[0].kind, "work");
  assert.match(treeText(modal.previewEl), /No work-log entry/);
  modal.inputEl.value = "Shipped the fix";
  modal.updatePreview();
  assert.match(treeText(modal.previewEl), /Shipped the fix/);
  assert.match(modal.recallFooterEl.textContent, /Release & log summary/);
  modal.close();
  assert.equal(detached, 1);
});

test("USED BEFORE fills on Ctrl+N/P, Esc restores draft, typing adopts the fill, and fixed rows stay put", () => {
  const input = new Element({ tag: "input" });
  const host = new Element();
  const logs = makeLogsApi([phrase("athena agent", "athena agent", 0), phrase("apollo research", "apollo research", 1)]);
  const recall = helpers.attachLogRecall({ inputEl: input, bandHost: host, logsApi: logs.api, kind: "work", ownKeys: true, arrowKeys: true });
  assert.equal(host.style["--bob-log-recall-slots"], "2");
  const firstRow = host.find((element) => element.classList.contains("bob-log-recall-row") && !element.classList.contains("is-empty"));
  let mousePrevented = false;
  firstRow.listeners.mousedown[0]({ preventDefault() { mousePrevented = true; } });
  assert.equal(mousePrevented, true);
  input.value = "ath";
  input.fire("input", {});
  assert.equal(recall.handleKeydown(keyEvent("n", { ctrlKey: true })), true);
  assert.equal(input.value, "athena agent");
  assert.equal(recall.isRecalling(), true);
  assert.equal(recall.backOut(), true);
  assert.equal(input.value, "ath");
  input.value = "draft edit";
  input.fire("input", {});
  assert.equal(recall.isRecalling(), false);
  input.value = "ath";
  input.fire("input", {});
  const selected = recall.handleKeydown(keyEvent("p", { ctrlKey: true }));
  assert.equal(selected, true);
  assert.equal(input.value, "athena agent");
  recall.detach();
});

test("dense log recall stays hidden until a query or navigation key reveals it", () => {
  const input = new Element({ tag: "input" });
  const host = new Element();
  const logs = makeLogsApi([phrase("athena agent", "athena agent", 0)]);
  const recall = helpers.attachLogRecall({ inputEl: input, bandHost: host, logsApi: logs.api, kind: "work", density: "dense", ownKeys: false });
  assert.equal(host.classList.contains("is-hidden"), true);
  input.value = "at";
  input.fire("input", {});
  assert.equal(host.classList.contains("is-hidden"), false);
  recall.detach();
});

test("log recall ignores modified and composing chords and leaves absent catalogs inert", () => {
  const input = new Element({ tag: "input" });
  const host = new Element();
  const absent = helpers.attachLogRecall({ inputEl: input, bandHost: host, kind: "work", ownKeys: true, logsApi: { snapshot: () => null, fetch: async () => ({ status: "unavailable" }) } });
  assert.equal(absent.handleKeydown(keyEvent("n", { ctrlKey: true })), false);
  absent.detach();
  const logs = makeLogsApi([phrase("athena agent", "athena agent", 0)]);
  const recall = helpers.attachLogRecall({ inputEl: input, bandHost: host, logsApi: logs.api, kind: "work", ownKeys: true });
  assert.equal(recall.handleKeydown(keyEvent("n", { ctrlKey: true, shiftKey: true })), false);
  assert.equal(recall.handleKeydown(keyEvent("n", { ctrlKey: true, isComposing: true })), false);
  recall.detach();
});

test("a stale catalog refresh waits while recalling, then re-ranks after Esc", () => {
  const input = new Element({ tag: "input" });
  const host = new Element();
  const logs = makeLogsApi([phrase("athena agent", "athena agent", 0), phrase("apollo research", "apollo research", 1)]);
  const recall = helpers.attachLogRecall({ inputEl: input, bandHost: host, logsApi: logs.api, kind: "work", ownKeys: false });
  input.value = "ath";
  input.fire("input", {});
  recall.handleKeydown(keyEvent("n", { ctrlKey: true }));
  const filled = input.value;
  logs.replace({ schema_version: 1, ok: true, overlay: {}, logs: [{ kind: "work", phrases: [phrase("atlas project", "atlas project", 0)] }] });
  assert.equal(input.value, filled);
  assert.equal(recall.backOut(), true);
  assert.equal(input.value, "ath");
  assert.equal(recall.handleKeydown(keyEvent("n", { ctrlKey: true })), true);
  assert.equal(recall.isRecalling(), false);
  assert.equal(input.value, "ath");
  recall.detach();
});

