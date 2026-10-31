// View tests for the Task Wikilink Picker card (phase picker of
// plan 202610/obsidian_task_wikilinks.md). Covers render plans: groups, the
// Hidden run, sticky headers, row anatomy, locators, action lines, counts,
// empty and indexing states, windowing, and narrow layout.

const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

function row(overrides) {
  const notePath = overrides.notePath || "Tasks.md";
  const line = overrides.line ?? 0;
  const status = overrides.status ?? " ";
  const open = overrides.open ?? !["x", "X", "-"].includes(status);
  const displayText = overrides.displayText || "Do the thing";
  const blockId = Object.prototype.hasOwnProperty.call(overrides, "blockId")
    ? overrides.blockId
    : "do-the-thing";
  return {
    notePath,
    line,
    rawLine: `- [${status}] #task ${displayText}${blockId ? ` ^${blockId}` : ""}`,
    status,
    blockId,
    hidden: false,
    prjBlocked: false,
    section: "Inbox",
    depth: 0,
    searchText: displayText,
    displayText,
    duplicateId: false,
    open,
    locator: notePath.replace(/\.md$/i, "").split("/").pop(),
    linkTarget: notePath.replace(/\.md$/i, "").split("/").pop(),
    ...overrides,
  };
}

function plan(rows, options = {}) {
  return helpers.buildTaskWikilinkPickerPlan({
    rows,
    query: options.query || "",
    ownerPath: options.ownerPath || "sase_cleanup.md",
    source: options.source || {
      sourcePath: options.ownerPath || "sase_cleanup.md",
      line: 99,
    },
    selectedKey: options.selectedKey || null,
    rowLimit: options.rowLimit,
    renderAll: options.renderAll,
    narrow: Boolean(options.narrow),
    progress: options.progress || { ready: true, scanned: 0, total: 0 },
    warningNote: options.warningNote || null,
    blockIdsByPath: options.blockIdsByPath || new Map(),
    inboxPaths: options.inboxPaths || new Set(["mac_inbox.md"]),
    now: options.now || new Date(2026, 9, 30),
  });
}

test("empty filter groups This note, In progress, Next, Other open, Hidden, Completed", () => {
  const rows = [
    row({ notePath: "sase_cleanup.md", line: 1, displayText: "Here", blockId: "here", status: " " }),
    row({ notePath: "sase_cleanup.md", line: 2, displayText: "Hidden here", blockId: "hh", hidden: true }),
    row({ notePath: "Work.md", line: 0, displayText: "Active", blockId: "active", status: "/" }),
    row({ notePath: "Work.md", line: 1, displayText: "Queued", blockId: "queued", status: "*" }),
    row({ notePath: "alpha.md", line: 0, displayText: "Alpha", blockId: "alpha" }),
    row({ notePath: "beta.md", line: 0, displayText: "Beta", blockId: "beta" }),
    row({ notePath: "beta.md", line: 1, displayText: "Hidden beta", blockId: "hb", hidden: true }),
    row({ notePath: "done/2026/old.md", line: 0, displayText: "Old", blockId: "old", status: "x", open: false, locator: "done/2026/old", linkTarget: "done/2026/old" }),
  ];
  const built = plan(rows, { renderAll: true });
  const sections = built.items.filter((item) => item.kind === "section").map((item) => item.id);
  assert.deepEqual(sections, [
    "in_this_note",
    "in_progress",
    "next",
    "open",
    "hidden",
    "completed",
  ]);
  const noteHeaders = built.items.filter((item) => item.kind === "note");
  assert.ok(noteHeaders.every((item) => item.sticky === true));
  assert.ok(noteHeaders.some((item) => item.path === "alpha.md"));
  assert.ok(noteHeaders.some((item) => item.path === "beta.md"));
  assert.equal(
    noteHeaders.some((item) => item.path === "beta.md" && item.locator.includes("Hidden")),
    false,
  );
  const hiddenSection = built.items.find((item) => item.kind === "section" && item.id === "hidden");
  assert.equal(hiddenSection.label, "Hidden");
  const keys = built.selectableKeys;
  assert.ok(keys[0].endsWith("|1"));
});

