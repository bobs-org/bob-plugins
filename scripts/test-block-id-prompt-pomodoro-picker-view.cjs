// View tests for the Pomodoro link picker modal ("Link to today"). Loads
// the built plugin with modal-harness.cjs's ModalStub/ElementStub (the
// navigation-hotkeys-harness.cjs loader pattern); block-id-prompt-harness.cjs
// stays on its stub Modal.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Module = require("node:module");

const {
  ElementStub,
  ModalStub,
  click,
  pressKey,
} = require("./modal-harness.cjs");

global.window = global.window || { setTimeout: (callback) => callback() };

const iconCalls = [];
const noticeMessages = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal extends ModalStub {}
    class TestNotice {
      constructor(message) {
        noticeMessages.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: TestNotice,
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
    themesApi = null,
  } = options;
  const model = helpers.buildPomodoroLinkPickerModel(daily, { now });
  assert.equal(model.ok, true);
  const modal = new helpers.PomodoroLinkPickerModal(
    themesApi
      ? { plugins: { plugins: { "bob-ledger-tools": { api: { themes: themesApi } } } } }
      : {},
    { model, task, needsBlockId, now, budget },
  );
  modal.open();
  return modal;
}

function createThemesApi(initialThemes) {
  const themes = initialThemes.map((theme) => ({ ...theme }));
  const hidden = new Set(themes.filter((theme) => theme.hidden).map((theme) => theme.key));
  const listeners = new Set();
  const writes = [];
  const notify = () => listeners.forEach((listener) => listener({ reason: "test" }));
  const api = {
    version: 1,
    available: () => ({ available: true }),
    fetch: () => Promise.resolve({ report: { themes }, stale: false, error: null }),
    snapshot: () => ({ themes: themes.map((theme) => ({ ...theme, hidden: hidden.has(theme.key) })) }),
    componentsOf: (name) => String(name || "").split("+").map((raw) => raw.trim()).filter(Boolean).map((raw) => ({ raw, key: raw.toLowerCase().replace(/\s+/g, " ") })),
    historyRows: ({ query = "", limit = 5, exclusions = new Set() } = {}) => {
      const needle = String(query).trim().toLowerCase();
      return themes
        .filter((theme) => !hidden.has(theme.key) && !exclusions.has(theme.key))
        .filter((theme) => !needle || theme.name.toLowerCase().includes(needle))
        .sort((left, right) => right.last_used.localeCompare(left.last_used))
        .slice(0, limit);
    },
    hueFor: (key) => ({ hue: String(key).startsWith("focus") ? "aqua" : "blue", hue_source: "test" }),
    similarTo: (name) => String(name).toLowerCase().startsWith("fix") ? ["FIXES"] : [],
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    hide: (name) => {
      writes.push(["hide", name]);
      const theme = themes.find((row) => row.name === name);
      if (theme) hidden.add(theme.key);
      notify();
      return Promise.resolve({ ok: true });
    },
    unhide: (name) => {
      writes.push(["unhide", name]);
      const theme = themes.find((row) => row.name === name);
      if (theme) hidden.delete(theme.key);
      notify();
      return Promise.resolve({ ok: true });
    },
    isHidden: (name) => {
      const theme = themes.find((row) => row.name === name);
      return Boolean(theme && hidden.has(theme.key));
    },
    writes,
  };
  return api;
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

test("recent theme rows follow today's rows and render component swatches", () => {
  const themesApi = createThemesApi([
    { key: "focus flow", name: "Focus flow", last_used: "2026-08-14", days_used: 4 },
  ]);
  const modal = openPicker({ themesApi });
  assert.deepEqual(rowTitles(modal), [
    "CAPTURE",
    "LATER",
    "New Pomodoro Focus flow",
  ]);
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  assert.ok(rows[0].classes.includes("is-existing"));
  assert.ok(rows[2].classes.includes("is-recent"));
  assert.ok(findByClass(rows[2], "bid-ppk-theme-swatch").classes.includes("is-aqua"));
  modal.close();
});

test("exact recent themes suppress generic creation and preserve catalog spelling", async () => {
  const themesApi = createThemesApi([
    { key: "focus flow", name: "Focus flow", last_used: "2026-08-14", days_used: 4 },
  ]);
  const modal = openPicker({ themesApi });
  type(modal, "focus flow");
  assert.deepEqual(rowTitles(modal), ["New Pomodoro Focus flow"]);
  assert.ok(findAllByClass(modal.contentEl, "bid-ppk-row")[0].classes.includes("is-recent"));

  const choicePromise = modal.waitForChoice();
  pressKey(modal, "Enter", { shiftKey: true });
  assert.deepEqual(await choicePromise, {
    kind: "new",
    name: "Focus flow",
    preserveSpelling: true,
  });
});

test("Ctrl+D hides a Recent suggestion as an undoable ghost and leaves Today unchanged", async () => {
  const themesApi = createThemesApi([
    { key: "focus flow", name: "Focus flow", last_used: "2026-08-14", days_used: 4 },
  ]);
  const modal = openPicker({ themesApi });
  const todayKeyEvent = pressKey(modal, "d", { ctrlKey: true });
  assert.equal(todayKeyEvent.defaultPrevented, true);
  assert.deepEqual(themesApi.writes, []);

  modal.moveSelection(1);
  modal.moveSelection(1);
  assert.equal(modal.rows[modal.selectedIndex].kind, "recent");
  pressKey(modal, "d", { ctrlKey: true });
  await tick();
  assert.equal(themesApi.isHidden("Focus flow"), true);
  const hiddenIndex = modal.rows.findIndex((row) => row.kind === "recent" && row.hidden);
  assert.notEqual(hiddenIndex, -1);
  assert.equal(modal.selectedIndex, hiddenIndex);
  modal.selectedIndex = hiddenIndex;

  pressKey(modal, "d", { ctrlKey: true });
  await tick();
  assert.equal(themesApi.isHidden("Focus flow"), false);
  assert.equal(modal.rows.some((row) => row.kind === "recent" && row.hidden), false);
  modal.close();
});

test("new-name rows show near-duplicate and hidden-theme hints", async () => {
  const themesApi = createThemesApi([
    { key: "fixes", name: "FIXES", last_used: "2026-08-14", days_used: 4, hidden: true },
  ]);
  const modal = openPicker({ themesApi });
  type(modal, "fix");
  const create = findAllByClass(modal.contentEl, "bid-ppk-row").find((row) =>
    row.classes.includes("is-new"),
  );
  assert.ok(create);
  assert.match(textOf(create), /like FIXES/);
  assert.equal(modal.rows[modal.selectedIndex].kind, "new");

  // The hidden exact name is offered on an otherwise normal create row.
  type(modal, "fixes");
  const candidateIndex = modal.rows.findIndex((row) => row.kind === "new");
  assert.notEqual(candidateIndex, -1);
  const candidate = findAllByClass(modal.contentEl, "bid-ppk-row").find((row) =>
    row.classes.includes("is-new"),
  );
  assert.match(textOf(candidate), /Hidden/);
  modal.selectedIndex = candidateIndex;
  pressKey(modal, "d", { ctrlKey: true });
  await tick();
  assert.equal(themesApi.isHidden("FIXES"), false);
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

test("done-today themes stay in Recent while open Today themes stay excluded", () => {
  const themesApi = createThemesApi([
    { key: "done", name: "DONE", last_used: "2026-08-15", days_used: 2 },
    { key: "capture", name: "CAPTURE", last_used: "2026-08-14", days_used: 4 },
  ]);
  const modal = openPicker({ themesApi });
  assert.deepEqual(rowTitles(modal), ["CAPTURE", "LATER", "New Pomodoro DONE"]);
  assert.ok(
    !modal.rows.some(
      (row) => row.kind === "recent" && row.theme && row.theme.key === "capture",
    ),
  );
  modal.close();
});

test("configured theme menu vectors scope Recent, preserve config order, and flag new names", () => {
  const vectors = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/pomodoro_themes/vectors.json"),
      "utf8",
    ),
  ).menu.filter((item) => Array.isArray(item.configured));
  assert.equal(vectors.length, 3);
  for (const item of vectors) {
    const configured = item.configured.map((theme) => ({
      key: theme.name.toLowerCase(),
      name: theme.name,
      color: theme.color === "auto" ? null : theme.color,
    }));
    const hidden = new Set((item.hidden || []).map((name) => name.toLowerCase()));
    const used = [];
    for (const [date, names] of Object.entries(item.history || {})) {
      for (const name of names) {
        const key = name.toLowerCase();
        const prior = used.find((theme) => theme.key === key);
        if (prior) {
          prior.last_used = date;
        } else {
          used.push({ key, name, last_used: date, days_used: 1, hidden: hidden.has(key) });
        }
      }
    }
    const rows = configured.map((theme) => {
      const known = used.find((row) => row.key === theme.key);
      return known
        ? { ...known, configured: true }
        : {
            ...theme,
            hue: theme.color,
            hue_source: theme.color ? "config" : "hash",
            configured: true,
            last_used: "",
            days_used: 0,
            hidden: hidden.has(theme.key),
          };
    });
    const themesApi = {
      version: 1,
      available: () => ({ available: true }),
      snapshot: () => ({ themes: rows, configured_themes: configured }),
      isConfigured: (key) => configured.some((theme) => theme.key === key),
      componentsOf: (name) => String(name || "").split("+").map((raw) => raw.trim()).filter(Boolean).map((raw) => ({ raw, key: raw.toLowerCase().replace(/\s+/g, " ") })),
      historyRows: ({ exclusions = new Set() } = {}) => rows
        .filter((theme) => !theme.hidden && !exclusions.has(theme.key)),
      similarTo: () => ["BUILD", "SNACK"],
      hueFor: (key) => ({ hue: key === "build" ? "yellow" : "violet", hue_source: "config" }),
    };
    const query = item.draft.slice(2).trim();
    const baseRows = query
      ? [{ kind: "new", key: `new-${query}`, name: query.toUpperCase(), selectable: true }]
      : [];
    const result = helpers.withPomodoroThemeHistoryRows(
      { creation: { allowed: true }, entries: [], allEntries: [] },
      query,
      baseRows,
      0,
      { themesApi },
    );
    const actual = result.rows.map((row) => row.kind === "recent"
      ? { name: row.name, replacement: row.theme.key, origin: "history" }
      : { name: row.name, replacement: row.name.toLowerCase(), creates_pomodoro: true });
    assert.deepEqual(actual, item.expected, item.name);
    if (item.name === "configured-unconfigured-create-row") {
      const create = result.rows.find((row) => row.kind === "new");
      assert.equal(create.unconfigured, true);
      assert.deepEqual(create.similarTo, ["BUILD"]);
    }
  }
});

test("configured empty-query picker shows up to twelve configured themes", () => {
  const configured = Array.from({ length: 14 }, (_, index) => ({
    key: `theme${index}`,
    name: `THEME${index}`,
    color: null,
  }));
  const themesApi = {
    version: 1,
    available: () => ({ available: true }),
    snapshot: () => ({ themes: configured, configured_themes: configured }),
    isConfigured: () => true,
    componentsOf: (name) => [{ raw: name, key: name.toLowerCase() }],
    historyRows: () => configured,
    similarTo: () => [],
    hueFor: () => ({ hue: null, hue_source: "hash" }),
  };
  const result = helpers.withPomodoroThemeHistoryRows(
    { creation: { allowed: true }, entries: [], allEntries: [] },
    "",
    [],
    -1,
    { themesApi },
  );
  assert.equal(result.rows.filter((row) => row.kind === "recent").length, 12);
});

test("link success notice names an unconfigured theme after creating its Pomodoro", () => {
  const plugin = new Plugin();
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            themes: {
              version: 1,
              snapshot: () => ({
                configured_themes: [{ key: "build", name: "BUILD", color: "yellow" }],
                themes: [],
              }),
              isConfigured: (key) => key === "build",
              componentsOf: (name) => String(name || "").split("+").map((raw) => ({ raw: raw.trim(), key: raw.trim().toLowerCase() })),
            },
          },
        },
      },
    },
  };
  plugin.futureLinkCleanupNoticeSuffix = () => "";
  plugin.planBudgetNoticeSuffix = () => "";
  const notice = plugin.formatPomodoroLinkOutcome(
    { statusChanged: true, newStatus: " " },
    { destination: { kind: "created", name: "SNACK" }, removedCount: 0, content: "" },
  );
  assert.equal(
    notice,
    "Linked to new SNACK · Next · SNACK isn't one of your themes",
  );
});

