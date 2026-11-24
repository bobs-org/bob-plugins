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
  const text = options.text || `Offer task ${index}`;
  const notePath = options.notePath || `projects/project-${index % 3}.md`;
  const closeTask = options.close && options.taskContext === true
    ? {
      path: notePath,
      line: index + 1,
      text: `- [ ] #task ${text}`,
      displayText: text,
      status: "Ready",
      preimage: `- [ ] #task ${text}`,
    }
    : null;
  return {
    key,
    text,
    notePath,
    status: options.status || "Ready",
    ...(options.task || closeTask ? { task: options.task || closeTask } : {}),
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
    {
      close: closeDescriptor(options.closeOptions || { unblocks: index === 0 ? 1 : 0 }),
      taskContext: options.taskContext === true,
    },
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

function requirementModel() {
  const ownerKey = "work/ship.md#^ship@owner-snapshot";
  const key = `${ownerKey}/req/1~requirement1`;
  return {
    title: "Choose successor tasks",
    groups: [{
      group: "requirements",
      kind: "requirements",
      owner: { task_key: "work/ship.md#^ship", key: ownerKey, path: "work/ship.md", block_id: "ship", line: 3, text: "Ship parser" },
      copy: {
        title: "Requirements · “Ship parser”", scope: "1 requirement", why: "Met when it closes, unless you say otherwise",
        glyph: "requirement", footer: "⌃X met · ⌃⇧X drop · ⌃⇧T own task · space pull in · ⌃J jump",
        hint: "-k N own task · -X N[=why] drop · -p N pull in",
      },
      rows: [{
        offer: { key, n: 1, group: "requirements", selected: false },
        req: { owner: ownerKey, path: "1", depth: 1, parent_key: null, text: "Handle empty input", line: 4, state: "pending", pending_descendants: 0 },
        consequences: {
          met: "Met when it closes, unless you say otherwise",
          drop: "⊘ Dropped “Handle empty input”",
          carry: "→ “Handle empty input” is its own task now",
          carry_pulled: "→ “Handle empty input” is its own task now · pulled in",
        },
      }],
    }],
  };
}

function makePlugin(options = {}) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const recallState = { attached: [], noted: [] };
  const logRecall = {
    version: 1,
    attach(attachOptions) {
      recallState.attached.push(attachOptions);
      return { detach() {} };
    },
    noteUsed(kind, text) { recallState.noted.push([kind, text]); return true; },
  };
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
  plugin.app.plugins.plugins["bob-navigation-hotkeys"] = { api: { logRecall } };
  plugin.recallState = recallState;
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

test("api.successors is v6 and the close descriptor normalizes both cases", () => {
  const plugin = makePlugin();
  assert.equal(plugin.api.successors.version, 6);
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
  const { pending, modal } = await openPicker(plugin, verdictModel(3, { taskContext: true }));
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
  assert.equal(plugin.recallState.attached.at(-1).kind, "cancel");
  assert.equal(plugin.recallState.attached.at(-1).density, "dense");
  assert.equal(plugin.recallState.attached.at(-1).ownKeys, true);
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

test("requirement Drop reuses Log Recall, normalizes its reason, and restores staged choices on Esc", async () => {
  const plugin = makePlugin({ now: 5000 });
  const model = requirementModel();
  const key = model.groups[0].rows[0].offer.key;
  const { pending, modal } = await openPicker(plugin, model);
  pressVerdict(modal, true);
  assert.equal(modal.reasonEditKey, key);
  assert.equal(modal.reasonEditKind, "requirement");
  assert.equal(modal.requirementChoices.get(key).verdict, "drop");
  assert.equal(plugin.recallState.attached.at(-1).kind, "cancel", "drop uses the existing Cancel Log Recall source");
  assert.equal(plugin.recallState.attached.at(-1).sourcePath(), "work/ship.md");
  const input = findAll(modal.resultsEl, "bob-successor-reason-input")[0];
  assert.equal(input.getAttribute("placeholder"), "Why drop it? (optional)");
  input.value = "  no longer needed\n now  ";
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  assert.equal(modal.requirementChoices.get(key).reason, "no longer needed now");
  assert.match(allText(modal.resultsEl), /no longer needed now/);
  plugin.setNow(7000);
  pressKey(modal, "Enter");
  assert.deepEqual(await pending, {
    picks: [],
    reqs: [{ key, verdict: "drop", reason: "no longer needed now" }],
  });

  const restorePlugin = makePlugin({ now: 5000 });
  const restoreModel = requirementModel();
  const restoreKey = restoreModel.groups[0].rows[0].offer.key;
  const restored = await openPicker(restorePlugin, restoreModel);
  pressKey(restored.modal, "t", { ctrlKey: true, shiftKey: true });
  pressVerdict(restored.modal, true);
  pressKey(restored.modal, "Escape");
  assert.equal(restored.modal.reasonEditKey, null);
  assert.equal(restored.modal.requirementChoices.get(restoreKey).verdict, "carry", "Esc restores the previous staged choice");
  pressKey(restored.modal, "Escape");
  assert.equal(restored.modal.escArmed, true, "the first list Esc arms the existing discard step");
  pressKey(restored.modal, "Escape");
  assert.equal(restored.modal.requirementChoices.size, 0, "the second Esc discards staged requirement choices");
  restored.modal.allowCloseWithoutArm = true;
  restored.modal.close();
  assert.equal(await restored.pending, null);
});

test("S6 reason field opts into links and keeps its draft and band across re-renders", async () => {
  const plugin = makePlugin({ now: 5000 });
  const handles = [];
  const logRecall = plugin.app.plugins.plugins["bob-navigation-hotkeys"].api.logRecall;
  logRecall.attach = (attachOptions) => {
    plugin.recallState.attached.push(attachOptions);
    const handle = {
      rebinds: [],
      detached: 0,
      rebind(next) { this.rebinds.push(next); return true; },
      detach() { this.detached += 1; },
    };
    handles.push(handle);
    return handle;
  };
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  pressVerdict(modal, true);
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  const options = plugin.recallState.attached.at(-1);
  assert.equal(options.links, true);
  assert.equal(options.kind, "cancel");
  assert.equal(options.density, "dense");
  assert.equal(options.sourcePath(), "projects/project-1.md", "links resolve against the offer's note");
  assert.deepEqual(options.subjects(), [], "a row without task context has no identity, so no subject is guessed");
  assert.equal(handles.length, 1);

  const first = findAll(modal.resultsEl, "bob-successor-reason-input")[0];
  first.value = "Superseded by [[sa";
  first.selectionStart = 18;
  first.selectionEnd = 18;
  modal.renderResults();
  const rebuilt = findAll(modal.resultsEl, "bob-successor-reason-input")[0];
  assert.notEqual(rebuilt, first, "renderResults rebuilds the field");
  assert.equal(rebuilt.value, "Superseded by [[sa", "the typed draft survives, not the staged reason");
  assert.equal(handles.length, 1, "the band handle is rebound, not re-attached");
  assert.equal(handles[0].rebinds.length, 1);
  assert.equal(handles[0].rebinds[0].inputEl, rebuilt);
  assert.equal(handles[0].detached, 0);

  const marked = modal.markedKeys.size;
  click(rebuilt);
  assert.equal(modal.reasonEditKey, "verdict:key/0", "clicks inside the editor never toggle the row");
  assert.equal(modal.markedKeys.size, marked);

  rebuilt.focus();
  const bracket = pressKey(modal, "[", { ctrlKey: true });
  assert.equal(bracket.defaultPrevented, true);
  assert.equal(modal.reasonEditKey, null, "Ctrl+[ restores like Esc");
  assert.equal(modal.verdicts.has("verdict:key/0"), false);
  assert.equal(handles[0].detached, 1, "closing the editor detaches its band");
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

  const secondPlugin = makePlugin({ now: 5000 });
  const second = await openPicker(secondPlugin, verdictModel(1));
  pressVerdict(second.modal, true);
  const secondInputs = findAll(second.modal.resultsEl, "bob-successor-reason-input");
  secondInputs[0].value = "blur reason";
  const reasonWrap = findAll(second.modal.resultsEl, "bob-successor-reason")[0];
  reasonWrap.contains = (node) => {
    for (let current = node; current; current = current.parent) {
      if (current === reasonWrap) return true;
    }
    return false;
  };
  const bandRow = secondPlugin.recallState.attached.at(-1).bandHost.createDiv();
  secondInputs[0].blur();
  secondInputs[0].listeners.blur({ relatedTarget: bandRow });
  assert.equal(second.modal.reasonEditKey, "verdict:key/0", "moving focus inside USED BEFORE does not commit");
  secondInputs[0].focus();
  secondInputs[0].blur();
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
  const { pending, modal } = await openPicker(plugin, verdictModel(3, { taskContext: true }));
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

test("empty-filter Space converts a staged Done row into a Pull-in mark", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, verdictModel(2));
  pressVerdict(modal, false);
  modal.selectedIndex = modal.visibleItems.findIndex(
    (item) => item.kind === "offer" && item.row.key === "verdict:key/0",
  );
  modal.renderResults();
  const selectedIndex = modal.selectedIndex;
  const event = pressKey(modal, " ");
  assert.equal(event.defaultPrevented, true);
  assert.equal(modal.selectedIndex, selectedIndex);
  assert.equal(modal.verdicts.size, 0);
  assert.deepEqual(Array.from(modal.markedKeys), ["verdict:key/0"]);
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
  assert.equal(plugin.api.successors.version, 6);
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
    taskContext: true,
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

// Successor jump pin with verdicts (`api.successors` v5,
// docs/task-dependencies.md §12.22 successor jump).

function jumpVerdictModel(count, options = {}) {
  return { ...verdictModel(count, options), jump: { supported: true } };
}

function pressJump(modal, keyOptions = {}) {
  return pressKey(modal, "j", { ctrlKey: true, ...keyOptions });
}

test("the pin survives verdicts and Esc discard, and stages the apply & jump chip", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, jumpVerdictModel(3));
  pressJump(modal);
  const pinnedKey = modal.jumpKey;
  assert.ok(pinnedKey, "the pin stages on a jump-enabled verdict card");
  pressVerdict(modal, false);
  assert.equal(modal.jumpKey, pinnedKey, "a Done verdict never moves the pin");
  assert.match(allText(modal.footerEl), /apply & jump/);
  assert.match(allText(modal.footerEl), /↗ “Offer task 1”/);
  pressKey(modal, "Escape");
  pressKey(modal, "Escape");
  assert.equal(modal.verdicts.size, 0, "the second Esc discards the verdicts");
  assert.equal(modal.jumpKey, pinnedKey, "the pin stays like a mark does");
  assert.equal(modal.pickerOpen, true);
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("pin plus closes commits picks, closes, and jump together", async () => {
  const plugin = makePlugin({ now: 5000 });
  const { pending, modal } = await openPicker(plugin, jumpVerdictModel(3, { taskContext: true }));
  pressVerdict(modal, false);
  modal.selectedIndex = 1;
  modal.renderResults();
  pressJump(modal);
  assert.equal(modal.jumpKey, "verdict:key/1");
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  assert.deepEqual(await pending, {
    picks: [],
    closes: [{ key: "verdict:key/0", outcome: "done" }],
    jump: { key: "verdict:key/1" },
  });
});

test("Ctrl+J is inert in the reason editor and Esc closes a pin-only card to null", async () => {
  const plugin = makePlugin({ now: 5000 });
  const { pending, modal } = await openPicker(plugin, jumpVerdictModel(2));
  pressVerdict(modal, true);
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  const unfocused = pressJump(modal);
  assert.equal(unfocused.defaultPrevented, false, "keys from the reason field never reach the card");
  assert.equal(modal.jumpKey, null, "no pin stages from the reason field");
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  modal.inputEl.focus();
  const consumed = pressJump(modal);
  assert.equal(consumed.defaultPrevented, true, "the reason editor consumes the key");
  assert.equal(modal.jumpKey, null, "no pin stages while the reason editor is open");
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  findAll(modal.resultsEl, "bob-successor-reason-input")[0].focus();
  pressKey(modal, "Escape");
  assert.equal(modal.reasonEditKey, null);

  pressJump(modal);
  assert.ok(modal.jumpKey, "the pin stages after the editor closes");
  pressKey(modal, "Escape");
  assert.equal(modal.pickerOpen, false, "a pin alone never arms Esc");
  assert.equal(await pending, null, "the Esc that closes the card discards the pin");
});

test("S6 reason field declares the cancelled row as its subject (1-based task line to 0-based guard line)", async () => {
  const plugin = makePlugin({ now: 5000 });
  const model = verdictModel(1, { closeOptions: { unblocks: 0 } });
  model.groups[0].rows[0] = row("projects/project-1.md#^cut-me", 1, {
    notePath: "projects/project-1.md",
    close: closeDescriptor({ unblocks: 0 }),
    task: {
      path: "projects/project-1.md",
      line: 5,
      text: "- [ ] #task Cut me ^cut-me",
      displayText: "Cut me",
      status: " ",
      preimage: "- [ ] #task Cut me ^cut-me",
    },
  });
  const { pending, modal } = await openPicker(plugin, model);
  pressVerdict(modal, true);
  const options = plugin.recallState.attached.at(-1);
  assert.equal(options.density, "dense");
  assert.deepEqual(options.subjects(), [{ path: "projects/project-1.md", line: 4, blockId: "cut-me" }],
    "the row being cancelled is shown but disabled in the reason's `((`");
  assert.deepEqual(helpers.successorReasonSubjects(null), []);
  assert.deepEqual(helpers.successorReasonSubjects({ task: { path: "a.md", line: 0, preimage: "x" } }), [],
    "a malformed line declares no subject");
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

// --- S6 NAME stage inside the dense inline reason (phase bob-cli-oz.4) -----
// The reason field commits on Enter (after a 350 ms guard) and on blur. NAME
// never moves focus, so it can never trigger that blur commit; Enter in NAME
// belongs to the band (never the host's commit); and a real blur while NAME is
// open cancels naming without writing the vault, then the host's own blur
// commit stores the byte-identical draft.
const { createSiblingNamer } = require("./prompt-sibling-naming-helpers.cjs");

test("S6 native Scope Escape peels NAME, the list, then the reason without blur-committing", async () => {
  const plugin = makePlugin({ now: 5000 });
  const store = { "Tasks.md": "- [ ] #task Reply to Dana" };
  const namer = createSiblingNamer({ files: store, sourcePath: "Tasks.md", subjects: [] });
  plugin.app.plugins.plugins["block-id-prompt"] = { api: { taskLinks: namer.api } };
  plugin.app.plugins.plugins["bob-navigation-hotkeys"].api.logRecall.attach = (options) =>
    helpers.attachLogRecall({ ...options, app: plugin.app, hintDebounceMs: 0, notes: [], parentPaths: [], linkedPaths: [], recentPaths: [] });
  const { pending, modal } = await openPicker(plugin, verdictModel(1));
  // Obsidian Scope checks handlers in registration order, before DOM input
  // listeners. Its constructor's Escape handler is already present at attach.
  const scope = {
    keys: [],
    register(modifiers, key, func) { const handler = { modifiers, key, func }; this.keys.push(handler); return handler; },
    unregister(handler) { this.keys = this.keys.filter((entry) => entry !== handler); },
    escape(event) {
      for (const handler of this.keys) {
        if (handler.key !== null && handler.key !== "Escape") continue;
        const result = handler.func(event);
        if (result !== undefined || handler.key !== null || handler.modifiers !== null) return result;
      }
    },
  };
  modal.scope = scope;
  let nativeEscapes = 0;
  scope.register([], "Escape", (event) => { nativeEscapes += 1; return modal.onEscapeKey(event); });
  pressVerdict(modal, true);
  const input = modal.reasonInputEl;
  const handle = modal.reasonRecall;
  input.value = "dup of ((Reply";
  input.selectionStart = input.selectionEnd = input.value.length;
  input.focus();
  input.listeners.input({ type: "input", inputType: "insertText", target: input });
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  assert.equal(handle.isNaming(), true);
  const escape = () => scope.escape({ key: "Escape", target: input, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(escape(), false);
  assert.equal(handle.isNaming(), false);
  assert.equal(handle.isTaskOpen(), true);
  assert.equal(input.value, "dup of ((Reply");
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  assert.equal(modal.escArmed, false);
  assert.equal(escape(), false);
  assert.equal(handle.isTaskOpen(), false);
  assert.equal(modal.reasonEditKey, "verdict:key/0");
  assert.equal(nativeEscapes, 0, "neither band Escape reaches Modal");
  assert.equal(escape(), false);
  assert.equal(nativeEscapes, 1);
  assert.equal(modal.reasonEditKey, null);
  assert.equal(modal.verdicts.size, 0, "Esc restores the pre-edit verdict instead of storing the draft");
  assert.equal(store["Tasks.md"], "- [ ] #task Reply to Dana");
  assert.equal(scope.keys.length, 1, "reason disposal removes its scope handlers");
  namer.close();
  modal.close();
  assert.equal(await pending, null);
});

test("S6 dense reason: NAME owns Enter, never blurs, and a real blur cancels naming without a write", async () => {
  const plugin = makePlugin({ now: 5000 });
  const model = verdictModel(1, { closeOptions: { unblocks: 0 } });
  model.groups[0].rows[0] = row("projects/project-1.md#^cut-me", 1, {
    notePath: "projects/project-1.md",
    close: closeDescriptor({ unblocks: 0 }),
    task: {
      path: "projects/project-1.md",
      line: 1,
      text: "- [ ] #task Cut me ^cut-me",
      displayText: "Cut me",
      status: " ",
      preimage: "- [ ] #task Cut me ^cut-me",
    },
  });
  const noteText = ["- [ ] #task Cut me ^cut-me", "- [ ] #task Reply to Dana"].join("\n");
  const store = { "projects/project-1.md": noteText };
  const namer = createSiblingNamer({ files: store, sourcePath: "projects/project-1.md", subjects: [] });
  plugin.app.plugins.plugins["block-id-prompt"] = { api: { taskLinks: namer.api } };
  const logRecall = plugin.app.plugins.plugins["bob-navigation-hotkeys"].api.logRecall;
  logRecall.attach = (attachOptions) => {
    plugin.recallState.attached.push(attachOptions);
    return helpers.attachLogRecall({ ...attachOptions, app: plugin.app, hintDebounceMs: 0, notes: [], parentPaths: [], linkedPaths: [], recentPaths: [] });
  };
  const { pending, modal } = await openPicker(plugin, model);
  pressVerdict(modal, true);
  const input = findAll(modal.resultsEl, "bob-successor-reason-input")[0];
  const handle = modal.reasonRecall;
  assert.equal(typeof handle.isTaskOpen, "function", "the real proseField handle is attached");
  input.value = "dup of ((Reply";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.focus();
  for (const handler of [...((input._listeners && input._listeners.input) || [])]) {
    handler.call(input, { type: "input", inputType: "insertText", isComposing: false, target: input });
  }
  assert.equal(handle.isTaskOpen(), true, "(( opens the tasks mode in the dense reason field");
  plugin.setNow(6000);
  pressKey(modal, "Enter");
  assert.equal(handle.isNaming(), true, "Enter on the ID-less row opens NAME, it never commits the reason");
  assert.equal(modal.reasonEditKey, "projects/project-1.md#^cut-me", "the reason field stays open");
  assert.equal(input.value, "dup of ((Reply", "NAME leaves the field byte-identical");
  const written = JSON.stringify(store);

  // A real blur cancels naming without a vault write.
  input.blur();
  input.listeners.blur({});
  assert.equal(handle.isNaming(), false, "blur leaves NAME");
  assert.equal(JSON.stringify(store), written, "blur never writes the vault");
  assert.equal(store["projects/project-1.md"], noteText, "the note is exactly as before");
  assert.equal(modal.verdicts.get("projects/project-1.md#^cut-me").reason, "dup of ((Reply",
    "the host's own blur commit stores the unchanged draft");
  namer.close();
  modal.allowCloseWithoutArm = true;
  modal.close();
  assert.equal(await pending, null);
});

test("S6 reason subjects include the cancelled row plus ID-less siblings, never identified siblings", () => {
  const cancelled = row("projects/project-1.md#^cut-me", 1, {
    notePath: "projects/project-1.md",
    close: closeDescriptor({ unblocks: 0 }),
    task: {
      path: "projects/project-1.md",
      line: 5,
      text: "- [ ] #task Cut me ^cut-me",
      displayText: "Cut me",
      status: " ",
      preimage: "- [ ] #task Cut me ^cut-me",
    },
  });
  const identified = row("projects/project-1.md#^keep", 2, {
    notePath: "projects/project-1.md",
    close: closeDescriptor({ unblocks: 0 }),
    task: {
      path: "projects/project-1.md",
      line: 6,
      text: "- [ ] #task Keep ^keep",
      displayText: "Keep",
      status: " ",
      preimage: "- [ ] #task Keep ^keep",
    },
  });
  const idless = row("projects/project-1.md#sibling", 3, {
    notePath: "projects/project-1.md",
    close: closeDescriptor({ unblocks: 0 }),
    task: {
      path: "projects/project-1.md",
      line: 7,
      text: "- [ ] #task Sibling idea",
      displayText: "Sibling idea",
      status: " ",
      preimage: "- [ ] #task Sibling idea",
    },
  });
  const modal = { model: { groups: [{ rows: [cancelled, identified, idless] }] } };
  const subjects = helpers.successorReasonSubjects(cancelled, modal);
  assert.deepEqual(subjects, [
    { path: "projects/project-1.md", line: 4, blockId: "cut-me" },
    { path: "projects/project-1.md", line: 6 },
  ], "cancelled row plus ID-less sibling, identified sibling stays linkable");
  // One-arg form keeps working.
  assert.deepEqual(helpers.successorReasonSubjects(cancelled), [
    { path: "projects/project-1.md", line: 4, blockId: "cut-me" },
  ]);
});
