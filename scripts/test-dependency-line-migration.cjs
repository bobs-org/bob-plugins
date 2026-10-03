// Tests for scripts/migrate-dependency-lines.mjs (bob-cli-3n.10).
// `docs/task-dependencies.md` §§2-4 in bob-cli are authoritative; nav's
// exported helpers own the grammar and writer form, and these vectors pin
// the migration's batch planner to the R1/R2/R8-R10 contract.
const assert = require("node:assert/strict");
const test = require("node:test");

let planMigration;
let parseArgs;

test.before(async () => {
  ({ planMigration, parseArgs } = await import(
    "./migrate-dependency-lines.mjs"
  ));
});

function plan(files, archiveFiles) {
  return planMigration(
    files.map((file) => ({ ...file })),
    (archiveFiles || []).map((file) => ({ ...file })),
  );
}

function changedContent(report, relativePath) {
  const file = report.files.find((candidate) => candidate.relativePath === relativePath);
  assert.ok(file, `planned file ${relativePath}`);
  return file.nextContent;
}

function unchangedPaths(report) {
  return report.files.filter((file) => !file.changed).map((file) => file.relativePath);
}

test("folds embed, struck, and plain legacy children into one canonical line", () => {
  const content = [
    "- [?] #task Dependent! [id:: note__dep] [dependsOn:: note__aaa, note__bbb, note__ccc] ^dep",
    "\t- ![[#^aaa]]",
    "\t- ~~[[#^bbb]]~~",
    "\t- [[#^ccc]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "- [ ] #task BBB! [id:: note__bbb] ^bbb",
    "- [ ] #task CCC! [id:: note__ccc] ^ccc",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  assert.equal(report.foldedChildren, 3);
  assert.equal(report.createdLines, 1);
  assert.equal(report.fieldUpdates, 0);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("\t- ⛓️ **DEPENDS ON:** [[#^aaa]] • [[#^bbb]] • [[#^ccc]]"));
  assert.ok(!next.includes("![[#^aaa]]"));
  assert.ok(!next.includes("~~[[#^bbb]]~~"));
});

test("legacy-label row links come first, then legacy children in order", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__aaa, note__bbb] ^dep",
    "\t- 🔗 **DEPENDENCIES:** [[#^bbb]]",
    "\t- ![[#^aaa]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "- [ ] #task BBB! [id:: note__bbb] ^bbb",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("\t- ⛓️ **DEPENDS ON:** [[#^bbb]] • [[#^aaa]]"));
});

test("R2 adopts field-only open dependents; unadoptable ids stay warned", () => {
  const content = [
    "- [?] #task Needs things! [dependsOn:: note__aaa, note__ghost] ^dep",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  assert.equal(report.adoptedLines, 1);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("\t- ⛓️ **DEPENDS ON:** [[#^aaa]]"));
  assert.ok(next.includes("[dependsOn:: note__aaa, note__ghost]"));
  assert.equal(report.unadoptable.length, 1);
  assert.equal(report.unadoptable[0].id, "note__ghost");
});

test("closed dependents gain the line but keep the field untouched", () => {
  // The covered case folds the child into a line without touching the field.
  const covered = [
    "- [x] #task Done dependent! [dependsOn:: note__aaa] ^dep",
    "\t- ![[#^aaa]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content: covered }]);
  assert.equal(report.createdLines, 1);
  assert.equal(report.fieldUpdates, 0);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("\t- ⛓️ **DEPENDS ON:** [[#^aaa]]"));
  assert.ok(next.includes("[dependsOn:: note__aaa]"));
  assert.deepEqual(report.droppedFieldIds, []);
});

test("open dependents drop stale field ids and stamp targets missing [id::]", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__stale, note__aaa] ^dep",
    "\t- ![[#^aaa]]",
    "- [ ] #task AAA! ^aaa",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  // The stale id is dropped (no unresolved links remain) and the target is
  // stamped with its canonical id, which the field then carries.
  assert.equal(report.fieldUpdates, 1);
  assert.equal(report.targetIdUpdates, 1);
  assert.equal(report.droppedFieldIds.length, 1);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("[dependsOn:: note__aaa]"));
  assert.ok(next.includes("- [ ] #task AAA! [id:: note__aaa] ^aaa"));
});

