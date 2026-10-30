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
    lineText = null,
    themeSnapshot = null,
  } = options;
  const model = helpers.buildPomodoroLinkPickerModel(daily, { now });
  assert.equal(model.ok, true);
  if (themeSnapshot) {
    model.themeSnapshot = themeSnapshot;
    model.themeSuggestion = themeSnapshot.suggestion;
  }
  const modal = new helpers.PomodoroLinkPickerModal(
    themesApi
      ? { plugins: { plugins: { "bob-ledger-tools": { api: { themes: themesApi } } } } }
      : {},
    {
      model,
      task: lineText === null ? task : { ...task, lineText },
      needsBlockId,
      now,
      budget,
    },
  );
  modal.open();
  return modal;
}

// A canned Ledger Tools field/parser pair mirroring the real pure rule closely
// enough to exercise the footer's wiring: single non-exempt destination
// components set, matching inherited defaults clear, anything else is none.
function stubTaskThemeOf(lineText) {
  const fields = [...String(lineText || "").matchAll(/\[(?:theme|type)::\s*([^\]]*)\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (fields.length === 0) {
    return { state: "none" };
  }
  if (fields.length > 1) {
    return { state: "repair", repair: "duplicate" };
  }
  return { state: "set", value: fields[0].toUpperCase(), key: fields[0].toLowerCase() };
}

function suggestionKeyOf(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() || null;
  }
  const theme = value.theme && typeof value.theme === "object" ? value.theme : value;
  const key = theme && typeof theme.key === "string" ? theme.key.trim().toLowerCase() : "";
  return key || null;
}

function suggestionNameOf(value) {
  if (typeof value === "string") {
    return value.trim().toUpperCase();
  }
  const theme = value && value.theme && typeof value.theme === "object" ? value.theme : value;
  if (theme && typeof theme.name === "string" && theme.name) {
    return theme.name;
  }
  const key = suggestionKeyOf(value);
  return key ? key.toUpperCase() : "";
}

function stubPlanRetype(options = {}) {
  const destination = String(options.destination || options.destinationName || "");
  const parts = destination.split("+").map((part) => part.trim()).filter(Boolean);
  const typeParts = parts.filter((part) => part.toLowerCase() !== "later");
  if (typeParts.length === 0) {
    return { kind: "container" };
  }
  const effectiveKey = suggestionKeyOf(options.effective || options.suggestion);
  const destKeys = parts.map((part) => part.toLowerCase());
  if (effectiveKey && destKeys.includes(effectiveKey)) {
    return { kind: "consistent" };
  }
  if (options.keepType === true) {
    return {
      kind: "merge",
      name: `${destination.trim()} + ${suggestionNameOf(options.effective || options.suggestion)}`,
    };
  }
  let chosen = null;
  if (options.tabPick) {
    const want = String(options.tabPick).trim().toLowerCase();
    chosen = typeParts.find((part) => part.toLowerCase() === want) || null;
  }
  if (!chosen) {
    const exempt = new Set(
      (Array.isArray(options.exemptKeys) ? options.exemptKeys : ["PLAN"])
        .map((key) => String(key).trim().toLowerCase()),
    );
    chosen = typeParts.find((part) => !exempt.has(part.toLowerCase())) || typeParts[0];
  }
  const inherited = options.inherited;
  const inheritedKey = suggestionKeyOf(
    inherited && inherited.source === "task" ? inherited.inherited : inherited,
  );
  if (inheritedKey && inheritedKey === chosen.toLowerCase()) {
    return { kind: "clear" };
  }
  return { kind: "set", name: chosen.toUpperCase(), key: chosen.toLowerCase() };
}

function stubTypeComponentsOf(name) {
  return String(name || "")
    .split("+")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((component) => ({
      name: component,
      key: component.toLowerCase(),
      isType: component.toLowerCase() !== "later",
    }));
}

function createThemesApi(initialThemes, extra = {}) {
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
    planRetype: stubPlanRetype,
    typeComponentsOf: stubTypeComponentsOf,
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
  return Object.assign(api, extra);
}

// Build the task-aware snapshot the entry points attach: suggestion, choice,
// and the detached inputs the preselection helper consumed.
function makeThemeSnapshot(model, { suggestion, choice, exemptKeys = ["PLAN"] }) {
  return {
    semanticSuggestion: JSON.parse(JSON.stringify(suggestion)),
    suggestion,
    choice,
    entries: model.entries.map((entry) => ({
      name: entry.name || null,
      open: true,
      running: entry.running === true,
      entryLine: entry.entryLine,
      componentKeys: String(entry.name || "")
        .split("+")
        .map((raw) => raw.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean),
    })),
    exemptKeys,
    strict: false,
    maxThemes: 3,
    planMeter: { themes: { count: 1, cap: 3, over: false } },
    ledgerKeys: ["capture", "later"],
  };
}

function noteSuggestion() {
  return {
    theme: { key: "write", name: "WRITE", known: true, hue: "violet", hue_source: "hash" },
    source: "note",
    label: "from sase_blog",
    from: {
      path: "Areas/sase_blog.md",
      stem: "sase_blog",
      kind: "area",
      chain: ["Areas/sase_blog.md"],
      hue: "aqua",
    },
  };
}

function taskFieldSuggestion(name, inherited = noteSuggestion()) {
  return {
    theme: { key: name.toLowerCase(), name, known: true, hue: "orange", hue_source: "hash" },
    source: "task",
    inherited,
  };
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
  assert.equal(textOf(findByClass(create, "bid-ppk-theme")), "+1 type");
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
  assert.equal(textOf(theme), "+1 type · 4/3");
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
  assert.equal(textOf(findByClass(plain.contentEl, "bid-ppk-theme")), "+1 type");
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
    "Linked under SNACK · Next · SNACK isn't one of your types",
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

function footerText(modal) {
  const footer = findByClass(modal.contentEl, "bid-ppk-theme-footer");
  assert.ok(footer, "the theme footer line exists");
  return { footer, text: textOf(footer), hidden: footer.style.display === "none" };
}

function openSuggestedEntryPicker({ suggestion = noteSuggestion(), lineText = "- [*] #task Ship it", themes = [], extra = {} } = {}) {
  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion,
    choice: { kind: "entry", index: 0 },
  });
  const themesApi = createThemesApi(themes, {
    taskThemeOf: stubTaskThemeOf,
    planRetype: stubPlanRetype,
    typeComponentsOf: stubTypeComponentsOf,
    ...extra,
  });
  return openPicker({ themesApi, lineText, themeSnapshot: snapshot });
}

