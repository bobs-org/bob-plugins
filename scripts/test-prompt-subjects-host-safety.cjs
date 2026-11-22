// Host safety for `((` in prompts (T11, phase bob-cli-oz.4).
//
// A prompt's `((` can name an ID-less sibling task in the subject's own note
// while the host prompt is open over its own pending write. For every host
// family this test: opens the prompt, names the sibling through the REAL
// block-id-prompt `api.taskLinks` session (same editors, same vault store),
// lets the host submit, and asserts the host's write lands on the right line
// and never refuses as stale. The subject row stays disabled throughout.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
  NavigationHotkeysPlugin,
  TransactionEditor,
  createLinkPickerHarness,
  createBulletPropertyPickerHarness,
  runCardAction,
  openBulletPropertyValueStage,
  confirmScheduleReasonStage,
  buildScheduleReasonConfig,
} = require("./navigation-hotkeys-harness.cjs");
const { createSiblingNamer, assertOneLineInPlace } = require("./prompt-sibling-naming-helpers.cjs");

const TICK = () => new Promise((resolve) => setImmediate(resolve));
const DAILY_PATH = "2026/2026-11-21.md";

function cursorHost({ lines, cursor = { line: 0, ch: 0 }, path = "Plan.md" }) {
  const editor = new TransactionEditor(lines.join("\n"), cursor);
  const file = { path, basename: path.replace(/\.md$/u, ""), extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [file] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file });
  return { editor, file, plugin, path };
}

function linkHost({ tasks, daily, cursor }) {
  const harness = createLinkPickerHarness({
    notes: { "Tasks.md": tasks },
    linkPath: DAILY_PATH,
    linkContent: daily,
    cursor,
  });
  return {
    ...harness,
    view: { editor: harness.linkEditor, file: harness.files.get(DAILY_PATH) },
  };
}

