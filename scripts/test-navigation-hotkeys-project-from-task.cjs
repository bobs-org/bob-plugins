const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

test("buildProjectSeedFromChildBullets: an ALL-CAPS bullet becomes a section only when it has nested list items", () => {
  const withChildren = helpers.buildProjectSeedFromChildBullets(
    ["  - REQUIREMENTS", "    - Must work offline"],
    "2026-08-12",
  );
  assert.deepEqual(withChildren.taskLines, []);
  assert.deepEqual(withChildren.sections, [
    { title: "Requirements", noteLines: ["- Must work offline"] },
  ]);
  assert.equal(withChildren.lossless, true);

  const withoutChildren = helpers.buildProjectSeedFromChildBullets(
    ["  - REQUIREMENTS"],
    "2026-08-12",
  );
  assert.deepEqual(withoutChildren.sections, []);
  assert.deepEqual(withoutChildren.taskLines, [
    "- [ ] #task REQUIREMENTS [created::2026-08-12]",
  ]);
});

test("buildProjectSeedFromChildBullets: a checked ALL-CAPS bullet stays a task even with nested list items", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    ["  - [ ] REQUIREMENTS", "    - Must work offline"],
    "2026-08-12",
  );
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task REQUIREMENTS [created::2026-08-12]",
    "  - Must work offline",
  ]);
});

test("buildProjectSeedFromChildBullets moves a direct-child schedule log under the project task", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
      "\t\t- *2026-08-05* — waiting on the vendor quote",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.managedLogLines, [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
    "\t\t- *2026-08-05* — waiting on the vendor quote",
  ]);
});

test("buildProjectSeedFromChildBullets preserves schedule-log marker spellings and source order", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - **SCHEDULE LOG**",
      "    - *2026-08-05* — first",
      "  - 🗓️ **Schedule log:**",
      "    - *2026-08-06* — second",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.managedLogLines, [
    "\t- **SCHEDULE LOG**",
    "\t  - *2026-08-05* — first",
    "\t- 🗓️ **Schedule log:**",
    "\t  - *2026-08-06* — second",
  ]);
});

test("buildProjectSeedFromChildBullets keeps schedule-log boundary cases on the existing paths", () => {
  const checkbox = helpers.buildProjectSeedFromChildBullets(
    ["  - [ ] 🗓️ **SCHEDULE LOG**", "    - Child note"],
    "2026-08-12",
  );
  assert.deepEqual(checkbox.managedLogLines, []);
  assert.deepEqual(checkbox.sections, []);
  assert.deepEqual(checkbox.taskLines, [
    "- [ ] #task 🗓️ **SCHEDULE LOG** [created::2026-08-12]",
    "  - Child note",
  ]);

  const plainSection = helpers.buildProjectSeedFromChildBullets(
    ["  - SCHEDULE LOG", "    - Preserve as a section note"],
    "2026-08-12",
  );
  assert.deepEqual(plainSection.managedLogLines, []);
  assert.deepEqual(plainSection.taskLines, []);
  assert.deepEqual(plainSection.sections, [
    { title: "Schedule Log", noteLines: ["- Preserve as a section note"] },
  ]);
});

test("buildProjectSeedFromChildBullets leaves a nested schedule log under the converted child task", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - Draft the API",
      "    - 🗓️ **SCHEDULE LOG**",
      "      - *2026-08-05* — reason",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.managedLogLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-05* — reason",
  ]);
});

test("buildProjectSeedFromChildBullets moves empty and deeply nested schedule logs without forcing task output", () => {
  const empty = helpers.buildProjectSeedFromChildBullets(
    ["\t- 🗓️ **SCHEDULE LOG**"],
    "2026-08-12",
  );
  assert.equal(empty.lossless, true);
  assert.deepEqual(empty.taskLines, []);
  assert.deepEqual(empty.sections, []);
  assert.deepEqual(empty.managedLogLines, ["\t- 🗓️ **SCHEDULE LOG**"]);

  const deep = helpers.buildProjectSeedFromChildBullets(
    [
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05* — reason",
      "\t\t\t- nested context",
    ],
    "2026-08-12",
  );
  assert.deepEqual(deep.managedLogLines, [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-08-05* — reason",
    "\t\t\t- nested context",
  ]);
});

