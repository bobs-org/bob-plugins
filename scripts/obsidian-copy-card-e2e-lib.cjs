// Fixture and assertion helpers for the real-Obsidian Copy card e2e.
// Offline self-test uses these without launching Obsidian.
"use strict";

const path = require("node:path");

const TASKS = Object.freeze({
  id: Object.freeze({
    title: "Use records to start tracking bank transactions",
    blockId: "bank-records",
  }),
  noId: Object.freeze({
    title: "Add event note to the recruiter Google event",
  }),
  closed: Object.freeze({
    title: "Close the old records task",
    blockId: "closed-records",
  }),
  linked: Object.freeze({
    title: "Review the linked task from another note",
    blockId: "linked-target",
  }),
  taskChip: Object.freeze({ title: "Copy one chip from the task", blockId: "task-chip-single" }),
  taskChipPair: Object.freeze({ title: "Disambiguate task chips", blockId: "task-chip-pair" }),
  nestedChipParent: Object.freeze({ title: "Keep nested task chips separate", blockId: "nested-chip-parent" }),
  nestedChipTask: Object.freeze({ title: "Copy from the nested task", blockId: "nested-chip-task" }),
  pomodoro: "11:00-11:25 — review records",
});

const NOTE = "Copy card e2e.md";

const CHIP = Object.freeze({
  singleNeedle: "Chip single",
  singlePayload: "run `just check` now ",
  singleLabel: "deploy",
  pairNeedle: "Chip pair",
  taskSingleNeedle: "Copy one chip from the task",
  taskSinglePayload: "run `just check` once ",
  taskPairNeedle: "Disambiguate task chips",
  nestedParentNeedle: "Keep nested task chips separate",
  nestedTaskNeedle: "Copy from the nested task",
});

function notePath() {
  return NOTE;
}

function seedNote() {
  return [
    "# Copy card e2e",
    "",
    "- [ ] #task " + TASKS.id.title + " ^" + TASKS.id.blockId,
    "  - a child note for the records task",
    "- [ ] #task " + TASKS.taskChip.title + " ^" + TASKS.taskChip.blockId,
    "  - Task chip single: ``copy[deploy]: run `just check` once ``",
    "- [ ] #task " + TASKS.taskChipPair.title + " ^" + TASKS.taskChipPair.blockId,
    "  - a chipless line inside this task",
    "  - `copy: task one`",
    "  - `copy: task two`",
    "- [ ] #task " + TASKS.nestedChipParent.title + " ^" + TASKS.nestedChipParent.blockId,
    "  - [ ] #task " + TASKS.nestedChipTask.title + " ^" + TASKS.nestedChipTask.blockId,
    "    - `copy: nested-only`",
    "- [ ] #task " + TASKS.noId.title,
    "- [x] #task " + TASKS.closed.title + " ^" + TASKS.closed.blockId,
    "",
    "- [ ] (" + TASKS.pomodoro + ")",
    "  - [[Copy card e2e#^" + TASKS.id.blockId + "|Use records to start tracking bank transactions]]",
    "- [ ] (11:30 - 11:55) — review a task from another note",
    "  - [[Linked target#^" + TASKS.linked.blockId + "|Review the linked task from another note]]",
    "- [ ] (12:00 - 12:25) — missing linked task",
    "  - [[Copy card e2e#^missing-target|A missing task]]",
    "",
    "Plain prose for the file-only Copy card state.",
    "",
    "Chip single: ``copy[deploy]: run `just check` now ``",
    "",
    "Chip pair: `copy: one` plus `copy: two`",
    "",
    "- [ ] 2026-11-01 grocery store",
    "",
    "- [ ] #task Fence parent ^fence-parent",
    "  ```",
    "  - [ ] #task Fence example ^fence-example",
    "  ```",
    "  - code:",
    "    ~~~~",
    "    - [ ] #task Four-space example ^four-space",
    "    ~~~~",
    "",
    "- [ ] #task Tilde parent ^tilde-parent",
    "  ~~~",
    "  - [ ] #task Tilde example ^tilde-example",
    "  ~~~",
    "",
  ].join("\n");
}

function baseConfigYaml() {
  return [
    "copy:",
    "  templates:",
    "    - label: Bare note link",
    '      template: "[[{note_name}]]"',
    "",
  ].join("\n");
}

function fullConfigYaml() {
  return [
    "copy:",
    "  templates:",
    "    - label: Task ref",
    "      key: t",
    '      template: "the ^{block_id} task in the {path} file"',
    "    - label: Bare note link",
    '      template: "[[{note_name}]]"',
    "    - label: Broken task ref",
    "      key: b",
    '      template: "{task_id}"',
    "    - label: Unquoted template",
    "      key: u",
    "      template: { path: value }",
    "    - label: Path collision",
    "      key: p",
    '      template: "{note_name} copy"',
    "",
  ].join("\n");
}

