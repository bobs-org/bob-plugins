const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");
const { click } = require("./modal-harness.cjs");

const {
  planDeleteCurrentFile,
  classifyDeleteConfirmKey,
  DeleteFileConfirmModal,
} = helpers;

const NOW = new Date(2026, 10, 10, 12, 0, 0);
const FRESH_CREATED = new Date(NOW.getTime() - 18 * 1000);
const OLD_CREATED = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
const FRESH_ISO = FRESH_CREATED.toISOString();
const OLD_ISO = OLD_CREATED.toISOString();

function keyEvent(key, extras = {}) {
  return {
    key,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    defaultPrevented: false,
    propagationStopped: false,
    ...extras,
  };
}

function collectText(node) {
  if (!node) {
    return "";
  }
  const own = node.textContent || "";
  const kids = Array.isArray(node.children)
    ? node.children.map(collectText).join("")
    : "";
  return `${own}${kids}`;
}

function basePlan(overrides = {}) {
  return planDeleteCurrentFile({
    path: "scratch.md",
    isMarkdown: true,
    frontmatter: { created: FRESH_ISO },
    now: NOW,
    lastDelete: null,
    childNoteCount: 0,
    backlinkCount: 0,
    openTaskCount: 0,
    lineCount: 6,
    body: `---\ncreated: ${FRESH_ISO}\n---\nhello\n`,
    ...overrides,
  });
}

function reasonsOf(overrides) {
  return basePlan(overrides).reasons;
}

function makeFile(path, extras = {}) {
  const leaf = String(path).split("/").pop() || path;
  const extension = leaf.includes(".") ? leaf.split(".").pop() : "";
  return {
    path,
    extension,
    basename: leaf.replace(/\.[^.]+$/, ""),
    ...extras,
  };
}

function liveCreatedIso(offsetMs = 1000) {
  return new Date(Date.now() - offsetMs).toISOString();
}

function makeDeletePlugin(options = {}) {
  const file = options.file || makeFile(options.path || "scratch.md");
  const trashCalls = [];
  const filesByPath = new Map([[file.path, file]]);
  for (const extra of options.extraFiles || []) {
    filesByPath.set(extra.path, extra);
  }
  const created = options.createdIso || liveCreatedIso();
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    workspace: {
      getActiveFile: () =>
        options.activeFile === undefined ? file : options.activeFile,
    },
    metadataCache: {
      getFileCache: (candidate) => {
        if (options.cacheFor && candidate && options.cacheFor[candidate.path]) {
          return options.cacheFor[candidate.path];
        }
        return {
          frontmatter: options.frontmatter || { created },
          listItems: options.listItems || [],
        };
      },
      resolvedLinks: options.resolvedLinks || {},
    },
    vault: {
      getAbstractFileByPath: (path) => filesByPath.get(path) || null,
      cachedRead: async () =>
        options.body ||
        `---\ncreated: ${created}\n---\nhello\n`,
      getMarkdownFiles: () => options.markdownFiles || [file],
    },
    fileManager: {
      trashFile: async (trashed) => {
        trashCalls.push(trashed);
        if (options.removeOnTrash) {
          filesByPath.delete(trashed.path);
        }
      },
    },
  };
  plugin.collectChildNotes = () => options.children || [];
  plugin.lastDeleteCurrentFile = options.lastDelete || null;
  plugin.deleteCurrentFileModal = options.openModal || null;
  return { plugin, file, trashCalls, filesByPath };
}

// --- Expected outcomes ---------------------------------------------------

test("dev.md (area, no created, children, backlinks) asks", () => {
  const plan = basePlan({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    childNoteCount: 12,
    backlinkCount: 41,
    body: "---\ntype: \"[[area]]\"\n---\n# Dev\n",
  });
  assert.equal(plan.confirm, true);
  assert.ok(plan.reasons.includes("No created: date — treated as an established note"));
  assert.ok(plan.reasons.includes("12 notes name it as their parent"));
  assert.match(plan.facts.text, /Area note/);
  assert.match(plan.facts.text, /41 notes link here/);
});

test("tomorrow's daily created 18s ago does not ask", () => {
  const plan = basePlan({
    path: "2026/20261111.md",
    frontmatter: {
      type: "[[day]]",
      date: "2026-11-11",
      created: FRESH_ISO,
    },
    backlinkCount: 1,
    openTaskCount: 2,
    body: `---\ntype: "[[day]]"\ndate: 2026-11-11\ncreated: ${FRESH_ISO}\n---\n- [ ] PLAN\n`,
  });
  assert.equal(plan.confirm, false);
  assert.deepEqual(plan.reasons, []);
});