test("buildProjectSeedFromChildBullets routes mixed child blocks to tasks, sections, and the schedule log", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - Draft the API",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-08-05* — waiting on the vendor quote",
      "  - REQUIREMENTS",
      "    - Must work offline",
      "  - Write the migration",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
    "- [ ] #task Write the migration [created::2026-08-12]",
  ]);
  assert.deepEqual(result.sections, [
    { title: "Requirements", noteLines: ["- Must work offline"] },
  ]);
  assert.deepEqual(result.managedLogLines, [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t  - *2026-08-05* — waiting on the vendor quote",
  ]);
});

test("buildProjectSeedFromChildBullets moves a direct-child work log under the project task", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Added coverage for the parser",
      "\t\t- *2026-08-11* — Sketched the migration",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.managedLogLines, [
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-08-15* — Added coverage for the parser",
    "\t\t- *2026-08-11* — Sketched the migration",
  ]);
});

test("buildProjectSeedFromChildBullets preserves work-log marker spellings byte-for-byte", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - **WORK LOG**",
      "    - *2026-08-15* — first",
      "  - 🛠️ **Work log:**",
      "    - *2026-08-11* — second",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.managedLogLines, [
    "\t- **WORK LOG**",
    "\t  - *2026-08-15* — first",
    "\t- 🛠️ **Work log:**",
    "\t  - *2026-08-11* — second",
  ]);
});

test("buildProjectSeedFromChildBullets keeps work-log boundary cases on the existing paths", () => {
  const checkbox = helpers.buildProjectSeedFromChildBullets(
    ["  - [ ] 🛠️ **WORK LOG**", "    - Child note"],
    "2026-08-12",
  );
  assert.deepEqual(checkbox.managedLogLines, []);
  assert.deepEqual(checkbox.sections, []);
  assert.deepEqual(checkbox.taskLines, [
    "- [ ] #task 🛠️ **WORK LOG** [created::2026-08-12]",
    "  - Child note",
  ]);

  const plainSection = helpers.buildProjectSeedFromChildBullets(
    ["  - WORK LOG", "    - Preserve as a section note"],
    "2026-08-12",
  );
  assert.deepEqual(plainSection.managedLogLines, []);
  assert.deepEqual(plainSection.taskLines, []);
  assert.deepEqual(plainSection.sections, [
    { title: "Work Log", noteLines: ["- Preserve as a section note"] },
  ]);
});

test("buildProjectSeedFromChildBullets leaves a nested work log under the converted child task", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - Draft the API",
      "    - 🛠️ **WORK LOG**",
      "      - *2026-08-15* — reason",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.managedLogLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
    "  - 🛠️ **WORK LOG**",
    "    - *2026-08-15* — reason",
  ]);
});

test("buildProjectSeedFromChildBullets moves an empty work log without forcing task output", () => {
  const empty = helpers.buildProjectSeedFromChildBullets(
    ["\t- 🛠️ **WORK LOG**"],
    "2026-08-12",
  );
  assert.equal(empty.lossless, true);
  assert.deepEqual(empty.taskLines, []);
  assert.deepEqual(empty.sections, []);
  assert.deepEqual(empty.managedLogLines, ["\t- 🛠️ **WORK LOG**"]);
});

test("buildProjectSeedFromChildBullets moves both logs in source order without sorting by kind", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Added coverage for the parser",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, []);
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.managedLogLines, [
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-08-15* — Added coverage for the parser",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
  ]);
});

