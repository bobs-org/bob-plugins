// Identity and line-map forwarding after settle regrouping.
const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const BEFORE = [
  "## Tasks",
  "",
  "- [ ] #task An idea to pick up later ^idea",
  "- [/] #task Finish the design ^design",
  "  - Keep the keyboard interaction simple.",
  "- [*] #task Review the implementation ^review",
].join("\n");

const AFTER = [
  "## Tasks",
  "",
  "### Next & In Progress",
  "",
  "- [/] #task Finish the design ^design",
  "  - Keep the keyboard interaction simple.",
  "- [*] #task Review the implementation ^review",
  "",
  "### Ready",
  "",
  "- [ ] #task An idea to pick up later ^idea",
].join("\n");

test("supplied block ID is authoritative and never falls back to a stale line", () => {
  const lines = AFTER.split("\n");
  assert.deepEqual(
    helpers.resolveNavTaskIdentity(lines, { blockId: "design", line: 3, text: "- [ ] #task Replacement" }),
    { line: 4, reason: null, source: "blockId" },
  );
  assert.deepEqual(
    helpers.resolveNavTaskIdentity(lines, {
      blockId: "missing",
      line: 4,
      text: "- [/] #task Finish the design ^design",
    }),
    { line: null, reason: "missing", source: "blockId" },
  );
  const duplicates = [
    "- [ ] #task First ^dup",
    "- [ ] #task Second ^dup",
  ];
  assert.deepEqual(
    helpers.resolveNavTaskIdentity(duplicates, { blockId: "dup", line: 0 }),
    { line: null, reason: "ambiguous", source: "blockId" },
  );
  assert.equal(
    helpers.resolveNavTaskIdentity(lines, { line: 4 }).line,
    null,
    "a line number alone is never identity",
  );
});

test("resolveReviewQueueLine prefers unique blockId and goes stale when it disappears", () => {
  const hit = helpers.resolveReviewQueueLine(AFTER, {
    path: "Areas/home.md",
    line: 4,
    originalMarkdown: "- [/] #task Finish the design ^design",
    blockId: "design",
  });
  assert.deepEqual(hit, { ok: true, line: 4, source: "blockId" });

  const missing = helpers.resolveReviewQueueLine(AFTER, {
    path: "Areas/home.md",
    line: 4,
    originalMarkdown: "- [/] #task Finish the design ^design",
    blockId: "gone",
  });
  assert.deepEqual(missing, { ok: false, reason: "stale" });

  const unchanged = helpers.resolveReviewQueueLine(BEFORE, {
    path: "Areas/home.md",
    line: 4,
    originalMarkdown: "- [/] #task Finish the design ^design",
  });
  assert.deepEqual(unchanged, { ok: true, line: 3, source: "line" });
});

test("queue entries and resume anchors follow identity after regrouping", () => {
  const lineMap = { 2: 10, 3: 4, 4: 5, 5: 6 };
  const mapped = helpers.mapReviewQueueEntryThroughSettle(
    {
      path: "Areas/home.md",
      line: 4,
      originalMarkdown: "- [/] #task Finish the design ^design",
      blockId: "design",
      rank: 1,
    },
    AFTER,
    lineMap,
  );
  assert.equal(mapped.line, 5);
  assert.match(mapped.originalMarkdown, /Finish the design/);
  assert.equal(mapped.blockId, "design");

  const staleId = helpers.mapReviewQueueEntryThroughSettle(
    {
      path: "Areas/home.md",
      line: 4,
      originalMarkdown: "- [/] #task Finish the design ^design",
      blockId: "gone",
    },
    AFTER,
    lineMap,
  );
  assert.equal(staleId, null);

  const resume = helpers.mapReviewResumeRefThroughSettle(
    {
      path: "Areas/home.md",
      line: 4,
      text: "- [/] #task Finish the design ^design",
      blockId: "design",
      key: "Areas/home.md:4",
    },
    AFTER,
    lineMap,
  );
  assert.equal(resume.line, 5);
  assert.equal(resume.blockId, "design");
});

test("resume lookup with a disappeared block ID does not use the old line number", () => {
  const queue = [
    {
      path: "Areas/home.md",
      line: 4,
      originalMarkdown: "- [ ] #task Replacement at old line",
      blockId: "other",
    },
    {
      path: "Areas/home.md",
      line: 5,
      originalMarkdown: "- [/] #task Finish the design ^design",
      blockId: "design",
    },
  ];
  const found = helpers.findReviewResumeIndex(queue, {
    path: "Areas/home.md",
    line: 4,
    text: "- [ ] #task Replacement at old line",
    blockId: "design",
  });
  assert.equal(found, 1);
  const missing = helpers.findReviewResumeIndex(queue, {
    path: "Areas/home.md",
    line: 4,
    text: "- [ ] #task Replacement at old line",
    blockId: "gone",
  });
  assert.equal(missing, -1);
});

test("recorded jumps map through the settle lineMap", () => {
  const lineMap = { 3: 4, 7: 10 };
  const jump = helpers.mapNavJumpLocationThroughSettle(
    { path: "Areas/home.md", line: 3, ch: 2, blockId: "design" },
    lineMap,
    AFTER,
  );
  assert.equal(jump.line, 4);
  assert.equal(jump.blockId, "design");
  assert.match(jump.text, /Finish the design/);
});

test("composeNavLineMaps drops missing mappings", () => {
  const composed = helpers.composeNavLineMaps({ 0: 2, 1: 3, 2: 9 }, { 2: 4, 3: 5 });
  assert.deepEqual(composed, { 0: 4, 1: 5 });
});

test("closed identities in a lagging review queue are refused", () => {
  for (const status of ["x", "-"]) {
    const content = AFTER.replace("- [/] #task Finish the design", `- [${status}] #task Finish the design`);
    assert.deepEqual(helpers.resolveReviewQueueLine(content, {
      path: "Areas/home.md", blockId: "design", line: 4,
      originalMarkdown: "- [/] #task Finish the design ^design",
    }), { ok: false, reason: "stale" });
  }
});
