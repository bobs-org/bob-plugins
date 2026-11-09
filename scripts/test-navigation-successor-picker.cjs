// SO21, SO22, SO25, and SO32: the real nav picker lifecycle, selection,
// group/filter reachability, review-walk hold, and non-rejecting API.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
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
const CyclerPlugin = require("../plugins/task-status-cycler/main.js");
const cyclerHelpers = CyclerPlugin.helpers;
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
    ...(options.suffix ? { suffix: options.suffix } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.task ? { task: options.task } : {}),
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

test("Ctrl+N / Ctrl+P move the highlight like ArrowDown / ArrowUp", async () => {
  const plugin = makePlugin();
  const model = modelFor(3);
  const { pending, modal } = await openPicker(plugin, model);
  assert.equal(modal.selectedIndex, 0);

  const down = pressKey(modal, "n", { ctrlKey: true });
  assert.equal(down.defaultPrevented, true);
  assert.equal(modal.selectedIndex, 1);
  assert.equal(modal.markedKeys.size, 0);
  const highlighted = findAll(modal.resultsEl, "is-highlighted");
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].getAttribute("aria-selected"), "true");
  assert.equal(highlighted[0].getAttribute("data-successor-key"), model.groups[0].rows[1].key);

  pressKey(modal, "n", { ctrlKey: true });
  assert.equal(modal.selectedIndex, 2);
  const wrap = pressKey(modal, "n", { ctrlKey: true });
  assert.equal(wrap.defaultPrevented, true);
  assert.equal(modal.selectedIndex, 0);

  const wrapUp = pressKey(modal, "p", { ctrlKey: true });
  assert.equal(wrapUp.defaultPrevented, true);
  assert.equal(modal.selectedIndex, 2);
  pressKey(modal, "p", { ctrlKey: true });
  assert.equal(modal.selectedIndex, 1);

  pressKey(modal, "N", { ctrlKey: true });
  assert.equal(modal.selectedIndex, 2, "Caps Lock Ctrl+N still moves");

  const before = modal.selectedIndex;
  const meta = pressKey(modal, "n", { metaKey: true });
  assert.equal(meta.defaultPrevented, false);
  assert.equal(modal.selectedIndex, before);
  const alt = pressKey(modal, "n", { ctrlKey: true, altKey: true });
  assert.equal(alt.defaultPrevented, false);
  assert.equal(modal.selectedIndex, before);

  await finishWithEnter(plugin, modal);
  assert.deepEqual(await pending, { picks: [{ key: model.groups[0].rows[2].key }] });
});

