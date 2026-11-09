// Successor picker verdict UI (`api.successors` v4, docs/task-dependencies.md
// §12.22). Covers the nav-card phase: staging, keys, reason field,
// two-step Esc, guards, footer, v3 parity, and the merge card.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { ModalStub, click, pressKey } = require("./modal-harness.cjs");

global.window = global.window || { setTimeout: (callback) => callback() };

class TestModal extends ModalStub {}
class TestNotice {
  constructor(message) {
    this.message = String(message);
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: class Plugin {},
      Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function closeDescriptor(options = {}) {
  return {
    complete: options.complete !== false,
    cancel: options.cancel !== false,
    ...(options.why ? { why: options.why } : {}),
    ...(options.completeConsequence ? { completeConsequence: options.completeConsequence } : {}),
    ...(options.cancelConsequence ? { cancelConsequence: options.cancelConsequence } : {}),
    ...(options.scopeNote ? { scopeNote: options.scopeNote } : {}),
    unblocks: options.unblocks || 0,
  };
}

function row(key, index, options = {}) {
  return {
    key,
    text: options.text || `Offer task ${index}`,
    notePath: options.notePath || `projects/project-${index % 3}.md`,
    status: options.status || "Ready",
    destinationLabel: options.destinationLabel || "BOB",
    needsBlockId: options.needsBlockId === true,
    selectable: options.selectable !== false,
    ...(options.mutedReason ? { mutedReason: options.mutedReason } : {}),
    ...(options.close ? { close: options.close } : {}),
  };
}

function verdictModel(count, options = {}) {
  const rows = Array.from({ length: count }, (_, index) => row(
    `verdict:key/${index}`,
    index + 1,
    { close: closeDescriptor(options.closeOptions || { unblocks: index === 0 ? 1 : 0 }) },
  ));
  return {
    title: "Choose successors",
    predecessors: [{ notePath: "work/close.md", blockId: "closed", text: "Close task" }],
    groups: [{ group: "hand_off", header: "Hand-offs", project: "", rows, folded: {} }],
    close: { supported: true },
  };
}

function plainModel(count) {
  const rows = Array.from({ length: count }, (_, index) => row(`opaque:key/${index}#${index}`, index + 1));
  return {
    title: "Choose successors",
    predecessors: [{ notePath: "work/close.md", blockId: "closed", text: "Close task" }],
    groups: [{ group: "hand_off", header: "Hand-offs", project: "", rows }],
  };
}

function makePlugin(options = {}) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  let now = options.now === undefined ? 1000 : options.now;
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {},
    plugins: { plugins: {} },
  };
  plugin.successorPickerUnavailable = false;
  plugin.activeSuccessorPicker = null;
  plugin.reviewSuccessorGestureOwner = null;
  plugin.reviewSuccessorWalkHold = null;
  plugin.reviewLanding = null;
  plugin.reviewGestureSeq = 0;
  plugin.reviewLandingEpoch = 0;
  plugin.reviewWalkLock = null;
  plugin.successorPickerNow = () => now;
  plugin.reviewAdvanceNow = () => now;
  plugin.setNow = (value) => { now = value; };
  plugin.api = helpers.createDependencyNavApi(plugin);
  return plugin;
}

async function openPicker(plugin, model) {
  const pending = plugin.api.successors.pick(model);
  await Promise.resolve();
  const modal = plugin.activeSuccessorPicker;
  assert.ok(modal, "pick opens a modal for selectable offers");
  return { pending, modal };
}

function findAll(element, className, out = []) {
  if (!element) return out;
  if (element.classes && element.classes.includes(className)) out.push(element);
  for (const child of element.children || []) findAll(child, className, out);
  return out;
}

function allText(element) {
  if (!element) return "";
  return [element.textContent || "", ...(element.children || []).map(allText)].join(" ");
}

function pressVerdict(modal, shift = false, keyOptions = {}) {
  return pressKey(modal, shift ? "X" : "x", {
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: shift,
    ...keyOptions,
  });
}

test("api.successors is v4 and the close descriptor normalizes both cases", () => {
  const plugin = makePlugin();
  assert.equal(plugin.api.successors.version, 4);
  const snake = helpers.normalizeSuccessorPickerModel({
    title: "Choose",
    predecessors: [],
    groups: [{
      group: "hand_off",
      rows: [{
        key: "k1", text: "Task", notePath: "n.md", status: "Ready",
        destinationLabel: "BOB", selectable: true,
        close: { complete: true, cancel: true, why: "", complete_consequence: "✓ C", cancel_consequence: "⊘ X", scope_note: "scope", unblocks: 2 },
      }],
    }],
    close: { supported: true },
  });
  assert.deepEqual(snake.groups[0].rows[0].close, {
    complete: true, cancel: true,
    completeConsequence: "✓ C", cancelConsequence: "⊘ X",
    scopeNote: "scope", unblocks: 2,
  });
  assert.deepEqual(snake.close, { supported: true });
  const dropped = helpers.normalizeSuccessorPickerModel({
    title: "Choose",
    predecessors: [],
    groups: [{
      group: "hand_off",
      rows: [{
        key: "k1", text: "Task", notePath: "n.md", status: "Ready",
        destinationLabel: "BOB", selectable: true,
        close: { complete: true, cancel: true },
      }],
    }],
  });
  assert.equal(dropped.groups[0].rows[0].close, undefined);
  assert.equal(dropped.close, undefined);
});

