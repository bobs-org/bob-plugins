const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  pomodoroFixtureLines,
} = require("./navigation-hotkeys-harness.cjs");


test("parsePomodoroEntryLine parses named/unnamed, placeholder/range, and open/closed shapes", () => {
  assert.deepEqual(
    helpers.parsePomodoroEntryLine("- [ ] () — BODY"),
    {
      indent: "",
      status: " ",
      open: true,
      bodyStart: 6,
      rangeText: "()",
      rangeStart: 6,
      rangeEnd: 8,
      placeholder: true,
      name: "BODY",
      nameStart: 11,
      nameEnd: 15,
    },
  );
  const unnamed = helpers.parsePomodoroEntryLine("- [ ] ()");
  assert.equal(unnamed.name, null);
  assert.equal(unnamed.nameStart, null);
  assert.equal(unnamed.nameEnd, null);

  const colonRange = helpers.parsePomodoroEntryLine(
    "- [ ] (20:50-21:25 [t:: 35m]) — VERIFY",
  );
  assert.equal(colonRange.placeholder, false);
  assert.equal(colonRange.rangeText, "(20:50-21:25 [t:: 35m])");
  assert.equal(colonRange.name, "VERIFY");

  const compactRange = helpers.parsePomodoroEntryLine(
    "- [x] (**0855-0920** [t:: 25m])",
  );
  assert.equal(compactRange.status, "x");
  assert.equal(compactRange.open, false);
  assert.equal(compactRange.placeholder, false);
  assert.equal(compactRange.name, null);

  assert.equal(
    helpers.parsePomodoroEntryLine("- [/] (**0900-0930** [t:: 5m])").open,
    true,
  );

  // An em dash inside `[t:: ]` metadata is part of the range, never a name.
  const embeddedDash = helpers.parsePomodoroEntryLine(
    "- [ ] (**0920-0950** [t:: 30m — extra]) — VERIFY",
  );
  assert.equal(embeddedDash.rangeText, "(**0920-0950** [t:: 30m — extra])");
  assert.equal(embeddedDash.name, "VERIFY");

  assert.equal(helpers.parsePomodoroEntryLine("\t- [ ] ()"), null);
  assert.equal(helpers.parsePomodoroEntryLine("Not a ledger line"), null);
  assert.equal(helpers.parsePomodoroEntryLine("- [ ] no parenthetical"), null);
});

test("normalizePomodoroName uppercases, collapses whitespace, strips em dashes, and rejects empty/over-length", () => {
  assert.deepEqual(helpers.normalizePomodoroName("body"), {
    valid: true,
    name: "BODY",
    error: null,
  });
  assert.equal(helpers.normalizePomodoroName("  a   b  ").name, "A B");
  assert.equal(helpers.normalizePomodoroName("— body").name, "BODY");
  assert.equal(helpers.normalizePomodoroName("").valid, false);
  assert.match(helpers.normalizePomodoroName("   ").error, /empty/);
  const maxLength = "X".repeat(helpers.POMODORO_NAME_MAX_LENGTH);
  assert.equal(helpers.normalizePomodoroName(maxLength).valid, true);
  const overLength = "X".repeat(helpers.POMODORO_NAME_MAX_LENGTH + 1);
  const overResult = helpers.normalizePomodoroName(overLength);
  assert.equal(overResult.valid, false);
  assert.match(overResult.error, /exceed/);
});

test("formatPomodoroEntryLine emits a placeholder entry with or without a name", () => {
  assert.equal(helpers.formatPomodoroEntryLine(""), "- [ ] ()");
  assert.equal(helpers.formatPomodoroEntryLine("BODY"), "- [ ] () — BODY");
});