test("tomorrow's daily created 3 days ago asks as established", () => {
  const plan = basePlan({
    path: "2026/20261111.md",
    frontmatter: {
      type: "[[day]]",
      date: "2026-11-11",
      created: OLD_ISO,
    },
    body: `---\ntype: "[[day]]"\ncreated: ${OLD_ISO}\n---\n- [ ] PLAN\n`,
  });
  assert.equal(plan.confirm, true);
  assert.equal(plan.reasons.length, 1);
  assert.match(plan.reasons[0], /^Created /);
});

test("today's daily note asks even when fresh", () => {
  const plan = basePlan({
    path: "2026/20261110.md",
    frontmatter: {
      type: "[[day]]",
      date: "2026-11-10",
      created: FRESH_ISO,
    },
  });
  assert.equal(plan.confirm, true);
  assert.ok(plan.reasons.includes("Daily note for 2026-11-10 (today)"));
});

test("current week and all_time journal notes ask", () => {
  const week = basePlan({
    path: "2026/2026-W46.md",
    frontmatter: { type: "[[day]]", date: "2026-11-09", created: FRESH_ISO },
  });
  assert.equal(week.confirm, true);
  assert.ok(week.reasons.includes("Journal note dated 2026-11-09"));

  const allTime = basePlan({
    path: "all_time.md",
    frontmatter: { type: "[[day]]", created: FRESH_ISO },
  });
  assert.equal(allTime.confirm, true);
  assert.ok(allTime.reasons.includes("Journal note"));
});

test("next week's note, freshly created, does not ask", () => {
  const plan = basePlan({
    path: "2026/2026-W47.md",
    frontmatter: { type: "[[day]]", date: "2026-11-16", created: FRESH_ISO },
  });
  assert.equal(plan.confirm, false);
});

test("fresh new_project note with open tasks and a backlink does not ask", () => {
  const plan = basePlan({
    path: "sase_foo.md",
    frontmatter: { type: "[[project]]", created: FRESH_ISO },
    backlinkCount: 1,
    openTaskCount: 3,
  });
  assert.equal(plan.confirm, false);
});

test("fresh project note that already has a child asks", () => {
  const plan = basePlan({
    path: "sase_foo.md",
    frontmatter: { type: "[[project]]", created: FRESH_ISO },
    childNoteCount: 1,
  });
  assert.equal(plan.confirm, true);
  assert.deepEqual(plan.reasons, ["1 note names it as its parent"]);
});

test("managed ref, done archive, and template always ask", () => {
  const ref = basePlan({
    path: "ref/blogs/article.md",
    frontmatter: { source_pdf: "lib/blogs/article.pdf", created: FRESH_ISO },
  });
  assert.equal(ref.confirm, true);
  assert.ok(
    ref.reasons.includes(
      "Managed reference note — bob ref owns its PDF and reading task",
    ),
  );

  const done = basePlan({
    path: "done/dev_done.md",
    frontmatter: { created: FRESH_ISO },
  });
  assert.equal(done.confirm, true);
  assert.ok(done.reasons.includes("Done archive"));

  const template = basePlan({
    path: "_templates/daily.md",
    frontmatter: { created: FRESH_ISO },
  });
  assert.equal(template.confirm, true);
  assert.ok(template.reasons.includes("Template"));
});

test("non-Markdown files always ask", () => {
  for (const path of ["img/x.png", "lib/blogs/x.pdf"]) {
    const plan = basePlan({
      path,
      isMarkdown: false,
      frontmatter: null,
      body: "",
      lineCount: 0,
    });
    assert.equal(plan.confirm, true, path);
    assert.ok(plan.reasons.includes("Not a Markdown note"), path);
  }
});

test("old blank note with no links does not ask (age exemption)", () => {
  const plan = basePlan({
    path: "old_blank.md",
    frontmatter: { created: "2025-06-02" },
    body: "---\ncreated: 2025-06-02\n---\n\n",
    backlinkCount: 0,
    childNoteCount: 0,
  });
  assert.equal(plan.confirm, false);
});

test("old blank note with a backlink still asks", () => {
  const plan = basePlan({
    path: "old_blank.md",
    frontmatter: { created: "2025-06-02" },
    body: "---\ncreated: 2025-06-02\n---\n",
    backlinkCount: 1,
  });
  assert.equal(plan.confirm, true);
  assert.match(plan.reasons[0], /^Created 2025-06-02 /);
});