test("unresolved links stay verbatim and keep field ids as breadcrumbs", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__gone, note__aaa] ^dep",
    "\t- ![[#^aaa]]",
    "\t- ![[#^gone]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("[[#^gone]]"));
  // R1 mirrors the line's order first, then the R4 breadcrumb — the same
  // reorder the hooks would project.
  assert.ok(next.includes("[dependsOn:: note__aaa, note__gone]"));
  assert.equal(report.fieldUpdates, 1);
  assert.equal(report.unresolved.length, 1);
});

test("leaves #^ref embeds, non-task parents, fences, and conflict children alone", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__aaa] ^dep",
    "\t- ![[#^aaa]]",
    "\t- ![[ref/chat/some-note#^ref]]",
    "- plain bullet with a sole link",
    "\t- ![[#^aaa]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "```",
    "- [?] #task Fenced! [dependsOn:: note__aaa]",
    "\t- ![[#^aaa]]",
    "```",
    "- [?] #task Conflict parent! [dependsOn:: note__aaa] ^con",
    "\t- ![[#^aaa]]",
    "\t\t- a sub-bullet",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  assert.equal(report.foldedChildren, 1);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].reason, "legacy_child_has_sub_bullets");
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("\t- ![[ref/chat/some-note#^ref]]"));
  assert.ok(next.includes("- [?] #task Conflict parent! [dependsOn:: note__aaa] ^con\n\t- ![[#^aaa]]"));
  assert.ok(next.includes("\t- ![[#^aaa]]\n```"));
  const leftTexts = report.leftAlone.map((entry) => entry.text).join("\n");
  assert.ok(leftTexts.includes("some-note"));
});

test("malformed rows leave the whole dependent alone", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__aaa] ^dep",
    "\t- ⛓️ **DEPENDS ON:** [[#^aaa]] plus trailing prose",
    "\t- ![[#^aaa]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  assert.ok(unchangedPaths(report).includes("note.md"));
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].reason, "malformed_dependency_line");
});

test("R9 deletes label-only rows and removes the open field", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__aaa] ^dep",
    "\t- ⛓️ **DEPENDS ON:**",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  assert.equal(report.removedRows, 1);
  const next = changedContent(report, "note.md");
  assert.ok(!next.includes("DEPENDS ON"));
  assert.ok(!next.includes("[dependsOn::"));
});

test("cross-note links use the shortest unambiguous form", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: other__aaa, sub__deep__bbb] ^dep",
    "\t- ![[other#^aaa]]",
    "\t- ![[sub/deep#^bbb]]",
    "",
  ].join("\n");
  const other = "- [ ] #task AAA! [id:: other__aaa] ^aaa\n";
  const deep = "- [ ] #task BBB! [id:: sub__deep__bbb] ^bbb\n";
  const report = plan([
    { relativePath: "note.md", content },
    { relativePath: "other.md", content: other },
    { relativePath: "sub/deep.md", content: deep },
  ]);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("- ⛓️ **DEPENDS ON:** [[other#^aaa]] • [[deep#^bbb]]"));
});

test("ambiguous basenames fall back to the full path", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: a__x, b__x] ^dep",
    "\t- ![[x#^x]]",
    "",
  ].join("\n");
  const report = plan([
    { relativePath: "note.md", content },
    { relativePath: "a/x.md", content: "- [ ] #task X! [id:: a__x] ^x\n" },
    { relativePath: "b/x.md", content: "- [ ] #task Y! [id:: b__x] ^x\n" },
  ]);
  // Bare `x` matches two notes, so the legacy child is uncovered and stays;
  // both field ids still adopt by exact id, with full-path link forms.
  assert.equal(report.adoptedLines, 1);
  assert.equal(report.leftAlone.length, 1);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("[[a/x#^x]] • [[b/x#^x]]"));
  assert.ok(next.includes("\t- ![[x#^x]]"));
});

