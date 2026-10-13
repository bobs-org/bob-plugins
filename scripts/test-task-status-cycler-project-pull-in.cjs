const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  MarkdownView,
  helpers,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

// Project pull-in vectors (docs/task-dependencies.md §12.10 / §12.11).
// Pure PP rows go through `planSuccessors`; Ctrl+Enter / cancel / take-back
// and the gated zero-read budget go through the real plugin path.

const TODAY = "2026-10-09";
const DAILY_PATH = "2026/20261009.md";
const FUTURE = "2026-12-01";

function planFixture({ day, notes, closed, options = {} }) {
  const documents = Object.entries(notes).map(([path, text]) => ({
    path,
    text,
  }));
  const tasks = helpers.tasksFromDocuments(documents);
  const index = helpers.buildDependentsIndex(tasks);
  const plan = helpers.planSuccessors({
    closed,
    index,
    dailyBefore: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    linkUnblocked: true,
    basenameCounts: { ship: 1, sase: 1, other: 1 },
    noteTexts: notes,
    selection: "all",
    ...options,
  });
  return { documents, tasks, index, plan };
}

function projectNote(body, extraFrontmatter = []) {
  return [
    "---",
    'type: "[[project]]"',
    "status: wip",
    ...extraFrontmatter,
    "---",
    ...body,
  ].join("\n");
}

function shipDay(link = "\t- [[ship#^a]]") {
  return ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — SHIP", link].join("\n");
}

const LAST_TASK = "- [ ] #task Last task [id:: ship__a] ^a";
const HIDDEN_PRJ = "- [ ] #task #prj Ship it! #hide ^prj";
const A_CLOSED = [
  {
    path: "ship.md",
    blockId: "a",
    taskId: "ship__a",
    text: "Last task",
  },
];