test("typing done shows only the Recent DONE row and keeps catalog spelling", async () => {
  const themesApi = createThemesApi([
    { key: "done", name: "DONE", last_used: "2026-08-15", days_used: 2 },
    { key: "capture", name: "CAPTURE", last_used: "2026-08-14", days_used: 4 },
  ]);
  const modal = openPicker({ themesApi });
  type(modal, "done");
  assert.deepEqual(rowTitles(modal), ["New Pomodoro DONE"]);
  assert.equal(modal.rows.length, 1);
  assert.equal(modal.rows[0].kind, "recent");

  const choicePromise = modal.waitForChoice();
  pressKey(modal, "Enter", { shiftKey: true });
  assert.deepEqual(await choicePromise, {
    kind: "new",
    name: "DONE",
    preserveSpelling: true,
  });
});

test("Today exclusions apply before query filtering; cancelled themes stay Recent", () => {
  const seen = {};
  const base = createThemesApi([
    { key: "done", name: "DONE", last_used: "2026-08-15", days_used: 2 },
    { key: "capture", name: "CAPTURE", last_used: "2026-08-14", days_used: 4 },
  ]);
  const themesApi = {
    ...base,
    historyRows: (options = {}) => {
      seen[String(options.query || "")] = new Set(options.exclusions || []);
      return base.historyRows(options);
    },
  };
  const modal = openPicker({ themesApi });
  type(modal, "later");
  assert.ok(seen.later.has("capture"), "open CAPTURE stays excluded when filtered out");
  assert.ok(!seen.later.has("done"), "done DONE never enters the exclusion set");
  assert.ok(
    !modal.rows.some(
      (row) => row.kind === "recent" && row.theme && row.theme.key === "capture",
    ),
  );
  modal.close();

  const cancelled = openPicker({
    daily: ["## Pomodoros", "- [ ] () — HERE", "- [-] () — GONE"].join("\n"),
    themesApi: createThemesApi([
      { key: "gone", name: "GONE", last_used: "2026-08-15", days_used: 1 },
      { key: "here", name: "HERE", last_used: "2026-08-14", days_used: 3 },
    ]),
  });
  assert.deepEqual(rowTitles(cancelled), ["HERE", "New Pomodoro GONE"]);
  cancelled.close();
});