test("createPomodoroBulletMovePickerRows excludes ineligible entries and handles create/invalid rows", () => {
  const content = pomodoroFixtureLines().join("\n");
  const { entries } = helpers.collectPomodoroEntries(content);
  const sourceEntryLine = entries[1].entryLine;
  const emptyRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "",
  );
  assert.deepEqual(
    emptyRows.map((row) => [row.kind, row.title]),
    [
      ["existing", "Pomodoro #3"],
      ["existing", "BODY"],
      ["existing", "VERIFY"],
    ],
  );
  assert.equal(emptyRows.some((row) => row.entry && row.entry.open === false), false);
  assert.equal(emptyRows.some((row) => row.entry && row.entry.entryLine === sourceEntryLine), false);

  const createRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "deep",
  );
  assert.deepEqual(createRows, [
    {
      kind: "new",
      name: "DEEP",
      title: "New Pomodoro DEEP",
      meta: "Created below the current Pomodoro",
    },
  ]);

  const collisionRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "body",
  );
  assert.equal(collisionRows.some((row) => row.kind === "new"), false);
  assert.deepEqual(
    collisionRows.map((row) => row.title),
    ["BODY"],
  );

  const strippedEmptyRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "——",
  );
  assert.equal(strippedEmptyRows[0].kind, "invalid");
  assert.match(strippedEmptyRows[0].statusText, /empty/);

  const overLengthRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "X".repeat(helpers.POMODORO_NAME_MAX_LENGTH + 1),
  );
  assert.equal(overLengthRows[0].kind, "invalid");
  assert.match(overLengthRows[0].statusText, /exceed/);
});

test("createPomodoroBulletMovePickerRows maps = to a fresh source-name Pomodoro in bullet mode only", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — focus",
    "\t- move",
    "- [ ] () — FOCUS",
    "\t- existing",
    "- [ ] () — PLUS",
    "\t- preview mentions + and = directly",
  ].join("\n");
  const { entries } = helpers.collectPomodoroEntries(content);
  const sourceEntryLine = entries[0].entryLine;

  for (const query of ["=", "  =  "]) {
    assert.deepEqual(
      helpers.createPomodoroBulletMovePickerRows(
        entries,
        sourceEntryLine,
        query,
      ),
      [
        {
          kind: "new",
          name: "FOCUS",
          title: "New Pomodoro FOCUS",
          meta: "Created below the current Pomodoro",
        },
      ],
    );
  }

  const ordinaryNameRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "C++",
  );
  assert.deepEqual(ordinaryNameRows.map((row) => row.kind), ["new"]);
  assert.equal(ordinaryNameRows[0].name, "C++");

  const plusRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "+",
  );
  assert.equal(plusRows[0].kind, "new");
  assert.equal(plusRows[0].name, "+");
  assert.equal(
    plusRows.some((row) => row.kind === "split" || row.kind === "invalid"),
    false,
  );

  const doublePlusRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "++",
  );
  assert.deepEqual(doublePlusRows.map((row) => row.kind), ["new"]);
  assert.equal(doublePlusRows[0].name, "++");

  const existingNameRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "focus",
  );
  assert.equal(existingNameRows.some((row) => row.kind === "new"), false);
  assert.deepEqual(existingNameRows.map((row) => row.title), ["FOCUS"]);

  const entryModeRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "+",
    { mode: "entry" },
  );
  assert.equal(entryModeRows[0].kind, "rename");
  assert.equal(entryModeRows[0].name, "+");
  assert.equal(
    entryModeRows.some((row) => row.kind === "existing" && row.title === "PLUS"),
    true,
  );

  const entryEqualsRows = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "=",
    { mode: "entry" },
  );
  assert.equal(entryEqualsRows[0].kind, "rename");
  assert.equal(entryEqualsRows[0].name, "=");
});