test("per-note headers expose sticky data, kind icons, and count pills", () => {
  const rows = [
    row({ notePath: "ref/paper.md", line: 0, displayText: "Read", blockId: "read" }),
    row({ notePath: "ref/paper.md", line: 1, displayText: "Cite", blockId: "cite" }),
    row({ notePath: "mac_inbox.md", line: 0, displayText: "Inbox", blockId: "inb" }),
    row({ notePath: "projects/foo.md", line: 0, displayText: "Project", blockId: "prj" }),
    row({ notePath: "2026/20261030.md", line: 0, displayText: "Daily", blockId: "day" }),
  ];
  const built = plan(rows, { ownerPath: "other.md", source: { sourcePath: "other.md", line: 9 }, renderAll: true });
  const notes = Object.fromEntries(
    built.items.filter((item) => item.kind === "note").map((item) => [item.path, item]),
  );
  assert.equal(notes["ref/paper.md"].noteKind, "ref");
  assert.equal(notes["ref/paper.md"].icon, "book-open");
  assert.equal(notes["ref/paper.md"].count, 2);
  assert.equal(notes["mac_inbox.md"].noteKind, "inbox");
  assert.equal(notes["mac_inbox.md"].icon, "inbox");
  assert.equal(notes["projects/foo.md"].noteKind, "project");
  assert.equal(notes["projects/foo.md"].icon, "folder-kanban");
  assert.equal(notes["2026/20261030.md"].noteKind, "daily");
  assert.equal(notes["2026/20261030.md"].icon, "calendar-days");
  assert.equal(helpers.taskWikilinkNoteKind("done/2026/x.md"), "done");
  assert.equal(helpers.taskWikilinkNoteKindIcon("done"), "archive");
});

