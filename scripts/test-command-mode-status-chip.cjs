// Brand run indicator: model plus idempotent paint for indicator_label = brand,
// indicator_runs = all. Every run the engine owns lights it.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BobCommandModePlugin,
  helpers,
  makeApp,
  makeRunner,
} = require("./command-mode-harness.cjs");

function chipEl() {
  const { ElementStub } = require("./modal-harness.cjs");
  return new ElementStub({ tag: "span", cls: "bob-cmd-chip" });
}

function run(id, elapsed, extra = {}) {
  const now = Date.parse("2026-10-26T15:00:00.000Z");
  return {
    id,
    title: extra.title || "Vault sync",
    outcome: extra.outcome || "running",
    effect: extra.effect || "writes",
    budget_secs: extra.budget_secs !== undefined ? extra.budget_secs : 180,
    started_at: new Date(now - elapsed).toISOString(),
    argv: extra.argv || ["/usr/bin/bob", "vault-sync", "run"],
    ...extra,
  };
}

const NOW = Date.parse("2026-10-26T15:00:00.000Z");

function htmlCollection(children) {
  const collection = {
    length: children.length,
    item(index) { return children[index] || null; },
    *[Symbol.iterator]() { yield* children; },
  };
  children.forEach((child, index) => { collection[index] = child; });
  return collection;
}

class DomLikeElement {
  constructor(className = "") {
    this._children = [];
    this._className = String(className);
    this.style = {};
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.textContent = "";
    this.classList = {
      add: (...classes) => this.setClasses([...this.classTokens(), ...classes]),
      remove: (...classes) => this.setClasses(this.classTokens().filter((item) => !classes.includes(item))),
      toggle: (token, force) => {
        const present = this.classList.contains(token);
        const add = force === undefined ? !present : Boolean(force);
        if (add) this.classList.add(token);
        else this.classList.remove(token);
        return add;
      },
      contains: (token) => this.classTokens().includes(token),
    };
  }