test("buildProjectSeedFromChildBullets routes mixed child blocks to tasks, sections, and both logs", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - Draft the API",
      "  - 🗓️ **SCHEDULE LOG**",
      "    - *2026-08-05* — waiting on the vendor quote",
      "  - REQUIREMENTS",
      "    - Must work offline",
      "  - 🛠️ **WORK LOG**",
      "    - *2026-08-15* — Added coverage for the parser",
      "  - Write the migration",
    ],
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
    "- [ ] #task Write the migration [created::2026-08-12]",
  ]);
  assert.deepEqual(result.sections, [
    { title: "Requirements", noteLines: ["- Must work offline"] },
  ]);
  assert.deepEqual(result.managedLogLines, [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t  - *2026-08-05* — waiting on the vendor quote",
    "\t- 🛠️ **WORK LOG**",
    "\t  - *2026-08-15* — Added coverage for the parser",
  ]);
});

test("parseManagedTaskLogParentBullet accepts sixteen spellings, blockquotes, and rejects trailing text", () => {
  const scheduleSpellings = [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t- 🗓️ **SCHEDULE LOG:**",
    "\t- **SCHEDULE LOG**",
    "\t- **SCHEDULE LOG:**",
    "\t- 🗓️ **Schedule log**",
    "\t- 🗓️ **Schedule log:**",
    "\t- **Schedule log**",
    "\t- **Schedule log:**",
  ];
  for (const line of scheduleSpellings) {
    const parsed = helpers.parseManagedTaskLogParentBullet(line);
    assert.deepEqual(
      { indent: parsed.indent, marker: parsed.marker, kind: parsed.kind },
      { indent: "\t", marker: "-", kind: helpers.MANAGED_TASK_LOG_KIND_SCHEDULE },
      line,
    );
  }

  const workSpellings = [
    "\t- 🛠️ **WORK LOG**",
    "\t- 🛠️ **WORK LOG:**",
    "\t- **WORK LOG**",
    "\t- **WORK LOG:**",
    "\t- 🛠️ **Work log**",
    "\t- 🛠️ **Work log:**",
    "\t- **Work log**",
    "\t- **Work log:**",
  ];
  for (const line of workSpellings) {
    const parsed = helpers.parseManagedTaskLogParentBullet(line);
    assert.deepEqual(
      { indent: parsed.indent, marker: parsed.marker, kind: parsed.kind },
      { indent: "\t", marker: "-", kind: helpers.MANAGED_TASK_LOG_KIND_WORK },
      line,
    );
  }

  assert.deepEqual(
    helpers.parseManagedTaskLogParentBullet("> - 🛠️ **WORK LOG**"),
    {
      indent: "> ",
      marker: "-",
      hasEmoji: true,
      kind: helpers.MANAGED_TASK_LOG_KIND_WORK,
    },
  );
  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- 🛠️ **WORK LOG** trailing"),
    null,
  );
});

test("parseManagedTaskLogParentBullet rejects emoji/label mismatches like parse_managed_task_log_marker", () => {
  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- 🗓️ **WORK LOG**"),
    null,
  );
  assert.equal(
    helpers.parseManagedTaskLogParentBullet("\t- 🛠️ **SCHEDULE LOG**"),
    null,
  );

  const mismatched = helpers.buildProjectSeedFromChildBullets(
    ["  - 🗓️ **WORK LOG**", "  - 🛠️ **SCHEDULE LOG**"],
    "2026-08-12",
  );
  assert.deepEqual(mismatched.managedLogLines, []);
  assert.deepEqual(mismatched.taskLines, [
    "- [ ] #task 🗓️ **WORK LOG** [created::2026-08-12]",
    "- [ ] #task 🛠️ **SCHEDULE LOG** [created::2026-08-12]",
  ]);
});