test("Ctrl+P wraps to the collapsed group's expand row", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, modelFor(20, { group: "project" }));
  assert.equal(modal.selectedIndex, 0);
  const event = pressKey(modal, "p", { ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  const last = modal.visibleItems[modal.selectedIndex];
  assert.equal(last.kind, "expand");
  assert.equal(modal.selectedIndex, modal.visibleItems.length - 1);
  await finishWithEnter(plugin, modal);
  assert.equal(modal.expandedGroups.has(0), true, "Enter on the expand row expands the group");
  modal.close();
  assert.equal(await pending, null);
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

function makePluginWithDestination(pickImpl, options = {}) {
  const plugin = makePlugin();
  plugin.app.plugins.plugins["block-id-prompt"] = {
    api: { pomodoroLinkPicker: { version: 1, pick: pickImpl } },
  };
  if (options.files) {
    plugin.app.vault = {
      getAbstractFileByPath: (path) => (
        Object.prototype.hasOwnProperty.call(options.files, path) ? { path } : null
      ),
      cachedRead: async (file) => options.files[file.path],
    };
  }
  if (options.leaves) {
    plugin.app.workspace.getLeavesOfType = (type) => (
      type === "markdown" ? options.leaves : []
    );
  }
  return plugin;
}

function taskNote(options = {}) {
  const path = options.path || "projects/write.md";
  const before = Array.isArray(options.before) ? options.before : ["# Project", ""];
  const lineText = options.lineText || "- [ ] #task Offer task ^offer";
  const after = Array.isArray(options.after) ? options.after : [];
  const lines = [...before, lineText, ...after];
  return {
    path,
    text: lines.join("\n"),
    line: before.length + 1,
    preimage: lineText,
    displayText: options.displayText || "Offer task",
    status: options.status || " ",
  };
}

function taskAwareRow(key, note, extra = {}) {
  return row(key, extra.index || 1, {
    text: note.displayText,
    notePath: note.path,
    status: extra.status || "Ready",
    ...extra,
    task: {
      path: note.path,
      line: note.line,
      text: note.text,
      displayText: note.displayText,
      status: note.status,
      preimage: note.preimage,
    },
  });
}

function taskAwareModel(notes) {
  return {
    title: "Choose successors",
    predecessors: [{ notePath: "work/close.md", blockId: "closed", text: "Close task" }],
    groups: [{
      group: "hand_off",
      header: "Hand-offs",
      project: "",
      rows: notes.map((note, index) => taskAwareRow(`opaque:task/${index}`, note, { index: index + 1 })),
    }],
  };
}

async function flush(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

test("destination override shapes normalize and label", () => {
  const { normalizeSuccessorDestinationOverride, successorDestinationOverrideLabel } = helpers;
  assert.deepEqual(
    normalizeSuccessorDestinationOverride({ kind: "existing", entryLine: 4, entryText: "- [ ] () — DEEP", title: "DEEP" }),
    { kind: "existing", entryLine: 4, entryText: "- [ ] () — DEEP", title: "DEEP" },
  );
  assert.deepEqual(normalizeSuccessorDestinationOverride({ kind: "new", name: "  WRITE " }), { kind: "new", name: "WRITE" });
  assert.deepEqual(
    normalizeSuccessorDestinationOverride({ kind: "new", name: "Write", preserveSpelling: true }),
    { kind: "new", name: "Write", preserveSpelling: true },
  );
  assert.equal(normalizeSuccessorDestinationOverride({ kind: "existing", entryLine: -1, entryText: "x" }), null);
  assert.equal(normalizeSuccessorDestinationOverride({ kind: "new", name: "" }), null);
  assert.equal(normalizeSuccessorDestinationOverride({ kind: "other" }), null);
  assert.equal(normalizeSuccessorDestinationOverride(null), null);
  assert.equal(successorDestinationOverrideLabel({ kind: "new", name: "WRITE" }), "WRITE");
  assert.equal(successorDestinationOverrideLabel({ kind: "existing", entryLine: 4, entryText: "x", title: "DEEP" }), "DEEP");
  assert.equal(successorDestinationOverrideLabel(null), "");
});

test("destination picker detection needs block-id-prompt api v1 with pick", () => {
  const { getSuccessorDestinationPickerApi } = helpers;
  assert.equal(getSuccessorDestinationPickerApi(null), null);
  assert.equal(getSuccessorDestinationPickerApi({ plugins: { plugins: {} } }), null);
  assert.equal(getSuccessorDestinationPickerApi({ plugins: { plugins: { "block-id-prompt": { api: { pomodoroLinkPicker: { version: 0, pick: async () => null } } } } } }), null);
  const api = { version: 1, pick: async () => null };
  assert.equal(getSuccessorDestinationPickerApi({ plugins: { plugins: { "block-id-prompt": { api: { pomodoroLinkPicker: api } } } } }), api);
});

test("Ctrl+Shift+Enter retargets marked rows, shows the override, and returns it with the picks", async () => {
  const plugin = makePluginWithDestination(async () => ({ kind: "new", name: "DEEP" }));
  const { pending, modal } = await openPicker(plugin, modelFor(3));
  assert.ok(modal.footerHints.some((hint) => hint.label === "retarget"), "hint appears when the picker exists");
  pressKey(modal, "Tab");
  pressKey(modal, "Tab");
  assert.equal(await modal.retargetRowsForDestination(), true);
  assert.deepEqual(
    Array.from(modal.destinationOverrides.entries()),
    [["opaque:key/0#0", { kind: "new", name: "DEEP" }], ["opaque:key/1#1", { kind: "new", name: "DEEP" }]],
  );
  assert.match(allText(modal.resultsEl), /→ DEEP/);
  await finishWithEnter(plugin, modal);
  assert.deepEqual(await pending, {
    picks: [
      { key: "opaque:key/0#0", destination: { kind: "new", name: "DEEP" } },
      { key: "opaque:key/1#1", destination: { kind: "new", name: "DEEP" } },
    ],
  });
});

test("Ctrl+Shift+Enter keypress retargets the highlighted row when nothing is marked", async () => {
  let calls = 0;
  const plugin = makePluginWithDestination(async () => {
    calls += 1;
    return { kind: "existing", entryLine: 5, entryText: "- [ ] () — DEEP", title: "DEEP" };
  });
  const { pending, modal } = await openPicker(plugin, modelFor(2));
  pressKey(modal, "Enter", { ctrlKey: true, shiftKey: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(modal.destinationOverrides.size, 1);
  await finishWithEnter(plugin, modal);
  const result = await pending;
  assert.equal(result.picks.length, 1);
  assert.deepEqual(result.picks[0].destination, { kind: "existing", entryLine: 5, entryText: "- [ ] () — DEEP", title: "DEEP" });
});

test("a cancelled destination pick and a missing picker leave rows untouched", async () => {
  const cancelled = makePluginWithDestination(async () => null);
  const first = await openPicker(cancelled, modelFor(1));
  assert.equal(await first.modal.retargetRowsForDestination(), false);
  assert.equal(first.modal.destinationOverrides.size, 0);
  first.modal.close();
  assert.equal(await first.pending, null);

  const malformed = makePluginWithDestination(async () => ({ kind: "new", name: "" }));
  const second = await openPicker(malformed, modelFor(1));
  assert.equal(await second.modal.retargetRowsForDestination(), false);
  assert.equal(second.modal.destinationOverrides.size, 0);
  second.modal.close();
  assert.equal(await second.pending, null);

  const plain = makePlugin();
  const third = await openPicker(plain, modelFor(1));
  assert.ok(!third.modal.footerHints.some((hint) => hint.label === "retarget"), "no hint without the picker");
  assert.equal(await third.modal.retargetRowsForDestination(), false);
  pressKey(third.modal, "Enter", { ctrlKey: true, shiftKey: true });
  assert.ok(plain.activeSuccessorPicker, "the keypress is a no-op without the picker");
  third.modal.close();
  assert.equal(await third.pending, null);
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

const WRITE_SHOWN = {
  theme: { key: "write", name: "WRITE" },
  source: "note",
  label: "from write.md",
};
const DEEP_SHOWN = {
  theme: { key: "deep", name: "DEEP" },
  source: "task",
  inherited: { theme: { key: "deep", name: "DEEP" }, source: "note" },
};

test("themeIntent and preserveSpelling survive both destination normalizers", () => {
  const { normalizeSuccessorDestinationOverride, normalizeSuccessorThemeIntent } = helpers;
  const valid = {
    kind: "new",
    name: "Write",
    preserveSpelling: true,
    themeIntent: { deliberate: true, retype: false, shown: WRITE_SHOWN },
  };
  const nav = normalizeSuccessorDestinationOverride(valid);
  assert.deepEqual(nav, {
    kind: "new",
    name: "Write",
    preserveSpelling: true,
    themeIntent: { deliberate: true, retype: false, shown: WRITE_SHOWN },
  });
  const cycler = cyclerHelpers.normalizeSuccessorPickDestination(nav);
  assert.deepEqual(cycler, nav);
  const existing = normalizeSuccessorDestinationOverride({
    kind: "existing",
    entryLine: 4,
    entryText: "- [ ] () — DEEP",
    title: "DEEP",
    themeIntent: { deliberate: false, retype: false, shown: DEEP_SHOWN },
  });
  assert.deepEqual(cyclerHelpers.normalizeSuccessorPickDestination(existing), existing);
  assert.deepEqual(
    normalizeSuccessorThemeIntent({ deliberate: true, retype: true, shown: WRITE_SHOWN }),
    { deliberate: true, retype: true, shown: WRITE_SHOWN },
  );
  assert.deepEqual(
    cyclerHelpers.normalizeSuccessorThemeIntent({ deliberate: true, retype: true, shown: null }),
    { deliberate: true, retype: true, shown: null },
  );
});

test("malformed themeIntent is dropped without rejecting a valid destination", () => {
  const { normalizeSuccessorDestinationOverride } = helpers;
  const malformed = [
    { deliberate: "yes", retype: false, shown: null },
    { deliberate: true, retype: 1, shown: null },
    { deliberate: true, retype: false, shown: "write" },
    { deliberate: true, retype: false, shown: {} },
    { deliberate: true, retype: false, shown: { theme: {} } },
    { deliberate: true, retype: false, shown: { theme: { key: "" } } },
    "intent",
    42,
  ];
  for (const themeIntent of malformed) {
    assert.deepEqual(
      normalizeSuccessorDestinationOverride({ kind: "new", name: "WRITE", themeIntent }),
      { kind: "new", name: "WRITE" },
      `nav drops ${JSON.stringify(themeIntent)}`,
    );
    assert.deepEqual(
      cyclerHelpers.normalizeSuccessorPickDestination({ kind: "new", name: "WRITE", themeIntent }),
      { kind: "new", name: "WRITE" },
      `cycler drops ${JSON.stringify(themeIntent)}`,
    );
  }
});

test("the picker model carries validated task context and drops malformed task objects", () => {
  const { normalizeSuccessorPickerModel, normalizeSuccessorPickerTaskContext } = helpers;
  const note = taskNote({ before: ["# Project", "intro"], lineText: "- [ ] #task Later line ^later" });
  const normalized = normalizeSuccessorPickerModel(taskAwareModel([note]));
  assert.deepEqual(normalized.groups[0].rows[0].task, {
    path: note.path,
    line: 3,
    text: note.text,
    displayText: note.displayText,
    status: note.status,
    preimage: note.preimage,
  });
  assert.equal(normalizeSuccessorPickerTaskContext({ path: "x.md", line: 0, text: "a", preimage: "a" }), null);
  const withoutTask = normalizeSuccessorPickerModel(modelFor(1));
  assert.equal(withoutTask.groups[0].rows[0].task, undefined);
  const malformed = taskAwareModel([note]);
  malformed.groups[0].rows[0].task = { path: note.path, line: 3, text: note.text };
  assert.equal(normalizeSuccessorPickerModel(malformed).groups[0].rows[0].task, undefined);
});

test("task-aware retargets pass each successor's context, including a non-first line", async () => {
  const write = taskNote({
    path: "projects/write.md",
    displayText: "Write docs",
    status: " ",
    lineText: "- [ ] #task Write docs ^write",
  });
  const deep = taskNote({
    path: "projects/deep.md",
    before: ["# Deep", "", "prelude"],
    displayText: "Deep work",
    status: "?",
    lineText: "- [?] #task Deep work ^deep",
  });
  const requests = [];
  const plugin = makePluginWithDestination(async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      return {
        kind: "new",
        name: "WRITE",
        themeIntent: { deliberate: true, retype: false, shown: WRITE_SHOWN },
      };
    }
    return {
      kind: "existing",
      entryLine: 5,
      entryText: "- [ ] () — DEEP",
      title: "DEEP",
      themeIntent: { deliberate: false, retype: false, shown: DEEP_SHOWN },
    };
  }, { files: { [write.path]: write.text, [deep.path]: deep.text } });
  const { pending, modal } = await openPicker(plugin, taskAwareModel([write, deep]));
  pressKey(modal, "Tab");
  pressKey(modal, "Tab");
  assert.equal(await modal.retargetRowsForDestination(), true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].task, {
    path: write.path,
    line: write.line,
    text: write.text,
    displayText: write.displayText,
    status: write.status,
  });
  assert.deepEqual(requests[1].task, {
    path: deep.path,
    line: 4,
    text: deep.text,
    displayText: deep.displayText,
    status: deep.status,
  });
  assert.equal(modal.destinationOverrides.get("opaque:task/0").themeIntent.shown, WRITE_SHOWN);
  assert.equal(modal.destinationOverrides.get("opaque:task/1").themeIntent.shown, DEEP_SHOWN);
  await finishWithEnter(plugin, modal);
  const result = await pending;
  const viaCycler = cyclerHelpers.normalizeSuccessorPicks(result);
  assert.equal(viaCycler[0].destination.themeIntent.deliberate, true);
  assert.equal(viaCycler[1].destination.kind, "existing");
  assert.equal(viaCycler[1].destination.themeIntent.shown, DEEP_SHOWN);
});

test("old rows retarget without a task request and cannot acquire theme permission", async () => {
  const requests = [];
  const plugin = makePluginWithDestination(async (request) => {
    requests.push(request);
    return { kind: "new", name: "DEEP" };
  });
  const { pending, modal } = await openPicker(plugin, modelFor(2));
  pressKey(modal, "Tab");
  pressKey(modal, "Tab");
  assert.equal(await modal.retargetRowsForDestination(), true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {});
  assert.deepEqual(requests[1], {});
  assert.equal(modal.destinationOverrides.get("opaque:key/0#0").themeIntent, undefined);
  await finishWithEnter(plugin, modal);
  const result = await pending;
  assert.equal(result.picks[0].destination.themeIntent, undefined);
});

test("Alt+Enter retype and untouched default merge keep validated intent", async () => {
  const note = taskNote();
  const plugin = makePluginWithDestination(async () => ({
    kind: "new",
    name: "WRITE",
    themeIntent: { deliberate: true, retype: true, shown: WRITE_SHOWN },
  }), { files: { [note.path]: note.text } });
  const first = await openPicker(plugin, taskAwareModel([note]));
  assert.equal(await first.modal.retargetRowsForDestination(), true);
  assert.deepEqual(first.modal.destinationOverrides.get("opaque:task/0").themeIntent, {
    deliberate: true,
    retype: true,
    shown: WRITE_SHOWN,
  });
  first.modal.close();
  assert.equal(await first.pending, null);

  const untouched = makePluginWithDestination(async () => ({
    kind: "existing",
    entryLine: 2,
    entryText: "- [ ] () — WRITE",
    title: "WRITE",
    themeIntent: { deliberate: false, retype: false, shown: WRITE_SHOWN },
  }), { files: { [note.path]: note.text } });
  const second = await openPicker(untouched, taskAwareModel([note]));
  assert.equal(await second.modal.retargetRowsForDestination(), true);
  assert.deepEqual(second.modal.destinationOverrides.get("opaque:task/0").themeIntent, {
    deliberate: false,
    retype: false,
    shown: WRITE_SHOWN,
  });
  second.modal.close();
});

test("a changed or missing source refuses the retarget and leaves overrides untouched", async () => {
  const note = taskNote();
  const changed = makePluginWithDestination(async () => ({ kind: "new", name: "WRITE" }), {
    files: { [note.path]: "# Project\n\n- [ ] #task Changed line ^offer" },
  });
  const first = await openPicker(changed, taskAwareModel([note]));
  first.modal.destinationOverrides.set("opaque:task/0", { kind: "new", name: "KEEP" });
  pressKey(first.modal, "Tab");
  assert.equal(await first.modal.retargetRowsForDestination(), false);
  assert.deepEqual(Array.from(first.modal.destinationOverrides.entries()), [
    ["opaque:task/0", { kind: "new", name: "KEEP" }],
  ]);
  assert.equal(first.modal.markedKeys.size, 1);
  first.modal.close();

  const missing = makePluginWithDestination(async () => ({ kind: "new", name: "WRITE" }), { files: {} });
  const second = await openPicker(missing, taskAwareModel([note]));
  assert.equal(await second.modal.retargetRowsForDestination(), false);
  assert.equal(second.modal.destinationOverrides.size, 0);
  second.modal.close();
});

test("an intermediate cancel and a close while awaiting leave previous overrides", async () => {
  const write = taskNote({ path: "projects/write.md", displayText: "Write" });
  const deep = taskNote({ path: "projects/deep.md", displayText: "Deep" });
  const files = { [write.path]: write.text, [deep.path]: deep.text };
  let calls = 0;
  const cancelled = makePluginWithDestination(async () => {
    calls += 1;
    return calls === 1 ? { kind: "new", name: "WRITE" } : null;
  }, { files });
  const first = await openPicker(cancelled, taskAwareModel([write, deep]));
  first.modal.destinationOverrides.set("opaque:task/0", { kind: "new", name: "KEEP" });
  pressKey(first.modal, "Tab");
  pressKey(first.modal, "Tab");
  assert.equal(await first.modal.retargetRowsForDestination(), false);
  assert.deepEqual(Array.from(first.modal.destinationOverrides.entries()), [
    ["opaque:task/0", { kind: "new", name: "KEEP" }],
  ]);
  assert.equal(first.modal.markedKeys.size, 2);
  first.modal.close();

  let resolvePick;
  const hanging = makePluginWithDestination(() => new Promise((resolve) => {
    resolvePick = resolve;
  }), { files: { [write.path]: write.text } });
  const second = await openPicker(hanging, taskAwareModel([write]));
  second.modal.destinationOverrides.set("opaque:task/0", { kind: "new", name: "KEEP" });
  const pendingRetarget = second.modal.retargetRowsForDestination();
  await flush();
  second.modal.close();
  resolvePick({ kind: "new", name: "WRITE" });
  assert.equal(await pendingRetarget, false);
  assert.equal(await second.pending, null);
});

test("open-editor text wins the refresh and reentry is refused while awaiting", async () => {
  const note = taskNote();
  const live = `${note.text}\n`;
  const requests = [];
  let resolvePick;
  const plugin = makePluginWithDestination((request) => {
    requests.push(request);
    return new Promise((resolve) => { resolvePick = resolve; });
  }, {
    files: { [note.path]: "stale" },
    leaves: [{
      view: {
        file: { path: note.path },
        editor: { getValue: () => live },
      },
    }],
  });
  const { modal, pending } = await openPicker(plugin, taskAwareModel([note]));
  const first = modal.retargetRowsForDestination();
  await flush();
  assert.equal(await modal.retargetRowsForDestination(), false, "reentry is refused");
  resolvePick({ kind: "new", name: "WRITE" });
  assert.equal(await first, true);
  assert.equal(requests[0].task.text, live);
  modal.close();
  assert.equal(await pending, null);
});


test("retarget:false hides the hint, ignores Ctrl+Shift+Enter, and drops destinations", async () => {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { plugins: { plugins: {} } };
  const model = {
    title: "Promoted to project · pull in successors",
    predecessors: [{ notePath: "S.md", blockId: "s", text: "Source" }],
    groups: [{ group: "project", header: "Proj", project: "P.md", rows: [row("P.md#^a", 1)], folded: { hidden: 0, alreadyPlanned: 0, subProjects: 0 } }],
  };
  const modal = new helpers.SuccessorOfferPickerModal(plugin.app, model, () => {}, { retarget: false });
  assert.ok(!modal.footerHints.some((hint) => hint.label === "retarget"));
  assert.equal(await modal.retargetRowsForDestination(), false);
  modal.pickerOpen = true;
  let prevented = false;
  modal.handleKeydown({ key: "Enter", ctrlKey: true, shiftKey: true, altKey: false, preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
  assert.equal(prevented, true);
  modal.close();
});

// ---------------------------------------------------------------------------
// Picker API v2 (docs/task-dependencies.md §12.13, §12.15): keep_moving
// groups, caption, tag, folded blocked/scheduled, row lanes, title and icon.

const KM_PROJECT = "projects/sase_badges.md";
const KM_CAPTION = "✓ Draft the badge spec was the last sase_badges task planned today";
const KM_TAG = "ready in sase_badges · not dependents";

function keepMovingGroup(options = {}) {
  return {
    group: "keep_moving",
    header: "Keep ‹sase_badges› moving",
    caption: KM_CAPTION,
    tag: KM_TAG,
    project: KM_PROJECT,
    rows: [
      row("km:pending", 1, { text: "Ship the badge renderer", notePath: KM_PROJECT, status: "/", destinationLabel: "FIX" }),
      row("km:next", 2, { text: "Wire badges into the README", notePath: KM_PROJECT, status: "*", destinationLabel: "FIX" }),
      row("km:ready", 3, { text: "Write badge docs", notePath: KM_PROJECT, status: " ", destinationLabel: "FIX", needsBlockId: true }),
    ],
    folded: { hidden: 1, alreadyPlanned: 0, subProjects: 0, blocked: 2, scheduled: 1 },
    ...options,
  };
}

function keepMovingModel(groups = [keepMovingGroup()], extra = {}) {
  return {
    predecessors: [{ notePath: KM_PROJECT, blockId: "draft-spec", text: "Draft the badge spec" }],
    groups,
    budget: { links: 6, max: 10 },
    ...extra,
  };
}

test("picker API v2 renders a keep_moving group: title, caption, tag, lanes, fold line, and the skip-forward icon", async () => {
  const plugin = makePlugin();
  assert.equal(plugin.api.successors.version, 4);
  const { pending, modal } = await openPicker(plugin, keepMovingModel());
  assert.equal(modal.title, "Keep ‹sase_badges› moving", "only-keep_moving models derive the picker title");
  assert.equal(modal.headerIcon, "skip-forward");
  assert.ok(modal.contentEl.classes.includes("is-keep-moving-only"));
  const group = findAll(modal.resultsEl, "bob-successor-group")[0];
  assert.ok(group.classes.includes("is-keep_moving"));
  assert.equal(findAll(group, "bob-successor-group-title")[0].textContent, "Keep ‹sase_badges› moving");
  assert.equal(findAll(group, "bob-successor-group-tag")[0].textContent, KM_TAG);
  assert.equal(findAll(group, "bob-successor-group-caption")[0].textContent, KM_CAPTION);
  const tagParent = findAll(group, "bob-successor-group-titlebar")[0];
  assert.ok(findAll(tagParent, "bob-successor-group-tag").length === 1, "the tag shares the title line");
  const details = findAll(group, "bob-successor-row-details").map((el) => el.textContent);
  assert.deepEqual(details, [
    "sase_badges · Pending · → FIX",
    "sase_badges · Next · → FIX",
    "sase_badges · Ready · → FIX · needs ^id",
  ], "rows show lane names, never raw symbols");
  const folds = findAll(group, "bob-successor-folded-count").map((el) => el.textContent);
  assert.deepEqual(folds, ["2 blocked · 1 scheduled later · 1 hidden"], "one fold line, zero parts omitted");
  assert.match(allText(modal.footerEl), /plan 6\/10 → 7\/10/);
  pressKey(modal, "a", { ctrlKey: true });
  assert.match(allText(modal.footerEl), /plan 6\/10 → 9\/10/);
  await finishWithEnter(plugin, modal);
  assert.deepEqual((await pending).picks.map((pick) => pick.key), ["km:pending", "km:next", "km:ready"]);
});

test("a keep_moving fold line omits zero parts and orders blocked, scheduled later, hidden", () => {
  const fold = (folded) => helpers.successorPickerFoldedLines(
    helpers.normalizeSuccessorPickerModel(keepMovingModel([keepMovingGroup({ folded })])).groups[0],
  );
  assert.deepEqual(fold({ blocked: 2, scheduled: 1, hidden: 1 }), ["2 blocked · 1 scheduled later · 1 hidden"]);
  assert.deepEqual(fold({ scheduled: 3 }), ["3 scheduled later"]);
  assert.deepEqual(fold({ hidden: 1 }), ["1 hidden"]);
  assert.deepEqual(fold({}), []);
  assert.deepEqual(fold(undefined), []);
});

test("picker titles follow the keep_moving copy table; an explicit title always wins", () => {
  const two = keepMovingModel([
    keepMovingGroup(),
    keepMovingGroup({ project: "projects/sase_docs.md", header: "Keep ‹sase_docs› moving" }),
  ]);
  two.groups[1].rows = [row("km:docs", 9, { text: "Fix docs", notePath: "projects/sase_docs.md", status: "*" })];
  assert.equal(helpers.normalizeSuccessorPickerModel(two).title, "Keep 2 projects moving");
  assert.equal(helpers.normalizeSuccessorPickerModel(keepMovingModel()).title, "Keep ‹sase_badges› moving");
  assert.equal(helpers.normalizeSuccessorPickerModel(keepMovingModel(undefined, { title: "Choose" })).title, "Choose");
  // A model with a non-keep_moving group keeps the existing default title.
  const mixed = keepMovingModel([modelFor(1).groups[0], keepMovingGroup()]);
  assert.equal(helpers.normalizeSuccessorPickerModel(mixed).title, "Choose successor tasks");
  assert.equal(helpers.normalizeSuccessorPickerModel(mixed).keepMovingOnly, false);
  // The project name falls back to the first row's note when `project` is absent.
  const bare = keepMovingModel([keepMovingGroup({ project: "" })]);
  assert.equal(helpers.normalizeSuccessorPickerModel(bare).title, "Keep ‹sase_badges› moving");
});

test("a mixed picker keeps the generic icon and renders keep_moving last with the same heading", async () => {
  const plugin = makePlugin();
  const handOffs = modelFor(1, { group: "hand_off" }).groups[0];
  const project = modelFor(1, { group: "project", keyPrefix: "p" }).groups[0];
  const { pending, modal } = await openPicker(plugin, keepMovingModel([keepMovingGroup(), handOffs, project]));
  assert.equal(modal.headerIcon, "git-pull-request");
  assert.equal(modal.contentEl.classes.includes("is-keep-moving-only"), false);
  assert.equal(modal.title, "Choose successor tasks");
  // Groups render in model order: the cycler supplies keep_moving last; nav never reorders.
  const titles = findAll(modal.resultsEl, "bob-successor-group-title").map((el) => el.textContent);
  assert.deepEqual(titles, ["Keep ‹sase_badges› moving", "Hand-offs", "Project ‹large-project›"]);
  modal.close();
  await pending;

  const ordered = await openPicker(makePlugin(), keepMovingModel([handOffs, project, keepMovingGroup()]));
  const orderedTitles = findAll(ordered.modal.resultsEl, "bob-successor-group-title").map((el) => el.textContent);
  assert.deepEqual(orderedTitles, ["Hand-offs", "Project ‹large-project›", "Keep ‹sase_badges› moving"]);
  const lastGroup = findAll(ordered.modal.resultsEl, "bob-successor-group").pop();
  assert.ok(lastGroup.classes.includes("is-keep_moving"));
  assert.equal(findAll(lastGroup, "bob-successor-group-caption").length, 1);
  assert.equal(findAll(lastGroup, "bob-successor-group-tag").length, 1);
  const earlier = findAll(ordered.modal.resultsEl, "bob-successor-group").slice(0, 2);
  for (const el of earlier) {
    assert.equal(findAll(el, "bob-successor-group-caption").length, 0, "dependent groups have no caption");
    assert.equal(findAll(el, "bob-successor-group-tag").length, 0, "dependent groups have no tag");
  }
  ordered.modal.close();
  await ordered.pending;
});

test("v1 models render exactly as before: no caption, tag, or titlebar, and rows keep their v1 details", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, modelFor(2, {
    group: "hand_off",
    folded: { hidden: 1, alreadyPlanned: 2, subProjects: 1 },
  }));
  assert.equal(modal.title, "Choose successors");
  assert.equal(modal.headerIcon, "git-pull-request");
  assert.equal(findAll(modal.resultsEl, "bob-successor-group-caption").length, 0);
  assert.equal(findAll(modal.resultsEl, "bob-successor-group-tag").length, 0);
  assert.equal(findAll(modal.resultsEl, "bob-successor-group-titlebar").length, 0);
  assert.deepEqual(
    findAll(modal.resultsEl, "bob-successor-folded-count").map((el) => el.textContent),
    ["1 hidden", "2 already planned", "1 sub-project stays blocked until the next reconcile"],
    "legacy fold keys keep one line per count",
  );
  const details = findAll(modal.resultsEl, "bob-successor-row-details").map((el) => el.textContent);
  assert.deepEqual(details[0], "project-1 · Ready · → BOB");
  modal.close();
  await pending;
});

test("legacy groups render the additive blocked and scheduled folds as their own lines", () => {
  const normalized = helpers.normalizeSuccessorPickerModel({
    ...modelFor(1),
    groups: [{ ...modelFor(1).groups[0], folded: { hidden: 1, blocked: 2, scheduled: 3 } }],
  });
  assert.deepEqual(helpers.successorPickerFoldedLines(normalized.groups[0]), ["1 hidden", "2 blocked", "3 scheduled later"]);
});

test("rows show lane names for every group and never a raw status symbol", () => {
  const lane = helpers.successorPickerLaneName;
  assert.equal(lane(undefined, " "), "Ready");
  assert.equal(lane(undefined, "*"), "Next");
  assert.equal(lane(undefined, "/"), "Pending");
  assert.equal(lane(undefined, "?"), "Blocked");
  assert.equal(lane("Pending", " "), "Pending", "a supplied lane wins");
  assert.equal(lane("next", "/"), "Next", "lane names match case-insensitively");
  assert.equal(lane("bogus", "*"), "Next", "an unknown lane falls back to the status");
  assert.equal(lane(undefined, "Ready"), "Ready", "v1 callers already pass lane names");
  assert.equal(lane(undefined, "In Progress"), "In Progress", "unmapped words pass through");
  assert.equal(lane(undefined, "~"), "", "an unmapped symbol is hidden");
  assert.equal(lane(undefined, ""), "");
  const rowFor = (status) => helpers.normalizeSuccessorPickerModel(
    modelFor(1, { rowOptions: () => ({ status }) }),
  ).groups[0].rows[0];
  assert.equal(rowFor("*").lane, "Next");
  const withLane = helpers.normalizeSuccessorPickerModel({
    ...modelFor(1),
    groups: [{ ...modelFor(1).groups[0], rows: [{ ...modelFor(1).groups[0].rows[0], status: "x", lane: "Pending" }] }],
  });
  assert.equal(withLane.groups[0].rows[0].lane, "Pending");
});

test("unknown groups are still dropped and a keep_moving-only model with no selectable row is unusable", async () => {
  const unknown = { ...keepMovingGroup(), group: "surprise" };
  assert.equal(helpers.normalizeSuccessorPickerModel(keepMovingModel([unknown])), null);
  const kept = helpers.normalizeSuccessorPickerModel(keepMovingModel([unknown, keepMovingGroup()]));
  assert.deepEqual(kept.groups.map((group) => group.group), ["keep_moving"]);
  const muted = keepMovingGroup();
  muted.rows = muted.rows.map((item) => ({ ...item, selectable: false, mutedReason: "blocked" }));
  assert.equal(await makePlugin().api.successors.pick(keepMovingModel([muted])), null);
});

test("the filter reaches keep_moving groups by caption, tag, and lane", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, keepMovingModel());
  const visibleKeys = () => modal.visibleItems.filter((item) => item.kind === "offer").map((item) => item.row.key);
  modal.inputEl.value = "not dependents";
  modal.renderResults();
  assert.deepEqual(visibleKeys(), ["km:pending", "km:next", "km:ready"], "the tag matches the whole group");
  modal.inputEl.value = "last sase_badges task";
  modal.renderResults();
  assert.equal(visibleKeys().length, 3, "the caption matches the whole group");
  modal.inputEl.value = "pending";
  modal.renderResults();
  assert.deepEqual(visibleKeys(), ["km:pending"], "the lane name filters rows");
  modal.close();
  await pending;
});

test("keep_moving picks reuse the normal pick/retarget paths: keys and destinations round-trip", async () => {
  const plugin = makePlugin();
  const { pending, modal } = await openPicker(plugin, keepMovingModel());
  pressKey(modal, "Tab");
  plugin.setNow(1350);
  pressKey(modal, "Enter");
  assert.deepEqual(await pending, { picks: [{ key: "km:pending" }] });
});

test("cycler keep-moving model survives nav normalization with identical copy", () => {
  const projectPath = "sase_badges.md";
  const dayPath = "2026/20261101.md";
  const today = "2026-11-01";
  const day = ["# 2026-11-01", "", "## Pomodoros", "- [ ] () — FIX", "\t- [[sase_badges#^spec]]"].join("\n");
  const noteText = [
    "---", 'type: "[[project]]"', "status: wip", "parent: [[sase]]", "---",
    "- [ ] #task Badge project ^prj",
    "- [x] #task Draft the badge spec ^spec",
    "- [/] #task Pending work ^pending",
    "- [*] #task Next work ^next",
    "- [ ] #task Ready work ^ready",
    "- [?] #task Blocked ^blocked",
    "- [ ] #task Future [scheduled:: 2026-12-01] ^future",
    "- [ ] #task Hidden #hide ^hidden",
  ].join("\n");
  const notes = { [projectPath]: noteText };
  const tasks = cyclerHelpers.tasksFromDocuments(Object.entries(notes).map(([path, text]) => ({ path, text })));
  const plan = cyclerHelpers.planSuccessors({
    closed: [{ path: projectPath, blockId: "spec", text: "- [x] #task Draft the badge spec ^spec" }],
    index: cyclerHelpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyAfter: day,
    dailyPath: dayPath,
    today,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: () => true,
    selection: [],
  });
  const model = cyclerHelpers.buildSuccessorPickerModel({
    predecessors: [{ note_path: projectPath, block_id: "spec", text: "Draft the badge spec" }],
    offers: plan.offers,
    foldedByProject: plan.foldedByProject,
  });
  const normalized = helpers.normalizeSuccessorPickerModel(model);
  assert.ok(normalized);
  assert.deepEqual(normalized.groups.map((group) => group.group), ["keep_moving"]);
  const group = normalized.groups[0];
  assert.equal(group.caption, "✓ Draft the badge spec was the last sase_badges task planned today");
  assert.equal(group.tag, "ready in sase_badges · not dependents");
  assert.deepEqual(group.folded, { hidden: 1, alreadyPlanned: 0, subProjects: 0, blocked: 1, scheduled: 1 });
  assert.deepEqual(group.rows.map((row) => row.lane), ["Pending", "Next", "Ready"]);
  assert.equal(normalized.title, model.title);
  assert.equal(normalized.title, "Keep ‹sase_badges› moving");
  assert.equal(helpers.successorPickerGroupTitle(group), model.groups[0].header);

  const selected = cyclerHelpers.planSuccessors({
    closed: [{ path: projectPath, blockId: "spec", text: "- [x] #task Draft the badge spec ^spec" }],
    index: cyclerHelpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyAfter: day,
    dailyPath: dayPath,
    today,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: () => true,
    selection: "all",
  });
  const noticeModel = {
    predecessors: [{ note_path: projectPath, block_id: "spec", text: "Draft the badge spec" }],
    unblocked: selected.unblocked,
    keep_moving: selected.keep_moving,
    failure: null,
  };
  assert.equal(helpers.buildUnblockedNoticeModel(noticeModel).text, cyclerHelpers.successorNoticeText(noticeModel));
  const oneRow = selected.keep_moving.find((row) => String(row.text || "").includes("Ready work")) || selected.keep_moving[0];
  const oneModel = {
    predecessors: noticeModel.predecessors,
    unblocked: [],
    keep_moving: [oneRow],
    failure: null,
  };
  assert.equal(helpers.buildUnblockedNoticeModel(oneModel).text, cyclerHelpers.successorNoticeText(oneModel));
  const mixedModel = {
    predecessors: noticeModel.predecessors,
    unblocked: [{
      text: "Normal task", status_symbol: "*", status_name: "Next",
      link: { entry_name: "FIX" }, trigger: "dependency", not_linked: null,
    }],
    keep_moving: [oneRow],
    failure: null,
  };
  assert.equal(helpers.buildUnblockedNoticeModel(mixedModel).text, cyclerHelpers.successorNoticeText(mixedModel));
  const failedRow = { ...oneRow, link: null, not_linked: "failed", offer: { ...(oneRow.offer || {}), selected: true } };
  const failureModel = {
    predecessors: noticeModel.predecessors,
    unblocked: [],
    keep_moving: [failedRow],
    failure: { count: 1, reason: "daily note changed" },
  };
  assert.equal(helpers.buildUnblockedNoticeModel(failureModel).text, cyclerHelpers.successorNoticeText(failureModel));
});

// ---------------------------------------------------------------------------
// Picker API v3 (docs/task-dependencies.md §12.13, §12.18): relation groups.

const REL_TARGET = "Send implementation prompt";
const REL_CAPTION = "\u201cSend implementation prompt\u201d is done";
const REL_TAG = "your links \u00b7 not dependents";
const REL_HEADER = "Starts after \u201cSend implementation prompt\u201d";
const REL_FOLD = "not offered \u00b7 \u201cWrite rollout notes\u201d waits for \u201cShip schema change\u201d \u00b7 1 already started";

function relationGroup(options = {}) {
  return {
    group: "relation",
    header: REL_HEADER,
    caption: REL_CAPTION,
    tag: REL_TAG,
    foldText: REL_FOLD,
    after: { notePath: "agents.md", blockId: "implement", text: REL_TARGET },
    event: "done",
    label: "starts after",
    rows: [
      row("rel:evaluate", 1, {
        text: "Prepare evaluation prompt",
        notePath: "agents.md",
        status: "*",
        destinationLabel: "BUILD",
        suffix: "after \u201cSend implementation prompt\u201d and \u201cDeploy release\u201d",
      }),
    ],
    folded: { hidden: 1, alreadyPlanned: 0, subProjects: 0, blocked: 1, scheduled: 0, alreadyStarted: 1, waitsFor: 1 },
    ...options,
  };
}

function relationModel(groups = [relationGroup()], extra = {}) {
  return {
    predecessors: [{ notePath: "agents.md", blockId: "implement", text: REL_TARGET }],
    groups,
    budget: { links: 6, max: 10 },
    ...extra,
  };
}

test("picker API v3 renders a relation group: header, caption, tag, fold, title, and link-2 icon", async () => {
  const plugin = makePlugin();
  assert.equal(plugin.api.successors.version, 4);
  const { pending, modal } = await openPicker(plugin, relationModel());
  assert.equal(modal.title, REL_HEADER);
  assert.equal(modal.headerIcon, "link-2");
  assert.ok(modal.contentEl.classes.includes("is-relation-only"));
  const group = findAll(modal.resultsEl, "bob-successor-group")[0];
  assert.ok(group.classes.includes("is-relation"));
  assert.equal(findAll(group, "bob-successor-group-title")[0].textContent, REL_HEADER);
  assert.equal(findAll(group, "bob-successor-group-tag")[0].textContent, REL_TAG);
  assert.equal(findAll(group, "bob-successor-group-caption")[0].textContent, REL_CAPTION);
  assert.deepEqual(findAll(group, "bob-successor-folded-count").map((el) => el.textContent), [REL_FOLD]);
  assert.deepEqual(findAll(group, "bob-successor-row-details").map((el) => el.textContent), [
    "agents \u00b7 Next \u00b7 \u2192 BUILD",
  ]);
  assert.deepEqual(findAll(group, "bob-successor-row-meta").map((el) => el.textContent), [
    "after \u201cSend implementation prompt\u201d and \u201cDeploy release\u201d",
  ]);
  modal.close();
  await pending;
});

test("a mixed picker keeps the generic title and icon and renders relation with caption and tag", async () => {
  const plugin = makePlugin();
  const handOffs = modelFor(1, { group: "hand_off" }).groups[0];
  const { pending, modal } = await openPicker(plugin, relationModel([handOffs, relationGroup()], {
    title: "Pull in successors of Send implementation prompt",
  }));
  assert.equal(modal.headerIcon, "git-pull-request");
  assert.equal(modal.contentEl.classes.includes("is-relation-only"), false);
  assert.equal(modal.title, "Pull in successors of Send implementation prompt");
  const titles = findAll(modal.resultsEl, "bob-successor-group-title").map((el) => el.textContent);
  assert.deepEqual(titles, ["Hand-offs", REL_HEADER]);
  const groups = findAll(modal.resultsEl, "bob-successor-group");
  assert.ok(groups[1].classes.includes("is-relation"));
  assert.equal(findAll(groups[0], "bob-successor-group-caption").length, 0);
  assert.equal(findAll(groups[1], "bob-successor-group-caption").length, 1);
  assert.equal(findAll(groups[1], "bob-successor-group-tag").length, 1);
  modal.close();
  await pending;
});

test("v1 and v2 models still render as before under picker API v3", async () => {
  const plugin = makePlugin();
  const v1 = await openPicker(plugin, modelFor(1, { group: "hand_off" }));
  assert.equal(v1.modal.headerIcon, "git-pull-request");
  assert.equal(findAll(v1.modal.resultsEl, "bob-successor-group-caption").length, 0);
  assert.equal(findAll(v1.modal.resultsEl, "bob-successor-row-meta").length, 0);
  v1.modal.close();
  await v1.pending;
  const v2 = await openPicker(makePlugin(), keepMovingModel());
  assert.equal(v2.modal.headerIcon, "skip-forward");
  assert.ok(v2.modal.contentEl.classes.includes("is-keep-moving-only"));
  v2.modal.close();
  await v2.pending;
});

test("unknown groups are still dropped and a relation-only model with no selectable row is unusable", async () => {
  const unknown = { ...relationGroup(), group: "surprise" };
  assert.equal(helpers.normalizeSuccessorPickerModel(relationModel([unknown])), null);
  const kept = helpers.normalizeSuccessorPickerModel(relationModel([unknown, relationGroup()]));
  assert.deepEqual(kept.groups.map((group) => group.group), ["relation"]);
  const muted = relationGroup();
  muted.rows = muted.rows.map((item) => ({ ...item, selectable: false, mutedReason: "blocked" }));
  assert.equal(await makePlugin().api.successors.pick(relationModel([muted])), null);
});

test("the filter reaches relation groups by caption, tag, fold, suffix, and second reason", async () => {
  const plugin = makePlugin();
  const withReason = relationGroup();
  withReason.rows[0].reason = "\u00b7 starts after \u201cSend implementation prompt\u201d";
  const { pending, modal } = await openPicker(plugin, relationModel([withReason]));
  const visibleKeys = () => modal.visibleItems.filter((item) => item.kind === "offer").map((item) => item.row.key);
  modal.inputEl.value = "not dependents";
  modal.renderResults();
  assert.deepEqual(visibleKeys(), ["rel:evaluate"]);
  modal.inputEl.value = "is done";
  modal.renderResults();
  assert.deepEqual(visibleKeys(), ["rel:evaluate"]);
  modal.inputEl.value = "already started";
  modal.renderResults();
  assert.deepEqual(visibleKeys(), ["rel:evaluate"], "foldText matches the whole group");
  modal.inputEl.value = "Deploy release";
  modal.renderResults();
  assert.deepEqual(visibleKeys(), ["rel:evaluate"], "row suffix filters");
  modal.close();
  await pending;
});

test("relation-only titles follow the copy table; an explicit title always wins", () => {
  const one = helpers.normalizeSuccessorPickerModel(relationModel());
  assert.equal(one.title, REL_HEADER);
  assert.equal(one.relationOnly, true);
  const two = relationModel([
    relationGroup(),
    relationGroup({
      after: { notePath: "agents.md", blockId: "deploy", text: "Deploy release" },
      header: "Starts after \u201cDeploy release\u201d",
      rows: [row("rel:other", 2, { text: "Other", notePath: "agents.md", status: " " })],
    }),
  ]);
  const normalizedTwo = helpers.normalizeSuccessorPickerModel(two);
  assert.equal(normalizedTwo.title, "Starts after 2 tasks");
  assert.equal(
    helpers.normalizeSuccessorPickerModel(relationModel(undefined, { title: "Choose" })).title,
    "Choose",
  );
  const mixed = relationModel([modelFor(1).groups[0], relationGroup()]);
  assert.equal(helpers.normalizeSuccessorPickerModel(mixed).title, "Choose successor tasks");
  assert.equal(helpers.normalizeSuccessorPickerModel(mixed).relationOnly, false);
});

test("relation successor copy vectors drive every copy-table string", () => {
  const vectorsPath = path.join(
    __dirname,
    "../plugins/bob-navigation-hotkeys/scripts/fixtures/relation_successor/vectors.json",
  );
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
  assert.ok(Array.isArray(vectors.copy) && vectors.copy.length > 0);
  for (const vector of vectors.copy) {
    const got = helpers.relationSuccessorCopy(vector.input, vector.expected);
    for (const [key, value] of Object.entries(vector.expected)) {
      assert.deepEqual(got[key], value, `${vector.id} ${vector.name}: ${key}`);
    }
  }
});