test("createPomodoroBulletMovePickerRows = shortcut resolves named closed sources and rejects unnamed, missing, and invalid sources", () => {
  const namedClosedContent = [
    "## Pomodoros",
    "- [x] (**0900-0930**) — closed — focus",
    "\t- moved",
    "- [ ] () — OTHER",
  ].join("\n");
  const { entries: namedClosedEntries } =
    helpers.collectPomodoroEntries(namedClosedContent);
  const namedClosedRows = helpers.createPomodoroBulletMovePickerRows(
    namedClosedEntries,
    namedClosedEntries[0].entryLine,
    "=",
  );
  assert.deepEqual(namedClosedRows, [
    {
      kind: "new",
      name: "CLOSED FOCUS",
      title: "New Pomodoro CLOSED FOCUS",
      meta: "Created below the current Pomodoro",
    },
  ]);

  const unnamedContent = [
    "## Pomodoros",
    "- [ ] ()",
    "\t- moved",
    "- [ ] () — OTHER",
  ].join("\n");
  const { entries: unnamedEntries } =
    helpers.collectPomodoroEntries(unnamedContent);
  const unnamedRows = helpers.createPomodoroBulletMovePickerRows(
    unnamedEntries,
    unnamedEntries[0].entryLine,
    "=",
  );
  assert.equal(unnamedRows[0].kind, "invalid");
  assert.match(unnamedRows[0].statusText, /named source/);
  assert.match(unnamedRows[0].statusText, /type a new name/);

  const unnamedSplitRows = helpers.createPomodoroBulletMovePickerRows(
    unnamedEntries,
    unnamedEntries[0].entryLine,
    "=focus",
  );
  assert.equal(unnamedSplitRows[0].kind, "invalid");
  assert.match(unnamedSplitRows[0].statusText, /named source/);

  const missingRows = helpers.createPomodoroBulletMovePickerRows(
    unnamedEntries,
    999,
    "=",
  );
  assert.equal(missingRows[0].kind, "invalid");
  assert.match(missingRows[0].statusText, /could not be found/);

  const missingSplitRows = helpers.createPomodoroBulletMovePickerRows(
    unnamedEntries,
    999,
    "=focus",
  );
  assert.equal(missingSplitRows[0].kind, "invalid");
  assert.match(missingSplitRows[0].statusText, /could not be found/);

  const invalidNameContent = [
    "## Pomodoros",
    `- [ ] () — ${"X".repeat(helpers.POMODORO_NAME_MAX_LENGTH + 1)}`,
    "\t- moved",
    "- [ ] () — OTHER",
  ].join("\n");
  const { entries: invalidNameEntries } =
    helpers.collectPomodoroEntries(invalidNameContent);
  const invalidNameRows = helpers.createPomodoroBulletMovePickerRows(
    invalidNameEntries,
    invalidNameEntries[0].entryLine,
    "=",
  );
  assert.equal(invalidNameRows[0].kind, "invalid");
  assert.match(invalidNameRows[0].statusText, /exceed/);

  const overLengthSplitRows = helpers.createPomodoroBulletMovePickerRows(
    unnamedEntries,
    unnamedEntries[1].entryLine,
    `=${"X".repeat(helpers.POMODORO_NAME_MAX_LENGTH + 1)}`,
  );
  assert.equal(overLengthSplitRows[0].kind, "invalid");
  assert.match(overLengthSplitRows[0].statusText, /exceed/);
});