  get children() {
    return htmlCollection(this._children.slice());
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || "");
  }

  classTokens() {
    return this._className.split(/\s+/).filter(Boolean);
  }

  setClasses(classes) {
    this._className = [...new Set(classes.filter(Boolean))].join(" ");
  }

  addClass(token) {
    this.classList.add(token);
  }

  appendChild(child) {
    this._children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    const found = this._children.indexOf(child);
    if (found >= 0) this._children.splice(found, 1);
    const index = this._children.indexOf(reference);
    child.parentNode = this;
    this._children.splice(index >= 0 ? index : this._children.length, 0, child);
    return child;
  }

  addEventListener(type, callback) {
    (this.listeners[type] || (this.listeners[type] = [])).push(callback);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function installDomLikeDocument() {
  const previous = global.document;
  global.document = { createElement: () => new DomLikeElement() };
  return () => {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  };
}

function domChild(element, cls) {
  return Array.from(element.children).find((child) => child.classList.contains(cls)) || null;
}

function labelText(chip) {
  const found = (chip.children || []).find((child) => (child.classes || []).includes("bob-cmd-chip-label"));
  return found ? found.textContent : "";
}

function clockText(chip) {
  const found = (chip.children || []).find((child) => (child.classes || []).includes("bob-cmd-chip-clock"));
  return found ? found.textContent : "";
}

test("hidden below 400 ms, and never settles for such runs", () => {
  const chip = chipEl();
  const state = { shown: new Set(), settle: null };
  const hidden = helpers.cmRenderStatusChip(chip, [run("one", 399, { title: "Quick" })], NOW, () => {}, () => "", state);
  assert.equal(hidden.visible, false);
  assert.equal(state.shown.size, 0);
  // A finish for a never-shown run must not settle.
  state.settle = null;
  const model = helpers.cmStatusChipModel([], NOW + 10, state, () => "");
  assert.equal(model.visible, false);
});

test("running keeps one mark element, brand label, tabular clock, and native tooltip", () => {
  const chip = chipEl();
  const opened = [];
  const state = { shown: new Set(), settle: null };
  const result = helpers.cmRenderStatusChip(chip, [run("one", 42000)], NOW, (id) => opened.push(id), () => "pulling", state);
  assert.equal(result.visible, true);
  const marks = (chip.children || []).filter((c) => (c.classes || []).includes("bob-cmd-chip-mark"));
  assert.equal(marks.length, 1);
  const first = marks[0];
  assert.equal(first.getAttribute("aria-hidden"), "true");
  helpers.cmRenderStatusChip(chip, [run("one", 42000)], NOW, () => {}, () => "pulling", state);
  const marksAfter = (chip.children || []).filter((c) => (c.classes || []).includes("bob-cmd-chip-mark"));
  assert.equal(marksAfter[0], first);
  assert.equal(labelText(chip), "bob");
  assert.equal(clockText(chip), "0:42");
  assert.match(chip.getAttribute("aria-label"), /Vault sync/);
  assert.match(chip.getAttribute("aria-label"), /bob vault-sync run/);
  assert.match(chip.getAttribute("aria-label"), /Last: pulling/);
  assert.equal(chip.getAttribute("title"), undefined);
  assert.equal(chip.getAttribute("data-tooltip-position"), "top");
});

test("two runs show count, longest clock, and click opens the newest", () => {
  const chip = chipEl();
  const opened = [];
  const state = { shown: new Set(), settle: null };
  const result = helpers.cmRenderStatusChip(
    chip,
    [run("one", 10000, { title: "Scan" }), run("two", 2000, { title: "Plan" })],
    NOW,
    (id) => opened.push(id),
    () => "",
    state,
  );
  assert.equal(result.runs, 2);
  assert.equal(labelText(chip), "bob ×2");
  assert.equal(clockText(chip), "0:10");
  chip.onclick();
  assert.deepEqual(opened, ["two"]);
});

test("queued-only gives is-queued and overdue writer gives is-overdue with budget tooltip", () => {
  const chip = chipEl();
  const state = { shown: new Set(), settle: null };
  helpers.cmRenderStatusChip(chip, [run("q", 5000, { outcome: "queued" })], NOW, () => {}, () => "", state);
  assert.ok(chip.classList.contains("is-queued"));
  const chip2 = chipEl();
  const state2 = { shown: new Set(), settle: null };
  const overdue = helpers.cmRenderStatusChip(chip2, [run("late", 181000)], NOW, () => {}, () => "", state2);
  assert.equal(overdue.overdue, true);
  assert.ok(chip2.classList.contains("is-overdue"));
  assert.match(chip2.getAttribute("aria-label"), /past its ~3 min budget/);
});

test("settle shows outcome glyph for 1600 ms, then leaving, then hidden", () => {
  const chip = chipEl();
  const state = { shown: new Set(["done"]), settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4312, atMs: NOW } };
  const settled = helpers.cmRenderStatusChip(chip, [], NOW + 500, () => {}, () => "", state);
  assert.equal(settled.visible, true);
  assert.ok(chip.classList.contains("is-settled"));
  assert.ok(chip.classList.contains("is-completed"));
  assert.equal(clockText(chip), "0:04");
  assert.match(chip.getAttribute("aria-label"), /Deploy · Completed in 0:04/);
  const leavingAt = NOW + 1600 - 200;
  const leaving = helpers.cmRenderStatusChip(chip, [], leavingAt, () => {}, () => "", state);
  assert.equal(leaving.visible, true);
  assert.ok(chip.classList.contains("is-leaving"));
  const gone = helpers.cmRenderStatusChip(chip, [], NOW + 1700, () => {}, () => "", state);
  assert.equal(gone.visible, false);
  const failedState = { shown: new Set(["f"]), settle: { runId: "f", title: "Sync", outcome: "failed", durationMs: 1201, atMs: NOW } };
  const chip2 = chipEl();
  const failed = helpers.cmRenderStatusChip(chip2, [], NOW + 500, () => {}, () => "", failedState);
  assert.equal(failed.visible, true);
  assert.ok(chip2.classList.contains("is-failed"));
});

test("sequence model shows step, sequence clock, tooltip, and between-step visibility", () => {
  const active = run("step-2", 12000, {
    title: "Reconcile tasks",
    sequence: { id: "seq-one", index: 2, total: 3 },
  });
  const sequence = {
    id: "seq-one", total: 3, index: 2, startedAtMs: NOW - 42000,
    steps: [
      { title: "Sync vault now", display: ["vault-sync", "run"] },
      { title: "Reconcile tasks", display: ["task", "reconcile"] },
      { title: "Today's plan", display: ["plan"] },
    ],
    results: [{ index: 1, runId: "step-1", outcome: "completed", durationMs: 30000 }],
  };
  const state = { shown: new Set(), settle: null };
  const model = helpers.cmStatusChipModel([active], NOW, state, () => "reconciled 12 tasks", { sequences: [sequence] });
  assert.equal(model.step, "2/3");
  assert.equal(model.stepTitle, "Reconcile tasks");
  assert.equal(model.clock, "0:42");
  assert.equal(model.runId, "step-2");
  assert.match(model.tooltip, /bob · sequence 2 of 3 · 0:42/);
  assert.match(model.tooltip, /✓ Sync vault now · 0:30/);
  assert.match(model.tooltip, /bob task reconcile/);
  assert.match(model.tooltip, /Last: reconciled 12 tasks/);

  const between = {
    ...sequence,
    index: 3,
    results: [...sequence.results, { index: 2, runId: "step-2", outcome: "completed", durationMs: 12000 }],
  };
  const betweenModel = helpers.cmStatusChipModel([], NOW, state, () => "", { sequences: [between] });
  assert.equal(betweenModel.visible, true);
  assert.equal(betweenModel.step, "3/3");
  assert.equal(betweenModel.runId, "step-2");
  state.settle = { runId: "old", title: "Old run", outcome: "completed", durationMs: 1000, atMs: NOW };
  const betweenChip = chipEl();
  const betweenPaint = helpers.cmRenderStatusChip(betweenChip, [], NOW, () => {}, () => "", state, { sequences: [between] });
  assert.equal(betweenPaint.visible, true);
  assert.equal(state.settle, null);
});