test("parseScheduleLogParentBullet ignores a work-log marker so Ctrl+Shift+P cannot write into it", () => {
  assert.equal(
    helpers.parseScheduleLogParentBullet("\t- 🛠️ **WORK LOG**"),
    null,
  );

  const both = [
    "- [ ] #task Parent ^parent",
    "  - 🛠️ **WORK LOG**",
    "    - *2026-08-15* — Added coverage",
    "  - 🗓️ **SCHEDULE LOG**",
    "    - *2026-08-05* — reason",
  ].join("\n");
  assert.deepEqual(helpers.findScheduleLogParent(both, 0), {
    line: 3,
    indent: "  ",
    marker: "-",
  });
});

test("normalizeProjectManagedLogLine falls back to one extra tab for mixed indentation", () => {
  assert.equal(
    helpers.normalizeProjectManagedLogLine("  - *2026-08-05* — reason", "\t"),
    "\t\t- *2026-08-05* — reason",
  );
});

test("parseProjectSectionBulletTitle rejects wikilinks, tags, block IDs, mixed case, snake_case, and inline code", () => {
  assert.equal(helpers.parseProjectSectionBulletTitle("[[SOME_NOTE]]"), null);
  assert.equal(helpers.parseProjectSectionBulletTitle("#TODO"), null);
  assert.equal(
    helpers.parseProjectSectionBulletTitle("REQUIREMENTS ^abc"),
    null,
  );
  assert.equal(helpers.parseProjectSectionBulletTitle("Mixed Case"), null);
  assert.equal(helpers.parseProjectSectionBulletTitle("SNAKE_CASE"), null);
  assert.equal(helpers.parseProjectSectionBulletTitle("`CODE`"), null);
  assert.equal(
    helpers.parseProjectSectionBulletTitle("REQUIREMENTS"),
    "Requirements",
  );
});

test("formatProjectSectionTitle title-cases without preserving acronyms and collapses whitespace", () => {
  assert.equal(helpers.formatProjectSectionTitle("FUTURE WORK"), "Future Work");
  assert.equal(helpers.formatProjectSectionTitle("NON-GOALS"), "Non-Goals");
  assert.equal(
    helpers.formatProjectSectionTitle("OPEN   QUESTIONS"),
    "Open Questions",
  );
  assert.equal(helpers.formatProjectSectionTitle("API DESIGN"), "Api Design");
  assert.equal(helpers.formatProjectSectionTitle("Q&A"), "Q&A");
});

test("insertProjectSectionNotes fills an empty existing section with a blank line then the notes", () => {
  const content = ["## Requirements", "", "## Future Work"].join("\n");
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Requirements", noteLines: ["- Must work offline"] },
  ]);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.createdCount, 0);
  assert.equal(
    result.content,
    ["## Requirements", "", "- Must work offline", "", "## Future Work"].join(
      "\n",
    ),
  );
});

test("insertProjectSectionNotes appends after the last nonblank line of a non-empty existing section, leaving trailing blanks and the header untouched", () => {
  const content = [
    "## Requirements",
    "- Existing requirement",
    "",
    "",
    "## Future Work",
  ].join("\n");
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Requirements", noteLines: ["- Must work offline"] },
  ]);
  assert.equal(result.insertedCount, 1);
  assert.equal(
    result.content,
    [
      "## Requirements",
      "- Existing requirement",
      "- Must work offline",
      "",
      "",
      "## Future Work",
    ].join("\n"),
  );
});

test("insertProjectSectionNotes matches an existing header case-insensitively and keeps its casing", () => {
  const content = ["## API Design", "", "## Future Work"].join("\n");
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Api Design", noteLines: ["- Uses REST"] },
  ]);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.createdCount, 0);
  assert.equal(
    result.content,
    ["## API Design", "", "- Uses REST", "", "## Future Work"].join("\n"),
  );
});