test("createPomodoroBulletMovePickerRows formats titles, metadata, and query matches", () => {
  const content = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- [[range#^one]]",
    "\t- [[range#^two]]",
    "- [ ] ()",
    "\t- [[plain#^one]]",
    "- [ ] () — BODY",
    "\t- [[body#^one]]",
    "- [ ] () — EMPTY",
  ].join("\n");
  const { entries } = helpers.collectPomodoroEntries(content);
  const rows = helpers
    .createPomodoroBulletMovePickerRows(entries, -1, "")
    .filter((row) => row.kind === "existing");

  assert.deepEqual(
    rows.map((row) => ({
      title: row.title,
      statusLabel: row.statusLabel,
      meta: row.meta,
    })),
    [
      {
        title: "0920-0950",
        statusLabel: "",
        meta: "[[range#^one]] +1 more",
      },
      {
        title: "Pomodoro #2",
        statusLabel: "Unscheduled",
        meta: "[[plain#^one]]",
      },
      {
        title: "BODY",
        statusLabel: "Unscheduled",
        meta: "[[body#^one]]",
      },
      {
        title: "EMPTY",
        statusLabel: "Unscheduled",
        meta: "No sub-bullets yet",
      },
    ],
  );

  const existingTitlesFor = (query) =>
    helpers
      .createPomodoroBulletMovePickerRows(entries, -1, query)
      .filter((row) => row.kind === "existing")
      .map((row) => row.title);
  assert.deepEqual(existingTitlesFor("body"), ["BODY"]);
  assert.deepEqual(existingTitlesFor("0920"), ["0920-0950"]);
  assert.deepEqual(existingTitlesFor("#2"), ["Pomodoro #2"]);
  assert.deepEqual(existingTitlesFor("2"), ["0920-0950", "Pomodoro #2"]);
  assert.deepEqual(existingTitlesFor("plain"), ["Pomodoro #2"]);

  const onlySourceContent = [
    "## Pomodoros",
    "- [ ] () — ONLY",
    "\t- [[x#^one]]",
  ].join("\n");
  const { entries: onlyEntries } =
    helpers.collectPomodoroEntries(onlySourceContent);
  assert.deepEqual(
    helpers.createPomodoroBulletMovePickerRows(
      onlyEntries,
      onlyEntries[0].entryLine,
      "next",
    ),
    [
      {
        kind: "new",
        name: "NEXT",
        title: "New Pomodoro NEXT",
        meta: "Created below the current Pomodoro",
      },
    ],
  );
});

test("buildPomodoroBulletMoveNotice formats counts, destinations, and suffixes", () => {
  assert.equal(
    helpers.buildPomodoroBulletMoveNotice(
      { createdPomodoro: false, skippedDuplicateCount: 0, movedCount: 3 },
      { actualCount: 3, clamped: false },
      "VERIFY",
    ),
    "Moved 3 bullets to VERIFY",
  );
  assert.equal(
    helpers.buildPomodoroBulletMoveNotice(
      { createdPomodoro: false, skippedDuplicateCount: 0, movedCount: 1 },
      { actualCount: 1, clamped: false },
      "Pomodoro #6",
    ),
    "Moved 1 bullet to Pomodoro #6",
  );
  assert.equal(
    helpers.buildPomodoroBulletMoveNotice(
      {
        createdPomodoro: true,
        createdPomodoroName: "BODY",
        skippedDuplicateCount: 0,
        movedCount: 3,
      },
      { actualCount: 3, clamped: false },
      "BODY",
    ),
    "Moved 3 bullets to new Pomodoro BODY",
  );
  assert.equal(
    helpers.buildPomodoroBulletMoveNotice(
      {
        createdPomodoro: true,
        createdPomodoroName: "BODY",
        skippedDuplicateCount: 1,
        movedCount: 2,
      },
      { actualCount: 3, requestedCount: 5, clamped: true },
      "BODY",
    ),
    "Moved 3 bullets to new Pomodoro BODY (merged 1 duplicate) (requested 5; reached end of Pomodoro)",
  );
});

test("buildPomodoroEntryMoveNotice formats moved/merged counts and the deleted-empty case", () => {
  assert.equal(
    helpers.buildPomodoroEntryMoveNotice(
      { movedCount: 3, skippedDuplicateCount: 0 },
      { entry: { position: 2 } },
      "DEEP WORK",
    ),
    "Moved 3 bullets from Pomodoro #2 to DEEP WORK",
  );
  assert.equal(
    helpers.buildPomodoroEntryMoveNotice(
      { movedCount: 1, skippedDuplicateCount: 1 },
      { entry: { position: 2 } },
      "DEEP WORK",
    ),
    "Moved 1 bullet from Pomodoro #2 to DEEP WORK (merged 1 duplicate)",
  );
  assert.equal(
    helpers.buildPomodoroEntryMoveNotice(
      { movedCount: 0, skippedDuplicateCount: 0 },
      { entry: { position: 2 } },
      "DEEP WORK",
    ),
    "Deleted empty Pomodoro #2",
  );
});

test("createPomodoroBulletMovePickerRows 'entry' mode emits rename rows for novel/self names and existing-destination rows for other names", () => {
  const content = pomodoroFixtureLines().join("\n");
  const { entries } = helpers.collectPomodoroEntries(content);
  const sourceEntryLine = 9; // BODY

  const novel = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "brand new",
    { mode: "entry" },
  );
  assert.deepEqual(novel, [
    {
      kind: "rename",
      name: "BRAND NEW",
      title: "Rename to BRAND NEW",
      meta: "Renames the current Pomodoro",
      badge: "Rename",
    },
  ]);

  const otherExisting = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "verify",
    { mode: "entry" },
  );
  assert.equal(otherExisting.some((row) => row.kind === "rename"), false);
  assert.deepEqual(
    otherExisting.map((row) => row.kind),
    ["existing"],
  );
  assert.equal(otherExisting[0].title, "VERIFY");

  const ownName = helpers.createPomodoroBulletMovePickerRows(
    entries,
    sourceEntryLine,
    "body",
    { mode: "entry" },
  );
  assert.deepEqual(
    ownName.map((row) => row.kind),
    ["rename"],
  );
  assert.equal(ownName[0].name, "BODY");
});

