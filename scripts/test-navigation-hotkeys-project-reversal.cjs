const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  parseFrontmatterFromContent,
} = require("./navigation-hotkeys-harness.cjs");

function workedExampleProjectNote(overrides = {}) {
  const frontmatter = {
    parent: 'parent: "[[Health]]"',
    template: 'template: "[[new_project]]"',
    type: 'type: "[[project]]"',
    status: "status: wip",
    created: "created: 2026-08-01T09:12:00-04:00",
    scheduled: "scheduled: 2026-09-01",
    ...overrides.frontmatter,
  };
  const lifecycle =
    overrides.lifecycle ||
    "- [ ] #task #prj Build a gym habit [p::1] #hide ^prj";
  const lifecycleChildren = Object.prototype.hasOwnProperty.call(
    overrides,
    "lifecycleChildren",
  )
    ? overrides.lifecycleChildren
    : [
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- _2026-08-05 — 2026-08-01 → 2026-09-01 — 🎲 auto_",
      ];
  const tasks = Object.prototype.hasOwnProperty.call(overrides, "tasks")
    ? overrides.tasks
    : [
        "- [ ] #task Buy shoes [created::2026-08-01]",
        "\t- Check the outlet store",
        "- [x] #task Sign up [created::2026-08-01]",
      ];
  const extraSections = Object.prototype.hasOwnProperty.call(
    overrides,
    "extraSections",
  )
    ? overrides.extraSections
    : [
        "## Requirements",
        "",
        "- Must be within walking distance",
        "",
        "## Open Questions",
        "",
        "- Morning or evening?",
      ];
  const preamble = Object.prototype.hasOwnProperty.call(overrides, "preamble")
    ? overrides.preamble
    : [];
  const lines = [
    "---",
    ...Object.values(frontmatter).filter((line) => line !== null),
    "---",
    "",
    ...preamble,
    lifecycle,
    ...lifecycleChildren,
    "",
    "## Tasks",
    "",
    ...tasks,
    "",
    ...extraSections,
  ];
  const ending = overrides.lineEnding || "\n";
  return lines.join(ending);
}

function workedExampleParentNote(overrides = {}) {
  const type = overrides.type || 'type: "[[area]]"';
  const extraFrontmatter = overrides.extraFrontmatter || [];
  const tasks = Object.prototype.hasOwnProperty.call(overrides, "tasks")
    ? overrides.tasks
    : ["- [ ] #task (REPLACE WITH TASK DESCRIPTION) [created::2026-08-01]"];
  const lines = [
    "---",
    type,
    ...extraFrontmatter,
    "---",
    "",
    ...(overrides.omitTasksHeader
      ? []
      : ["## Tasks", "", ...tasks, ...(overrides.afterTasks || [])]),
  ];
  return lines.join(overrides.lineEnding || "\n");
}

function expectedRestoredGymHabitBlock() {
  return [
    "- [ ] #task Build a gym habit [p::1] [scheduled::2026-09-01] [created::2026-08-01] ^gym-habit",
    "\t- [ ] #task Buy shoes [created::2026-08-01]",
    "\t\t- Check the outlet store",
    "\t- [x] #task Sign up [created::2026-08-01]",
    "\t- REQUIREMENTS",
    "\t\t- Must be within walking distance",
    "\t- OPEN QUESTIONS",
    "\t\t- Morning or evening?",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- _2026-08-05 — 2026-08-01 → 2026-09-01 — 🎲 auto_",
  ];
}



