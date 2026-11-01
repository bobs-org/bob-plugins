// Regression coverage for rendering the actual refresh picker modal, including
// the Less often route used by the freshness decay card.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { ElementStub, ModalStub, defer } = require("./modal-harness.cjs");

global.window = { setTimeout: defer };

const openedModals = [];
const originalLoad = Module._load;
Module._load = function loadWithModalHarness(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class extends ModalStub {
        constructor(app) {
          super(app);
          openedModals.push(this);
        }
      },
      Notice: class {},
      Plugin: class {},
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
Module._load = originalLoad;
const h = NavigationHotkeysPlugin.helpers;

function flattenText(element) {
  return [element.textContent, ...element.children.map(flattenText)]
    .filter(Boolean)
    .join(" ");
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

for (const startDays of [90, 120, 180]) {
  test(`Less often picker renders actual rows from ${startDays} days and Escape writes nothing`, () => {
    openedModals.length = 0;
    const taskLine = "- [ ] #task Rename queue input [fresh:: 2026-07-01] [keeps:: 3]";
    const editor = { getLine: (line) => (line === 0 ? taskLine : null) };
    const plugin = new NavigationHotkeysPlugin();
    plugin.app = {};
    plugin.config = { properties: [] };

    const cardCtx = {
      cm: editor,
      line: 0,
      rawLine: taskLine,
      filePath: "a.md",
      plan: {
        lessOften: {
          mode: "picker",
          beforeDays: startDays,
          minDays: startDays + 1,
          maxDays: 365,
        },
      },
    };

    assert.equal(plugin.openFreshnessDecayLessOftenPicker(cardCtx), true);
    assert.equal(openedModals.length, 1);
    const modal = openedModals[0];
    assert.equal(modal.isOpen, true);
    assert.equal(modal.title, `Refresh every · longer than ${startDays} d`);
    assert.ok(modal.visibleItems.length > 0);
    assert.ok(modal.visibleItems.every((item) => item.refreshDays > startDays));
    assert.equal(modal.resultsEl.children.length, modal.visibleItems.length);
    const renderedRows = descendants(modal.resultsEl).filter((item) =>
      item.classes.includes("bob-cnp-property-value-row"),
    );
    assert.equal(renderedRows.length, modal.visibleItems.length);
    for (let index = 0; index < modal.visibleItems.length; index += 1) {
      assert.match(
        flattenText(renderedRows[index]),
        new RegExp(String(modal.visibleItems[index].refreshDays)),
      );
    }
    assert.match(flattenText(modal.footerEl), /Close or dismiss/);

    const event = {
      key: "Escape",
      preventDefault() {},
      stopPropagation() {},
    };
    modal.dispatchKey(event);
    assert.equal(modal.isOpen, false);
    assert.equal(editor.getLine(0), taskLine);
  });
}

test("renderFooter skips malformed hints and retains valid structured hints", () => {
  const footer = new ElementStub();
  const picker = Object.create(NavigationHotkeysPlugin.helpers.FilteredPickerModal.prototype);
  picker.footerEl = footer;
  picker.footerHints = [
    "legacy malformed string",
    null,
    { keys: [], label: "empty" },
    { keys: ["↵"], label: "Apply" },
    { keys: ["esc"], label: "Close or dismiss" },
  ];
  picker.renderFooter();
  assert.equal(footer.children.length, 2);
  assert.match(flattenText(footer), /Apply/);
  assert.match(flattenText(footer), /Close or dismiss/);
});

test("Pending refresh modal previews the dated Work Log and confirms once", () => {
  openedModals.length = 0;
  const results = [];
  const modal = new NavigationHotkeysPlugin.helpers.FreshnessRefreshSummaryModal(
    {},
    {
      dateText: "2026-10-08",
      now: new Date(2026, 9, 8, 14, 32),
      totalCount: 3,
      eligibleCount: 1,
      onDone: (value) => results.push(value),
    },
  );
  modal.open();
  assert.equal(modal.attached, true);
  assert.match(flattenText(modal.contentEl), /Refresh 3 tasks/);
  assert.match(flattenText(modal.contentEl), /1 of 3 tasks qualify/);
  assert.match(flattenText(modal.contentEl), /nothing written yet/);
  assert.equal(
    modal.inputEl.getAttribute("placeholder"),
    "What did you get done? (optional · ↵ to skip)",
  );

  modal.inputEl.value = "Checked the API :: field";
  modal.inputEl.listeners.input();
  assert.match(flattenText(modal.previewEl), /\*2026-10-08 14:32\* — Checked the API :: field/);
  assert.match(flattenText(modal.previewEl), /Dataview inline field/);
  assert.match(flattenText(modal.previewEl), /WORK LOG/);
  assert.match(flattenText(modal.hintsEl), /Refresh & log summary/);

  modal.inputEl.listeners.keydown({
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  modal.submit();
  assert.deepEqual(results, ["Checked the API :: field"]);
  assert.equal(modal.attached, false);
});

test("dismissing the Pending refresh modal cancels without a summary", () => {
  const results = [];
  const modal = new NavigationHotkeysPlugin.helpers.FreshnessRefreshSummaryModal(
    {},
    { dateText: "2026-10-08", onDone: (value) => results.push(value) },
  );
  modal.open();
  assert.match(flattenText(modal.previewEl), /Refresh only; no Work Log entry/);
  assert.match(flattenText(modal.hintsEl), /Refresh without a summary/);
  modal.inputEl.listeners.keydown({
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(results, [null]);
  assert.equal(modal.attached, false);
});

test("shared prompt planner routes counted, Pending, and Next target combinations", () => {
  const modes = ["single", "counted", "task-link"];
  for (const mode of modes) {
    for (let bits = 0; bits < 8; bits += 1) {
      const hasCounted = Boolean(bits & 1);
      const hasWork = Boolean(bits & 2);
      const hasNext = Boolean(bits & 4);
      const plan = h.planFreshnessRefreshPrompt({
        singleKeep: mode === "single",
        rottenTargets: hasCounted ? [{ raw: "counted" }] : [],
        workTargets: hasWork ? [{ raw: "pending" }] : [],
        laneTargets: hasNext ? [{ raw: "next" }] : [],
      });
      const keepCount = Number(hasCounted) + Number(hasNext);
      const expectedKind = mode === "single" && keepCount === 1 && !hasWork
        ? hasCounted ? "single-rotten" : "single-lane"
        : keepCount ? "batch" : hasWork ? "work-only" : "none";
      assert.equal(plan.kind, expectedKind, `${mode} bits=${bits}`);
      assert.equal(plan.showWorkField, hasWork, `${mode} bits=${bits}`);
      assert.deepEqual(plan.keepTargets.map((target) => target.kind), [
        ...(hasCounted ? ["counted"] : []), ...(hasNext ? ["lane"] : []),
      ]);
    }
  }
});

test("single Next prompt changes preview, Enter hint, and unreadable-history gate", () => {
  const results = [];
  const modal = new NavigationHotkeysPlugin.helpers.FreshnessRefreshSummaryModal(
    {},
    {
      dateText: "2026-10-23",
      keep: {
        lane: "next",
        raw: "- [*] #task Read next [fresh:: 2026-10-14]",
        entry: { fresh: "2026-10-14", ageDays: 9, tierLabel: "NEXT" },
        history: { status: "ambiguous", entries: [] },
        advance: true,
      },
      onDone: (value) => results.push(value),
    },
  );
  modal.open();
  assert.match(flattenText(modal.contentEl), /Keep in Next\?/);
  assert.equal(modal.inputEl.getAttribute("placeholder"), "Why keep it in Next? (optional · ↵ to skip)");
  assert.match(flattenText(modal.previewEl), /No entry/);
  assert.match(flattenText(modal.previewEl), /Refresh only; no Rotten Log entry/);
  assert.equal(modal.refreshButton.textContent, "Keep & next");
  assert.equal(modal.refreshButton.disabled, false);

  modal.inputEl.value = "still needed";
  modal.inputEl.listeners.input();
  assert.match(flattenText(modal.previewEl), /\*2026-10-23\* — still needed · kept in Next/);
  assert.equal(modal.refreshButton.textContent, "Keep, log & next");
  assert.equal(modal.refreshButton.disabled, true);
  modal.inputEl.value = "";
  modal.inputEl.listeners.input();
  modal.inputEl.listeners.keydown({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(results, [""]);
});

test("Next batch preview counts only entries with a nonblank reason", () => {
  const modal = new NavigationHotkeysPlugin.helpers.FreshnessRefreshSummaryModal(
    {},
    {
      dateText: "2026-10-23",
      keepTargets: [{
        kind: "lane", raw: "- [*] #task Next", history: { status: "ok", entries: [] },
      }],
      showWorkField: false,
      totalCount: 1,
      onDone: () => {},
    },
  );
  modal.open();
  assert.equal(modal.keepInputEl.getAttribute("placeholder"), "Why keep them in Next? (optional · ↵ to skip)");
  assert.match(flattenText(modal.keepPreviewEl), /Next · 0 logged/);
  assert.match(flattenText(modal.keepPreviewEl), /no entry \(blank reason\)/);
  assert.match(flattenText(modal.keepPreviewEl), /Refresh only; no Rotten Log entry/);
  assert.equal(modal.refreshButton.textContent, "Keep");
  modal.keepInputEl.value = "stay here";
  modal.keepInputEl.listeners.input();
  assert.match(flattenText(modal.keepPreviewEl), /kept in Next/);
  assert.match(flattenText(modal.keepPreviewEl), /Writes one entry.*1 qualifying task/);
  assert.equal(modal.refreshButton.textContent, "Keep & log");
  assert.equal(modal.refreshButton.disabled, false);
});