test("any fresh note deleted 2s after another asks", () => {
  const plan = basePlan({
    lastDelete: { path: "other.md", at: NOW.getTime() - 2000 },
  });
  assert.equal(plan.confirm, true);
  assert.ok(
    plan.reasons.includes(
      'You deleted "other.md" 2s ago — this is a different file',
    ),
  );
});

// --- created: / date: parsers -------------------------------------------

test("created: accepts -05:00, -0500, date-only, and Date", () => {
  const colon = basePlan({
    frontmatter: { created: "2020-01-15T08:30:00-05:00" },
    body: "---\ncreated: 2020-01-15T08:30:00-05:00\n---\nhello\n",
  });
  const bare = basePlan({
    frontmatter: { created: "2020-01-15T08:30:00-0500" },
    body: "---\ncreated: 2020-01-15T08:30:00-0500\n---\nhello\n",
  });
  assert.equal(colon.confirm, true);
  assert.deepEqual(colon, bare);

  const dateOnly = basePlan({
    frontmatter: { created: "2026-11-09" },
    body: "---\ncreated: 2026-11-09\n---\nhello\n",
  });
  assert.equal(dateOnly.confirm, true);
  assert.match(dateOnly.reasons[0], /^Created 2026-11-09 /);

  const asDate = basePlan({
    frontmatter: { created: new Date(NOW.getTime() - 1000) },
    body: "---\ncreated: x\n---\nhello\n",
  });
  assert.equal(asDate.confirm, false);
});

test("created: garbage and far-future stamps are established", () => {
  const garbage = basePlan({
    frontmatter: { created: "not-a-date" },
    body: "---\ncreated: not-a-date\n---\nhello\n",
  });
  assert.equal(garbage.confirm, true);
  assert.ok(
    garbage.reasons.includes("No created: date — treated as an established note"),
  );

  const future = basePlan({
    frontmatter: { created: new Date(NOW.getTime() + 10 * 60 * 1000) },
    body: "---\ncreated: future\n---\nhello\n",
  });
  assert.equal(future.confirm, true);
  assert.ok(
    future.reasons.includes("No created: date — treated as an established note"),
  );

  const skew = basePlan({
    frontmatter: { created: new Date(NOW.getTime() + 4 * 60 * 1000) },
    body: "---\ncreated: skew\n---\nhello\n",
  });
  assert.equal(skew.confirm, false);
});

test("date: accepts YYYY-MM-DD, YYYY-MM, and YYYY", () => {
  assert.ok(
    reasonsOf({
      path: "periods/month.md",
      frontmatter: { type: "[[day]]", date: "2026-11", created: FRESH_ISO },
    }).includes("Journal note dated 2026-11-01"),
  );
  assert.ok(
    reasonsOf({
      path: "periods/year.md",
      frontmatter: { type: "[[day]]", date: "2026", created: FRESH_ISO },
    }).includes("Journal note dated 2026-01-01"),
  );
  assert.ok(
    reasonsOf({
      path: "2026/20261109.md",
      frontmatter: { type: "[[day]]", date: "2026-11-09", created: FRESH_ISO },
    }).includes("Daily note for 2026-11-09"),
  );
});

test("daily path falls back to the filename date when date: is missing", () => {
  const plan = basePlan({
    path: "2026/20261110.md",
    frontmatter: { created: FRESH_ISO },
  });
  assert.ok(plan.reasons.includes("Daily note for 2026-11-10 (today)"));
});

test("fresh window is 24 hours", () => {
  const justInside = basePlan({
    frontmatter: { created: new Date(NOW.getTime() - 24 * 60 * 60 * 1000 + 1000) },
    body: "---\ncreated: x\n---\nhello\n",
  });
  assert.equal(justInside.confirm, false);

  const justOutside = basePlan({
    frontmatter: { created: new Date(NOW.getTime() - 24 * 60 * 60 * 1000 - 1000) },
    body: "---\ncreated: x\n---\nhello\n",
  });
  assert.equal(justOutside.confirm, true);
  assert.match(justOutside.reasons[0], /^Created /);
});

test("rapid repeat is inside 5s only", () => {
  const inside = basePlan({
    lastDelete: { path: "a.md", at: NOW.getTime() - 4999 },
  });
  assert.equal(inside.confirm, true);

  const outside = basePlan({
    lastDelete: { path: "a.md", at: NOW.getTime() - 5000 },
  });
  assert.equal(outside.confirm, false);
});

// --- key classifier ------------------------------------------------------