test("S3 cursor release: naming a sibling during the Release prompt never makes the write stale", async () => {
  notices.length = 0;
  const lines = ["- [/] #task Working ^w1", "- [ ] #task Sibling idea", "- [ ] #task Other ^o1"];
  const host = cursorHost({ lines });
  const namer = createSiblingNamer({
    editors: [{ path: host.path, editor: host.editor }],
    sourcePath: host.path,
    subjects: [{ path: host.path, line: 0, blockId: "w1" }],
  });
  await namer.assertSubjectGuarded("Working");
  const before = host.editor.getValue();
  host.plugin.requestLaneReleaseSummary = async (_options, prompt) => {
    assert.deepEqual(prompt.subjects, [{ path: host.path, line: 0, blockId: "w1" }]);
    await namer.nameSibling("Sibling idea", "sibling-idea");
    return { cancelled: false, summary: "did it" };
  };
  const ok = await host.plugin.toggleTaskLane(host.editor, {
    stampText: "2026-09-30 14:32",
    now: new Date(2026, 8, 30, 14, 32),
  });
  assert.equal(ok, true, notices.at(-1));
  const after = host.editor.getValue().split("\n");
  assert.equal(after[0], "- [ ] #task Working ^w1", "the released task landed on its own line");
  assert.match(host.editor.getValue(), /\*2026-09-30 14:32\* — did it/);
  assert.ok(after.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  assert.ok(after.includes("- [ ] #task Other ^o1"));
  assertOneLineInPlace(before, before.replace("Sibling idea", "Sibling idea ^sibling-idea"), 1);
  namer.close();
});

test("S3 cursor release still refuses when the prompt-time edit touches the target line", async () => {
  notices.length = 0;
  const host = cursorHost({ lines: ["- [/] #task Working ^w1", "- [ ] #task Sibling idea"] });
  host.plugin.requestLaneReleaseSummary = async () => {
    host.editor.replaceRange("- [/] #task Working renamed ^w1", { line: 0, ch: 0 }, { line: 0, ch: 23 });
    return { cancelled: false, summary: "did it" };
  };
  const ok = await host.plugin.toggleTaskLane(host.editor, {
    stampText: "2026-09-30 14:32",
    now: new Date(2026, 8, 30, 14, 32),
  });
  assert.equal(ok, false);
  assert.match(notices.at(-1), /changed; no tasks were updated/);
  assert.match(host.editor.getValue(), /Working renamed/, "a genuinely stale target is never written over");
});

test("S2 Move to Next: naming a sibling in the task's note during the prompt never makes the write stale", async () => {
  notices.length = 0;
  const noted = [];
  const harness = linkHost({
    daily: ["## Pomodoros", "- [ ] (**0940-1010**)", "\t- [[Tasks#^a1]]"].join("\n"),
    tasks: ["- [/] #task Fix the parser crash ^a1", "- [ ] #task Sibling idea"].join("\n"),
    cursor: { line: 2, ch: 3 },
  });
  harness.plugin.app.plugins = {
    plugins: {
      "bob-navigation-hotkeys": {
        api: {
          version: 3,
          logRecall: {
            version: 1,
            attach: () => ({ detach() {} }),
            noteUsed: (kind, text) => { noted.push([kind, text]); return true; },
          },
        },
      },
    },
  };
  const namer = createSiblingNamer({
    files: harness.notes,
    editors: [{ path: DAILY_PATH, editor: harness.linkEditor }],
    sourcePath: "Tasks.md",
    subjects: [{ path: "Tasks.md", line: 0, blockId: "a1" }],
  });
  const pending = harness.plugin.toggleTaskLinkLane({ editor: harness.linkEditor, view: harness.view });
  await TICK();
  await TICK();
  const modal = harness.plugin.taskLinkLanePrompt;
  assert.ok(modal, "the Move to Next prompt opened");
  assert.deepEqual(modal.taskLinkLaneSubjects(), [{ path: "Tasks.md", line: 0, blockId: "a1" }]);
  await namer.assertSubjectGuarded("Fix the parser crash");
  await namer.nameSibling("Sibling idea", "sibling-idea");
  modal.inputEl.value = "Finished the API review";
  modal.submit();
  const result = await pending;
  assert.deepEqual(result, { ok: true, mode: "pause", changed: 1 }, notices.at(-1));
  const note = harness.notes["Tasks.md"].split("\n");
  assert.match(note[0], /^- \[\*\] #task Fix the parser crash \^a1/, "the moved task landed on its own line");
  assert.match(harness.notes["Tasks.md"], /— Finished the API review/);
  assert.ok(note.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  namer.close();
});

test("S3 link release: naming a sibling in the linked note during the Release prompt never makes the write stale", async () => {
  notices.length = 0;
  const harness = linkHost({
    daily: ["## Pomodoros", "- [ ] (**0940-1010**)", "\t- [[Tasks#^a1]]"].join("\n"),
    tasks: ["- [/] #task Fix the parser crash ^a1", "- [ ] #task Sibling idea"].join("\n"),
    cursor: { line: 2, ch: 3 },
  });
  const namer = createSiblingNamer({
    files: harness.notes,
    editors: [{ path: DAILY_PATH, editor: harness.linkEditor }],
    sourcePath: "Tasks.md",
    subjects: [{ path: "Tasks.md", line: 0, blockId: "a1" }],
  });
  harness.plugin.requestLaneReleaseSummary = async (_options, prompt) => {
    assert.deepEqual(prompt.subjects.map((entry) => entry.blockId), ["a1"]);
    await namer.nameSibling("Sibling idea", "sibling-idea");
    return { cancelled: false, summary: "parked" };
  };
  const ok = await harness.plugin.toggleTaskLane(harness.linkEditor, {
    stampText: "2026-09-30 14:32",
    now: new Date(2026, 8, 30, 14, 32),
  });
  assert.equal(ok, true, notices.at(-1));
  const note = harness.notes["Tasks.md"].split("\n");
  assert.match(note[0], /^- \[ \] #task Fix the parser crash \^a1/, "the released task landed on its own line");
  assert.match(harness.notes["Tasks.md"], /— parked/);
  assert.ok(note.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  namer.close();
});

// --- Task Card stage writes (S7-S11) ----------------------------------------
// The Task Card is a long-lived picker: it snapshots its target notes when it
// opens, then a prose stage (cancel reason, lane-release reason, schedule
// review, scheduled inline reason) waits for Enter. A sibling named in that
// window must not stale the stage's commit, in either session shape.

function localDateText(today = new Date()) {
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return { year, month, day, dateText: `${year}-${month}-${day}`, dailyPath: `${year}/${year}${month}${day}.md` };
}

async function confirmReasonStage(picker, stage, reasonText) {
  assert.equal(picker.stage, stage);
  picker.inputEl = { value: reasonText };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

test("S7 Task Card cancel (single note): naming a sibling during the reason stage never makes the cancel stale", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: helpers.validateBulletPropertyConfig({ properties: [{ name: "scheduled", values: "date" }] }),
    content: ["- [ ] #task One ^a1", "- [ ] #task Sibling idea"].join("\n"),
    cursor: { line: 0, ch: 0 },
    baseDate: new Date(2026, 9, 2),
    now: new Date(2026, 9, 2, 14, 32),
    app: { plugins: { plugins: {} } },
  });
  assert.equal(harness.open(), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  await runCardAction(picker, "cancel");
  const subjects = helpers.pickerProseSubjects(picker);
  assert.deepEqual(subjects.map((entry) => ({ path: entry.path, line: entry.line, blockId: entry.blockId })), [
    { path: "Tasks.md", line: 0, blockId: "a1" },
  ], "the card's own task is the stage's subject");
  const namer = createSiblingNamer({
    editors: [{ path: "Tasks.md", editor: harness.editor }],
    sourcePath: "Tasks.md",
    subjects,
  });
  await namer.assertSubjectGuarded("One");
  await namer.nameSibling("Sibling idea", "sibling-idea");
  await confirmReasonStage(picker, "cancel-reason", "superseded");
  const lines = harness.editor.getValue().split("\n");
  assert.match(lines[0], /^- \[-\] #task One \[cancelled:: \d{4}-\d{2}-\d{2}\] \^a1$/, "the cancel landed on the card's own task");
  assert.match(harness.editor.getValue(), /superseded/);
  assert.ok(lines.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  harness.plugin.activeBulletPropertyPicker = null;
  namer.close();
});

test("S7 Task Card cancel (Task Link session): naming a sibling in the linked note never makes the cancel stale", async () => {
  for (const noteOpen of [true, false]) {
    notices.length = 0;
    const today = new Date();
    const { dateText, dailyPath } = localDateText(today);
    const linkContent = ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - [[Tasks#^a1]]"].join("\n");
    const taskText = ["- [ ] #task Ship it ^a1", "- [ ] #task Sibling idea"].join("\n");
    const taskEditor = new TransactionEditor(taskText, { line: 0, ch: 0 });
    const harness = createLinkPickerHarness({
      linkPath: dailyPath,
      linkContent,
      cursor: { line: 3, ch: 0 },
      notes: { "Tasks.md": taskText },
      ...(noteOpen ? { openEditors: { "Tasks.md": taskEditor } } : {}),
    });
    assert.equal(
      await harness.plugin.openLinkPicker(harness.linkEditor, { config: harness.config, baseDate: today, random: () => 0 }),
      true,
    );
    const picker = harness.plugin.activeBulletPropertyPicker;
    assert.equal(picker.isLinkSession(), true);
    await runCardAction(picker, "cancel");
    const subjects = helpers.pickerProseSubjects(picker);
    assert.deepEqual(subjects.map((entry) => ({ path: entry.path, line: entry.line, blockId: entry.blockId })), [
      { path: "Tasks.md", line: 0, blockId: "a1" },
    ], "the linked task is the stage's subject");
    const namer = createSiblingNamer({
      files: harness.notes,
      editors: [
        { path: dailyPath, editor: harness.linkEditor },
        ...(noteOpen ? [{ path: "Tasks.md", editor: taskEditor }] : []),
      ],
      sourcePath: "Tasks.md",
      subjects,
    });
    await namer.assertSubjectGuarded("Ship it");
    await namer.nameSibling("Sibling idea", "sibling-idea");
    await confirmReasonStage(picker, "cancel-reason", "superseded");
    const finalText = noteOpen ? taskEditor.getValue() : harness.notes["Tasks.md"];
    const lines = finalText.split("\n");
    assert.equal(lines[0], `- [-] #task Ship it [cancelled:: ${dateText}] ^a1`, `the cancel landed on the linked task's own line (open=${noteOpen})`);
    assert.match(finalText, /superseded/);
    assert.ok(lines.includes("- [ ] #task Sibling idea ^sibling-idea"), `the named sibling kept its ID (open=${noteOpen})`);
    assert.equal(harness.linkEditor.content, "## Pomodoros", "the invoking link bullet was removed");
    harness.plugin.activeBulletPropertyPicker = null;
    namer.close();
  }
});

test("S8 Task Card lane release (Task Link session): naming a sibling during the reason stage never makes the release stale", async () => {
  notices.length = 0;
  const today = new Date();
  const { dailyPath } = localDateText(today);
  const linkContent = ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - [[Tasks#^a1]]"].join("\n");
  const taskText = ["- [/] #task Working ^a1", "- [ ] #task Sibling idea"].join("\n");
  const harness = createLinkPickerHarness({
    linkPath: dailyPath,
    linkContent,
    cursor: { line: 3, ch: 0 },
    notes: { "Tasks.md": taskText },
  });
  assert.equal(
    await harness.plugin.openLinkPicker(harness.linkEditor, { config: harness.config, baseDate: today, random: () => 0 }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  harness.plugin.app.plugins = { plugins: {} };
  await runCardAction(picker, "lane");
  assert.equal(picker.stage, "lane-release-reason");
  const subjects = helpers.pickerProseSubjects(picker);
  assert.deepEqual(subjects.map((entry) => entry.blockId), ["a1"], "the released task is the stage's subject");
  const namer = createSiblingNamer({
    files: harness.notes,
    editors: [{ path: dailyPath, editor: harness.linkEditor }],
    sourcePath: "Tasks.md",
    subjects,
  });
  await namer.nameSibling("Sibling idea", "sibling-idea");
  await confirmReasonStage(picker, "lane-release-reason", "parked");
  const lines = harness.notes["Tasks.md"].split("\n");
  assert.match(lines[0], /^- \[ \] #task Working \^a1/, "the released task landed on its own line");
  assert.match(harness.notes["Tasks.md"], /parked/);
  assert.ok(lines.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  harness.plugin.activeBulletPropertyPicker = null;
  namer.close();
});

test("S10 Task Card schedule review (single note): naming a sibling during the Reason stage never makes the schedule stale", async () => {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    config: buildScheduleReasonConfig(),
    content: ["- [ ] #task Ship the thing ^ship", "- [ ] #task Sibling idea"].join("\n"),
    baseDate: new Date(2026, 7, 3),
    random: () => 0,
    app: { plugins: { plugins: {} } },
  });
  const picker = await openBulletPropertyValueStage(harness, "scheduled");
  const dateItem = picker.items.find((item) => item.kind === "value");
  assert.ok(dateItem);
  picker.openItem(dateItem);
  assert.equal(picker.stage, "schedule-review");
  const subjects = helpers.pickerProseSubjects(picker);
  assert.deepEqual(subjects.map((entry) => entry.blockId), ["ship"], "the scheduled task is the review's subject");
  const namer = createSiblingNamer({
    editors: [{ path: "Tasks.md", editor: harness.editor }],
    sourcePath: "Tasks.md",
    subjects,
  });
  await namer.assertSubjectGuarded("Ship the thing");
  await namer.nameSibling("Sibling idea", "sibling-idea");
  const applied = await confirmScheduleReasonStage(picker, "waiting on the API");
  assert.equal(applied, true, notices.at(-1));
  const lines = harness.editor.getValue().split("\n");
  assert.match(lines[0], new RegExp(`^- \\[ \\] #task Ship the thing \\[scheduled:: ${dateItem.value}\\] \\^ship$`), "the schedule landed on the card's own task");
  assert.match(harness.editor.getValue(), /waiting on the API/, "the reason was logged");
  assert.ok(lines.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  harness.plugin.activeBulletPropertyPicker = null;
  namer.close();
});

test("S10 Task Card schedule review (Task Link session): naming a sibling in the linked note never makes the schedule stale", async () => {
  notices.length = 0;
  const today = new Date();
  const { dailyPath } = localDateText(today);
  const linkContent = ["## Pomodoros", "", "- [ ] Current (0900-0930)", "  - [[Tasks#^a1]]"].join("\n");
  const taskText = ["- [ ] #task Ship it ^a1", "- [ ] #task Sibling idea"].join("\n");
  const harness = createLinkPickerHarness({
    linkPath: dailyPath,
    linkContent,
    cursor: { line: 3, ch: 0 },
    notes: { "Tasks.md": taskText },
  });
  assert.equal(
    await harness.plugin.openLinkPicker(harness.linkEditor, { config: harness.config, baseDate: new Date(2026, 7, 3), random: () => 0 }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.equal(picker.isLinkSession(), true);
  await runCardAction(picker, "schedule");
  const dateItem = picker.items.find((item) => item.kind === "value");
  assert.ok(dateItem);
  picker.openItem(dateItem);
  assert.equal(picker.stage, "schedule-review");
  const subjects = helpers.pickerProseSubjects(picker);
  assert.deepEqual(subjects.map((entry) => entry.blockId), ["a1"], "the linked task is the review's subject");
  const namer = createSiblingNamer({
    files: harness.notes,
    editors: [{ path: dailyPath, editor: harness.linkEditor }],
    sourcePath: "Tasks.md",
    subjects,
  });
  await namer.nameSibling("Sibling idea", "sibling-idea");
  const applied = await confirmScheduleReasonStage(picker, "waiting on the API");
  assert.equal(applied, true, notices.at(-1));
  const lines = harness.notes["Tasks.md"].split("\n");
  assert.match(lines[0], new RegExp(`^- \\[[ ?]\\] #task Ship it \\[scheduled:: ${dateItem.value}\\] \\^a1`), "the schedule landed on the linked task's own line (a future date derives Blocked)");
  assert.match(harness.notes["Tasks.md"], /waiting on the API/);
  assert.ok(lines.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  harness.plugin.activeBulletPropertyPicker = null;
  namer.close();
});