test("createPomodoroBulletMovePickerRows 'bullets' mode is unchanged by the new options argument", () => {
  const content = pomodoroFixtureLines().join("\n");
  const { entries } = helpers.collectPomodoroEntries(content);
  const threeArg = helpers.createPomodoroBulletMovePickerRows(entries, 9, "verify");
  const explicitBullets = helpers.createPomodoroBulletMovePickerRows(
    entries,
    9,
    "verify",
    { mode: "bullets" },
  );
  assert.deepEqual(threeArg, explicitBullets);

  const threeArgNovel = helpers.createPomodoroBulletMovePickerRows(
    entries,
    9,
    "brand new",
  );
  assert.deepEqual(threeArgNovel.map((row) => row.kind), ["new"]);
});

test("createPomodoroBulletMovePickerRows excludes the source and closed entries from destination rows in both modes, sharing the invalid row", () => {
  const content = pomodoroFixtureLines().join("\n");
  const { entries } = helpers.collectPomodoroEntries(content);

  for (const mode of ["bullets", "entry"]) {
    const rows = helpers.createPomodoroBulletMovePickerRows(entries, 9, "", {
      mode,
    });
    const destinationRows = rows.filter((row) => row.kind === "existing");
    assert.equal(
      destinationRows.some((row) => row.entry.entryLine === 9),
      false,
    );
    assert.equal(
      destinationRows.some((row) => row.entry.open === false),
      false,
    );

    const invalidRows = helpers.createPomodoroBulletMovePickerRows(
      entries,
      9,
      "——",
      { mode },
    );
    assert.equal(invalidRows[0].kind, "invalid");
    assert.match(invalidRows[0].statusText, /empty/);
  }
});