function createProjectReversalHarness(options) {
  const projectPath = options.projectPath || "Health_gym_habit.md";
  const parentPath = options.parentPath || "Health.md";
  const projectBasename = projectPath.replace(/\.md$/i, "").split("/").pop();
  const parentBasename = parentPath.replace(/\.md$/i, "").split("/").pop();
  const projectFile = {
    path: projectPath,
    basename: projectBasename,
    extension: "md",
  };
  const parentFile = {
    path: parentPath,
    basename: parentBasename,
    extension: "md",
  };
  const fileByPath = {
    [projectPath]: projectFile,
    [parentPath]: parentFile,
  };
  const contents = {
    [projectPath]: options.projectContent,
    [parentPath]: options.parentContent,
  };

  for (const extra of options.extraFiles || []) {
    const basename = extra.path.replace(/\.md$/i, "").split("/").pop();
    fileByPath[extra.path] = {
      path: extra.path,
      basename,
      extension: "md",
    };
    contents[extra.path] = extra.content;
  }

  const trashCalls = [];
  const focused = [];
  const projectLines = String(options.projectContent || "").split(/\r?\n/);
  const cursorLine =
    options.cursorLine !== undefined
      ? options.cursorLine
      : projectLines.findIndex(
          (line) => /#task/.test(line) && /\^prj(?:\s|$)/.test(line),
        );
  const editor = new TransactionEditor(options.projectContent, {
    line: cursorLine < 0 ? 0 : cursorLine,
    ch: 0,
  });
  const view = {
    file: projectFile,
    editor,
    save:
      options.save ||
      (async () => {
        contents[projectPath] = editor.getValue();
      }),
  };

  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      process:
        options.process ||
        (async (file, fn) => {
          const next = fn(contents[file.path]);
          contents[file.path] = next;
          return next;
        }),
      read:
        options.read ||
        (async (file) => {
          if (!Object.prototype.hasOwnProperty.call(contents, file.path)) {
            throw new Error(`missing ${file.path}`);
          }
          return contents[file.path];
        }),
      getMarkdownFiles: () => Object.values(fileByPath),
      getAbstractFileByPath: (path) => fileByPath[path] || null,
    },
    fileManager: {
      trashFile:
        options.trashFile ||
        (async (file) => {
          trashCalls.push(file.path);
          delete contents[file.path];
        }),
    },
    metadataCache: {
      getBacklinksForFile: () => ({ data: options.backlinks || {} }),
      getFirstLinkpathDest: (linkText) => {
        const name = String(linkText || "")
          .replace(/\.md$/i, "")
          .split("/")
          .pop();
        for (const file of Object.values(fileByPath)) {
          if (file.basename === name) {
            return file;
          }
        }
        return null;
      },
      getFileCache: (file) => {
        if (!file) {
          return null;
        }
        if (options.frontmatterByPath && options.frontmatterByPath[file.path]) {
          return { frontmatter: options.frontmatterByPath[file.path] };
        }
        return { frontmatter: parseFrontmatterFromContent(contents[file.path]) };
      },
    },
  };
  plugin.focusTaskMoveDestination = async (file, anchor) => {
    focused.push({ path: file.path, anchor });
    return true;
  };

  return {
    plugin,
    editor,
    view,
    contents,
    trashCalls,
    focused,
    projectFile,
    parentFile,
    fileByPath,
  };
}