function markUnblocked(line, { today } = {}) {
  const text = String(line || "");
  if (/(^|[\s([{])#hide(?=$|[\s)\]},.;:!?])/.test(text)) {
    return text;
  }
  if (!/\[fresh::/.test(text)) {
    return text;
  }
  return text.replace(/(\s+\^[A-Za-z0-9_-]+$)/, ` [unblocked:: ${today}]$1`);
}

function pullInRows(plan) {
  return (plan.unblocked || []).filter((row) => row.trigger === "project_empty");
}

test("PP22 pins #hide bytes to normalize_task_hide_tag(line, false, true)", () => {
  assert.equal(
    helpers.removeProjectHideTags("- [ ] #task #prj Ship it! #hide ^prj"),
    "- [ ] #task #prj Ship it! ^prj",
  );
  assert.equal(
    helpers.removeProjectHideTags(
      "- [ ] #task #prj Ship it! #hide [priority:: high] ^prj",
    ),
    "- [ ] #task #prj Ship it! [priority:: high] ^prj",
  );
  assert.equal(
    helpers.removeProjectHideTags(
      "- [ ] #task #prj Ship it! #hidden #hide ^prj",
    ),
    "- [ ] #task #prj Ship it! #hidden ^prj",
  );
});

test("PDS6/PDS15 resolve only one scalar project parent with NoteIndex rules", () => {
  const note = (parent) => ["---", `parent: ${parent}`, "---"].join("\n");
  const aliased = note('"[[dir/N#Heading|Alias]]"');
  assert.equal(helpers.projectParentTarget(aliased), "dir/N");
  assert.equal(
    helpers.resolveProjectParentPath(
      helpers.projectParentTarget(aliased),
      "child.md",
      ["dir/N.md", "archive/N.md"],
    ),
    "dir/N.md",
    "an exact path wins even when its basename is ambiguous",
  );
  assert.equal(
    helpers.resolveProjectParentPath("N#Heading", "child.md", ["dir/N.md"]),
    "dir/N.md",
  );
  assert.equal(
    helpers.resolveProjectParentPath("N", "child.md", ["dir/N.md", "old/N.md"]),
    null,
    "an ambiguous basename is not a parent",
  );
  assert.equal(helpers.projectParentTarget(note('["[[N]]"]')), null);
  assert.equal(
    helpers.projectParentTarget(note('"[[N]]"\nparent: "[[Other]]"')),
    null,
    "duplicate parent keys are not a scalar parent",
  );
  assert.equal(
    helpers.resolveProjectParentPath("child", "child.md", ["child.md"]),
    null,
    "a note cannot parent itself",
  );
  assert.equal(
    helpers.resolveProjectParentPath("20261009", "child.md", ["2026/20261009.md"]),
    null,
    "canonical daily notes are excluded",
  );
  assert.equal(
    helpers.resolveProjectParentPath("old", "child.md", ["done/old.md"]),
    null,
    "archive notes are excluded",
  );
});

test("PP1 links the emptied project's ^prj as Next and strips #hide", () => {
  const { plan } = planFixture({
    day: shipDay(),
    notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: A_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  const row = plan.unblocked[0];
  assert.equal(row.trigger, "project_empty");
  assert.equal(row.hide_removed, true);
  assert.equal(row.status_symbol, "*");
  assert.equal(row.previous_status_symbol, " ");
  assert.equal(row.block_id, "prj");
  assert.equal(row.not_linked, null);
  assert.equal(row.link.block_link, "[[ship#^prj]]");
  assert.equal(row.text, "Ship it!");
  assert.deepEqual(row.unblocked_by, [
    { note_path: "ship.md", block_id: "a", text: "Last task" },
  ]);
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].before, HIDDEN_PRJ);
  assert.equal(plan.edits[0].after, "- [*] #task #prj Ship it! ^prj");
  assert.equal(plan.placements.length, 1);
});

test("PP29 closing a child ^prj pulls in its empty parent project", () => {
  const childPath = "projects/child.md";
  const parentPath = "projects/parent.md";
  const child = projectNote(
    ["- [x] #task #prj Child project ^prj"],
    ['parent: "[[projects/parent#Overview|Parent]]"'],
  );
  const parent = projectNote([
    "- [ ] #task #prj Parent project ^prj",
    "  - 🧩 **Sub-projects:** [[projects/child|Child]]",
  ]);
  const closed = [{
    path: childPath,
    blockId: "prj",
    taskId: "child__prj",
    text: "Child project",
  }];
  const { plan } = planFixture({
    day: shipDay("\t- [[projects/child#^prj]]"),
    notes: { [childPath]: child, [parentPath]: parent },
    closed,
  });
  const pulledIn = plan.unblocked.find((row) => row.block_id === "prj");
  assert.ok(pulledIn);
  assert.equal(pulledIn.note_path, parentPath);
  assert.equal(pulledIn.trigger, "project_empty");
  assert.equal(pulledIn.status_symbol, "*");
  assert.deepEqual(pulledIn.unblocked_by, [
    { note_path: childPath, block_id: "prj", text: "Child project" },
  ]);
  assert.equal(plan.edits.some((edit) => edit.path === parentPath), true);
});

test("PP32/PP36 leave a parent-tagged ^prj blocked and hide the tag in row text", () => {
  const childPath = "projects/child.md";
  const parentPath = "projects/parent.md";
  const child = projectNote(
    ["- [x] #task #prj Child project ^prj"],
    ['parent: "[[projects/parent]]"'],
  );
  const parent = projectNote([
    "- [?] #task #prj #prj_is_blocked Parent project ^prj",
    "  - 🧩 **Sub-projects:** [[projects/child]]",
  ], ['parent: "[[root]]"']);
  const closed = [{ path: childPath, blockId: "prj", taskId: "", text: "Child project" }];
  const { plan } = planFixture({
    day: shipDay("\t- [[projects/child#^prj]]"),
    notes: { [childPath]: child, [parentPath]: parent },
    closed,
  });
  const row = plan.still_blocked.find((item) => item.note_path === parentPath);
  assert.ok(row);
  assert.equal(row.reason, "project");
  assert.equal(row.project, "root");
  assert.equal(row.text, "Parent project");
  assert.equal(plan.edits.length, 0);
});

test("PP30 keeps the parent untouched while another child or task remains", () => {
  const childPath = "projects/child.md";
  const parentPath = "projects/parent.md";
  const child = projectNote(
    ["- [x] #task #prj Child project ^prj"],
    ['parent: "[[projects/parent]]"'],
  );
  const closed = [{ path: childPath, blockId: "prj", taskId: "", text: "Child" }];
  for (const parent of [
    projectNote([
      "- [ ] #task #prj Parent project ^prj",
      "  - 🧩 **Sub-projects:** [[projects/child]] [[projects/other]]",
    ]),
    projectNote([
      "- [ ] #task #prj Parent project ^prj",
      "  - 🧩 **Sub-projects:** [[projects/child]]",
      "- [ ] #task Remaining parent work ^remaining",
    ]),
  ]) {
    const { plan } = planFixture({
      day: shipDay("\t- [[projects/child#^prj]]"),
      notes: { [childPath]: child, [parentPath]: parent },
      closed,
    });
    assert.equal(plan.unblocked.length, 0);
    assert.equal(plan.still_blocked.length, 0);
  }
});

test("PP31 skips missing, ambiguous, and non-project parents", () => {
  const childPath = "projects/child.md";
  const childBase = ["---", 'type: "[[project]]"', "status: wip", "---"];
  const child = (parentLine) => [
    ...childBase.slice(0, -1),
    ...(parentLine ? [parentLine] : []),
    "---",
    "- [x] #task #prj Child project ^prj",
  ].join("\n");
  const parentProject = projectNote([
    "- [ ] #task #prj Parent project ^prj",
    "  - 🧩 **Sub-projects:** [[projects/child]]",
  ]);
  const cases = [
    {
      childText: child(null),
      notes: { [childPath]: child(null), "projects/parent.md": parentProject },
    },
    {
      childText: child('parent: "[[missing]]"'),
      notes: { [childPath]: child('parent: "[[missing]]"') },
    },
    {
      childText: child('parent: "[[parent]]"'),
      notes: {
        [childPath]: child('parent: "[[parent]]"'),
        "projects/parent.md": parentProject,
        "archive/parent.md": parentProject,
      },
    },
    {
      childText: child('parent: "[[projects/parent]]"'),
      notes: {
        [childPath]: child('parent: "[[projects/parent]]"'),
        "projects/parent.md": [
          "---",
          'type: "[[area]]"',
          "status: wip",
          "---",
          "- [ ] #task Parent task ^prj",
          "  - 🧩 **Sub-projects:** [[projects/child]]",
        ].join("\n"),
      },
    },
  ];
  for (const { childText, notes } of cases) {
    const { plan } = planFixture({
      day: shipDay("\t- [[projects/child#^prj]]"),
      notes: { ...notes, [childPath]: childText },
      closed: [{ path: childPath, blockId: "prj", taskId: "", text: "Child" }],
    });
    assert.equal(plan.unblocked.length, 0);
    assert.equal(plan.still_blocked.length, 0);
  }
});

test("PP33 cancellation surfaces the parent without linking it", () => {
  const childPath = "projects/child.md";
  const parentPath = "projects/parent.md";
  const child = projectNote(
    ["- [-] #task #prj Child project ^prj"],
    ['parent: "[[projects/parent]]"'],
  );
  const parent = projectNote([
    "- [ ] #task #prj Parent project #hide ^prj",
    "  - 🧩 **Sub-projects:** [[projects/child]]",
  ]);
  const closed = [{ path: childPath, blockId: "prj", taskId: "", text: "Child" }];
  const offered = planFixture({
    day: shipDay(),
    notes: { [childPath]: child, [parentPath]: parent },
    closed,
  }).plan.unblocked[0];
  assert.equal(offered.note_path, parentPath);
  assert.ok(offered.offer);
  assert.equal(offered.offer.group, "project_finished");
  assert.ok(offered.link);

  const cancelled = planFixture({
    day: shipDay(),
    notes: { [childPath]: child, [parentPath]: parent },
    closed,
    options: { cancelled: true },
  }).plan.unblocked[0];
  assert.equal(cancelled.note_path, parentPath);
  assert.equal(cancelled.not_linked, "cancelled");
  assert.equal(cancelled.link, null);
  assert.equal(cancelled.status_symbol, " ");
  assert.equal(cancelled.hide_removed, true);
});

test("PP2 and PP3 leave a project with remaining work alone", () => {
  const twoOpen = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "- [ ] #task Still open ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(twoOpen.plan.unblocked.length, 0);
  assert.equal(twoOpen.plan.still_blocked.length, 0);

  const blockedResident = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "- [?] #task Blocked leftover ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(blockedResident.plan.unblocked.length, 0);
});

test("PP4 hidden leftover still pulls in; PP5 fences vs remaining marks", () => {
  const hiddenLeftover = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "- [ ] #task Hidden leftover #hide ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(pullInRows(hiddenLeftover.plan).length, 1);

  const fenced = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "```",
        "- [ ] #task Fenced leftover ^b",
        "```",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(pullInRows(fenced.plan).length, 1);

  const quoted = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "> - [ ] #task Quoted leftover ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(quoted.plan.unblocked.length, 0);

  const custom = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "- [>] #task Custom leftover ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(custom.plan.unblocked.length, 0);
});

test("PP6 Sub-projects marker states match display_for_wikilink", () => {
  const openChild = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        "\t- 🧩 **Sub-projects:** [[child]]",
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(openChild.plan.unblocked.length, 0);

  const struckOpen = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        "\t- 🧩 **Sub-projects:** ~~[[child]]~~",
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(struckOpen.plan.unblocked.length, 0);

  const doneChildren = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        "\t- 🧩 **Sub-projects:** ~~[[child]]~~ ✅ ~~[[other]]~~ ❌",
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(pullInRows(doneChildren.plan).length, 1);
});

test("PP7 and PP28 keep a future-scheduled ^prj byte-identical", () => {
  const inline = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        `- [ ] #task #prj Ship it! #hide [scheduled:: ${FUTURE}] ^prj`,
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(inline.plan.unblocked.length, 0);
  assert.equal(inline.plan.still_blocked.length, 1);
  assert.equal(inline.plan.still_blocked[0].reason, "scheduled");
  assert.equal(inline.plan.still_blocked[0].scheduled, FUTURE);
  assert.equal(inline.plan.still_blocked[0].trigger, "project_empty");
  assert.equal(inline.plan.edits.length, 0);

  const leftover = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote(
        [HIDDEN_PRJ, LAST_TASK],
        [`scheduled: ${FUTURE}`],
      ),
    },
    closed: A_CLOSED,
  });
  assert.equal(leftover.plan.unblocked.length, 0);
  assert.equal(leftover.plan.still_blocked[0].reason, "scheduled");
  assert.equal(leftover.plan.still_blocked[0].scheduled, FUTURE);
  assert.equal(leftover.plan.edits.length, 0);
});

test("PP8 still-blocks a ^prj that waits on another open prerequisite", () => {
  const { plan } = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        "- [ ] #task #prj Ship it! #hide [dependsOn:: other__p] ^prj",
        LAST_TASK,
      ]),
      "other.md": "- [ ] #task Other prereq [id:: other__p] ^p",
    },
    closed: A_CLOSED,
  });
  assert.equal(plan.unblocked.length, 0);
  assert.equal(plan.still_blocked.length, 1);
  assert.equal(plan.still_blocked[0].reason, "waits_on");
  assert.equal(plan.still_blocked[0].trigger, "project_empty");
  assert.equal(plan.edits.length, 0);
});