test("sequence chip lazily inserts step and title before the clock and hides them when idle", () => {
  const restore = installDomLikeDocument();
  try {
    const chip = new DomLikeElement("status-bar-item bob-cmd-chip");
    const state = { shown: new Set(), settle: null };
    helpers.cmRenderStatusChip(chip, [run("plain", 5000)], NOW, () => {}, () => "", state);
    assert.deepEqual(Array.from(chip.children).map((child) => child.className), [
      "bob-cmd-chip-mark", "bob-cmd-chip-label", "bob-cmd-chip-clock",
    ]);
    const sequence = {
      id: "seq-paint", index: 2, total: 3, startedAtMs: NOW - 5000,
      steps: [{ title: "Sync vault", display: ["vault-sync", "run"] }, { title: "Reconcile tasks", display: ["task", "reconcile"] }, { title: "Plan", display: ["plan"] }],
      results: [],
    };
    const record = run("seq-run", 2500, { sequence: { id: "seq-paint", index: 2, total: 3 } });
    helpers.cmRenderStatusChip(chip, [record], NOW, () => {}, () => "", state, { sequences: [sequence] });
    assert.deepEqual(Array.from(chip.children).map((child) => child.className), [
      "bob-cmd-chip-mark", "bob-cmd-chip-label", "bob-cmd-chip-step", "bob-cmd-chip-title", "bob-cmd-chip-clock",
    ]);
    assert.equal(domChild(chip, "bob-cmd-chip-step").textContent, "2/3");
    assert.equal(domChild(chip, "bob-cmd-chip-title").textContent, "Reconcile tasks");
    helpers.cmRenderStatusChip(chip, [record], NOW, () => {}, () => "", state, { sequences: [sequence] });
    assert.equal(chip.children.length, 5);
    helpers.cmRenderStatusChip(chip, [run("plain", 5000)], NOW, () => {}, () => "", state);
    assert.equal(domChild(chip, "bob-cmd-chip-step").style.display, "none");
    assert.equal(domChild(chip, "bob-cmd-chip-title").style.display, "none");
  } finally {
    restore();
  }
});

test("sequence settle displays its final step and opens the focus run", () => {
  const chip = chipEl();
  const opened = [];
  const state = {
    shown: new Set(["seq-settled"]),
    settle: {
      runId: "focus-run", title: "Today's plan", outcome: "completed", durationMs: 42000, atMs: NOW,
      sequence: { id: "seq-settled", step: "3/3", stepTitle: "Today's plan", total: 3 },
    },
  };
  const result = helpers.cmRenderStatusChip(chip, [], NOW + 500, (id) => opened.push(id), () => "", state);
  assert.equal(result.step, "3/3");
  assert.equal(result.stepTitle, "Today's plan");
  assert.match(chip.getAttribute("aria-label"), /bob · sequence 3\/3 · 0:42/);
  chip.onclick();
  assert.deepEqual(opened, ["focus-run"]);
});

test("a new run during a settle shows running at once and click opens the settled run", () => {
  const chip = chipEl();
  const opened = [];
  const state = { shown: new Set(["done"]), settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4000, atMs: NOW } };
  const result = helpers.cmRenderStatusChip(chip, [run("next", 5000, { title: "Next" })], NOW + 600, (id) => opened.push(id), () => "", state);
  assert.equal(result.visible, true);
  assert.ok(chip.classList.contains("is-running"));
  assert.equal(state.settle, null);
  // Settle click and Enter open the settled run.
  const chip2 = chipEl();
  const opened2 = [];
  const state2 = { shown: new Set(["done"]), settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4000, atMs: NOW } };
  const settled = helpers.cmRenderStatusChip(chip2, [], NOW + 500, (id) => opened2.push(id), () => "", state2);
  assert.equal(settled.runId, "done");
  chip2.onclick();
  assert.deepEqual(opened2, ["done"]);
});