test("duplicate ids are ambiguous and fatal for --write", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: same__aaa] ^dep",
    "",
  ].join("\n");
  const report = plan([
    { relativePath: "note.md", content },
    { relativePath: "same.md", content: "- [ ] #task AAA! [id:: same__aaa] ^aaa\n" },
    { relativePath: "other.md", content: "- [ ] #task AAA clone! [id:: same__aaa] ^aaa\n" },
  ]);
  assert.ok(report.unadoptable.length >= 1);
  assert.ok(report.ambiguous.length >= 1);
});

test("archive targets keep the done/ path and are never stamped", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: done_old__aaa] ^dep",
    "\t- ![[done/old#^aaa]]",
    "",
  ].join("\n");
  const archived = "- [x] #task AAA! [id:: done_old__aaa] ^aaa\n";
  const report = plan(
    [{ relativePath: "note.md", content }],
    [{ relativePath: "done/old.md", content: archived }],
  );
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("[[done/old#^aaa]]"));
  assert.equal(report.targetIdUpdates, 0);
});

test("self links stay on the line but are not projected", () => {
  const content = [
    "- [?] #task Dependent! [id:: note__dep] [dependsOn:: note__dep] ^dep",
    "\t- ![[#^dep]]",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("[[#^dep]]"));
  assert.ok(!next.includes("[dependsOn::"));
  assert.ok(report.warnings.some((warning) => warning.kind === "self_dependency"));
});

test("non-task targets stay on the line but are not projected", () => {
  const content = [
    "- [?] #task Dependent! [dependsOn:: note__blk] ^dep",
    "\t- ![[#^blk]]",
    "- plain carrier ^blk",
    "",
  ].join("\n");
  const report = plan([{ relativePath: "note.md", content }]);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("[[#^blk]]"));
  assert.ok(!next.includes("[dependsOn::"));
  assert.ok(report.warnings.some((warning) => warning.kind === "non_task_dependency"));
});

test("preserves CRLF, missing final newline, and cancel-log position", () => {
  const lines = [
    "- [?] #task Dependent! [dependsOn:: note__aaa] ^dep",
    "\t- ❌ **CANCEL LOG**",
    "\t- ![[#^aaa]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
  ];
  const content = lines.join("\r\n");
  const report = plan([{ relativePath: "note.md", content }]);
  const next = changedContent(report, "note.md");
  assert.ok(next.includes("\r\n"));
  assert.ok(!next.endsWith("\n"));
  const out = next.split("\r\n");
  assert.equal(out[1], "\t- ❌ **CANCEL LOG**");
  assert.ok(out[2].includes("⛓️ **DEPENDS ON:** [[#^aaa]]"));
});

test("migration is idempotent", () => {
  const content = [
    "- [?] #task Dependent! [id:: note__dep] [dependsOn:: note__aaa] ^dep",
    "\t- ![[#^aaa]]",
    "\t- ![[ref/chat/reading#^ref]]",
    "- [ ] #task AAA! [id:: note__aaa] ^aaa",
    "",
  ].join("\n");
  const first = plan([{ relativePath: "note.md", content }]);
  const once = changedContent(first, "note.md");
  const second = plan([{ relativePath: "note.md", content: once }]);
  assert.deepEqual(unchangedPaths(second), ["note.md"]);
  assert.equal(second.createdLines, 0);
  assert.equal(second.foldedChildren, 0);
});

test("parseArgs handles --vault, --write, --help, and rejects unknowns", () => {
  const path = require("node:path");
  assert.equal(parseArgs([]).write, false);
  assert.equal(parseArgs(["--write"]).write, true);
  assert.equal(parseArgs(["--vault", "some/dir"]).vault, path.resolve("some/dir"));
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});