test("collectPomodoroEntries reports positions, open/name, child ranges, previews, and skips fenced/absent sections", () => {
  const content = pomodoroFixtureLines().join("\n");
  const { section, entries } = helpers.collectPomodoroEntries(content);
  assert.deepEqual(section, { startLine: 0, endLine: 12 });
  assert.equal(entries.length, 5);
  assert.deepEqual(
    entries.map((entry) => [entry.position, entry.open, entry.name]),
    [
      [1, false, null],
      [2, true, null],
      [3, true, null],
      [4, true, "BODY"],
      [5, true, "VERIFY"],
    ],
  );
  const closed = entries[0];
  assert.equal(closed.childStartLine, 2);
  assert.equal(closed.childEndLineExclusive, 4);
  assert.equal(closed.childIndent, "\t");
  assert.equal(closed.previewText, "~~[[#^gtd]]~~");
  assert.equal(closed.moreCount, 1);

  const grandchildEntry = entries[2];
  assert.equal(grandchildEntry.bulletLines.length, 1);
  assert.equal(grandchildEntry.previewText, "[[sase#^pager]]");
  assert.equal(grandchildEntry.moreCount, 0);

  const fenced = [
    "## Pomodoros",
    "```md",
    "- [ ] ()",
    "```",
    "- [ ] () — REAL",
  ].join("\n");
  assert.equal(helpers.collectPomodoroEntries(fenced).entries.length, 1);

  assert.deepEqual(helpers.collectPomodoroEntries("# Just a note\nBody"), {
    section: null,
    entries: [],
  });
});

test("findPomodoroBulletContext resolves owning entries and rejects entry/blank/outside-section lines", () => {
  const content = pomodoroFixtureLines().join("\n");
  const sub = helpers.findPomodoroBulletContext(content, 5);
  assert.equal(sub.entry.entryLine, 4);
  assert.equal(sub.depth, 4);

  const grandchild = helpers.findPomodoroBulletContext(content, 8);
  assert.equal(grandchild.entry.entryLine, 6);
  assert.equal(grandchild.depth, 8);

  assert.equal(helpers.findPomodoroBulletContext(content, 1), null);
  assert.equal(helpers.findPomodoroBulletContext(content, 0), null);
  assert.equal(helpers.findPomodoroBulletContext(content, 13), null);
});

test("findPomodoroBulletContext leaves plain #task lines on the task-move route", () => {
  const content = [
    "- [ ] #task Plain outside Pomodoros ^plain",
    "",
    ...pomodoroFixtureLines(),
  ].join("\n");
  assert.equal(helpers.findPomodoroBulletContext(content, 0), null);
  assert.notEqual(helpers.findPomodoroBulletContext(content, 7), null);
});

test("discoverMovablePomodoroBulletTargets collects bare/counted siblings, clamps, and isolates subtree and grandchild depths", () => {
  const content = pomodoroFixtureLines().join("\n");
  const bare = helpers.discoverMovablePomodoroBulletTargets(content, 5, 0);
  assert.equal(bare.valid, true);
  assert.deepEqual(bare.targets.map((target) => target.line), [5]);
  assert.equal(bare.entryLine, 4);

  const counted = helpers.discoverMovablePomodoroBulletTargets(content, 2, 1);
  assert.deepEqual(counted.targets.map((target) => target.line), [2, 3]);
  assert.equal(counted.clamped, false);
  assert.equal(counted.requestedCount, 2);

  const clamped = helpers.discoverMovablePomodoroBulletTargets(content, 2, 5);
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.requestedCount, 6);
  assert.equal(clamped.actualCount, 2);

  // The nested `sase-tj` bullet under `[[sase#^pager]]` is not a sibling.
  const notSibling = helpers.discoverMovablePomodoroBulletTargets(content, 7, 1);
  assert.deepEqual(notSibling.targets.map((target) => target.line), [7]);
  assert.equal(notSibling.clamped, true);

  // Starting on the grandchild itself collects grandchild siblings only.
  const grandchild = helpers.discoverMovablePomodoroBulletTargets(content, 8, 3);
  assert.deepEqual(grandchild.targets.map((target) => target.line), [8]);
  assert.equal(grandchild.clamped, true);

  assert.match(
    helpers.discoverMovablePomodoroBulletTargets(content, 1, 0).error,
    /Pomodoro sub-bullet/,
  );
});