test("adopted unfinished runs appear flagged and all triggers light the indicator", () => {
  const chip = chipEl();
  const state = { shown: new Set(), settle: null };
  const adopted = run("adopt", 9000, { adopted: true, title: "Adopted" });
  const result = helpers.cmRenderStatusChip(chip, [adopted], NOW, () => {}, () => "", state);
  assert.equal(result.visible, true);
  assert.match(chip.getAttribute("aria-label"), /adopted after reload/);
  // indicator_runs = all: palette-triggered runs light the indicator (no sheet filter).
  const palette = run("pal", 5000, { title: "Palette", trigger: "command" });
  const model = helpers.cmStatusChipModel([palette], NOW, null, () => "");
  assert.equal(model.visible, true);
});

test("first visible paint uses HTMLCollection semantics and preserves existing classes", () => {
  const restore = installDomLikeDocument();
  try {
    const chip = new DomLikeElement("status-bar-item bob-cmd-chip");
    const state = { shown: new Set(), settle: null };
    assert.equal(typeof chip.children.includes, "undefined");
    const result = helpers.cmRenderStatusChip(chip, [run("dom", 5000)], NOW, () => {}, () => "", state);
    assert.equal(result.visible, true);
    assert.equal(chip.style.display, "");
    assert.deepEqual(Array.from(chip.children).map((child) => child.className), [
      "bob-cmd-chip-mark", "bob-cmd-chip-label", "bob-cmd-chip-clock",
    ]);
    assert.equal(domChild(chip, "bob-cmd-chip-label").textContent, "bob");
    assert.equal(domChild(chip, "bob-cmd-chip-clock").textContent, "0:05");
    assert.ok(chip.classList.contains("is-running"));
    assert.ok(chip.classList.contains("status-bar-item"));
    assert.ok(chip.classList.contains("bob-cmd-chip"));
  } finally {
    restore();
  }
});

test("DOM-like repaints keep the mark and anatomy idempotent", () => {
  const restore = installDomLikeDocument();
  try {
    const chip = new DomLikeElement("status-bar-item bob-cmd-chip");
    const state = { shown: new Set(), settle: null };
    helpers.cmRenderStatusChip(chip, [run("one", 5000)], NOW, () => {}, () => "", state);
    const mark = domChild(chip, "bob-cmd-chip-mark");
    helpers.cmRenderStatusChip(chip, [run("one", 5000), run("two", 2000)], NOW, () => {}, () => "", state);
    assert.equal(chip.children.length, 3);
    assert.equal(domChild(chip, "bob-cmd-chip-mark"), mark);
    assert.equal(domChild(chip, "bob-cmd-chip-label").textContent, "bob ×2");
  } finally {
    restore();
  }
});

test("DOM-like settle paint shows its outcome, then hides after the settle window", () => {
  const restore = installDomLikeDocument();
  try {
    const chip = new DomLikeElement("status-bar-item bob-cmd-chip");
    const state = {
      shown: new Set(["done"]),
      settle: { runId: "done", title: "Deploy", outcome: "completed", durationMs: 4312, atMs: NOW },
    };
    const settled = helpers.cmRenderStatusChip(chip, [], NOW + 500, () => {}, () => "", state);
    assert.equal(settled.visible, true);
    assert.equal(domChild(chip, "bob-cmd-chip-mark").textContent, "✓");
    assert.ok(chip.classList.contains("is-settled"));
    assert.ok(chip.classList.contains("is-completed"));
    const hidden = helpers.cmRenderStatusChip(chip, [], NOW + 1700, () => {}, () => "", state);
    assert.equal(hidden.visible, false);
    assert.equal(chip.style.display, "none");
  } finally {
    restore();
  }
});

test("plugin status-chip path paints an HTMLCollection-like status item", () => {
  const restore = installDomLikeDocument();
  const app = makeApp();
  const base = makeRunner({ app });
  const plugin = new BobCommandModePlugin(app);
  const chip = new DomLikeElement("status-bar-item");
  const now = Date.now();
  base.runner.activeRecords = () => [{
    ...run("plugin-run", 5000),
    started_at: new Date(now - 5000).toISOString(),
  }];
  plugin.commandModeRunner = base.runner;
  plugin.commandModeStickyNotices = new Map();
  plugin.addStatusBarItem = () => chip;
  try {
    plugin.commandModeStartStatusChip();
    const result = plugin.commandModeRefreshStatusChip(now);
    assert.equal(result.visible, true);
    assert.equal(chip.style.display, "");
    assert.equal(chip.children.length, 3);
  } finally {
    plugin.onunload();
    restore();
  }
});