test("suggested entry rows render the reason, dot, theme pill, and accessible label", () => {
  const modal = openSuggestedEntryPicker({
    extra: { hueFor: (key) => ({ hue: key === "write" ? "violet" : "blue", hue_source: "test" }) },
  });
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  const reason = findByClass(rows[0], "bid-ppk-suggest");
  assert.ok(reason, "the suggested row carries a reason line");
  assert.equal(reason.getAttribute("role"), "note");
  assert.match(textOf(reason), /Suggested · from /);
  assert.match(textOf(reason), /sase_blog/);
  assert.match(textOf(reason), /WRITE/);
  const dot = findAllByClass(reason, "bid-ppk-theme-swatch").find((swatch) =>
    swatch.classes.includes("is-aqua"),
  );
  assert.ok(dot, "the place dot carries the from.hue tint token");
  const pill = findAllByClass(reason, "bid-ppk-pill").find((candidate) =>
    candidate.classes.includes("is-suggested-theme"),
  );
  assert.ok(pill, "the suggested theme renders as a pill");
  assert.match(textOf(pill), /WRITE/);
  assert.ok(
    findAllByClass(pill, "bid-ppk-theme-swatch").some((swatch) => swatch.classes.includes("is-violet")),
    "the theme pill carries the theme hue token",
  );
  assert.match(
    rows[0].getAttribute("aria-label"),
    /suggested, from sase_blog/,
    "color is never the only cue",
  );
  modal.close();
});

