// SO21, SO22, SO25, and SO32: the real nav picker lifecycle, selection,
// group/filter reachability, review-walk hold, and non-rejecting API.
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
  };
}

function modelFor(count, options = {}) {
  const group = options.group || "hand_off";
  const rows = Array.from({ length: count }, (_, index) => row(
    options.keyPrefix ? `${options.keyPrefix}:${index}` : `opaque:key/${index}#${index}`,
    index + 1,
    {
      ...(options.rowOptions && options.rowOptions(index) ? options.rowOptions(index) : {}),
    },
  ));
  return {
    title: "Choose successors",
    predecessors: [{ notePath: "work/close.md", blockId: "closed", text: "Close task" }],
    groups: [{
      group,
      header: options.header || (group === "project" ? "- [ ] #prj Build the project ^prj" : "Hand-offs"),
      project: options.project || (group === "project" ? "projects/large-project.md" : ""),
      rows,
      ...(options.folded ? { folded: options.folded } : {}),
    }],
    ...(options.budget ? { budget: options.budget } : {}),
  };
}

function makePlugin(options = {}) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  let now = options.now === undefined ? 1000 : options.now;
  plugin.app = { workspace: {}, vault: {}, plugins: { plugins: {} } };
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

async function openPicker(plugin, model) {
  const pending = plugin.api.successors.pick(model);
  await Promise.resolve();
  const modal = plugin.activeSuccessorPicker;
  assert.ok(modal, "pick opens a modal for selectable offers");
  return { pending, modal };
}

async function finishWithEnter(plugin, modal, time = 1350) {
  plugin.setNow(time);
  pressKey(modal, "Enter");
}

test("1, 6, 11, and 20 offers start unmarked and retain supplied opaque keys", async () => {
  for (const count of [1, 6, 11, 20]) {
    const plugin = makePlugin();
    const model = modelFor(count);
    const { pending, modal } = await openPicker(plugin, model);
    assert.equal(modal.markedKeys.size, 0, `${count} offers start with no marks`);
    assert.equal(modal.model.selectableCount, count);
    assert.deepEqual(modal.model.groups[0].rows.map((item) => item.key), model.groups[0].rows.map((item) => item.key));
    modal.close();
    assert.equal(await pending, null);
    assert.equal(plugin.activeSuccessorPicker, null);
  }
});

test("Tab marks a subset, returns model order, and group Ctrl+A includes collapsed offers but excludes muted rows", async () => {
  const plugin = makePlugin();
  const subsetModel = modelFor(6);
  const subset = await openPicker(plugin, subsetModel);
  pressKey(subset.modal, "Tab");
  pressKey(subset.modal, "Tab");
  assert.deepEqual(Array.from(subset.modal.markedKeys), ["opaque:key/0#0", "opaque:key/1#1"]);
  await finishWithEnter(plugin, subset.modal);
  assert.deepEqual(await subset.pending, {
    picks: [{ key: "opaque:key/0#0" }, { key: "opaque:key/1#1" }],
  });

  const groupPlugin = makePlugin();
  const projectModel = modelFor(20, {
    group: "project",
    rowOptions: (index) => index % 5 === 0
      ? { selectable: false, mutedReason: "waits on 1 prerequisite" }
      : {},
  });
  const all = await openPicker(groupPlugin, projectModel);
  assert.ok(findAll(all.modal.resultsEl, "bob-successor-more").length, "large project group starts folded");
  pressKey(all.modal, "a", { ctrlKey: true });
  const expected = projectModel.groups[0].rows.filter((item) => item.selectable).map((item) => item.key);
  assert.deepEqual(all.modal.model.groups[0].rows.filter((item) => all.modal.markedKeys.has(item.key)).map((item) => item.key), expected);
  assert.equal(all.modal.markedKeys.size, expected.length);
  await finishWithEnter(groupPlugin, all.modal);
  assert.deepEqual((await all.pending).picks.map((item) => item.key), expected);
});