test("buildTaskBlockFromProjectNote restores the worked example and round-trips", () => {
  const content = workedExampleProjectNote();
  const result = helpers.buildTaskBlockFromProjectNote(content, {
    noteBasename: "Health_gym_habit",
    parentBasename: "Health",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.lines, expectedRestoredGymHabitBlock());
  assert.equal(result.taskCount, 2);
  assert.equal(result.sectionCount, 2);
  assert.equal(result.blockId, "gym-habit");
  assert.equal(result.scheduled, "2026-09-01");
  assert.equal(result.created, "2026-08-01");

  const seed = helpers.buildProjectSeedFromChildBullets(
    result.lines.slice(1),
    "2026-08-01",
  );
  assert.equal(seed.lossless, true);
  assert.deepEqual(seed.taskLines, [
    "- [ ] #task Buy shoes [created::2026-08-01]",
    "\t- Check the outlet store",
    "- [x] #task Sign up [created::2026-08-01]",
  ]);
  assert.deepEqual(seed.sections, [
    {
      title: "Requirements",
      noteLines: ["- Must be within walking distance"],
    },
    {
      title: "Open Questions",
      noteLines: ["- Morning or evening?"],
    },
  ]);
  assert.deepEqual(seed.managedLogLines, [
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t- _2026-08-05 — 2026-08-01 → 2026-09-01 — 🎲 auto_",
  ]);
});

test("buildTaskLineFromProjectNote preserves status, tags, and fields", () => {
  const now = new Date(2026, 7, 17);
  for (const status of [" ", "/", "*"]) {
    const parsed = helpers.parseProjectLifecycleTaskBody(
      `- [${status}] #task #prj Keep going #hide ^prj`,
    );
    assert.equal(parsed.status, status);
    assert.equal(
      helpers.buildTaskLineFromProjectNote({
        status: parsed.status,
        description: parsed.description,
        created: "2026-08-01",
      }),
      `- [${status}] #task Keep going [created::2026-08-01]`,
    );
  }

  const hidden = helpers.parseProjectLifecycleTaskBody(
    "- [ ] #task #prj Stay #hidden #hide [p::1] [id::Health_gym_habit__prj] ^prj",
  );
  assert.equal(
    hidden.description,
    "Stay #hidden [p::1] [id::Health_gym_habit__prj]",
  );
  assert.equal(
    helpers.buildTaskLineFromProjectNote({
      status: hidden.status,
      description: hidden.description,
      scheduled: "2026-09-01",
      created: "2026-08-01",
      blockId: "gym-habit",
    }),
    "- [ ] #task Stay #hidden [p::1] [id::Health_gym_habit__prj] [scheduled::2026-09-01] [created::2026-08-01] ^gym-habit",
  );

  const alreadyScheduled = helpers.parseProjectLifecycleTaskBody(
    "- [ ] #task #prj Already [scheduled::2026-10-01] #hide ^prj",
  );
  assert.equal(
    helpers.buildTaskLineFromProjectNote({
      status: alreadyScheduled.status,
      description: alreadyScheduled.description,
      scheduled: "2026-09-01",
      created: "2026-08-01",
    }),
    "- [ ] #task Already [scheduled::2026-10-01] [created::2026-08-01]",
  );

  const missingCreated = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      frontmatter: { created: null },
    }),
    {
      noteBasename: "Health_gym_habit",
      parentBasename: "Health",
      now,
    },
  );
  assert.match(missingCreated.lines[0], /\[created::2026-08-17\]/);

  const malformedCreated = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      frontmatter: { created: "created: not-a-date" },
    }),
    {
      noteBasename: "Health_gym_habit",
      parentBasename: "Health",
      now,
    },
  );
  assert.match(malformedCreated.lines[0], /\[created::2026-08-17\]/);
});

test("getProjectReversalBlockId inverts the forward basename helper", () => {
  assert.equal(
    helpers.getProjectReversalBlockId("Health_gym_habit", "Health"),
    "gym-habit",
  );
  assert.equal(
    helpers.getProjectReversalBlockId("gym_habit", "Health"),
    "gym-habit",
  );
  assert.equal(helpers.getProjectReversalBlockId("Ship It Project", "Health"), null);
});

test("formatProjectReversalSectionTitle uppercases titles and rejects unsafe ones", () => {
  assert.equal(
    helpers.formatProjectReversalSectionTitle("Future Work"),
    "FUTURE WORK",
  );
  assert.equal(
    helpers.formatProjectReversalSectionTitle("Api Design"),
    "API DESIGN",
  );
  assert.equal(helpers.formatProjectReversalSectionTitle("Q&A: notes!"), null);
});