test("findPomodoroEntryContext resolves entry lines and rejects sub-bullet/heading/blank/outside-section lines", () => {
  const content = pomodoroFixtureLines().join("\n");
  const closed = helpers.findPomodoroEntryContext(content, 1);
  assert.equal(closed.entry.entryLine, 1);
  assert.equal(closed.entry.open, false);

  const named = helpers.findPomodoroEntryContext(content, 9);
  assert.equal(named.entry.entryLine, 9);
  assert.equal(named.entry.name, "BODY");
  assert.equal(named.entryLine, 9);

  // Sub-bullets, the heading itself, and any line outside the section
  // return null; the two Pomodoro contexts are disjoint.
  assert.equal(helpers.findPomodoroEntryContext(content, 2), null);
  assert.equal(helpers.findPomodoroEntryContext(content, 5), null);
  assert.equal(helpers.findPomodoroEntryContext(content, 0), null);
  assert.equal(helpers.findPomodoroEntryContext(content, 13), null);
  assert.equal(helpers.findPomodoroBulletContext(content, 9), null);

  const withBlankAndInvalid = [
    "## Pomodoros",
    "- [ ] () — A",
    "",
    "- [ ] not a valid entry",
    "- [ ] () — B",
  ].join("\n");
  assert.equal(helpers.findPomodoroEntryContext(withBlankAndInvalid, 2), null);
  assert.equal(helpers.findPomodoroEntryContext(withBlankAndInvalid, 3), null);
  assert.notEqual(helpers.findPomodoroEntryContext(withBlankAndInvalid, 1), null);
  assert.notEqual(helpers.findPomodoroEntryContext(withBlankAndInvalid, 4), null);
});

test("discoverPomodoroEntryMoveTargets collects top-level children, drops empty placeholders, and allows a childless entry", () => {
  const content = pomodoroFixtureLines().join("\n");

  // Closed entry with a struck link and a tomato-marked link: both are
  // top-level movable children; descendants are not listed separately.
  const closed = helpers.discoverPomodoroEntryMoveTargets(content, 1);
  assert.equal(closed.valid, true);
  assert.deepEqual(closed.targets.map((target) => target.line), [2, 3]);
  assert.equal(closed.droppedLines.length, 0);
  assert.equal(closed.bulletCount, 2);
  assert.equal(closed.rawEntryLine, "- [x] (**0855-0920** [t:: 25m])");

  // A nested grandchild travels with its top-level parent; it is never
  // listed as its own target.
  const nested = helpers.discoverPomodoroEntryMoveTargets(content, 6);
  assert.deepEqual(nested.targets.map((target) => target.line), [7]);
  assert.equal(nested.bulletCount, 1);

  // A childless entry is valid with zero movable targets — the "delete this
  // empty Pomodoro" case.
  const childlessContent = [
    "## Pomodoros",
    "- [ ] () — EMPTY",
    "- [ ] () — OTHER",
  ].join("\n");
  const childless = helpers.discoverPomodoroEntryMoveTargets(
    childlessContent,
    1,
  );
  assert.equal(childless.valid, true);
  assert.deepEqual(childless.targets, []);
  assert.equal(childless.bulletCount, 0);

  // A lone empty placeholder bullet is droppable, not movable.
  const placeholderContent = [
    "## Pomodoros",
    "- [ ] () — EMPTY",
    "\t- ",
    "- [ ] () — OTHER",
  ].join("\n");
  const placeholder = helpers.discoverPomodoroEntryMoveTargets(
    placeholderContent,
    1,
  );
  assert.deepEqual(placeholder.targets, []);
  assert.deepEqual(
    placeholder.droppedLines.map((dropped) => dropped.line),
    [2],
  );
  assert.equal(placeholder.bulletCount, 0);

  // Rejects a non-entry line.
  assert.match(
    helpers.discoverPomodoroEntryMoveTargets(content, 5).error,
    /Place the cursor on a Pomodoro entry/,
  );
});