const KEY_CASES = [
  [{ key: "y" }, "confirm"],
  [{ key: "Y" }, "confirm"],
  [{ key: "y", shiftKey: true }, "confirm"],
  [{ key: "y", ctrlKey: true }, "cancel"],
  [{ key: "y", repeat: true }, "ignore"],
  [{ key: "Shift" }, "ignore"],
  [{ key: "Control" }, "ignore"],
  [{ key: "Alt" }, "ignore"],
  [{ key: "Meta" }, "ignore"],
  [{ key: "y", isComposing: true }, "ignore"],
  [{ key: "Enter" }, "cancel"],
  [{ key: " " }, "cancel"],
  [{ key: "Escape" }, "cancel"],
  [{ key: "n" }, "cancel"],
  [{ key: "d", ctrlKey: true, shiftKey: true }, "cancel"],
];

for (const [event, expected] of KEY_CASES) {
  const label = [
    event.ctrlKey ? "Ctrl+" : "",
    event.shiftKey ? "Shift+" : "",
    event.repeat ? "repeat " : "",
    event.isComposing ? "composing " : "",
    event.key,
  ].join("");
  test(`classifyDeleteConfirmKey ${label} → ${expected}`, () => {
    assert.equal(classifyDeleteConfirmKey(keyEvent(event.key, event)), expected);
  });
}

// --- modal ---------------------------------------------------------------