test("row anatomy, locator parts, and action lines cover identified, id-less, and guarded", () => {
  const identified = row({
    notePath: "sase_cleanup.md",
    line: 3,
    displayText: "Stop idling when no agents run",
    blockId: "no-idle",
    locator: "sase_cleanup",
    linkTarget: "sase_cleanup",
  });
  const idless = row({
    notePath: "mac_inbox.md",
    line: 12,
    displayText: "Try Opus with Blender. 💡",
    blockId: null,
    locator: "mac_inbox",
    linkTarget: "mac_inbox",
  });
  const archived = row({
    notePath: "done/2026/blender.md",
    line: 0,
    displayText: "Install Blender",
    blockId: null,
    locator: "done/2026/blender",
    linkTarget: "done/2026/blender",
  });
  const built = plan([identified, idless, archived], { renderAll: true });
  const byKey = Object.fromEntries(built.items.filter((i) => i.kind === "row").map((i) => [i.key, i]));
  const idRow = byKey["sase_cleanup.md|3"];
  assert.equal(idRow.status.glyph, "[ ]");
  assert.equal(idRow.locator.filename, "sase_cleanup");
  assert.equal(idRow.locator.hash, "#^");
  assert.equal(idRow.locator.id, "no-idle");
  assert.equal(idRow.action.kind, "identified");
  assert.equal(idRow.action.text, "↵ inserts [[sase_cleanup#^no-idle]]");
  assert.equal(idRow.replacement, "[[sase_cleanup#^no-idle]]");

  const addRow = byKey["mac_inbox.md|12"];
  assert.equal(addRow.locator.addId, true);
  assert.equal(addRow.action.kind, "idless");
  assert.match(addRow.action.text, /↵ names it \^[a-z0-9-]+ in mac_inbox\.md, then links it/);

  const archivedRow = byKey["done/2026/blender.md|0"];
  assert.equal(archivedRow.disabled, true);
  assert.equal(archivedRow.guard.badge, "archived");
  assert.match(archivedRow.action.text, /Archived tasks can't get an ID/);
  assert.equal(archivedRow.locator.addId, false);
});

test("title parts render code, wikilinks, markdown labels, and URL hosts", () => {
  const parts = helpers.parseTaskWikilinkTitleParts(
    "See `code`, [[Note|Alias]], [[other#^x]], [Try Opus](https://example.com/path), and https://obsidian.md/foo",
  );
  const types = parts.map((part) => part.type);
  assert.ok(types.includes("code"));
  assert.ok(types.includes("link"));
  assert.ok(types.includes("url"));
  const texts = parts.map((part) => part.text);
  assert.ok(texts.includes("code"));
  assert.ok(texts.includes("Alias"));
  assert.ok(texts.includes("other#^x"));
  assert.ok(texts.includes("Try Opus"));
  assert.ok(texts.includes("obsidian.md"));
});

test("counts, empty states, indexing, and footer hints", () => {
  const rows = [
    row({ notePath: "a.md", line: 0, displayText: "Alpha opus", blockId: "a" }),
    row({ notePath: "b.md", line: 0, displayText: "Beta", blockId: "b" }),
  ];
  const emptyQuery = plan(rows, { ownerPath: "z.md" });
  assert.match(emptyQuery.search.countText, /2 tasks/);
  assert.equal(emptyQuery.empty, null);
  assert.ok(emptyQuery.footer.hints.some((hint) => hint.label.includes("back to")));

  const filtered = plan(rows, { ownerPath: "z.md", query: "opus" });
  assert.equal(filtered.search.countText, "1 of 2");
  assert.equal(
    filtered.footer.hints.some((hint) => hint.label.includes("back to")),
    false,
  );

  const none = plan(rows, { ownerPath: "z.md", query: "zzzz" });
  assert.equal(none.search.countText, "No matches");
  assert.equal(none.empty.message, 'No tasks match "zzzz" · try fewer words');

  const vacant = plan([], { ownerPath: "z.md" });
  assert.equal(vacant.empty.message, "No tasks in this vault yet");

  const indexing = plan(rows, {
    ownerPath: "z.md",
    progress: { ready: false, scanned: 812, total: 1104 },
  });
  assert.equal(indexing.search.indexing.text, "Indexing · 812 of 1,104 notes");
  assert.equal(indexing.search.countText, "Indexing · 812 of 1,104 notes");
});

test("windowing emits 100-row windows and renderAll exhausts", () => {
  const rows = [];
  for (let index = 0; index < 250; index += 1) {
    rows.push(
      row({
        notePath: "pool.md",
        line: index,
        displayText: `Task ${index}`,
        blockId: `t${index}`,
      }),
    );
  }
  const first = plan(rows, { ownerPath: "other.md" });
  assert.equal(first.window.renderedRows, 100);
  assert.equal(first.window.canExtend, true);
  assert.equal(first.window.windowSize, 100);
  const jumped = plan(rows, {
    ownerPath: "other.md",
    selectedKey: "pool.md|240",
  });
  assert.ok(jumped.window.renderedRows >= 241);
  const all = plan(rows, { ownerPath: "other.md", renderAll: true });
  assert.equal(all.window.renderedRows, 250);
  assert.equal(all.window.exhausted, true);
});

test("narrow layout keeps basename plus id and drops the backspace hint", () => {
  const rows = [
    row({
      notePath: "projects/deep/nested/note.md",
      line: 0,
      displayText: "Deep",
      blockId: "deep",
      locator: "projects/deep/nested/note",
      linkTarget: "projects/deep/nested/note",
    }),
  ];
  const wide = plan(rows, { ownerPath: "x.md", renderAll: true, query: "" });
  const narrow = plan(rows, { ownerPath: "x.md", renderAll: true, narrow: true });
  const wideRow = wide.items.find((item) => item.kind === "row");
  const narrowRow = narrow.items.find((item) => item.kind === "row");
  assert.ok(wideRow.locator.folder);
  assert.equal(narrowRow.locator.folder, "");
  assert.equal(narrowRow.locator.filename, "note");
  assert.equal(narrowRow.locator.id, "deep");
  assert.equal(
    narrow.footer.hints.some((hint) => hint.label.includes("back to")),
    false,
  );
});

test("filtered list is flat with a Completed history divider", () => {
  const rows = [
    row({ notePath: "a.md", line: 0, displayText: "Open opus", blockId: "o" }),
    row({
      notePath: "b.md",
      line: 0,
      displayText: "Done opus",
      blockId: "d",
      status: "x",
      open: false,
    }),
  ];
  const built = plan(rows, { ownerPath: "z.md", query: "opus", renderAll: true });
  const kinds = built.items.map((item) => item.kind);
  assert.equal(kinds[0], "row");
  assert.ok(kinds.includes("section"));
  const divider = built.items.find((item) => item.kind === "section");
  assert.equal(divider.id, "completed");
  assert.equal(built.items[built.items.length - 1].group, "completed");
});

test("caret-task and unlinkable-path guards disable the row", () => {
  const caret = row({ notePath: "sase_cleanup.md", line: 4, displayText: "Self", blockId: "self" });
  const bad = row({
    notePath: "weird|#name.md",
    line: 0,
    displayText: "Bad",
    blockId: "bad",
    locator: "weird|#name",
    linkTarget: "weird|#name",
  });
  const built = plan([caret, bad], {
    ownerPath: "sase_cleanup.md",
    source: { sourcePath: "sase_cleanup.md", line: 4 },
    renderAll: true,
  });
  const self = built.items.find((item) => item.key === "sase_cleanup.md|4");
  assert.equal(self.disabled, true);
  assert.equal(self.guard.badge, "the task you're in");
  const unlinkable = built.items.find((item) => item.key === "weird|#name.md|0");
  assert.equal(unlinkable.disabled, true);
  assert.equal(unlinkable.action.text, "This note's name can't be linked");
});

test("card DOM helpers are exported for Chromium previews", () => {
  assert.equal(typeof helpers.renderTaskWikilinkResults, "function");
  assert.equal(typeof helpers.renderTaskWikilinkDetail, "function");
  assert.equal(typeof helpers.renderTaskWikilinkFooter, "function");
});