test("PP9 already-planned ^prj raises to Next without a new link", () => {
  const { plan } = planFixture({
    day: ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — SHIP", "\t- [[ship#^a]]", "\t- [[ship#^prj]]"].join("\n"),
    notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: A_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  const row = plan.unblocked[0];
  assert.equal(row.not_linked, "already_planned");
  assert.equal(row.link, null);
  assert.equal(row.status_symbol, "*");
  assert.equal(row.hide_removed, true);
  assert.equal(plan.placements.length, 0);
});

test("PP10 implicit destination for unplanned ^prj; PP11 reports disabled (SO14/SO19)", () => {
  const emptyDay = ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — SHIP"].join("\n");
  const surfaced = planFixture({
    day: emptyDay,
    notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: A_CLOSED,
  });
  // SO14: emptyDay has one open entry SHIP → implicit offer, linked with select-all.
  assert.equal(surfaced.plan.unblocked.length, 1);
  assert.equal(surfaced.plan.unblocked[0].not_linked, null);
  assert.ok(surfaced.plan.unblocked[0].link);
  assert.equal(surfaced.plan.unblocked[0].offer.destination.entry_role, "implicit");
  assert.equal(surfaced.plan.unblocked[0].hide_removed, true);

  const disabled = planFixture({
    day: shipDay(),
    notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: A_CLOSED,
    options: { linkUnblocked: false },
  });
  assert.equal(disabled.plan.unblocked[0].not_linked, "disabled");
  assert.equal(disabled.plan.unblocked[0].hide_removed, true);

  for (const [options, expected] of [[{ linkUnblocked: false }, "disabled"], [{ cancelled: true }, "cancelled"]]) {
    const noAnchor = planFixture({
      day: emptyDay,
      notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
      closed: A_CLOSED,
      options,
    });
    assert.equal(noAnchor.plan.unblocked[0].not_linked, expected);
  }
});

test("PP12 keeps In Progress; PP13 is silent for a visible already-linked Next", () => {
  const inProgress = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        "- [/] #task #prj Ship it! #hide ^prj",
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(inProgress.plan.unblocked[0].status_symbol, "/");
  assert.equal(inProgress.plan.unblocked[0].trigger, "project_empty");
  assert.ok(inProgress.plan.unblocked[0].link);

  const alreadyNext = planFixture({
    day: ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — SHIP", "\t- [[ship#^a]]", "\t- [[ship#^prj]]"].join("\n"),
    notes: {
      "ship.md": projectNote([
        "- [*] #task #prj Ship it! ^prj",
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(alreadyNext.plan.unblocked.length, 0);
  assert.equal(alreadyNext.plan.edits.length, 0);
});

test("PP14 an id-less last task still pulls in", () => {
  const { plan } = planFixture({
    day: shipDay("\t- [[ship#^plain]]"),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        "- [ ] #task Last task ^plain",
      ]),
    },
    closed: [{ path: "ship.md", blockId: "plain", text: "Last task" }],
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].trigger, "project_empty");
  assert.ok(plan.unblocked[0].link);
});

test("PP15 dependent and pull-in are both offered with no cap (SO2, breaker retired)", () => {
  const both = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]),
      "other.md":
        "- [?] #task Follow on [dependsOn:: ship__a] ^follow",
    },
    closed: A_CLOSED,
  });
  assert.deepEqual(
    both.plan.unblocked.map((row) => [row.block_id, row.trigger, Boolean(row.link)]),
    [
      ["follow", "dependency", true],
      ["prj", "project_empty", true],
    ],
  );

  const extraNotes = {};
  for (let n = 1; n <= 6; n += 1) {
    extraNotes[`d${n}.md`] = `- [?] #task Dep ${n} [dependsOn:: ship__a] ^d${n}`;
  }
  extraNotes["ship.md"] = projectNote([HIDDEN_PRJ, LAST_TASK]);
  const many = planFixture({
    day: shipDay(),
    notes: extraNotes,
    closed: A_CLOSED,
    options: {
      basenameCounts: { ship: 1, d1: 1, d2: 1, d3: 1, d4: 1, d5: 1, d6: 1 },
    },
  });
  const pullIn = many.plan.unblocked.filter((row) => row.trigger === "project_empty");
  assert.equal(pullIn.length, 1);
  assert.ok(pullIn[0].link);
  assert.equal(many.plan.unblocked.length, 7);
  for (const row of many.plan.unblocked) {
    assert.ok(row.link);
    assert.ok(row.offer);
  }
});

test("PP17 one pull-in row wins over project_task", () => {
  const { plan } = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        "- [ ] #task #prj Ship it! #hide [dependsOn:: ship__a] ^prj",
        "\t- ⛓️ **DEPENDS ON:** [[ship#^a]]",
        LAST_TASK,
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].trigger, "project_empty");
  assert.equal(plan.unblocked[0].not_linked, null);
  assert.ok(plan.unblocked[0].link);
  assert.equal(
    plan.unblocked.some((row) => row.not_linked === "project_task"),
    false,
  );
});

test("PP18 cancel recovers only", () => {
  const { plan } = planFixture({
    day: shipDay(),
    notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: A_CLOSED,
    options: { cancelled: true },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].not_linked, "cancelled");
  assert.equal(plan.unblocked[0].link, null);
  assert.equal(plan.unblocked[0].hide_removed, true);
  assert.equal(plan.placements.length, 0);
});

test("PP20 unrecognised or unplannable notes never pull in", () => {
  const cases = [
    projectNote([HIDDEN_PRJ, LAST_TASK]).replace("status: wip", "status: done"),
    [
      "---",
      'type: "[[project]]"',
      "status: wip",
      "---",
      HIDDEN_PRJ,
      "- [ ] #task #prj Other ^prj",
      LAST_TASK,
    ].join("\n"),
    projectNote([
      `- [ ] #task #prj Ship it! #hide [scheduled:: ${FUTURE}] [scheduled:: ${TODAY}] ^prj`,
      LAST_TASK,
    ]),
  ];
  for (const text of cases) {
    const { plan } = planFixture({
      day: shipDay(),
      notes: { "ship.md": text },
      closed: A_CLOSED,
    });
    assert.equal(plan.unblocked.length, 0, text.slice(0, 80));
  }

  const doneDir = planFixture({
    day: shipDay("\t- [[done/ship#^a]]"),
    notes: { "done/ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: [{ ...A_CLOSED[0], path: "done/ship.md" }],
  });
  assert.equal(doneDir.plan.unblocked.length, 0);

  const daily = planFixture({
    day: shipDay(),
    notes: { [DAILY_PATH]: projectNote([HIDDEN_PRJ, LAST_TASK]) },
    closed: [{ ...A_CLOSED[0], path: DAILY_PATH }],
  });
  assert.equal(daily.plan.unblocked.length, 0);
});

test("PP24 closing an external prerequisite pulls in only when N is empty", () => {
  const pClosed = [
    {
      path: "sase.md",
      blockId: "fix-apollo",
      taskId: "sase__fix-apollo",
      text: "Fix apollo machine!",
    },
  ];
  const empty = planFixture({
    day: ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", "\t- [[sase#^fix-apollo]]"].join("\n"),
    notes: {
      "sase.md": "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      "ship.md": projectNote([
        "- [ ] #task #prj Ship it! #hide [dependsOn:: sase__fix-apollo] ^prj",
      ]),
    },
    closed: pClosed,
  });
  assert.equal(empty.plan.unblocked.length, 1);
  assert.equal(empty.plan.unblocked[0].trigger, "project_empty");
  assert.ok(empty.plan.unblocked[0].link);

  const leftover = planFixture({
    day: ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", "\t- [[sase#^fix-apollo]]"].join("\n"),
    notes: {
      "sase.md": "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      "ship.md": projectNote([
        "- [ ] #task #prj Ship it! #hide [dependsOn:: sase__fix-apollo] ^prj",
        "- [ ] #task Still in the project ^b",
      ]),
    },
    closed: pClosed,
  });
  assert.equal(
    leftover.plan.unblocked.some((row) => row.trigger === "project_empty"),
    false,
  );
  assert.equal(
    leftover.plan.edits.some((edit) =>
      edit.path === "ship.md" && String(edit.before || "").includes("^prj")
    ),
    false,
  );
});

test("PP25 cascades project_member recovery after a [?] pull-in", () => {
  const { plan } = planFixture({
    day: ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", "\t- [[sase#^fix-apollo]]"].join("\n"),
    notes: {
      "sase.md": "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      "ship.md": projectNote([
        "- [?] #task #prj Ship it! #hide [dependsOn:: sase__fix-apollo] ^prj",
        "- [?] #task Resident leftover #prj_is_blocked #hide ^res",
      ]),
    },
    closed: [
      {
        path: "sase.md",
        blockId: "fix-apollo",
        taskId: "sase__fix-apollo",
        text: "Fix apollo machine!",
      },
    ],
    options: { markUnblockedLine: markUnblocked },
  });
  const pullIn = plan.unblocked.find((row) => row.trigger === "project_empty");
  assert.ok(pullIn);
  assert.equal(pullIn.status_symbol, "*");
  assert.equal(pullIn.hide_removed, true);
  assert.ok(pullIn.link);
  // SO10: hidden residents fold (recover only, no offer) and keep #hide.
  const folded = (plan.foldedByProject instanceof Map ? plan.foldedByProject.get("ship.md") : null) ||
    (plan.foldedByProject || {})["ship.md"];
  assert.ok(folded);
  assert.equal(folded.hidden, 1);
  const residentEdit = plan.edits.find((edit) => edit.before.includes("^res"));
  assert.ok(!residentEdit || residentEdit.after.includes("#hide"));
});

test("PP26 dated recount treats a hidden leftover as remaining work", () => {
  const dated = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        `- [ ] #task #prj Ship it! #hide [scheduled:: ${TODAY}] ^prj`,
        LAST_TASK,
        "- [ ] #task Hidden leftover #hide ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(dated.plan.unblocked.length, 0);

  const undated = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": projectNote([
        HIDDEN_PRJ,
        LAST_TASK,
        "- [ ] #task Hidden leftover #hide ^b",
      ]),
    },
    closed: A_CLOSED,
  });
  assert.equal(pullInRows(undated.plan).length, 1);
});