test("filtering expands matches, collapse state survives clearing, and hidden marks still submit", async () => {
  const plugin = makePlugin();
  const model = modelFor(20, { group: "project", keyPrefix: "stable opaque" });
  const { pending, modal } = await openPicker(plugin, model);
  pressKey(modal, "Tab");
  const firstKey = model.groups[0].rows[0].key;
  modal.inputEl.value = "Offer task 20";
  modal.inputEl.listeners.input();
  assert.ok(modal.visibleItems.some((item) => item.kind === "offer" && item.row.key === model.groups[0].rows[19].key));
  assert.equal(modal.markedKeys.has(firstKey), true);
  modal.inputEl.value = "no such task";
  modal.inputEl.listeners.input();
  assert.equal(modal.visibleItems.length, 0, "empty filters show no navigable choices");
  modal.inputEl.value = "";
  modal.inputEl.listeners.input();
  assert.equal(modal.expandedGroups.size, 0, "filter expansion does not change the user's collapsed state");
  assert.ok(findAll(modal.resultsEl, "bob-successor-more").length);
  await finishWithEnter(plugin, modal);
  assert.deepEqual(await pending, { picks: [{ key: firstKey }] }, "filtered-out marks remain selected and are submitted");

  const mousePlugin = makePlugin();
  const mouse = await openPicker(mousePlugin, modelFor(20, { group: "project" }));
  click(findAll(mouse.modal.resultsEl, "bob-successor-more")[0]);
  assert.equal(mouse.modal.expandedGroups.has(0), true, "the more control expands by mouse");
  assert.equal(mouse.modal.visibleItems.filter((item) => item.kind === "offer").length, 20);
  mouse.modal.close();
  assert.equal(await mouse.pending, null);

  const keyboardPlugin = makePlugin();
  const keyboard = await openPicker(keyboardPlugin, modelFor(20, { group: "project" }));
  const moreIndex = keyboard.modal.visibleItems.findIndex((item) => item.kind === "expand");
  keyboard.modal.selectedIndex = moreIndex;
  keyboardPlugin.setNow(1350);
  pressKey(keyboard.modal, "Enter");
  assert.equal(keyboard.modal.expandedGroups.has(0), true, "the highlighted more control expands by keyboard");
  keyboard.modal.close();
  assert.equal(await keyboard.pending, null);
});

test("group headers, folded counts, destinations, IDs, and budget meter render with over-budget picks allowed", async () => {
  const plugin = makePlugin();
  const model = modelFor(5, {
    group: "project",
    folded: { hidden: 2, alreadyPlanned: 3, subProjects: 4 },
    budget: { links: 3, max: 4 },
    rowOptions: (index) => index === 0 ? { needsBlockId: true, destinationLabel: "JOB" } : {},
  });
  const { pending, modal } = await openPicker(plugin, model);
  const text = allText(modal.resultsEl);
  assert.match(text, /Project ‹large-project›/);
  assert.match(text, /Build the project \^prj/);
  assert.match(text, /2 hidden/);
  assert.match(text, /3 already planned/);
  assert.match(text, /4 sub-projects stay blocked until the next reconcile/);
  assert.match(text, /→ JOB/);
  assert.match(text, /needs \^id/);
  assert.match(allText(modal.footerEl), /pull in 1/);
  assert.match(allText(modal.footerEl), /plan 3\/4 → 4\/4/);
  pressKey(modal, "a", { ctrlKey: true });
  assert.match(allText(modal.footerEl), /plan 3\/4 → 8\/4 · over plan/);
  await finishWithEnter(plugin, modal);
  assert.equal((await pending).picks.length, 5, "over-budget selections are submitted");
});

test("Enter modifiers, repeats, and the deterministic 349/350 ms guard are consumed", async () => {
  const plugin = makePlugin({ now: 1000 });
  const { pending, modal } = await openPicker(plugin, modelFor(1));
  for (const options of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { repeat: true },
  ]) {
    const event = pressKey(modal, "Enter", options);
    assert.equal(event.defaultPrevented, true);
    assert.equal(modal.pickerOpen, true);
  }
  plugin.setNow(1349);
  const before = pressKey(modal, "Enter");
  assert.equal(before.defaultPrevented, true);
  assert.equal(modal.pickerOpen, true, "349 ms is still guarded");
  plugin.setNow(1350);
  pressKey(modal, "Enter");
  assert.deepEqual(await pending, { picks: [{ key: "opaque:key/0#0" }] }, "350 ms is eligible");
});

