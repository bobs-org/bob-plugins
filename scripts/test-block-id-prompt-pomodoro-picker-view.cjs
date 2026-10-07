// View tests for the Pomodoro link picker modal ("Link to today"). Loads
// the built plugin with modal-harness.cjs's ModalStub/ElementStub (the
// navigation-hotkeys-harness.cjs loader pattern); block-id-prompt-harness.cjs
// stays on its stub Modal.
const test = require("node:test");
const assert = require("node:assert/strict");

const Module = require("node:module");

const {
  ElementStub,
  ModalStub,
  click,
  pressKey,
} = require("./modal-harness.cjs");

global.window = global.window || { setTimeout: (callback) => callback() };

const iconCalls = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal extends ModalStub {}
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      Setting: EmptyClass,
      TFile: EmptyClass,
      normalizePath: (value) => String(value || ""),
      setIcon: (el, name) => {
        iconCalls.push(name);
      },
    };
  }
  if (request === "@codemirror/view") {
    class EditorView {}
    EditorView.updateListener = { of: (callback) => ({ callback }) };
    return { EditorView };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require("../plugins/block-id-prompt/main.js");
Module._load = originalLoad;
const { helpers } = Plugin;

function findAllByClass(root, cls) {
  const found = [];
  (function walk(el) {
    if (el.classes && el.classes.includes(cls)) {
      found.push(el);
    }
    (el.children || []).forEach(walk);
  })(root);
  return found;
}

function findByClass(root, cls) {
  return findAllByClass(root, cls)[0] || null;
}

function textOf(el) {
  let text = el.textContent || "";
  (el.children || []).forEach((child) => {
    text += textOf(child);
  });
  return text;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

const NOW = new Date(2026, 7, 15, 9, 35);

const DAILY = [
  "## Pomodoros",
  "- [ ] (09:20-09:50) — CAPTURE",
  "  - [[Tasks#^aaa]]",
  "  - [[Tasks#^bbb]]",
  "  - [[Tasks#^ccc]]",
  "- [ ] () — LATER",
  "- [x] () — DONE",
].join("\n");

const MULTI_DAILY = [
  "## Pomodoros",
  "- [ ] (09:00-09:25) — ONE",
  "- [ ] (09:30-09:55) — TWO",
].join("\n");

const MEMORY_DAILY = [
  "## Pomodoros",
  "- [ ] () — MEMORY WORK",
  "- [ ] () — MEMORY",
].join("\n");

function openPicker(options = {}) {
  const {
    daily = DAILY,
    task = { displayText: "Ship it", status: " " },
    needsBlockId = false,
    now = NOW,
    budget = null,
  } = options;
  const model = helpers.buildPomodoroLinkPickerModel(daily, { now });
  assert.equal(model.ok, true);
  const modal = new helpers.PomodoroLinkPickerModal(
    {},
    { model, task, needsBlockId, now, budget },
  );
  modal.open();
  return modal;
}

function type(modal, value) {
  modal.inputEl.value = value;
  modal.inputEl.listeners.input({ target: modal.inputEl });
}

function rowTitles(modal) {
  return findAllByClass(modal.contentEl, "bid-ppk-row").map((row) =>
    textOf(findByClass(row, "bid-ppk-row-title")),
  );
}

function selectedTitle(modal) {
  const selected = findAllByClass(modal.contentEl, "bid-ppk-row").find((row) =>
    row.classes.includes("is-selected"),
  );
  return selected ? textOf(findByClass(selected, "bid-ppk-row-title")) : null;
}

test("header shows title, subtitle, lane chip per status, and block-ID chip", () => {
  const modal = openPicker();
  assert.equal(textOf(findByClass(modal.contentEl, "bid-ppk-title")), "Link to today");
  assert.equal(textOf(findByClass(modal.contentEl, "bid-ppk-subtitle")), "Ship it");
  assert.equal(textOf(findByClass(modal.contentEl, "bid-ppk-lane")), "Ready → Next");
  assert.equal(findByClass(modal.contentEl, "bid-ppk-blockid"), null);
  assert.ok(iconCalls.includes("timer"));
  modal.close();

  const cases = [
    [" ", "Ready → Next", "bid-ppk-lane"],
    ["?", "Blocked → Next", "bid-ppk-lane is-green"],
    ["*", "stays Next", "bid-ppk-lane is-muted"],
    ["/", "stays In Progress", "bid-ppk-lane is-muted"],
  ];
  for (const [status, label, cls] of cases) {
    const picker = openPicker({ task: { displayText: "T", status } });
    const lane = findByClass(picker.contentEl, "bid-ppk-lane");
    assert.equal(textOf(lane), label);
    for (const name of cls.split(" ")) {
      assert.ok(lane.classes.includes(name), `${label} carries ${name}`);
    }
    picker.close();
  }

  const withId = openPicker({ needsBlockId: true });
  const chip = findByClass(withId.contentEl, "bid-ppk-blockid");
  assert.equal(textOf(chip), "+ block ID");
  assert.equal(chip.getAttribute("title"), "You'll name the block ID next");
  withId.close();
});

test("rows render in document order with the default selected", () => {
  const modal = openPicker();
  assert.deepEqual(rowTitles(modal), ["CAPTURE", "LATER"]);
  assert.equal(selectedTitle(modal), "CAPTURE");

  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  assert.equal(rows[0].getAttribute("role"), "option");
  assert.equal(rows[0].getAttribute("aria-selected"), "true");
  assert.equal(rows[1].getAttribute("aria-selected"), "false");
  assert.equal(
    rows[0].getAttribute("aria-label"),
    "CAPTURE, running, 09:20–09:50, 3 tasks",
  );

  const results = findByClass(modal.contentEl, "bid-ppk-results");
  assert.equal(results.getAttribute("role"), "listbox");
  assert.equal(modal.inputEl.getAttribute("aria-controls"), "bid-ppk-list");
  assert.equal(modal.inputEl.getAttribute("aria-activedescendant"), "bid-ppk-row-0");

  assert.equal(textOf(findByClass(rows[0], "bid-ppk-pill")), "Running");
  assert.ok(findByClass(rows[0], "bid-ppk-pill").classes.includes("is-running"));
  assert.equal(textOf(findByClass(rows[1], "bid-ppk-pill")), "Next up");
  assert.ok(findByClass(rows[1], "bid-ppk-pill").classes.includes("is-next-up"));
  assert.ok(findByClass(rows[0], "bid-ppk-glyph").classes.includes("is-running"));
  assert.ok(findByClass(rows[1], "bid-ppk-glyph").classes.includes("is-next-up"));
  assert.ok(findByClass(rows[0], "bid-ppk-keycap"));
  modal.close();
});

test("running row shows progress fraction and minutes-left meta", () => {
  const modal = openPicker();
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  const glyph = findByClass(rows[0], "bid-ppk-glyph");
  assert.equal(glyph.style["--bid-ppk-progress"], "0.5");
  assert.ok(findByClass(rows[0], "bid-ppk-dot"));

  const meta = textOf(findByClass(rows[0], "bid-ppk-row-meta"));
  assert.match(meta, /09:20–09:50/);
  assert.match(meta, /15m left/);
  assert.match(meta, /3 tasks/);
  assert.match(meta, /aaa, bbb \+1/);
  assert.ok(findByClass(rows[0], "bid-ppk-left"));

  const laterMeta = textOf(findByClass(rows[1], "bid-ppk-row-meta"));
  assert.match(laterMeta, /empty/);
  modal.close();

  const over = openPicker({ now: new Date(2026, 7, 15, 9, 55) });
  const overRows = findAllByClass(over.contentEl, "bid-ppk-row");
  assert.equal(findByClass(overRows[0], "bid-ppk-glyph").style["--bid-ppk-progress"], "1");
  assert.match(textOf(findByClass(overRows[0], "bid-ppk-row-meta")), /5m over/);
  assert.ok(findByClass(overRows[0], "bid-ppk-over"));
  over.close();
});

test("unnamed entries render muted italic", () => {
  const modal = openPicker({
    daily: ["## Pomodoros", "- [ ] (09:20-09:50)", "- [ ] () — LATER"].join("\n"),
  });
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  const title = findByClass(rows[0], "bid-ppk-row-title");
  assert.ok(title.classes.includes("is-unnamed"));
  assert.equal(textOf(title), "09:20–09:50");
  modal.close();
});

test("filtering ranks, highlights, and clearing restores the default", () => {
  const modal = openPicker({ daily: MEMORY_DAILY });
  assert.deepEqual(rowTitles(modal), ["MEMORY WORK", "MEMORY"]);

  type(modal, "memory");
  assert.deepEqual(rowTitles(modal), ["MEMORY", "MEMORY WORK"]);
  assert.equal(selectedTitle(modal), "MEMORY");
  const firstRow = findAllByClass(modal.contentEl, "bid-ppk-row")[0];
  const highlight = findByClass(firstRow, "bid-tlp-hl");
  assert.ok(highlight);
  assert.equal(textOf(highlight), "MEMORY");

  type(modal, "");
  assert.deepEqual(rowTitles(modal), ["MEMORY WORK", "MEMORY"]);
  assert.equal(selectedTitle(modal), "MEMORY WORK");
  modal.close();
});

test("create row meta, divider, and theme badge", () => {
  const modal = openPicker();
  type(modal, "focus");
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  assert.equal(rows.length, 1);
  const create = rows[0];
  assert.ok(create.classes.includes("is-new"));
  assert.ok(!create.classes.includes("is-after-matches"));
  assert.equal(textOf(findByClass(create, "bid-ppk-create-name")), "FOCUS");
  assert.equal(
    textOf(findByClass(create, "bid-ppk-row-meta")),
    "after CAPTURE · becomes next up",
  );
  assert.equal(textOf(findByClass(create, "bid-ppk-pill")), "New");
  assert.equal(textOf(findByClass(create, "bid-ppk-theme")), "+1 theme");
  assert.ok(!findByClass(create, "bid-ppk-theme").classes.includes("is-over"));
  modal.close();

  const again = openPicker({
    daily: ["## Pomodoros", "- [x] () — TAXES", "- [ ] () — FOCUS"].join("\n"),
  });
  type(again, "taxes");
  const againRows = findAllByClass(again.contentEl, "bid-ppk-row");
  assert.equal(againRows.length, 1);
  assert.equal(
    textOf(findByClass(againRows[0], "bid-ppk-row-meta")),
    "TAXES is done — starts a fresh TAXES",
  );
  again.close();

  const top = openPicker({ daily: ["## Pomodoros", "- [-] () — GONE"].join("\n") });
  type(top, "brand new");
  const topRows = findAllByClass(top.contentEl, "bid-ppk-row");
  assert.equal(topRows.length, 1);
  assert.equal(
    textOf(findByClass(topRows[0], "bid-ppk-row-meta")),
    "first in Pomodoros",
  );
  top.close();

  const before = openPicker({ daily: ["## Pomodoros", "- [ ] () — ALPHA"].join("\n") });
  type(before, "beta");
  const beforeRows = findAllByClass(before.contentEl, "bid-ppk-row");
  assert.equal(
    textOf(findByClass(beforeRows[0], "bid-ppk-row-meta")),
    "before ALPHA · becomes next up",
  );
  before.close();
});

test("exact open names suppress the create row; prefix matches keep it", () => {
  const modal = openPicker();
  type(modal, "capture");
  assert.deepEqual(rowTitles(modal), ["CAPTURE"]);

  type(modal, "capt");
  assert.deepEqual(rowTitles(modal).length, 2);
  assert.match(rowTitles(modal)[1], /New Pomodoro CAPT/);
  const dividerRows = findAllByClass(modal.contentEl, "bid-ppk-row");
  assert.ok(dividerRows[1].classes.includes("is-after-matches"));
  assert.ok(!dividerRows[0].classes.includes("is-after-matches"));
  modal.close();
});

test("theme badge turns red over cap; a throwing budget hides the detail", () => {
  const overBudget = {
    current: null,
    forNewName: () => ({ themes: { count: 4, cap: 3, over: true } }),
  };
  const modal = openPicker({ budget: overBudget });
  type(modal, "focus");
  const theme = findByClass(modal.contentEl, "bid-ppk-theme");
  assert.equal(textOf(theme), "+1 theme · 4/3");
  assert.ok(theme.classes.includes("is-over"));
  modal.close();

  const throwing = {
    current: null,
    forNewName: () => {
      throw new Error("ledger down");
    },
  };
  const plain = openPicker({ budget: throwing });
  type(plain, "focus");
  assert.equal(textOf(findByClass(plain.contentEl, "bid-ppk-theme")), "+1 theme");
  plain.close();
});

test("invalid rows explain the grammar and are inert on Enter", async () => {
  const modal = openPicker();
  type(modal, "!!!");
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].classes.includes("is-invalid"));
  assert.match(textOf(rows[0]), /must start with a letter or digit/);
  assert.match(textOf(rows[0]), /Start with a letter or digit/);

  const promise = modal.waitForChoice();
  let settled = false;
  promise.then(() => {
    settled = true;
  });
  pressKey(modal, "Enter");
  await tick();
  await tick();
  assert.equal(settled, false);
  modal.close();
  assert.equal(await promise, null);
});