function expectedValues(vaultDir, homeDir) {
  const absolute = path.join(vaultDir, NOTE);
  const homeRelative = path.relative(homeDir, absolute).split(path.sep).join("/");
  const compact = homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)
    ? "~/" + homeRelative
    : absolute;
  const noteName = path.basename(NOTE, path.extname(NOTE));
  return Object.freeze({
    path: compact,
    fileName: NOTE,
    noteName,
    blockId: TASKS.id.blockId,
    taskRef: "the ^" + TASKS.id.blockId + " task in the " + compact + " file",
    noteLink: "[[" + noteName + "]]",
    taskLink: "[[" + noteName + "#^" + TASKS.id.blockId + "]]",
    closedBlockId: TASKS.closed.blockId,
    linkedPath: path.join(vaultDir, "Linked target.md"),
    linkedTaskRef: "the ^" + TASKS.linked.blockId + " task in the " +
      (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)
        ? "~/bob/Linked target.md"
        : path.join(vaultDir, "Linked target.md")) + " file",
  });
}

function rowMap(probe) {
  const result = new Map();
  for (const row of Array.isArray(probe && probe.rows) ? probe.rows : []) {
    result.set(row.id, row);
  }
  return result;
}

function assertProbe(probe, expected) {
  const options = expected && typeof expected === "object" ? expected : {};
  const failures = [];
  if (!probe || probe.open !== true) failures.push("card is not open");
  if (probe && probe.title !== "Copy") failures.push("title is not Copy");
  const rows = rowMap(probe);
  for (const id of options.rows || []) {
    if (!rows.has(id)) failures.push("missing row " + id);
  }
  for (const id of options.noRows || []) {
    if (rows.has(id)) failures.push("unexpected row " + id);
  }
  if (options.taskDivider === true && !probe.taskDivider) failures.push("missing TASK divider");
  if (options.taskDivider === false && probe.taskDivider) failures.push("unexpected TASK divider");
  if (options.taskState && probe.taskState !== options.taskState) {
    failures.push("task state is " + probe.taskState + ", wanted " + options.taskState);
  }
  if (options.taskTitle && probe.taskTitle !== options.taskTitle) {
    failures.push("task title did not match: " + String(probe.taskTitle || ""));
  }
  if (
    options.chipDividerTitle !== undefined &&
    probe.chipDividerTitle !== options.chipDividerTitle
  ) {
    failures.push("CHIP divider title was " + String(probe.chipDividerTitle || ""));
  }
  if (options.unavailableRows) {
    for (const id of options.unavailableRows) {
      const row = rows.get(id);
      if (!row || row.state !== "unavailable" || row.disabled !== true) {
        failures.push(id + " is not unavailable and disabled");
      }
    }
  }
  if (options.errorRows) {
    for (const id of options.errorRows) {
      const row = rows.get(id);
      if (!row || row.state !== "error" || row.disabled !== true) {
        failures.push(id + " is not an error row");
      }
    }
  }
  if (options.collisionRows) {
    for (const id of options.collisionRows) {
      const row = rows.get(id);
      if (!row || row.state !== "collision" || row.key !== "" || row.disabled === true) {
        failures.push(id + " is not a keyless, copyable collision row");
      }
    }
  }
  return { ok: failures.length === 0, failures, rows };
}

function overflowConfigYaml() {
  const lines = ["copy:", "  templates:"];
  for (let index = 1; index <= 12; index += 1) {
    lines.push("    - label: Overflow " + index);
    lines.push('      template: "{note_name}-' + index + '"');
  }
  return lines.join("\n") + "\n";
}

function expectedScreenshotNames() {
  const states = [
    "prose",
    "identified-task",
    "task-scope",
    "no-id",
    "linked-task",
    "broken-collision",
    "narrow-460",
    "long-list",
    "visible-refusal",
  ];
  return states.flatMap((state) => [
    "copy-card-" + state + "-light.png",
    "copy-card-" + state + "-dark.png",
  ]);
}

function assertScreenshotList(paths) {
  const names = new Set((Array.isArray(paths) ? paths : []).map((item) => path.basename(item)));
  const missing = expectedScreenshotNames().filter((name) => !names.has(name));
  return { ok: missing.length === 0, missing };
}

module.exports = {
  NOTE,
  TASKS,
  CHIP,
  assertProbe,
  assertScreenshotList,
  baseConfigYaml,
  expectedScreenshotNames,
  expectedValues,
  fullConfigYaml,
  notePath,
  overflowConfigYaml,
  seedNote,
};