test("Ctrl+X stages Done, advances, and the same key returns the row to Leave", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(3));
  assert.equal(modal.verdicts.size, 0);
  pressVerdict(modal, false);
  assert.deepEqual(Array.from(modal.verdicts.keys()), ["verdict:key/0"]);
  assert.equal(modal.verdicts.get("verdict:key/0").outcome, "done");
  assert.equal(modal.markedKeys.size, 0, "a verdict clears the pull-in mark");
  assert.match(allText(modal.footerEl), /✓ 1 done/);
  assert.ok(!allText(modal.footerEl).includes("pull in"), "zero segments are omitted");
  const firstIndex = modal.selectedIndex;
  assert.notEqual(firstIndex, 0, "setting advances the highlight");
  modal.selectedIndex = 0;
  modal.renderResults();
  pressVerdict(modal, false);
  assert.equal(modal.verdicts.size, 0, "the same key toggles back to Leave");
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("verdict mode keeps Ctrl+N / Ctrl+P", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(3));
  pressVerdict(modal, false);
  assert.equal(modal.selectedIndex, 1, "Ctrl+X auto-advances after staging Done");
  const verdictsBefore = Array.from(modal.verdicts.entries());
  const markedBefore = modal.markedKeys.size;

  const up = pressKey(modal, "p", { ctrlKey: true });
  assert.equal(up.defaultPrevented, true);
  assert.equal(modal.selectedIndex, 0);

  const down = pressKey(modal, "n", { ctrlKey: true });
  assert.equal(down.defaultPrevented, true);
  assert.equal(modal.selectedIndex, 1);

  assert.deepEqual(Array.from(modal.verdicts.entries()), verdictsBefore);
  assert.equal(modal.markedKeys.size, markedBefore);
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("Ctrl+Shift+X opens the reason field; Enter confirms and Esc restores", async () => {
  const plugin = makePlugin({ now: 5000 });
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  pressVerdict(modal, true);
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  const inputs = findAll(modal.resultsEl, "bob-successor-reason-input");
  assert.equal(inputs.length, 1, "the reason field replaces the detail line");
  assert.equal(inputs[0].getAttribute("placeholder"), "Why cancel? (optional)");
  inputs[0].value = "Fixed it a different way";
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  assert.equal(modal.reasonEditKey, null);
  assert.equal(modal.verdicts.get("verdict:key/0").reason, "Fixed it a different way");
  assert.match(allText(modal.resultsEl), /Fixed it a different way/);
  assert.match(allText(modal.footerEl), /⊘ 1 cancel/);

  modal.selectedIndex = 1;
  modal.renderResults();
  pressVerdict(modal, true);
  assert.equal(modal.reasonEditKey, "verdict:key/1");
  pressKey(modal, "Escape");
  assert.equal(modal.reasonEditKey, null, "Esc in the reason field restores");
  assert.equal(modal.verdicts.has("verdict:key/1"), false);
  assert.equal(modal.verdicts.size, 1, "the Done verdict survives the Cancel restore");
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("a blank Cancel reason is allowed and blur confirms the typed text", async () => {
  const plugin = makePlugin({ now: 5000 });
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  modal.selectedIndex = 1;
  modal.renderResults();
  pressVerdict(modal, true);
  const inputs = findAll(modal.resultsEl, "bob-successor-reason-input");
  assert.equal(inputs.length, 1);
  inputs[0].value = "";
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  assert.equal(modal.verdicts.get("verdict:key/1").reason, "", "blank is allowed");
  assert.match(allText(modal.resultsEl), /no reason/);

  const second = await openPicker(makePlugin({ now: 5000 }), verdictModel(1));
  pressVerdict(second.modal, true);
  const secondInputs = findAll(second.modal.resultsEl, "bob-successor-reason-input");
  secondInputs[0].value = "blur reason";
  secondInputs[0].listeners.blur({});
  assert.equal(second.modal.verdicts.get("verdict:key/0").reason, "blur reason");
  second.modal.allowCloseWithoutArm = true;
  second.modal.close();
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
  assert.equal(await second.pending, null);
});

test("repeat and IME are ignored and the KeyX code is a layout fallback", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  pressVerdict(modal, false, { repeat: true });
  assert.equal(modal.verdicts.size, 0, "held Ctrl+X stages one row, not a sweep");
  pressKey(modal, "x", { ctrlKey: true, isComposing: true });
  assert.equal(modal.verdicts.size, 0);
  pressKey(modal, "x", { ctrlKey: true, keyCode: 229 });
  assert.equal(modal.verdicts.size, 0);
  const fallback = pressKey(modal, "?", { ctrlKey: true, code: "KeyX" });
  assert.equal(fallback.defaultPrevented, true);
  assert.equal(modal.verdicts.size, 1, "the layout fallback stages Done");
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("Linux filter selection leaves Ctrl+X to native Cut", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  modal.inputEl.value = "query";
  modal.inputEl.selectionStart = 0;
  modal.inputEl.selectionEnd = 5;
  const realNavigator = global.navigator;
  global.navigator = { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" };
  try {
    const event = pressKey(modal, "x", { ctrlKey: true });
    assert.equal(event.defaultPrevented, false, "Cut keeps the key");
    assert.equal(modal.verdicts.size, 0, "no verdict stages under a Linux selection");
  } finally {
    if (realNavigator === undefined) {
      delete global.navigator;
    } else {
      global.navigator = realNavigator;
    }
  }
  modal.inputEl.selectionStart = 0;
  modal.inputEl.selectionEnd = 0;
  pressVerdict(modal, false);
  assert.equal(modal.verdicts.size, 1, "without a selection the card owns the chord");
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("ineligible rows refuse with the engine why and muted rows have no slot", async () => {
  const plugin = makePlugin();
  const model = verdictModel(3);
  model.groups[0].rows[1] = row("verdict:key/1", 2, {
    close: closeDescriptor({ complete: false, cancel: false, why: "“Task” is Done — only open tasks close here" }),
  });
  model.groups[0].rows[2] = row("verdict:key/2", 3, { selectable: false, mutedReason: "blocked" });
  const { pending, modal } = await openPicker(plugin, model);
  modal.selectedIndex = 1;
  modal.renderResults();
  pressVerdict(modal, false);
  assert.equal(modal.verdicts.size, 0, "nothing stages on an ineligible row");
  assert.match(allText(modal.footerEl), /only open tasks close here/);
  modal.selectedIndex = 2;
  modal.renderResults();
  pressVerdict(modal, true);
  assert.equal(modal.verdicts.size, 0, "muted rows have no verdict slot");
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("two-step Esc discards and stays open; the guarded close arms then closes", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  pressVerdict(modal, false);
  assert.equal(modal.verdicts.size, 1);
  pressKey(modal, "Escape");
  assert.equal(modal.escArmed, true, "the first Esc arms instead of closing");
  assert.equal(modal.pickerOpen, true);
  assert.match(allText(modal.footerEl), /Esc again to discard 1 close/);
  pressKey(modal, "a");
  assert.equal(modal.escArmed, false, "any other key disarms the warning");
  assert.equal(modal.verdicts.size, 1);
  pressKey(modal, "Escape");
  pressKey(modal, "Escape");
  assert.equal(modal.verdicts.size, 0, "the second Esc discards");
  assert.equal(modal.pickerOpen, true, "discard stays open");

  pressVerdict(modal, false);
  modal.close();
  assert.equal(modal.pickerOpen, true, "the first background close arms");
  assert.equal(modal.escArmed, true);
  modal.allowCloseWithoutArm = false;
  modal.close();
  assert.equal(modal.pickerOpen, false, "the second background close discards and closes");
  assert.equal(await pending, null);
});

test("no highlight fallback once verdicts exist; Enter applies picks and closes", async () => {
  const plugin = makePlugin({ now: 5000 });
  const { pending, modal } = await openPicker(plugin, verdictModel(3));
  pressVerdict(modal, false);
  modal.selectedIndex = 2;
  modal.renderResults();
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  const result = await pending;
  assert.deepEqual(result.picks, [], "no fallback to the highlighted row");
  assert.deepEqual(result.closes, [{ key: "verdict:key/0", outcome: "done" }]);
});

test("Ctrl+A skips verdict rows and Tab on a verdict row makes it Pull in", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(3));
  pressVerdict(modal, false);
  pressKey(modal, "a", { ctrlKey: true });
  assert.equal(modal.markedKeys.has("verdict:key/0"), false, "bulk keys never override a verdict");
  assert.equal(modal.markedKeys.size, 2);
  modal.selectedIndex = 0;
  modal.renderResults();
  pressKey(modal, "Tab");
  assert.equal(modal.verdicts.size, 0, "Tab converts the verdict to Pull in");
  assert.ok(modal.markedKeys.has("verdict:key/0"));
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("retarget ignores verdict rows with a soft refusal", async () => {
  const plugin = makePlugin();
  plugin.app.plugins.plugins["block-id-prompt"] = {
    api: { pomodoroLinkPicker: { version: 1, pick: async () => ({ kind: "new", name: "DEEP" }) } },
  };
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  pressKey(modal, "Tab");
  pressVerdict(modal, false);
  assert.equal(await modal.retargetRowsForDestination(), true);
  assert.deepEqual(
    Array.from(modal.destinationOverrides.keys()),
    ["verdict:key/0"],
    "verdict rows are never retargeted",
  );
  modal.markedKeys.clear();
  modal.selectedIndex = 1;
  modal.renderResults();
  assert.equal(await modal.retargetRowsForDestination(), false);
  assert.match(allText(modal.footerEl), /Retarget applies to pull-in rows only/);
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("v3-shaped models render exactly as before with no chords", async () => {
  const plugin = makePlugin();
  assert.equal(plugin.api.successors.version, 4);
  const { pending, modal } = await openPicker(plugin, plainModel(2));
  assert.equal(findAll(modal.resultsEl, "bob-successor-verdict-actions").length, 0);
  assert.ok(!allText(modal.footerEl).includes("✓"));
  assert.ok(!allText(modal.footerEl).includes("⊘"));
  pressVerdict(modal, false);
  assert.equal(modal.verdicts.size, 0, "no chords without close support");
  pressVerdict(modal, true);
  assert.equal(modal.verdicts.size, 0);
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("the task-merge card stays pull-in-only", async () => {
  const plugin = makePlugin();
  const model = {
    title: "Link the merged task?",
    predecessors: [],
    groups: [{
      group: "hand_off",
      header: "Hand off",
      caption: "“Task” can take the place of a removed link",
      tag: "",
      project: "",
      rows: [{
        key: "merge:key/0", text: "Target", notePath: "t.md", status: "",
        lane: "", destinationLabel: "", needsBlockId: false, selectable: true,
        suffix: "under FIX", reason: "merged from “Source”",
      }],
      folded: {},
    }],
  };
  const { pending, modal } = await openPicker(plugin, model);
  pressVerdict(modal, false);
  assert.equal(modal.verdicts.size, 0, "merge rows never receive verdicts");
  assert.equal(findAll(modal.resultsEl, "bob-successor-verdict-actions").length, 0);
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("zero picks with closes is a commit with footer, status, and aria", async () => {
  const plugin = makePlugin({ now: 5000 });
  const model = verdictModel(2, {
    closeOptions: {
      completeConsequence: "✓ Completes “Offer task 1” · Ready → Done",
      cancelConsequence: "⊘ Cancels “Offer task 2” · Ready → Cancelled",
      unblocks: 1,
    },
  });
  const { pending, modal } = await openPicker(plugin, model);
  pressVerdict(modal, false);
  assert.match(allText(modal.footerEl), /✓ 1 done/);
  assert.match(allText(modal.footerEl), /unblocks/);
  const labelled = findAll(modal.resultsEl, "bob-successor-row").filter(
    (el) => el.getAttribute("aria-label") && el.getAttribute("aria-label").includes("will be completed"),
  );
  assert.ok(labelled.length >= 1, "verdict rows carry the accessible suffix");
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  const result = await pending;
  assert.deepEqual(result.picks, []);
  assert.equal(result.closes.length, 1);
  assert.notEqual(result, null, "zero picks with closes is not null");
});

test("closes re-filter to eligible outcomes and never overlap picks", async () => {
  const normalized = helpers.normalizeSuccessorPickerModel(verdictModel(2));
  const filtered = helpers.normalizeSuccessorClosesForResult({ model: normalized }, [
    { key: "verdict:key/0", outcome: "done" },
    { key: "verdict:key/0", outcome: "done" },
    { key: "missing", outcome: "done" },
    { key: "verdict:key/1", outcome: "bogus" },
  ]);
  assert.deepEqual(filtered, [{ key: "verdict:key/0", outcome: "done" }]);
  const second = makePlugin();
  const { pending, modal: real } = await openPicker(second, verdictModel(2));
  pressKey(real, "Tab");
  pressVerdict(real, false);
  assert.ok(!real.markedKeys.has("verdict:key/1") || !real.verdicts.has("verdict:key/1"), "one row, one verdict");
  real.allowCloseWithoutArm = true;
  real.close();
  assert.equal(await pending, null);
  assert.ok(normalized.groups[0].rows[0].close.complete, "descriptors survive normalization");
});