test("reading and note suggestions render their own reasons and footer phrases", () => {
  const reading = {
    theme: { key: "read", name: "READ", known: true, hue: "blue", hue_source: "hash" },
    source: "reading",
    label: "reading task",
  };
  const modal = openSuggestedEntryPicker({ suggestion: reading });
  const rows = findAllByClass(modal.contentEl, "bid-ppk-row");
  const reason = findByClass(rows[0], "bid-ppk-suggest");
  assert.ok(reason);
  assert.match(textOf(reason), /Suggested · reading task/);
  assert.match(rows[0].getAttribute("aria-label"), /suggested, reading task/);
  modal.close();

  const note = {
    theme: { key: "plan", name: "PLAN", known: true, hue: "green", hue_source: "hash" },
    source: "note",
    label: "from gtd_daily",
    from: { path: "gtd_daily.md", stem: "gtd_daily", kind: "area", hue: "orange" },
  };
  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, { suggestion: note, choice: { kind: "entry", index: 0 } });
  const themesApi = createThemesApi([], { taskThemeOf: stubTaskThemeOf, planRetype: stubPlanRetype });
  const noteModal = openPicker({ themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  const noteRows = findAllByClass(noteModal.contentEl, "bid-ppk-row");
  assert.match(textOf(findByClass(noteRows[0], "bid-ppk-suggest")), /Suggested · from\s+.*gtd_daily/);
  assert.match(noteRows[0].getAttribute("aria-label"), /suggested, from gtd_daily/);
  noteModal.close();
});

test("footer previews the pending set and clear with the suggestion source", () => {
  const modal = openSuggestedEntryPicker();
  type(modal, "capture");
  const shown = footerText(modal);
  assert.equal(shown.hidden, false);
  assert.equal(
    shown.text,
    "→ CAPTURE · task becomes CAPTURE · sase_blog suggests WRITE · ⌥↵ keep WRITE (CAPTURE + WRITE)",
  );
  modal.close();

  const clearModal = openSuggestedEntryPicker({
    suggestion: taskFieldSuggestion("FIX"),
    lineText: "- [*] #task Ship it [type:: FIX]",
  });
  type(clearModal, "write");
  const cleared = footerText(clearModal);
  assert.equal(cleared.hidden, false);
  assert.equal(
    cleared.text,
    "→ WRITE · type cleared · from sase_blog · ⌥↵ keep FIX (WRITE + FIX)",
  );
  clearModal.close();
});

test("footer hides without task context or theme APIs", () => {
  const plain = openPicker();
  assert.equal(footerText(plain).hidden, true);
  assert.equal(footerText(plain).text, "");
  plain.close();

  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion(),
    choice: { kind: "entry", index: 0 },
  });
  const noApis = openPicker({ lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  assert.equal(footerText(noApis).hidden, true);
  noApis.close();
});

test("footer states a keep consequence when the destination already agrees", () => {
  const settled = openSuggestedEntryPicker({
    suggestion: taskFieldSuggestion("CAPTURE"),
    lineText: "- [*] #task Ship it [type:: CAPTURE]",
  });
  type(settled, "capture");
  const shown = footerText(settled);
  assert.equal(shown.hidden, false);
  assert.equal(shown.text, "→ CAPTURE · keeps CAPTURE");
  settled.close();
});

test("footer previews PLAN, LATER, and Tab cycling on a composite", () => {
  const later = openSuggestedEntryPicker();
  type(later, "later");
  assert.equal(footerText(later).hidden, false);
  assert.equal(footerText(later).text, "→ LATER · keeps WRITE");
  later.close();

  const planDaily = ["## Pomodoros", "- [ ] () — PLAN + FIX", "- [ ] () — LATER"].join("\n");
  const planProbe = helpers.buildPomodoroLinkPickerModel(planDaily, { now: NOW });
  const planSnapshot = makeThemeSnapshot(planProbe, {
    suggestion: noteSuggestion(),
    choice: { kind: "entry", index: 0 },
  });
  const planModal = openPicker({
    daily: planDaily,
    themesApi: createThemesApi([], {
      taskThemeOf: stubTaskThemeOf,
      planRetype: stubPlanRetype,
      typeComponentsOf: stubTypeComponentsOf,
    }),
    lineText: "- [*] #task Ship it",
    themeSnapshot: planSnapshot,
  });
  assert.equal(selectedTitle(planModal), "PLAN + FIX");
  assert.equal(
    footerText(planModal).text,
    "→ FIX · task becomes FIX · sase_blog suggests WRITE · ⌥↵ keep WRITE (PLAN + FIX + WRITE) · ⇥ PLAN",
  );
  pressKey(planModal, "Tab");
  assert.equal(planModal.tabPickKey, "plan");
  assert.equal(
    footerText(planModal).text,
    "→ PLAN · task becomes PLAN · sase_blog suggests WRITE · ⌥↵ keep WRITE (PLAN + FIX + WRITE) · ⇥ FIX",
  );
  planModal.close();

  const compositeDaily = ["## Pomodoros", "- [ ] () — FIX + BUILD", "- [ ] () — LATER"].join("\n");
  const compositeProbe = helpers.buildPomodoroLinkPickerModel(compositeDaily, { now: NOW });
  const compositeSnapshot = makeThemeSnapshot(compositeProbe, {
    suggestion: noteSuggestion(),
    choice: { kind: "entry", index: 0 },
  });
  const composite = openPicker({
    daily: compositeDaily,
    themesApi: createThemesApi([], {
      taskThemeOf: stubTaskThemeOf,
      planRetype: stubPlanRetype,
      typeComponentsOf: stubTypeComponentsOf,
    }),
    lineText: "- [*] #task Ship it",
    themeSnapshot: compositeSnapshot,
  });
  assert.equal(selectedTitle(composite), "FIX + BUILD");
  assert.equal(
    footerText(composite).text,
    "→ FIX · task becomes FIX · sase_blog suggests WRITE · ⌥↵ keep WRITE (FIX + BUILD + WRITE) · ⇥ BUILD",
  );
  pressKey(composite, "Tab");
  assert.equal(composite.tabPickKey, "build");
  assert.equal(
    footerText(composite).text,
    "→ BUILD · task becomes BUILD · sase_blog suggests WRITE · ⌥↵ keep WRITE (FIX + BUILD + WRITE) · ⇥ FIX",
  );
  composite.close();
});

test("footer refreshes on selection moves and hides on inert rows", async () => {
  const modal = openSuggestedEntryPicker();
  type(modal, "capture");
  assert.equal(footerText(modal).hidden, false);
  modal.moveSelection(1);
  // Only one row matches "capture": the move wraps to the same row.
  assert.equal(selectedTitle(modal), "CAPTURE");
  type(modal, "!!!");
  assert.equal(footerText(modal).hidden, true, "invalid rows have no destination");
  modal.close();
});

test("untouched refresh preserves a still-eligible suggested entry; arrivals adopt a first default", async () => {
  const modal = openSuggestedEntryPicker({
    suggestion: {
      ...noteSuggestion(),
      theme: { key: "capture", name: "CAPTURE", known: true },
    },
    themes: [{ key: "write", name: "WRITE", last_used: "2026-08-15", days_used: 2 }],
  });
  const firstKey = modal.rows[modal.selectedIndex].key;
  assert.equal(modal.initialKey, firstKey);
  assert.equal(modal.interacted, false);

  // A catalog arrival that keeps the settled row moves nothing.
  await modal.themesApi.hide("WRITE");
  await tick();
  assert.equal(modal.interacted, false);
  assert.equal(modal.rows[modal.selectedIndex].key, firstKey);
  assert.equal(modal.initialKey, firstKey, "an unchanged eligible default keeps its key");
  modal.close();

  // An empty picker that gains its first rows adopts them as the default.
  const emptyDaily = ["## Pomodoros", "- [x] () — DONE"].join("\n");
  let catalog = [];
  let emit = null;
  const api = createThemesApi([], { taskThemeOf: stubTaskThemeOf, planRetype: stubPlanRetype });
  api.historyRows = ({ query = "", limit = 5, exclusions = new Set() } = {}) => {
    const needle = String(query).trim().toLowerCase();
    return catalog
      .filter((theme) => !exclusions.has(theme.key))
      .filter((theme) => !needle || theme.name.toLowerCase().includes(needle))
      .slice(0, limit);
  };
  api.onChange = (listener) => {
    emit = listener;
    return () => {};
  };
  const empty = openPicker({ daily: emptyDaily, themesApi: api, lineText: "- [*] #task Ship it" });
  assert.equal(empty.selectedIndex, -1);
  assert.equal(empty.initialKey, null);
  assert.equal(empty.interacted, false);
  catalog = [{ key: "write", name: "WRITE", last_used: "2026-08-15", days_used: 2 }];
  emit({ reason: "test" });
  assert.equal(empty.rows.length, 1);
  assert.equal(empty.rows[0].kind, "recent");
  assert.equal(empty.selectedIndex, 0, "the arrival becomes the untouched default");
  assert.equal(empty.initialKey, empty.rows[0].key);
  assert.equal(empty.interacted, false);
  empty.close();
});

test("refresh after typing preserves the user's position and initial key", async () => {
  const modal = openSuggestedEntryPicker({
    themes: [
      { key: "write", name: "WRITE", last_used: "2026-08-15", days_used: 2 },
      { key: "other", name: "OTHER", last_used: "2026-08-14", days_used: 1 },
    ],
  });
  const initialKey = modal.initialKey;
  type(modal, "other");
  assert.equal(modal.interacted, true);
  assert.equal(selectedTitle(modal), "New Pomodoro OTHER");
  const userKey = modal.rows[modal.selectedIndex].key;

  await modal.themesApi.hide("WRITE");
  await tick();
  assert.equal(modal.rows[modal.selectedIndex].key, userKey, "refresh keeps the user's row");
  assert.equal(modal.initialKey, initialKey, "the initial key does not follow refreshes");
  const choicePromise = modal.waitForChoice();
  pressKey(modal, "Enter");
  const choice = await choicePromise;
  assert.equal(choice.themeIntent.deliberate, true, "a typed query is deliberate");
  assert.equal(choice.themeIntent.linkOnce, false);
});

test("removed rows fall back deterministically without clearing interaction", async () => {
  const modal = openSuggestedEntryPicker({
    themes: [{ key: "write", name: "WRITE", last_used: "2026-08-15", days_used: 2 }],
  });
  modal.moveSelection(2);
  assert.equal(modal.rows[modal.selectedIndex].kind, "recent");
  assert.equal(modal.interacted, true);

  await modal.themesApi.hide("WRITE");
  await tick();
  assert.equal(modal.interacted, true, "a refresh never clears interaction state");
  assert.notEqual(modal.rows[modal.selectedIndex].kind, "recent");
  assert.equal(modal.selectedIndex, modal.rows.findIndex((row) => row.selectable));
  modal.close();
});

test("clearing a query keeps interaction but returning home is not deliberate", async () => {
  const modal = openSuggestedEntryPicker();
  const homeKey = modal.initialKey;
  type(modal, "later");
  assert.equal(modal.interacted, true);
  type(modal, "");
  assert.equal(modal.interacted, true, "clearing never erases interaction");
  assert.equal(modal.rows[modal.selectedIndex].key, homeKey, "PT7 restores the default row");
  const promise = modal.waitForChoice();
  pressKey(modal, "Enter");
  const choice = await promise;
  assert.equal(choice.themeIntent.deliberate, false, "home with empty query is not deliberate");
  assert.deepEqual(choice.themeIntent.shown, noteSuggestion());
});

test("suggestion never recomputes on refresh and survives API changes", async () => {
  let suggestCalls = 0;
  const themesApi = createThemesApi(
    [{ key: "write", name: "WRITE", last_used: "2026-08-15", days_used: 2 }],
    {
      taskThemeOf: stubTaskThemeOf,
      planRetype: stubPlanRetype,
      suggestFor: () => {
        suggestCalls += 1;
        throw new Error("suggestFor must not run on refresh");
      },
    },
  );
  const modal = openSuggestedEntryPicker({ themesApi, themes: [] });
  // openSuggestedEntryPicker builds its own api; swap in the spy instead.
  modal.close();
  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion(),
    choice: { kind: "entry", index: 0 },
  });
  const spied = openPicker({ themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  const presented = JSON.parse(JSON.stringify(spied.shownSuggestion));
  type(spied, "later");
  await spied.themesApi.hide("WRITE");
  await tick();
  assert.equal(suggestCalls, 0);
  assert.deepEqual(spied.shownSuggestion, presented, "shown is preserved independently");
  spied.close();
});

test("deferred fetch makes an unknown suggestion eligible and settles the untouched default", async () => {
  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const unknown = noteSuggestion({
    theme: { key: "write", name: "WRITE", known: false },
  });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: unknown,
    choice: { kind: "fallback", code: "unknown_theme" },
  });
  let catalog = [];
  let fetchResolve = null;
  let onChange = null;
  let known = false;
  let suggestCalls = 0;
  const themesApi = createThemesApi([], {
    taskThemeOf: stubTaskThemeOf,
    planRetype: stubPlanRetype,
    suggestFor: () => {
      suggestCalls += 1;
      return noteSuggestion();
    },
    isKnownTheme: (key) => key === "write" && known,
    fetch: () => new Promise((resolve) => {
      fetchResolve = resolve;
    }),
    onChange: (listener) => {
      onChange = listener;
      return () => {};
    },
  });
  themesApi.historyRows = ({ query = "", limit = 5, exclusions = new Set() } = {}) => {
    const needle = String(query).trim().toLowerCase();
    return catalog
      .filter((theme) => !exclusions.has(theme.key))
      .filter((theme) => !needle || theme.name.toLowerCase().includes(needle))
      .slice(0, limit);
  };
  themesApi.snapshot = () => ({ themes: catalog });
  const model = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  model.themeSnapshot = snapshot;
  model.themeSuggestion = snapshot.suggestion;
  const modal = new helpers.PomodoroLinkPickerModal(
    { plugins: { plugins: { "bob-ledger-tools": { api: { themes: themesApi } } } } },
    { model, task: { displayText: "Ship it", status: " ", lineText: "- [*] #task Ship it" }, now: NOW, budget: null },
  );
  modal.open();
  assert.equal(modal.rows[modal.selectedIndex].entry.name, "CAPTURE");
  const initialKey = modal.initialKey;
  assert.equal(modal.interacted, false);
  assert.equal(modal.rows.some((row) => row.suggestedCreate), false);
  catalog = [{ key: "write", name: "Write", last_used: "2026-08-15", days_used: 2 }];
  known = true;
  fetchResolve({ report: { themes: catalog }, stale: false, error: null });
  await tick();
  await tick();
  assert.equal(modal.rows[0].kind, "new");
  assert.equal(modal.rows[0].name, "Write", "the refreshed catalog spelling is shown");
  assert.equal(modal.rows[0].preserveSpelling, true);
  assert.equal(modal.rows.some((row) => row.kind === "recent" && row.theme.key === "write"), false);
  assert.deepEqual(
    modal.rows.filter((row) => row.kind === "existing").map((row) => row.entry.name),
    ["CAPTURE", "LATER"],
    "Today rows retain ledger order behind the suggested row",
  );
  assert.equal(modal.rows[modal.selectedIndex].name, "Write");
  assert.notEqual(modal.initialKey, initialKey);
  assert.equal(modal.initialKey, modal.rows[modal.selectedIndex].key);
  assert.equal(modal.interacted, false);
  const promise = modal.waitForChoice();
  pressKey(modal, "Enter");
  const choice = await promise;
  assert.deepEqual(choice, {
    kind: "new",
    name: "Write",
    preserveSpelling: true,
    themeIntent: { deliberate: false, linkOnce: false, shown: modal.shownSuggestion },
  });
  assert.equal(suggestCalls, 0, "refresh does not rerun task suggestion resolution");
  const rowsAfterClose = modal.rows;
  onChange({ reason: "late" });
  await tick();
  assert.equal(modal.rows, rowsAfterClose, "a late change callback after close is ignored");
});