test("insertProjectSectionNotes appends new sections at EOF in source order and preserves a trailing newline", () => {
  const content = "## Tasks\n\n- [ ] #task Example\n";
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Open Questions", noteLines: ["- Who owns rollout?"] },
    { title: "Non-Goals", noteLines: ["- Supporting legacy clients"] },
  ]);
  assert.equal(result.insertedCount, 0);
  assert.equal(result.createdCount, 2);
  assert.equal(
    result.content,
    [
      "## Tasks",
      "",
      "- [ ] #task Example",
      "",
      "## Open Questions",
      "",
      "- Who owns rollout?",
      "",
      "## Non-Goals",
      "",
      "- Supporting legacy clients",
      "",
    ].join("\n"),
  );
});

test("insertProjectSectionNotes does not add a trailing newline when the original content had none", () => {
  const content = "## Tasks\n\n- [ ] #task Example";
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Open Questions", noteLines: ["- Who owns rollout?"] },
  ]);
  assert.equal(
    result.content,
    "## Tasks\n\n- [ ] #task Example\n\n## Open Questions\n\n- Who owns rollout?",
  );
});

test("insertProjectSectionNotes preserves CRLF line endings for an existing section", () => {
  const content = ["## Requirements", "", "## Future Work"].join("\r\n");
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Requirements", noteLines: ["- Must work offline"] },
  ]);
  assert.equal(
    result.content,
    [
      "## Requirements",
      "",
      "- Must work offline",
      "",
      "## Future Work",
    ].join("\r\n"),
  );
});

test("insertProjectSectionNotes creates a new section using the document's CRLF line ending", () => {
  const content = "## Tasks\r\n\r\n- [ ] #task Example\r\n";
  const result = helpers.insertProjectSectionNotes(content, [
    { title: "Open Questions", noteLines: ["- Who owns rollout?"] },
  ]);
  assert.equal(
    result.content,
    "## Tasks\r\n\r\n- [ ] #task Example\r\n\r\n## Open Questions\r\n\r\n- Who owns rollout?\r\n",
  );
});

test("buildProjectSeedFromChildBullets merges section bullets with equally-normalized titles in source order", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - OPEN QUESTIONS",
      "    - Who owns rollout?",
      "  - Draft the API",
      "  - OPEN  QUESTIONS",
      "    - What about backfill?",
    ],
    "2026-08-12",
  );
  assert.deepEqual(result.sections, [
    {
      title: "Open Questions",
      noteLines: ["- Who owns rollout?", "- What about backfill?"],
    },
  ]);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
  ]);
});

test("buildProjectSeedFromChildBullets splits a mixed child block into tasks and sections, preserving relative note depth verbatim", () => {
  const childLines = [
    "  - Draft the API",
    "  - REQUIREMENTS",
    "    - Must work offline",
    "    - p95 under 200ms",
    "      - measured at the edge",
    "  - OPEN QUESTIONS",
    "    - Who owns rollout?",
    "  - Write the migration",
  ];

  const result = helpers.buildProjectSeedFromChildBullets(
    childLines,
    "2026-08-12",
  );

  assert.equal(result.lossless, true);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
    "- [ ] #task Write the migration [created::2026-08-12]",
  ]);
  assert.deepEqual(result.sections, [
    {
      title: "Requirements",
      noteLines: [
        "- Must work offline",
        "- p95 under 200ms",
        "  - measured at the edge",
      ],
    },
    {
      title: "Open Questions",
      noteLines: ["- Who owns rollout?"],
    },
  ]);
  // Notes are copied verbatim: no #task token and no [created::] field.
  for (const section of result.sections) {
    for (const line of section.noteLines) {
      assert.doesNotMatch(line, /#task/);
      assert.doesNotMatch(line, /\[created::/);
    }
  }
});

test("buildProjectSeedFromChildBullets marks lossless false for content that fits neither a task nor a section, without losing the other tasks", () => {
  const result = helpers.buildProjectSeedFromChildBullets(
    [
      "  - Draft the API",
      "    Stray paragraph nested under the task",
      "not a list item and not indented under anything",
    ],
    "2026-08-12",
  );
  assert.equal(result.lossless, false);
  assert.deepEqual(result.taskLines, [
    "- [ ] #task Draft the API [created::2026-08-12]",
    "  Stray paragraph nested under the task",
  ]);
});