test("delete confirm modal lists reasons, facts, and focuses Keep", () => {
  notices.length = 0;
  const file = makeFile("dev.md");
  const plan = basePlan({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    childNoteCount: 12,
    backlinkCount: 41,
    body: "---\ntype: area\n---\n# Dev\n",
  });
  let confirmed = 0;
  let cancelled = 0;
  const modal = new DeleteFileConfirmModal(
    {},
    {
      file,
      path: "dev.md",
      plan,
      onConfirm: () => {
        confirmed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
    },
  );
  modal.open();
  const text = collectText(modal.contentEl);
  assert.match(text, /Delete dev\?/);
  assert.match(text, /dev\.md/);
  assert.match(text, /12 notes name it as their parent/);
  assert.match(text, /Area note/);
  assert.match(text, /Press y to move it to trash/);
  assert.equal(modal.keepButtonEl.focused, true);
  assert.equal(modal.trashButtonEl.focused, false);
  assert.ok(modal.trashButtonEl.classes.includes("mod-warning"));
  modal.handleDeleteConfirmKey(keyEvent("Escape"));
  assert.equal(cancelled, 1);
  assert.equal(confirmed, 0);
  assert.equal(modal.isOpen, false);
});

test("y confirms once; Enter and Space cancel without activating Move to trash", () => {
  const file = makeFile("dev.md");
  const plan = basePlan({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    body: "---\ntype: area\n---\n# Dev\n",
  });
  let confirmed = 0;
  let cancelled = 0;
  const modal = new DeleteFileConfirmModal(
    {},
    {
      file,
      path: "dev.md",
      plan,
      onConfirm: () => {
        confirmed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
    },
  );
  modal.open();
  const enter = keyEvent("Enter");
  modal.handleDeleteConfirmKey(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(cancelled, 1);
  assert.equal(confirmed, 0);

  const again = new DeleteFileConfirmModal(
    {},
    {
      file,
      path: "dev.md",
      plan,
      onConfirm: () => {
        confirmed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
    },
  );
  again.open();
  again.handleDeleteConfirmKey(keyEvent("y"));
  again.handleDeleteConfirmKey(keyEvent("y"));
  assert.equal(confirmed, 1);
});

test("Keep click cancels and Move to trash click confirms", () => {
  const file = makeFile("dev.md");
  const plan = basePlan({
    path: "dev.md",
    frontmatter: {},
    body: "---\n---\nhello\n",
  });
  let confirmed = 0;
  let cancelled = 0;
  const modal = new DeleteFileConfirmModal(
    {},
    {
      file,
      path: "dev.md",
      plan,
      onConfirm: () => {
        confirmed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
    },
  );
  modal.open();
  click(modal.keepButtonEl);
  assert.equal(cancelled, 1);
  assert.equal(confirmed, 0);

  const trash = new DeleteFileConfirmModal(
    {},
    {
      file,
      path: "dev.md",
      plan,
      onConfirm: () => {
        confirmed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
    },
  );
  trash.open();
  click(trash.trashButtonEl);
  assert.equal(confirmed, 1);
});

// --- command integration -------------------------------------------------

test("unprotected fresh note trashes at once with no modal", async () => {
  notices.length = 0;
  const { plugin, file, trashCalls } = makeDeletePlugin();
  await plugin.deleteCurrentFile();
  assert.equal(trashCalls.length, 1);
  assert.equal(trashCalls[0], file);
  assert.equal(plugin.deleteCurrentFileModal, null);
  assert.match(notices.at(-1), /Deleted "scratch\.md"/);
  assert.equal(plugin.lastDeleteCurrentFile.path, "scratch.md");
});

test("protected file opens the modal and trashes only after y, once", async () => {
  notices.length = 0;
  const { plugin, file, trashCalls } = makeDeletePlugin({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    body: "---\ntype: \"[[area]]\"\n---\n# Dev\n",
    children: [{ path: "child.md" }],
  });
  await plugin.deleteCurrentFile();
  assert.equal(trashCalls.length, 0);
  const modal = plugin.deleteCurrentFileModal;
  assert.ok(modal instanceof DeleteFileConfirmModal);
  assert.equal(modal.file, file);
  modal.handleDeleteConfirmKey(keyEvent("y"));
  await Promise.resolve();
  assert.equal(trashCalls.length, 1);
  assert.equal(trashCalls[0], file);
  modal.handleDeleteConfirmKey(keyEvent("y"));
  await Promise.resolve();
  assert.equal(trashCalls.length, 1);
  assert.equal(plugin.deleteCurrentFileModal, null);
});

test("a file renamed or removed before y is not trashed", async () => {
  notices.length = 0;
  const { plugin, file, trashCalls, filesByPath } = makeDeletePlugin({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    body: "---\ntype: area\n---\n# Dev\n",
    children: [{ path: "child.md" }],
  });
  await plugin.deleteCurrentFile();
  const modal = plugin.deleteCurrentFileModal;
  filesByPath.delete(file.path);
  modal.handleDeleteConfirmKey(keyEvent("y"));
  await Promise.resolve();
  assert.equal(trashCalls.length, 0);
  assert.match(notices.at(-1), /"dev\.md" changed — nothing deleted/);
});

test("a replacement file at the same path is not trashed", async () => {
  notices.length = 0;
  const { plugin, file, trashCalls, filesByPath } = makeDeletePlugin({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    body: "---\ntype: area\n---\n# Dev\n",
    children: [{ path: "child.md" }],
  });
  await plugin.deleteCurrentFile();
  const replacement = makeFile("dev.md");
  filesByPath.set("dev.md", replacement);
  plugin.deleteCurrentFileModal.handleDeleteConfirmKey(keyEvent("y"));
  await Promise.resolve();
  assert.equal(trashCalls.length, 0);
  assert.notEqual(replacement, file);
  assert.match(notices.at(-1), /changed — nothing deleted/);
});

test("a second command call while the modal is open is a no-op", async () => {
  const { plugin, trashCalls } = makeDeletePlugin({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    body: "---\ntype: area\n---\n# Dev\n",
    children: [{ path: "child.md" }],
  });
  await plugin.deleteCurrentFile();
  const modal = plugin.deleteCurrentFileModal;
  await plugin.deleteCurrentFile();
  assert.equal(plugin.deleteCurrentFileModal, modal);
  assert.equal(trashCalls.length, 0);
});

test("cancel notice keeps the file", async () => {
  notices.length = 0;
  const { plugin, trashCalls } = makeDeletePlugin({
    path: "dev.md",
    frontmatter: { type: "[[area]]" },
    body: "---\ntype: area\n---\n# Dev\n",
    children: [{ path: "child.md" }],
  });
  await plugin.deleteCurrentFile();
  plugin.deleteCurrentFileModal.handleDeleteConfirmKey(keyEvent("n"));
  assert.equal(trashCalls.length, 0);
  assert.match(notices.at(-1), /Kept "dev\.md"/);
});

test("no active file shows the existing notice", async () => {
  notices.length = 0;
  const { plugin, trashCalls } = makeDeletePlugin({ activeFile: null });
  await plugin.deleteCurrentFile();
  assert.equal(trashCalls.length, 0);
  assert.equal(notices.at(-1), "No active file");
});

test("trash failure shows the existing error notice and does not stamp", async () => {
  notices.length = 0;
  const { plugin } = makeDeletePlugin();
  plugin.app.fileManager.trashFile = async () => {
    throw new Error("nope");
  };
  await plugin.deleteCurrentFile();
  assert.match(notices.at(-1), /Could not delete "scratch\.md"/);
  assert.equal(plugin.lastDeleteCurrentFile, null);
});

test("successful delete records rapid-repeat even without a prompt", async () => {
  const { plugin } = makeDeletePlugin();
  const before = Date.now();
  await plugin.deleteCurrentFile();
  assert.equal(plugin.lastDeleteCurrentFile.path, "scratch.md");
  assert.ok(plugin.lastDeleteCurrentFile.at >= before);
});
