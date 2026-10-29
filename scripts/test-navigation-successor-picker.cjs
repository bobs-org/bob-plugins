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
    themeIntent: { deliberate: true, linkOnce: false, shown: WRITE_SHOWN },
  };
  const nav = normalizeSuccessorDestinationOverride(valid);
  assert.deepEqual(nav, {
    kind: "new",
    name: "Write",
    preserveSpelling: true,
    themeIntent: { deliberate: true, linkOnce: false, shown: WRITE_SHOWN },
  });
  const cycler = cyclerHelpers.normalizeSuccessorPickDestination(nav);
  assert.deepEqual(cycler, nav);
  const existing = normalizeSuccessorDestinationOverride({
    kind: "existing",
    entryLine: 4,
    entryText: "- [ ] () — DEEP",
    title: "DEEP",
    themeIntent: { deliberate: false, linkOnce: false, shown: DEEP_SHOWN },
  });
  assert.deepEqual(cyclerHelpers.normalizeSuccessorPickDestination(existing), existing);
  assert.deepEqual(
    normalizeSuccessorThemeIntent({ deliberate: true, linkOnce: true, shown: WRITE_SHOWN }),
    { deliberate: false, linkOnce: true, shown: WRITE_SHOWN },
  );
  assert.deepEqual(
    cyclerHelpers.normalizeSuccessorThemeIntent({ deliberate: true, linkOnce: true, shown: null }),
    { deliberate: false, linkOnce: true, shown: null },
  );
});

test("malformed themeIntent is dropped without rejecting a valid destination", () => {
  const { normalizeSuccessorDestinationOverride } = helpers;
  const malformed = [
    { deliberate: "yes", linkOnce: false, shown: null },
    { deliberate: true, linkOnce: 1, shown: null },
    { deliberate: true, linkOnce: false, shown: "write" },
    { deliberate: true, linkOnce: false, shown: {} },
    { deliberate: true, linkOnce: false, shown: { theme: {} } },
    { deliberate: true, linkOnce: false, shown: { theme: { key: "" } } },
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
        themeIntent: { deliberate: true, linkOnce: false, shown: WRITE_SHOWN },
      };
    }
    return {
      kind: "existing",
      entryLine: 5,
      entryText: "- [ ] () — DEEP",
      title: "DEEP",
      themeIntent: { deliberate: false, linkOnce: false, shown: DEEP_SHOWN },
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

test("Alt+Enter link-once and untouched preselection keep validated intent", async () => {
  const note = taskNote();
  const plugin = makePluginWithDestination(async () => ({
    kind: "new",
    name: "WRITE",
    themeIntent: { deliberate: true, linkOnce: true, shown: WRITE_SHOWN },
  }), { files: { [note.path]: note.text } });
  const first = await openPicker(plugin, taskAwareModel([note]));
  assert.equal(await first.modal.retargetRowsForDestination(), true);
  assert.deepEqual(first.modal.destinationOverrides.get("opaque:task/0").themeIntent, {
    deliberate: false,
    linkOnce: true,
    shown: WRITE_SHOWN,
  });
  first.modal.close();
  assert.equal(await first.pending, null);

  const untouched = makePluginWithDestination(async () => ({
    kind: "existing",
    entryLine: 2,
    entryText: "- [ ] () — WRITE",
    title: "WRITE",
    themeIntent: { deliberate: false, linkOnce: false, shown: WRITE_SHOWN },
  }), { files: { [note.path]: note.text } });
  const second = await openPicker(untouched, taskAwareModel([note]));
  assert.equal(await second.modal.retargetRowsForDestination(), true);
  assert.deepEqual(second.modal.destinationOverrides.get("opaque:task/0").themeIntent, {
    deliberate: false,
    linkOnce: false,
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