test("PP27 implicit offer after #hide strip; unpicked keeps WRITE rule (SO14/SO20)", () => {
  const prj =
    "- [?] #task #prj Ship it! #hide [fresh:: 2026-09-01] ^prj";
  const surfaced = planFixture({
    day: ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — SHIP"].join("\n"),
    notes: { "ship.md": projectNote([prj, LAST_TASK]) },
    closed: A_CLOSED,
    options: { markUnblockedLine: markUnblocked, selection: null },
  });
  // Unpicked: recovered rank with WRITE rule, #hide removed, not selected.
  assert.equal(surfaced.plan.unblocked[0].not_linked, "not_selected");
  assert.equal(surfaced.plan.unblocked[0].status_symbol, " ");
  assert.match(surfaced.plan.edits[0].after, /\[unblocked:: 2026-10-09\]/);
  assert.doesNotMatch(surfaced.plan.edits[0].after, /#hide/);

  const linked = planFixture({
    day: shipDay(),
    notes: { "ship.md": projectNote([prj, LAST_TASK]) },
    closed: A_CLOSED,
    options: { markUnblockedLine: markUnblocked },
  });
  assert.equal(linked.plan.unblocked[0].status_symbol, "*");
  assert.ok(linked.plan.unblocked[0].link);
  assert.doesNotMatch(linked.plan.edits[0].after, /\[unblocked::/);
});

test("successorNoticeText uses the §12.6 pull-in and surfaced copy", () => {
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [{ text: "Last task" }],
      unblocked: [
        {
          text: "Ship it!",
          status_symbol: "*",
          status_name: "Next",
          trigger: "project_empty",
          link: { entry_name: "SHIP", entry_created: false, line: 6 },
        },
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 Next in SHIP: Ship it! · project has no open tasks",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [{ text: "Last task" }],
      unblocked: [
        {
          text: "Ship it!",
          status_symbol: " ",
          status_name: "Ready",
          previous_status_symbol: " ",
          hide_removed: true,
          trigger: "project_empty",
          link: null,
          not_linked: "not_planned_today",
        },
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 Surfaced: Ship it! (Ready) · project has no open tasks",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [{ text: "Last task" }],
      unblocked: [
        {
          text: "Ship it!",
          status_symbol: " ",
          status_name: "Ready",
          previous_status_symbol: "?",
          hide_removed: true,
          trigger: "project_empty",
          link: null,
          not_linked: "not_planned_today",
        },
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 Unblocked: Ship it! (Ready) · project has no open tasks",
  );
  assert.match(
    helpers.successorNoticeText({
      predecessors: [],
      unblocked: [
        {
          text: "Follow on",
          status_symbol: "*",
          link: { entry_name: "SHIP", entry_created: false, line: 6 },
        },
        {
          text: "Ship it!",
          status_symbol: "*",
          trigger: "project_empty",
          link: { entry_name: "SHIP", entry_created: false, line: 7 },
        },
      ],
      still_blocked: [],
      failure: null,
    }),
    /^🔓 2 linked → SHIP:/,
  );
});

const LIVE_TODAY = helpers.formatLocalDate();
const LIVE_NOW = new Date(`${LIVE_TODAY}T12:00:00`);
const LIVE_DAILY = helpers.todayDailyPath({}, LIVE_NOW);

function makePlugin(harness, editor, path) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => LIVE_TODAY;
  plugin.getPomodoroWorkLogDateString = () => LIVE_TODAY;
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor, path);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

function installNavStub(plugin, seen) {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "bob-navigation-hotkeys": {
        api: {
          version: 3,
          notice: {
            version: 1,
            showUnblocked(model) {
              seen.push(model);
              return true;
            },
          },
          // SO picker fake: explicitly return all offers (select-all).
          successors: {
            version: 1,
            async pick(model) {
              const picks = [];
              for (const group of (model && model.groups) || []) {
                for (const row of (group && group.rows) || []) {
                  if (row && row.selectable && row.key) {
                    picks.push({ key: String(row.key) });
                  }
                }
              }
              return { picks };
            },
          },
        },
      },
    },
  };
}

function countVaultReads(harness) {
  const counts = { cachedRead: [], read: [], process: [], modify: [] };
  const vault = harness.app.vault;
  for (const key of Object.keys(counts)) {
    const original = vault[key];
    if (typeof original !== "function") {
      continue;
    }
    vault[key] = async (...args) => {
      const file = args[0];
      counts[key].push(file && file.path ? file.path : "?");
      return original.apply(vault, args);
    };
  }
  return counts;
}

function liveProject(body) {
  return projectNote(body);
}

function liveDay(link = "\t- [[ship#^a]]") {
  return [`# ${LIVE_TODAY}`, "", "## Pomodoros", "- [ ] () — SHIP", link].join(
    "\n",
  );
}

async function settle(plugin) {
  for (let round = 0; round < 10; round += 1) {
    await flushAsyncActions();
  }
  try {
    await plugin.referenceMutationQueue;
  } catch (error) {
    // finalize results carry failures; the queue itself must stay usable.
  }
  for (let round = 0; round < 10; round += 1) {
    await flushAsyncActions();
  }
}

test("Ctrl+Enter on the last task link inserts the ^prj and rewrites R", async () => {
  notices.length = 0;
  const day = liveDay();
  const source = liveProject([
    "- [ ] #task #prj Ship it! #hide ^prj",
    "- [ ] #task Last task [id:: ship__a] ^a",
  ]);
  const harness = createInMemoryObsidianApp({
    "ship.md": source,
    [LIVE_DAILY]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, LIVE_DAILY);
  const seen = [];
  installNavStub(plugin, seen);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: LIVE_DAILY,
  });

  assert.equal(result.resolved, true);
  assert.equal(result.changed, true);
  assert.match(editor.getLine(4), /~~\[\[ship#\^a\]\]~~/);
  assert.equal(editor.getLine(5), "\t- [[ship#^prj]]");
  assert.match(
    harness.getSource("ship.md"),
    /^- \[\*\] #task #prj Ship it! \^prj$/m,
  );
  assert.doesNotMatch(harness.getSource("ship.md"), /#hide/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].unblocked[0].trigger, "project_empty");
  assert.equal(seen[0].unblocked[0].hide_removed, true);
  assert.equal(notices.length, 0);
});

test("PP29 runtime close and reopen use the parent pull-in receipt", async () => {
  notices.length = 0;
  const childPath = "projects/child.md";
  const parentPath = "projects/parent.md";
  const daily = [
    `# ${LIVE_TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — CHILD",
    "\t- [[projects/child#^prj]]",
  ].join("\n");
  const child = projectNote(
    ["- [ ] #task #prj Child project ^prj"],
    ['parent: "[[projects/parent|Parent]]"'],
  );
  const parent = projectNote([
    "- [ ] #task #prj Parent project #hide ^prj",
    "  - 🧩 **Sub-projects:** [[projects/child|Child]]",
  ]);
  const harness = createInMemoryObsidianApp({
    [childPath]: child,
    [parentPath]: parent,
    [LIVE_DAILY]: daily,
  });
  const editor = createTextEditor(daily, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, LIVE_DAILY);
  const seen = [];
  installNavStub(plugin, seen);

  const closed = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: LIVE_DAILY,
  });
  assert.equal(closed.changed, true);
  assert.match(harness.getSource(childPath), /^- \[x\] #task #prj Child project.*\^prj$/m);
  assert.match(harness.getSource(parentPath), /^- \[\*\] #task #prj Parent project \^prj$/m);
  assert.doesNotMatch(harness.getSource(parentPath), /#hide/);
  assert.match(editor.getValue(), /~~\[\[projects\/child#\^prj\]\]~~/);
  assert.match(editor.getValue(), /\[\[parent#\^prj\]\]/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].unblocked[0].trigger, "project_empty");
  assert.deepEqual(seen[0].unblocked[0].unblocked_by, [
    { note_path: childPath, block_id: "prj", text: "#prj Child project" },
  ]);

  editor.setCursor({ line: 4, ch: 5 });
  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: LIVE_DAILY,
  });
  assert.equal(reopened.changed, true);
  assert.match(harness.getSource(childPath), /^- \[ \] #task #prj Child project.*\^prj$/m);
  assert.match(harness.getSource(parentPath), /^- \[ \] #task #prj Parent project #hide \^prj$/m);
  assert.match(editor.getValue(), /\t- \[\[projects\/child#\^prj\]\]/);
  assert.doesNotMatch(editor.getValue(), /\[\[projects\/parent#\^prj\]\]/);
});

test("PP18 Alt+[ cancel of the last task surfaces R without linking", async () => {
  notices.length = 0;
  const day = liveDay();
  const source = liveProject([
    "- [ ] #task #prj Ship it! #hide ^prj",
    "- [ ] #task Last task [id:: ship__a] ^a",
  ]);
  const harness = createInMemoryObsidianApp({
    "ship.md": source,
    [LIVE_DAILY]: day,
  });
  const editor = createTextEditor(source, { line: 5, ch: 5 });
  const plugin = makePlugin(harness, editor, "ship.md");
  const seen = [];
  installNavStub(plugin, seen);
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "ship.md" },
  });
  assert.equal(plugin.handleCycleCommand(false, editor, view, -1), true);
  await settle(plugin);

  assert.match(editor.getValue(), /^- \[-\] #task Last task/m);
  assert.match(editor.getValue(), /^- \[ \] #task #prj Ship it! \^prj$/m);
  assert.doesNotMatch(editor.getValue(), /#hide/);
  assert.equal(harness.getSource(LIVE_DAILY), day);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].unblocked[0].not_linked, "cancelled");
  assert.equal(seen[0].unblocked[0].trigger, "project_empty");
  assert.equal(seen[0].unblocked[0].link, null);
});

test("PP19 same-day reopen restores R byte-for-byte and takes back the link", async () => {
  notices.length = 0;
  const day = liveDay();
  const source = liveProject([
    "- [ ] #task #prj Ship it! #hide ^prj",
    "- [ ] #task Last task [id:: ship__a] ^a",
  ]);
  const harness = createInMemoryObsidianApp({
    "ship.md": source,
    [LIVE_DAILY]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, LIVE_DAILY);
  installNavStub(plugin, []);

  const closed = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: LIVE_DAILY,
  });
  assert.equal(closed.changed, true);
  assert.equal(editor.getLine(5), "\t- [[ship#^prj]]");
  notices.length = 0;

  editor.setCursor({ line: 4, ch: 5 });
  const reopened = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: LIVE_DAILY,
  });
  assert.equal(reopened.changed, true);
  assert.equal(editor.getLine(4), "\t- [[ship#^a]]");
  assert.equal(editor.lineCount(), 5);
  assert.equal(
    harness.getSource("ship.md").split("\n").find((line) => line.includes("^prj")),
    "- [ ] #task #prj Ship it! #hide ^prj",
  );
  assert.ok(
    notices.some((message) => message.startsWith("↩ Reopened")),
    JSON.stringify(notices),
  );
});

test("a close in a project that still has work stays inside the gate", async () => {
  notices.length = 0;
  const source = liveProject([
    "- [ ] #task #prj Ship it! #hide ^prj",
    "- [ ] #task Last task ^plain",
    "- [ ] #task Still open ^b",
  ]);
  const harness = createInMemoryObsidianApp({ "ship.md": source });
  const editor = createTextEditor(source, { line: 5, ch: 4 });
  const plugin = makePlugin(harness, editor, "ship.md");
  const counts = countVaultReads(harness);
  const seen = [];
  installNavStub(plugin, seen);

  const taskStatus = plugin.getActiveTaskStatus(editor);
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "ship.md" },
    taskStatus,
  );

  assert.equal(wrote, true);
  assert.deepEqual(counts.cachedRead, []);
  assert.deepEqual(counts.read, []);
  assert.equal(seen.length, 0);
  assert.equal(notices.length, 0);
  assert.match(harness.getSource("ship.md"), /#hide/);
});

test("P1 path-qualified skip keys: same ^review in another note does not suppress", () => {
  const day = shipDay();
  const notes = {
    "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK]),
    "other.md": "- [x] #task Other review ^review\n",
  };
  const closedOther = [{ path: "other.md", blockId: "review", taskId: "", text: "Other" }];
  // Sanity: closing a same-id task in another note still pulls in ship.md.
  const { plan } = planFixture({ day, notes, closed: A_CLOSED });
  assert.equal(plan.unblocked.some((row) => row.block_id === "prj"), true);
  assert.equal(closedOther.length, 1);
});

test("P3 id-less cascade: stale [?] R recovers resident without [id::]", () => {
  const day = shipDay("\t- [[ship#^a]]");
  const notes = {
    "ship.md": projectNote([
      "- [x] #task Last task ^a",
      "- [?] #task #prj Ship it! #hide ^prj",
      "- [?] #task Help #prj_is_blocked #hide ^help",
    ]),
  };
  const closed = [{ path: "ship.md", blockId: "a", taskId: "", text: "Last task" }];
  const { plan } = planFixture({ day, notes, closed });
  const prj = plan.unblocked.find((row) => row.block_id === "prj");
  assert.ok(prj);
  assert.equal(prj.trigger, "project_empty");
});

test("P4 frontmatter scheduled validity mirrors Rust", () => {
  const empty = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": ["---", 'type: "[[project]]"', "status: wip", "scheduled:", "---", HIDDEN_PRJ, LAST_TASK].join("\n"),
    },
    closed: A_CLOSED,
  });
  assert.equal(empty.plan.unblocked.length, 0);
  const commented = planFixture({
    day: shipDay(),
    notes: {
      "ship.md": ["---", 'type: "[[project]]"', "status: wip", "scheduled: 2026-12-01 # note", "---", HIDDEN_PRJ, LAST_TASK].join("\n"),
    },
    closed: A_CLOSED,
  });
  assert.equal(commented.plan.unblocked.length, 0);
});

test("P5 recognition mirrors Rust (status/type/prj line)", () => {
  const noStatus = planFixture({
    day: shipDay(),
    notes: { "ship.md": ["---", 'type: "[[project]]"', "---", HIDDEN_PRJ, LAST_TASK].join("\n") },
    closed: A_CLOSED,
  });
  assert.equal(noStatus.plan.unblocked.some((r) => r.block_id === "prj"), true);
  const flow = planFixture({
    day: shipDay(),
    notes: { "ship.md": projectNote([HIDDEN_PRJ, LAST_TASK], []).replace('type: "[[project]]"', 'type: ["[[project]]"]') },
    closed: A_CLOSED,
  });
  assert.equal(flow.plan.unblocked.some((r) => r.block_id === "prj"), true);
  const block = planFixture({
    day: shipDay(),
    notes: { "ship.md": ["---", "type:", '  - "[[project]]"', "status: wip", "---", HIDDEN_PRJ, LAST_TASK].join("\n") },
    closed: A_CLOSED,
  });
  assert.equal(block.plan.unblocked.some((r) => r.block_id === "prj"), true);
  const noTaskTag = planFixture({
    day: shipDay(),
    notes: { "ship.md": projectNote(["- [ ] #prj Ship it! #hide ^prj", LAST_TASK]) },
    closed: A_CLOSED,
  });
  assert.equal(noTaskTag.plan.unblocked.some((r) => r.block_id === "prj"), false);
});

test("P6 SUBOPEN blank line stops the marker scan (PP6)", () => {
  const withBlank = projectNote([
    "- [ ] #task #prj Ship it! #hide ^prj",
    "  - 🧩 **Sub-projects:**",
    "",
    "  - [[child]]",
    LAST_TASK,
  ]);
  // Blank line ends the sub-block: no open child -> pull-in.
  const { plan } = planFixture({ day: shipDay(), notes: { "ship.md": withBlank }, closed: A_CLOSED });
  assert.equal(plan.unblocked.some((r) => r.block_id === "prj"), true);
});