test("multiple running entries show the banner, no pills, and block creation", async () => {
  const modal = openPicker({ daily: MULTI_DAILY });
  assert.match(
    textOf(findByClass(modal.contentEl, "bid-ppk-banner")),
    /2 Pomodoros are running — pick one; new Pomodoros are off until one finishes/,
  );
  assert.equal(findByClass(modal.contentEl, "bid-ppk-pill"), null);
  assert.equal(selectedTitle(modal), "ONE");

  type(modal, "three");
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].classes.includes("is-blocked"));
  assert.match(textOf(rows[0]), /Can't add a Pomodoro while 2 are running/);
  assert.equal(modal.inputEl.getAttribute("aria-activedescendant"), undefined);

  const promise = modal.waitForChoice();
  let settled = false;
  promise.then(() => {
    settled = true;
  });
  pressKey(modal, "Enter");
  await tick();
  await tick();
  assert.equal(settled, false);
  modal.close();
  assert.equal(await promise, null);
});

test("navigation wraps and skips non-selectable rows", () => {
  const modal = openPicker({ daily: MULTI_DAILY });
  type(modal, "three");
  // Only the blocked row remains: navigation has nowhere to go.
  pressKey(modal, "ArrowDown");
  assert.equal(findAllByClass(modal.contentEl, "bid-ppk-row is-selected").length, 0);
  modal.close();

  const mixed = openPicker({ daily: MULTI_DAILY });
  type(mixed, "o");
  const titles = rowTitles(mixed);
  assert.ok(titles.includes("ONE"));
  assert.ok(titles.includes("TWO"));
  const blockedIndex = titles.findIndex((title) => /Can't add/.test(title));
  assert.ok(blockedIndex > 0);
  const firstTitle = selectedTitle(mixed);
  pressKey(mixed, "ArrowDown");
  const secondTitle = selectedTitle(mixed);
  assert.notEqual(secondTitle, firstTitle);
  pressKey(mixed, "ArrowDown");
  // Wraps past the blocked row back to the first selectable row.
  assert.equal(selectedTitle(mixed), firstTitle);
  pressKey(mixed, "ArrowUp");
  assert.equal(selectedTitle(mixed), secondTitle);
  pressKey(mixed, "n", { ctrlKey: true });
  assert.equal(selectedTitle(mixed), firstTitle);
  pressKey(mixed, "p", { ctrlKey: true });
  assert.equal(selectedTitle(mixed), secondTitle);
  mixed.close();
});

test("empty state invites planning a Pomodoro", () => {
  const modal = openPicker({ daily: ["## Pomodoros", "- [x] () — DONE"].join("\n") });
  assert.equal(findAllByClass(modal.contentEl, "bid-ppk-row").length, 0);
  assert.equal(
    textOf(findByClass(modal.contentEl, "bid-ppk-empty-text")),
    "No open Pomodoros today",
  );
  assert.equal(
    textOf(findByClass(modal.contentEl, "bid-ppk-empty-hint")),
    "Type a name to plan one",
  );
  assert.ok(iconCalls.includes("timer-off"));
  modal.close();
});

test("footer hints and plan meter", () => {
  const modal = openPicker();
  const hints = textOf(findByClass(modal.contentEl, "bid-ppk-hints"));
  assert.match(hints, /select/);
  assert.match(hints, /link/);
  assert.match(hints, /cancel/);
  // No create intent on an empty query: the ⇧↵ hint hides.
  const shiftHint = findAllByClass(modal.contentEl, "bid-ppk-hint").find((hint) =>
    /new NAME/.test(textOf(hint)),
  );
  assert.ok(shiftHint);
  assert.equal(shiftHint.style.display, "none");
  assert.equal(findByClass(modal.contentEl, "bid-ppk-meter"), null);

  type(modal, "focus");
  assert.equal(shiftHint.style.display, "");
  modal.close();

  const metered = openPicker({
    budget: {
      current: {
        themes: { count: 2, cap: 3, over: false },
        links: { count: 6, cap: 10, over: false },
        over: false,
      },
      forNewName: () => null,
    },
  });
  const meter = findByClass(metered.contentEl, "bid-ppk-meter");
  assert.equal(textOf(meter), "plan 2/3 · 6/10");
  assert.equal(meter.getAttribute("aria-live"), "polite");
  assert.ok(!meter.classes.includes("is-over"));
  metered.close();

  const over = openPicker({
    budget: {
      current: {
        themes: { count: 4, cap: 3, over: true },
        links: { count: 6, cap: 10, over: true },
        over: true,
      },
      forNewName: () => null,
    },
  });
  assert.ok(findByClass(over.contentEl, "bid-ppk-meter").classes.includes("is-over"));
  over.close();
});

test("Enter chooses the selected row; click chooses that row", async () => {
  const modal = openPicker();
  const promise = modal.waitForChoice();
  pressKey(modal, "Enter");
  const choice = await promise;
  assert.deepEqual(choice, {
    kind: "existing",
    entryLine: 1,
    entryText: "- [ ] (09:20-09:50) — CAPTURE",
    title: "CAPTURE",
  });
  assert.equal(modal.isOpen, false);

  const tapped = openPicker();
  const tappedPromise = tapped.waitForChoice();
  const rows = findAllByClass(tapped.contentEl, "bid-ppk-row");
  click(rows[1]);
  assert.deepEqual(await tappedPromise, {
    kind: "existing",
    entryLine: 5,
    entryText: "- [ ] () — LATER",
    title: "LATER",
  });
});

test("Shift+Enter creates; an exact open name links there instead", async () => {
  const modal = openPicker();
  type(modal, "focus");
  const promise = modal.waitForChoice();
  pressKey(modal, "Enter", { shiftKey: true });
  assert.deepEqual(await promise, { kind: "new", name: "FOCUS" });

  const exact = openPicker();
  type(exact, "capture");
  const exactPromise = exact.waitForChoice();
  pressKey(exact, "Enter", { shiftKey: true });
  const choice = await exactPromise;
  assert.equal(choice.kind, "existing");
  assert.equal(choice.title, "CAPTURE");
});

test("Ctrl+Shift+Enter commits exactly like Enter", async () => {
  const modal = openPicker();
  const promise = modal.waitForChoice();
  pressKey(modal, "Enter", { ctrlKey: true, shiftKey: true });
  assert.deepEqual(await promise, {
    kind: "existing",
    entryLine: 1,
    entryText: "- [ ] (09:20-09:50) — CAPTURE",
    title: "CAPTURE",
  });
});

test("Escape and Ctrl+[ cancel with no choice; settle-once holds", async () => {
  const modal = openPicker();
  assert.equal(modal.plugin, undefined);
  const promise = modal.waitForChoice();
  pressKey(modal, "Escape");
  assert.equal(await promise, null);

  const bracket = openPicker();
  const bracketPromise = bracket.waitForChoice();
  pressKey(bracket, "[", { ctrlKey: true });
  assert.equal(await bracketPromise, null);

  const once = openPicker();
  const oncePromise = once.waitForChoice();
  pressKey(once, "Enter");
  const first = await oncePromise;
  pressKey(once, "Enter");
  once.close();
  assert.deepEqual(await oncePromise, first);
  assert.deepEqual(oncePromise, once.waitForChoice());
});