test("buildProjectContentFromTask appends a TASKS section bullet's notes after the converted child tasks", () => {
  const content = [
    "- [ ] #task #prj (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^prj",
    "",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION) [created::<date>]",
    "",
    "## Future Work",
    "",
    "## Requirements",
  ].join("\n");

  const result = helpers.buildProjectContentFromTask(
    content,
    { description: "Ship the widget", priority: null },
    {
      childTaskLines: ["- [ ] #task Draft the API [created::2026-08-12]"],
      sections: [
        { title: "Tasks", noteLines: ["- Follow-up call with vendor"] },
      ],
    },
  );

  assert.equal(result.tasksInserted, true);
  assert.equal(result.sectionsInserted, 1);
  assert.equal(result.sectionsCreated, 0);
  assert.equal(
    result.content,
    [
      "- [ ] #task #prj Ship the widget #hide ^prj",
      "",
      "## Tasks",
      "",
      "- [ ] #task Draft the API [created::2026-08-12]",
      "- Follow-up call with vendor",
      "",
      "## Future Work",
      "",
      "## Requirements",
    ].join("\n"),
  );
});

test("buildProjectContentFromTask inserts schedule-log lines directly under the project lifecycle task", () => {
  const content = [
    "- [ ] #task #prj (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^prj",
    "",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION) [created::<date>]",
    "",
    "## Future Work",
    "",
    "## Requirements",
  ].join("\n");

  const result = helpers.buildProjectContentFromTask(
    content,
    { description: "Ship the widget", priority: null },
    {
      managedLogLines: [
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
      ],
      childTaskLines: ["- [ ] #task Draft the API [created::2026-08-12]"],
      sections: [{ title: "Requirements", noteLines: ["- Must work offline"] }],
    },
  );

  assert.equal(result.seeded, true);
  assert.equal(result.managedLogsInserted, true);
  assert.equal(result.tasksInserted, true);
  assert.equal(result.sectionsInserted, 1);
  assert.equal(result.sectionsCreated, 0);
  assert.equal(
    result.content,
    [
      "- [ ] #task #prj Ship the widget #hide ^prj",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
      "",
      "## Tasks",
      "",
      "- [ ] #task Draft the API [created::2026-08-12]",
      "",
      "## Future Work",
      "",
      "## Requirements",
      "",
      "- Must work offline",
    ].join("\n"),
  );
});

test("buildProjectContentFromTask inserts both managed logs directly under the project lifecycle task", () => {
  const content = [
    "- [ ] #task #prj (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^prj",
    "",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION) [created::<date>]",
    "",
    "## Future Work",
    "",
    "## Requirements",
  ].join("\n");

  const result = helpers.buildProjectContentFromTask(
    content,
    { description: "Ship the widget", priority: null },
    {
      managedLogLines: [
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
        "\t- 🛠️ **WORK LOG**",
        "\t\t- *2026-08-15* — Added coverage for the parser",
        "\t\t- *2026-08-11* — Sketched the migration",
      ],
      childTaskLines: ["- [ ] #task Draft the API [created::2026-08-12]"],
      sections: [{ title: "Requirements", noteLines: ["- Must work offline"] }],
    },
  );

  assert.equal(result.seeded, true);
  assert.equal(result.managedLogsInserted, true);
  assert.equal(result.tasksInserted, true);
  assert.equal(result.sectionsInserted, 1);
  assert.equal(result.sectionsCreated, 0);
  assert.equal(
    result.content,
    [
      "- [ ] #task #prj Ship the widget #hide ^prj",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05 → 2026-08-20* — rolled from priority",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-08-15* — Added coverage for the parser",
      "\t\t- *2026-08-11* — Sketched the migration",
      "",
      "## Tasks",
      "",
      "- [ ] #task Draft the API [created::2026-08-12]",
      "",
      "## Future Work",
      "",
      "## Requirements",
      "",
      "- Must work offline",
    ].join("\n"),
  );
});