test("splitProjectNoteForReversal treats TASKS as the task section and keeps section order", () => {
  const content = workedExampleProjectNote({
    extraSections: [
      "## Future Work",
      "",
      "- Later",
      "",
      "## Api Design",
      "",
      "- Uses REST",
    ],
  });
  const split = helpers.splitProjectNoteForReversal(
    content.replace("## Tasks", "## TASKS"),
  );
  assert.equal(split.valid, true);
  assert.deepEqual(
    split.taskLines,
    [
      "- [ ] #task Buy shoes [created::2026-08-01]",
      "\t- Check the outlet store",
      "- [x] #task Sign up [created::2026-08-01]",
    ],
  );
  assert.deepEqual(
    split.sections.map((section) => section.title),
    ["FUTURE WORK", "API DESIGN"],
  );

  const emptyRequirements = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      extraSections: ["## Requirements", "", "## Open Questions", "", "- Later"],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(emptyRequirements.valid, true);
  assert.equal(emptyRequirements.sectionCount, 1);
  assert.deepEqual(
    emptyRequirements.lines.filter((line) => line.startsWith("\t- ")),
    [
      "\t- [ ] #task Buy shoes [created::2026-08-01]",
      "\t- [x] #task Sign up [created::2026-08-01]",
      "\t- OPEN QUESTIONS",
      "\t- 🗓️ **SCHEDULE LOG**",
    ],
  );

  const rejectedTitle = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      extraSections: ["## Q&A: notes!", "", "- Something"],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(rejectedTitle.valid, false);
  assert.equal(
    rejectedTitle.error,
    'Section "Q&A: notes!" cannot be converted into a task bullet',
  );
});

test("indentProjectReversalLine preserves relative depth and drops blanks", () => {
  assert.equal(helpers.indentProjectReversalLine("   ", "\t", 1), "");
  assert.equal(
    helpers.indentProjectReversalLine("\t- child", "\t", 1),
    "\t- child",
  );
  assert.equal(
    helpers.indentProjectReversalLine("\t\t- nested", "\t", 1),
    "\t\t- nested",
  );
  assert.equal(
    helpers.indentProjectReversalLine("    - nested", "  ", 1),
    "\t  - nested",
  );
  assert.equal(
    helpers.indentProjectReversalLine("  - mixed", "\t", 1),
    "\t\t- mixed",
  );

  const twoSpace = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      tasks: ["  - [ ] #task Outer", "    - Inner"],
      lifecycleChildren: [],
      extraSections: [],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.deepEqual(twoSpace.lines.slice(1), [
    "\t- [ ] #task Outer",
    "\t  - Inner",
  ]);
});