test("onChange adopts a newly eligible existing match only before interaction", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "- [ ] () — WRITE",
    "- [ ] () — LATER",
  ].join("\n");
  const probe = helpers.buildPomodoroLinkPickerModel(daily, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion({ theme: { key: "write", name: "WRITE", known: false } }),
    choice: { kind: "fallback", code: "unknown_theme" },
  });
  let known = false;
  let catalog = [];
  let emit = null;
  const themesApi = createThemesApi([], {
    taskThemeOf: stubTaskThemeOf,
    planRetype: stubPlanRetype,
    isKnownTheme: (key) => key === "write" && known,
    historyRows: ({ exclusions = new Set() } = {}) => catalog.filter((row) => !exclusions.has(row.key)),
    onChange: (listener) => { emit = listener; return () => {}; },
  });
  const modal = openPicker({ daily, themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  assert.equal(modal.rows[modal.selectedIndex].entry.name, "BUILD");
  const rowOrder = modal.rows.filter((row) => row.kind === "existing").map((row) => row.entry.name);
  catalog = [{ key: "write", name: "Write", last_used: "2026-08-15", days_used: 1 }];
  known = true;
  emit({ reason: "catalog-loaded" });
  assert.deepEqual(modal.rows.filter((row) => row.kind === "existing").map((row) => row.entry.name), rowOrder);
  assert.equal(modal.rows[modal.selectedIndex].entry.name, "WRITE");
  assert.equal(modal.initialKey, modal.rows[modal.selectedIndex].key);
  assert.equal(modal.interacted, false);
  modal.close();
});