test("Escape, outside close, repeat close, concurrent calls, and unusable models settle safely", async () => {
  const plugin = makePlugin();
  const escape = await openPicker(plugin, modelFor(1));
  pressKey(escape.modal, "Escape");
  assert.equal(await escape.pending, null);
  escape.modal.close();
  assert.equal(plugin.activeSuccessorPicker, null);

  const outside = await openPicker(plugin, modelFor(1));
  outside.modal.close();
  outside.modal.close();
  assert.equal(await outside.pending, null);

  const concurrent = await openPicker(plugin, modelFor(6));
  pressKey(concurrent.modal, "Tab");
  assert.equal(await plugin.api.successors.pick(modelFor(1)), null);
  assert.equal(plugin.activeSuccessorPicker, concurrent.modal);
  assert.equal(concurrent.modal.markedKeys.size, 1, "the second call does not touch the first modal's marks");
  concurrent.modal.close();
  assert.equal(await concurrent.pending, null);

  assert.equal(await plugin.api.successors.pick({ title: "bad", groups: [] }), null);
  const muted = modelFor(2, { rowOptions: () => ({ selectable: false, mutedReason: "blocked" }) });
  assert.equal(await plugin.api.successors.pick(muted), null);
});

test("the review-walk hold survives the 3000 ms timeout and releases with the matching completion owner", async () => {
  const plugin = makePlugin({ now: 1000 });
  plugin.reviewLanding = { key: "walk.md:1" };
  plugin.reviewLandingEpoch = 7;
  plugin.reviewGestureSeq = 4;
  plugin.reviewWalkLock = 4000;
  const owner = plugin.beginReviewSuccessorGestureOwner({ seq: 4, epoch: 7, key: "walk.md:1" }, "capture");
  const { pending, modal } = await openPicker(plugin, modelFor(1));
  assert.equal(plugin.reviewSuccessorWalkHold, owner);
  plugin.setNow(5000);
  assert.equal(plugin.reviewWalkBusy(), true, "the explicit hold outlives the numeric lock");
  modal.close();
  assert.equal(await pending, null);
  assert.equal(plugin.reviewWalkBusy(), true, "dismissal leaves no unlocked gap before completion");
  assert.equal(plugin.releaseReviewSuccessorGestureOwner({ seq: 3, epoch: 7 }), false);
  assert.equal(plugin.reviewWalkBusy(), true, "a stale owner cannot release the active hold");
  plugin.releaseReviewSuccessorGestureOwner(owner);
  plugin.reviewWalkLock = 5350;
  assert.equal(plugin.reviewWalkBusy(), true, "the normal post-answer settling lock remains after owner release");
});

test("unload closes a pending modal, settles old and replacement APIs to null, and open failure cleans up", async () => {
  const plugin = makePlugin();
  plugin.cleanupVimJumpHistoryMappings = () => {};
  plugin.cancelPendingTaskMoveJump = () => {};
  plugin.cancelPendingVimJumpDestination = () => {};
  plugin.vimJumpHistory = null;
  const retainedApi = plugin.api;
  const pending = retainedApi.successors.pick(modelFor(1));
  await Promise.resolve();
  assert.ok(plugin.activeSuccessorPicker);
  plugin.onunload();
  assert.equal(await pending, null);
  assert.equal(plugin.activeSuccessorPicker, null);
  assert.equal(await retainedApi.successors.pick(modelFor(1)), null);
  assert.equal(await plugin.api.successors.pick(modelFor(1)), null);

  const failurePlugin = makePlugin();
  const Picker = helpers.SuccessorOfferPickerModal;
  const originalOnOpen = Picker.prototype.onOpen;
  Picker.prototype.onOpen = function throwDuringOpen() { throw new Error("render failed"); };
  try {
    assert.equal(await failurePlugin.api.successors.pick(modelFor(1)), null);
    assert.equal(failurePlugin.activeSuccessorPicker, null);
  } finally {
    Picker.prototype.onOpen = originalOnOpen;
  }
});
