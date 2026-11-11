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
  pomodoro: "11:00-11:25 — review records",
});

const NOTE = "Copy card e2e.md";

function notePath() {
  return NOTE;
}

function seedNote() {
  return [
    "# Copy card e2e",
    "",
    "- [ ] #task " + TASKS.id.title + " ^" + TASKS.id.blockId,
    "  - a child note for the records task",
    "- [ ] #task " + TASKS.noId.title,
    "- [x] #task " + TASKS.closed.title + " ^" + TASKS.closed.blockId,
    "",
    "- [ ] (" + TASKS.pomodoro + ")",
    "  - [[Copy card e2e#^" + TASKS.id.blockId + "|Use records to start tracking bank transactions]]",
    "",
    "Plain prose for the file-only Copy card state.",
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
    "    - label: Note link",
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
    "    - label: Note link",
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
  return Object.freeze({
    path: compact,
    absolute,
    fileName: NOTE,
    noteName: path.basename(NOTE, path.extname(NOTE)),
    blockId: "^" + TASKS.id.blockId,
    taskRef: "the ^" + TASKS.id.blockId + " task in the " + compact + " file",
    noteLink: "[[" + path.basename(NOTE, path.extname(NOTE)) + "]]",
    closedBlockId: "^" + TASKS.closed.blockId,
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
    "no-id",
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