test("refresh after arrows and after typing then clearing keeps the settled user key", () => {
  const daily = [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "- [ ] () — WRITE",
    "- [ ] () — LATER",
  ].join("\n");
  const probe = helpers.buildPomodoroLinkPickerModel(daily, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion({ theme: { key: "write", name: "WRITE", known: false } }),
    choice: { kind: "fallback", code: "unknown_theme" },
  });
  let known = false;
  let emit = null;
  const themesApi = createThemesApi([], {
    taskThemeOf: stubTaskThemeOf,
    planRetype: stubPlanRetype,
    isKnownTheme: (key) => key === "write" && known,
    onChange: (listener) => { emit = listener; return () => {}; },
  });
  const modal = openPicker({ daily, themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  const initialKey = modal.initialKey;
  modal.moveSelection(2);
  const arrowKey = modal.rows[modal.selectedIndex].key;
  known = true;
  emit({ reason: "after-arrow" });
  assert.equal(modal.rows[modal.selectedIndex].key, arrowKey);
  assert.equal(modal.initialKey, initialKey);

  type(modal, "later");
  const typedKey = modal.rows[modal.selectedIndex].key;
  emit({ reason: "while-typed" });
  assert.equal(modal.rows[modal.selectedIndex].key, typedKey);
  type(modal, "");
  assert.equal(modal.interacted, true);
  const clearedKey = modal.rows[modal.selectedIndex].key;
  emit({ reason: "after-clear" });
  assert.equal(modal.rows[modal.selectedIndex].key, clearedKey);
  assert.equal(modal.initialKey, initialKey);
  modal.close();
});

test("typed theme suggestion decorates the final Recent row without changing PT7 order", async () => {
  const catalog = [{ key: "write", name: "Write", last_used: "2026-08-15", days_used: 2 }];
  const themesApi = createThemesApi(catalog, {
    taskThemeOf: stubTaskThemeOf,
    planRetype: stubPlanRetype,
  });
  const plain = openPicker({ themesApi });
  type(plain, "wri");
  const plainOrder = rowTitles(plain);
  assert.deepEqual(plainOrder, ["New Pomodoro Write", "New Pomodoro WRI"]);
  assert.equal(plain.rows[plain.selectedIndex].kind, "new", "PT7 keeps its typed candidate first-selected");
  plain.close();

  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion({ theme: { key: "write", name: "WRITE", known: true } }),
    choice: { kind: "create" },
  });
  const suggested = openPicker({ themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  type(suggested, "wri");
  assert.deepEqual(rowTitles(suggested), plainOrder);
  assert.equal(suggested.rows.filter((row) => row.suggested).length, 1);
  assert.equal(suggested.rows[suggested.selectedIndex].kind, "new");
  assert.equal(suggested.rows.find((row) => row.suggested).kind, "recent");
  assert.equal(suggested.rows.find((row) => row.suggested).name, "Write");
  suggested.close();

  const exact = openPicker({ themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  type(exact, "write");
  assert.deepEqual(rowTitles(exact), ["New Pomodoro Write"]);
  assert.equal(exact.rows.filter((row) => row.suggested).length, 1);
  assert.equal(exact.rows[exact.selectedIndex].kind, "recent");
  const exactPromise = exact.waitForChoice();
  pressKey(exact, "Enter");
  const exactChoice = await exactPromise;
  assert.equal(exactChoice.name, "Write");
  assert.equal(exactChoice.preserveSpelling, true);

  const fallbackSnapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion({ theme: { key: "write", name: "WRITE", known: false } }),
    choice: { kind: "fallback", code: "unknown_theme" },
  });
  const fallback = openPicker({ themesApi, lineText: "- [*] #task Ship it", themeSnapshot: fallbackSnapshot });
  type(fallback, "wri");
  assert.deepEqual(rowTitles(fallback), plainOrder);
  assert.equal(fallback.rows.filter((row) => row.suggested).length, 1);
  assert.equal(fallback.rows.find((row) => row.suggested).kind, "recent");
  fallback.close();
});

test("Alt+Enter links once without remembering; plain commits carry deliberate intent", async () => {
  const modal = openSuggestedEntryPicker();
  modal.moveSelection(1);
  assert.equal(modal.rows[modal.selectedIndex].entry.name, "LATER");
  const promise = modal.waitForChoice();
  pressKey(modal, "Enter", { altKey: true });
  const choice = await promise;
  assert.equal(choice.kind, "existing");
  assert.deepEqual(choice.themeIntent, {
    deliberate: false,
    linkOnce: true,
    shown: noteSuggestion(),
  });
});

test("Enter, click, and Ctrl+Shift+Enter share the deliberate rule", async () => {
  const untouched = openSuggestedEntryPicker();
  const untouchedPromise = untouched.waitForChoice();
  pressKey(untouched, "Enter");
  assert.deepEqual((await untouchedPromise).themeIntent, {
    deliberate: false,
    linkOnce: false,
    shown: noteSuggestion(),
  });

  const doubleTap = openSuggestedEntryPicker();
  const doublePromise = doubleTap.waitForChoice();
  pressKey(doubleTap, "Enter");
  pressKey(doubleTap, "Enter");
  assert.equal((await doublePromise).themeIntent.deliberate, false, "untouched double tap is not deliberate");

  const moved = openSuggestedEntryPicker();
  moved.moveSelection(1);
  const movedPromise = moved.waitForChoice();
  pressKey(moved, "Enter", { ctrlKey: true, shiftKey: true });
  const movedChoice = await movedPromise;
  assert.equal(movedChoice.kind, "existing");
  assert.equal(movedChoice.title, "LATER");
  assert.equal(movedChoice.themeIntent.deliberate, true);
  assert.equal(movedChoice.themeIntent.linkOnce, false);

  const tapped = openSuggestedEntryPicker();
  const tappedPromise = tapped.waitForChoice();
  const rows = findAllByClass(tapped.contentEl, "bid-ppk-row");
  click(rows[1]);
  const tappedChoice = await tappedPromise;
  assert.equal(tappedChoice.title, "LATER");
  assert.equal(tappedChoice.themeIntent.deliberate, true, "clicking away from home is deliberate");
});

test("Shift+Enter named commits are always deliberate", async () => {
  const created = openSuggestedEntryPicker();
  type(created, "focus");
  const createPromise = created.waitForChoice();
  pressKey(created, "Enter", { shiftKey: true });
  const createChoice = await createPromise;
  assert.deepEqual(createChoice, {
    kind: "new",
    name: "FOCUS",
    themeIntent: { deliberate: true, linkOnce: false, shown: noteSuggestion() },
  });

  const exact = openSuggestedEntryPicker();
  type(exact, "capture");
  const exactPromise = exact.waitForChoice();
  pressKey(exact, "Enter", { shiftKey: true });
  const exactChoice = await exactPromise;
  assert.equal(exactChoice.kind, "existing");
  assert.equal(exactChoice.title, "CAPTURE");
  assert.equal(exactChoice.themeIntent.deliberate, true);
});

test("cancellation writes nothing even when task-aware", async () => {
  const modal = openSuggestedEntryPicker();
  const promise = modal.waitForChoice();
  pressKey(modal, "Escape");
  assert.equal(await promise, null);
});

test("Ctrl+D on the suggested create row is consumed without writes", async () => {
  const probe = helpers.buildPomodoroLinkPickerModel(DAILY, { now: NOW });
  const snapshot = makeThemeSnapshot(probe, {
    suggestion: noteSuggestion(),
    choice: { kind: "create" },
  });
  const themesApi = createThemesApi(
    [{ key: "write", name: "WRITE", last_used: "2026-08-15", days_used: 2, hidden: true }],
    { taskThemeOf: stubTaskThemeOf, planRetype: stubPlanRetype },
  );
  const modal = openPicker({ themesApi, lineText: "- [*] #task Ship it", themeSnapshot: snapshot });
  assert.equal(modal.rows[modal.selectedIndex].suggestedCreate, true);
  assert.ok(
    (modal.rows[modal.selectedIndex].hiddenThemes || []).length > 0,
    "the hidden suggestion stays eligible",
  );
  pressKey(modal, "d", { ctrlKey: true });
  await tick();
  assert.deepEqual(themesApi.writes, [], "no hide/unhide calls for the suggested row");
  assert.equal(modal.rows[modal.selectedIndex].suggestedCreate, true);
  assert.equal(themesApi.isHidden("WRITE"), true, "the suggestion stays hidden");
  assert.match(
    modal.rows[modal.selectedIndex].kind === "new" ? "new" : "other",
    /new/,
  );
  modal.close();
});