test("buildTaskBlockFromProjectNote reports structure and frontmatter errors", () => {
  const prose = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      preamble: ["Stray paragraph between the task and the rest."],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(prose.valid, false);
  assert.match(
    prose.error,
    /content outside the \^prj task and its sections: "Stray paragraph/,
  );

  const nestedHeader = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      extraSections: ["## Requirements", "", "### Nested", "- item"],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(nestedHeader.valid, false);
  assert.match(
    nestedHeader.error,
    /Section "Requirements" has content that is not a list item: "### Nested"/,
  );

  const fenced = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      extraSections: [
        "## Requirements",
        "",
        "```",
        "- fenced",
        "```",
      ],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(fenced.valid, false);
  assert.match(
    fenced.error,
    /Section "Requirements" has content that is not a list item: "```"/,
  );

  const levelOne = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      extraSections: ["# Overview", "", "- item"],
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(levelOne.valid, false);
  assert.match(
    levelOne.error,
    /content outside the \^prj task and its sections: "# Overview"/,
  );

  const multiple = helpers.buildTaskBlockFromProjectNote(
    `${workedExampleProjectNote()}\n- [ ] #task #prj Extra #hide ^prj\n`,
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(multiple.valid, false);
  assert.equal(multiple.error, "Project note has multiple ^prj tasks");

  const closed = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      lifecycle: "- [x] #task #prj Build a gym habit #hide ^prj",
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(closed.valid, false);
  assert.equal(
    closed.error,
    "Only open projects can be converted back to a task",
  );

  const placeholder = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      lifecycle:
        "- [ ] #task #prj (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^prj",
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(placeholder.valid, false);
  assert.equal(
    placeholder.error,
    "Project completion criteria is still the template placeholder",
  );

  const emptyCriteria = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      lifecycle: "- [ ] #task #prj #hide ^prj",
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(emptyCriteria.valid, false);
  assert.equal(emptyCriteria.error, "Project completion criteria is empty");

  const notProject = helpers.buildTaskBlockFromProjectNote(
    workedExampleProjectNote({
      frontmatter: { type: 'type: "[[area]]"' },
    }),
    { noteBasename: "Health_gym_habit", parentBasename: "Health" },
  );
  assert.equal(notProject.valid, false);
  assert.equal(notProject.error, "The ^prj task is not in a project note");
});

test("buildTaskBlockFromProjectNote keeps CRLF notes reconstructable", () => {
  const content = workedExampleProjectNote({ lineEnding: "\r\n" });
  const result = helpers.buildTaskBlockFromProjectNote(content, {
    noteBasename: "Health_gym_habit",
    parentBasename: "Health",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.lines, expectedRestoredGymHabitBlock());

  const parent = workedExampleParentNote({ lineEnding: "\r\n" });
  const inserted = helpers.insertTaskMoveBlocks(
    parent,
    [result.lines],
    "area",
  );
  assert.equal(inserted.valid, true);
  assert.equal(inserted.content.includes("\r\n"), true);
  assert.equal(inserted.content.includes(result.lines[0]), true);
});

test("rewriteBlockIdLinkOriginal accepts a target block ID and defaults to prj", () => {
  assert.equal(
    helpers.rewriteBlockIdLinkOriginal(
      "[[Health_gym_habit#^prj]]",
      "Health",
      "gym-habit",
    ),
    "[[Health#^gym-habit]]",
  );
  assert.equal(
    helpers.rewriteBlockIdLinkOriginal(
      "[[Health_gym_habit#^prj|Gym]]",
      "Health",
      "gym-habit",
    ),
    "[[Health#^gym-habit|Gym]]",
  );
  assert.equal(
    helpers.rewriteBlockIdLinkOriginal(
      "![[Health_gym_habit#^prj]]",
      "Health",
      "gym-habit",
    ),
    "![[Health#^gym-habit]]",
  );
  assert.equal(
    helpers.rewriteBlockIdLinkOriginal(
      "[Gym](Health_gym_habit.md#^prj)",
      "Health",
      "gym-habit",
    ),
    "[Gym](Health.md#^gym-habit)",
  );
  assert.equal(
    helpers.rewriteBlockIdLinkOriginal("[[Health#^old]]", "New"),
    "[[New#^prj]]",
  );
});

test("collectProjectNoteBacklinkClassification separates ^prj rewrites from other refs", () => {
  const classified = helpers.collectProjectNoteBacklinkClassification(
    {
      "Health.md": [
        { original: "[[Health_gym_habit]]", link: "Health_gym_habit" },
        {
          original: "[[Health_gym_habit#^prj]]",
          link: "Health_gym_habit#^prj",
        },
      ],
      "Daily.md": [
        {
          original: "[[Health_gym_habit#^prj]]",
          link: "Health_gym_habit#^prj",
        },
      ],
      "Other.md": [
        { original: "[[Health_gym_habit]]", link: "Health_gym_habit" },
      ],
    },
    "Health.md",
  );
  assert.deepEqual(
    classified.blockRewrites.map((rewrite) => rewrite.path).sort(),
    ["Daily.md", "Health.md"],
  );
  assert.deepEqual(classified.otherPaths, ["Other.md"]);
});

test("getProjectNoteToTaskNoticeText omits zero chips and uses no-child fallback", () => {
  assert.equal(
    helpers.getProjectNoteToTaskNoticeText(
      "Health_gym_habit",
      "Health",
      2,
      2,
      1,
    ),
    "Converted Health_gym_habit into a task in Health (2 tasks; 2 sections; 1 link updated)",
  );
  assert.equal(
    helpers.getProjectNoteToTaskNoticeText("Note", "Parent", 1, 0, 0),
    "Converted Note into a task in Parent (1 task)",
  );
  assert.equal(
    helpers.getProjectNoteToTaskNoticeText("Note", "Parent", 0, 0, 0),
    "Converted Note into a task in Parent (no child content)",
  );
});

test("convertProjectNoteToTask restores the parent task, rewrites links, and trashes the note", async () => {
  notices.length = 0;
  const projectContent = workedExampleProjectNote();
  const parentContent = workedExampleParentNote();
  const harness = createProjectReversalHarness({
    projectContent,
    parentContent,
    extraFiles: [
      {
        path: "Daily.md",
        content: "See [[Health_gym_habit#^prj]] today.\n",
      },
    ],
    backlinks: {
      "Daily.md": [
        {
          original: "[[Health_gym_habit#^prj]]",
          link: "Health_gym_habit#^prj",
        },
      ],
    },
  });

  assert.equal(
    await harness.plugin.createProjectNoteFromTask(
      harness.editor,
      harness.view,
    ),
    true,
  );
  assert.equal(
    harness.contents["Health.md"].includes(expectedRestoredGymHabitBlock()[0]),
    true,
  );
  assert.equal(
    harness.contents["Health.md"].includes(
      "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
    ),
    false,
  );
  assert.equal(
    harness.contents["Daily.md"],
    "See [[Health#^gym-habit]] today.\n",
  );
  assert.deepEqual(harness.trashCalls, ["Health_gym_habit.md"]);
  assert.match(notices.at(-1), /Converted .* into a task in Health/);
});

test("createProjectNoteFromTask dispatches reverse only on a real ^prj line", async () => {
  notices.length = 0;
  const forward = createProjectReversalHarness({
    projectPath: "Health.md",
    parentPath: "Unused.md",
    projectContent: [
      "---",
      'type: "[[area]]"',
      "---",
      "",
      "- [ ] #task Ordinary work",
    ].join("\n"),
    parentContent: "---\ntype: \"[[area]]\"\n---\n",
    cursorLine: 4,
  });
  assert.equal(
    await forward.plugin.createProjectNoteFromTask(forward.editor, forward.view),
    false,
  );
  assert.match(notices.at(-1), /Templater is not available/);
  assert.deepEqual(forward.trashCalls, []);

  notices.length = 0;
  const reverse = createProjectReversalHarness({
    projectContent: workedExampleProjectNote(),
    parentContent: workedExampleParentNote(),
  });
  assert.equal(
    await reverse.plugin.createProjectNoteFromTask(
      reverse.editor,
      reverse.view,
    ),
    true,
  );
  assert.match(notices.at(-1), /Converted .* into a task in Health/);

  notices.length = 0;
  const fenced = createProjectReversalHarness({
    projectPath: "Health.md",
    parentPath: "Unused.md",
    projectContent: [
      "---",
      'type: "[[area]]"',
      "---",
      "",
      "```markdown",
      "- [ ] #task #prj Example #hide ^prj",
      "```",
    ].join("\n"),
    parentContent: "---\ntype: \"[[area]]\"\n---\n",
    cursorLine: 5,
  });
  assert.equal(
    await fenced.plugin.createProjectNoteFromTask(fenced.editor, fenced.view),
    false,
  );
  assert.match(notices.at(-1), /Templater is not available/);
  assert.deepEqual(fenced.trashCalls, []);
});

test("convertProjectNoteToTask refusals leave every file untouched", async () => {
  async function assertUntouched(label, options, noticePattern) {
    notices.length = 0;
    const projectContent = options.projectContent || workedExampleProjectNote();
    const parentContent = options.parentContent || workedExampleParentNote();
    const harness = createProjectReversalHarness({
      projectContent,
      parentContent,
      ...options,
    });
    const beforeParent = harness.contents["Health.md"];
    const beforeProject = harness.contents["Health_gym_habit.md"];
    assert.equal(
      await harness.plugin.createProjectNoteFromTask(
        harness.editor,
        harness.view,
      ),
      false,
      label,
    );
    assert.equal(harness.contents["Health.md"], beforeParent, label);
    assert.equal(harness.contents["Health_gym_habit.md"], beforeProject, label);
    assert.deepEqual(harness.trashCalls, [], label);
    assert.match(notices.at(-1), noticePattern, label);
  }

  await assertUntouched(
    "missing parent",
    {
      projectContent: workedExampleProjectNote({
        frontmatter: { parent: null },
      }),
    },
    /Project note has no parent link/,
  );
  await assertUntouched(
    "unresolvable parent",
    {
      projectContent: workedExampleProjectNote({
        frontmatter: { parent: 'parent: "[[Missing]]"' },
      }),
    },
    /Parent note "Missing" not found/,
  );
  await assertUntouched(
    "closed parent",
    {
      parentContent: workedExampleParentNote({
        type: 'type: "[[project]]"',
        extraFrontmatter: ["status: done"],
      }),
    },
    /Parent note "Health" must be an area or open project/,
  );
  await assertUntouched(
    "no tasks section",
    {
      parentContent: workedExampleParentNote({
        type: 'type: "[[project]]"',
        extraFrontmatter: ["status: wip"],
        omitTasksHeader: true,
      }),
    },
    /Parent note "Health" has no ## Tasks section/,
  );
  await assertUntouched(
    "child note",
    {
      extraFiles: [
        {
          path: "Child.md",
          content: [
            "---",
            'parent: "[[Health_gym_habit]]"',
            'type: "[[project]]"',
            "---",
            "",
          ].join("\n"),
        },
      ],
    },
    /Project has 1 child notes; move them before converting/,
  );
  await assertUntouched(
    "colliding block ID",
    {
      parentContent: workedExampleParentNote({
        tasks: ["- [ ] #task Existing ^gym-habit"],
      }),
    },
    /Parent note already contains block ID: gym-habit/,
  );
  await assertUntouched(
    "extra inbound link",
    {
      extraFiles: [
        {
          path: "Other.md",
          content: "See [[Health_gym_habit]].\n",
        },
      ],
      backlinks: {
        "Other.md": [
          { original: "[[Health_gym_habit]]", link: "Health_gym_habit" },
        ],
      },
    },
    /1 notes link to "Health_gym_habit"; update them before converting \(first: Other\.md\)/,
  );
});

test("convertProjectNoteToTask reports post-write failures without rolling back", async () => {
  notices.length = 0;
  const trashFailure = createProjectReversalHarness({
    projectContent: workedExampleProjectNote(),
    parentContent: workedExampleParentNote(),
    trashFile: async () => {
      throw new Error("trash failed");
    },
  });
  assert.equal(
    await trashFailure.plugin.createProjectNoteFromTask(
      trashFailure.editor,
      trashFailure.view,
    ),
    true,
  );
  assert.match(notices.at(-1), /could not delete/);
  assert.equal(
    trashFailure.contents["Health.md"].includes(
      expectedRestoredGymHabitBlock()[0],
    ),
    true,
  );

  notices.length = 0;
  const rewriteFailure = createProjectReversalHarness({
    projectContent: workedExampleProjectNote(),
    parentContent: workedExampleParentNote(),
    backlinks: {
      "Missing.md": [
        {
          original: "[[Health_gym_habit#^prj]]",
          link: "Health_gym_habit#^prj",
        },
      ],
    },
  });
  assert.equal(
    await rewriteFailure.plugin.createProjectNoteFromTask(
      rewriteFailure.editor,
      rewriteFailure.view,
    ),
    true,
  );
  assert.match(notices.at(-1), /links could not be updated/);
  assert.deepEqual(rewriteFailure.trashCalls, []);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      rewriteFailure.contents,
      "Health_gym_habit.md",
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// link-picker: Ctrl+Shift+P edits the task behind a Task Link bullet.
// ---------------------------------------------------------------------------