test("buildProjectContentFromTask reports managed-log insertion failure without blocking other seeding", () => {
  const content = [
    "- [ ] #task (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^notprj",
    "",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION) [created::<date>]",
  ].join("\n");

  const result = helpers.buildProjectContentFromTask(
    content,
    { description: "Ship the widget", priority: null },
    {
      managedLogLines: [
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t- 🛠️ **WORK LOG**",
      ],
      childTaskLines: ["- [ ] #task Draft the API [created::2026-08-12]"],
    },
  );

  assert.equal(result.seeded, true);
  assert.equal(result.managedLogsInserted, false);
  assert.equal(result.tasksInserted, true);
  assert.equal(
    result.content,
    [
      "- [ ] #task Ship the widget #hide ^notprj",
      "",
      "## Tasks",
      "",
      "- [ ] #task Draft the API [created::2026-08-12]",
    ].join("\n"),
  );
});

test("insertProjectManagedLogLines preserves CRLF line endings", () => {
  const result = helpers.insertProjectManagedLogLines(
    [
      "---",
      "type: project",
      "---",
      "- [ ] #task #prj Ship the widget #hide ^prj",
      "",
      "## Tasks",
    ].join("\r\n"),
    ["\t- 🗓️ **SCHEDULE LOG**", "\t\t- *2026-08-05* — reason"],
  );

  assert.equal(result.inserted, true);
  assert.equal(
    result.content,
    [
      "---",
      "type: project",
      "---",
      "- [ ] #task #prj Ship the widget #hide ^prj",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-05* — reason",
      "",
      "## Tasks",
    ].join("\r\n"),
  );
});

test("findProjectLifecycleTaskIndex skips frontmatter and fenced code blocks", () => {
  const lines = [
    "---",
    'sample: "- [ ] #task #prj Frontmatter #hide ^prj"',
    "---",
    "```markdown",
    "- [ ] #task #prj Fence #hide ^prj",
    "```",
    "- [ ] #task #prj Real #hide ^prj",
  ];

  assert.equal(helpers.findProjectLifecycleTaskIndex(lines), 6);
});

test("getProjectFromTaskNoticeText reports a singular/plural section count like the link chip", () => {
  assert.equal(
    helpers.getProjectFromTaskNoticeText("Ship the widget", "Area", "Ship_widget", 0, 2),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area; 2 sections seeded)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText("Ship the widget", "Area", "Ship_widget", 1, 1),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area; 1 link updated; 1 section seeded)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText("Ship the widget", "Area", "Ship_widget", 0, 0),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText(
      "Ship the widget",
      "Area",
      "Ship_widget",
      0,
      1,
      ["schedule"],
    ),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area; 1 section seeded; schedule log moved)',
  );
});

test("getProjectFromTaskNoticeText reports moved log kinds in a fixed order", () => {
  assert.equal(
    helpers.getProjectFromTaskNoticeText(
      "Ship the widget",
      "Area",
      "Ship_widget",
      0,
      0,
      ["schedule"],
    ),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area; schedule log moved)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText(
      "Ship the widget",
      "Area",
      "Ship_widget",
      0,
      0,
      ["work"],
    ),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area; work log moved)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText(
      "Ship the widget",
      "Area",
      "Ship_widget",
      0,
      0,
      ["work", "schedule", "work", "unknown"],
    ),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area; schedule log moved; work log moved)',
  );
  assert.equal(
    helpers.getProjectFromTaskNoticeText(
      "Ship the widget",
      "Area",
      "Ship_widget",
      0,
      0,
      [],
    ),
    'Created project Ship_widget from task "Ship the widget" (task removed from Area)',
  );
});

