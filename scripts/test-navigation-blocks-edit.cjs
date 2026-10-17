// Reverse Blocks writer (`docs/task-dependencies.md` §15.6 / §15.9).
// RBP vectors compare final vault bytes against applyDependencyEdit.
// RBW6 is the shared counted-path duplicate-preparation fix.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  TransactionEditor,
  compatibleTasksSettings,
  parseFrontmatterFromContent,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const TODAY = new Date(2026, 9, 17, 12);
const DATE_TEXT = "2026-10-17";
const {
  mergeTargetPreparations,
  planBlocksEdit,
  buildBlocksEditNotice,
  BulletPropertyPickerModal,
  validateBulletPropertyConfig,
} = helpers;

function dailyPath(date = TODAY) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${year}${month}${day}.md`;
}

function testStamper(line, dateText) {
  const date = dateText || DATE_TEXT;
  const next = String(line || "").replace(/\s*\[fresh:: [^\]]*\]/g, "");
  if (/\s+\^[A-Za-z0-9-]+\s*$/.test(next)) {
    return next.replace(/(\s+\^[A-Za-z0-9-]+)\s*$/, ` [fresh:: ${date}]$1`);
  }
  return `${next} [fresh:: ${date}]`;
}

function lineOf(content, blockId) {
  const lines = String(content || "").split(/\r?\n/);
  return lines.findIndex((line) =>
    new RegExp(`\\^${blockId}(?:\\s|$)`).test(line),
  );
}

function liveNotes(harness) {
  const out = {};
  for (const path of harness.contents.keys()) {
    if (!/\.md$/i.test(path)) {
      continue;
    }
    const editor = harness.openEditors.get(path);
    out[path] = editor ? editor.getValue() : harness.contents.get(path);
  }
  return out;
}

function cloneNotes(notes) {
  return Object.fromEntries(
    Object.entries(notes).map(([path, content]) => [path, String(content)]),
  );
}

function resetNotices() {
  notices.length = 0;
}

function createHarness(notes, options = {}) {
  const contents = new Map(Object.entries(notes));
  const files = [...contents.keys()]
    .filter((path) => /\.md$/i.test(path))
    .map((path) => ({ path, extension: "md" }));
  const openEditors = new Map(options.openEditors || []);
  const processWrites = [];
  const settingsPath = ".obsidian/plugins/obsidian-tasks-plugin/data.json";
  const getContent = (path) => {
    const editor = openEditors.get(path);
    return editor ? editor.getValue() : contents.get(path);
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getActiveFile: () => options.activeFile || null,
      getActiveViewOfType: () => null,
      getLeavesOfType: (type) =>
        type === "markdown"
          ? [...openEditors.entries()].map(([path, editor]) => ({
              view: { file: { path, extension: "md" }, editor },
            }))
          : [],
    },
    vault: {
      adapter: {
        read: async () => JSON.stringify(compatibleTasksSettings()),
      },
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path) =>
        contents.has(path) || path === settingsPath ? { path } : null,
      cachedRead: async (file) =>
        getContent(file.path) === undefined ? "" : String(getContent(file.path)),
      read: async (file) => {
        if (file.path === settingsPath) {
          return JSON.stringify(compatibleTasksSettings());
        }
        return getContent(file.path) === undefined
          ? ""
          : String(getContent(file.path));
      },
      process: async (file, transform) => {
        processWrites.push(file.path);
        if (typeof options.mutateBeforeProcess === "function") {
          options.mutateBeforeProcess(file, contents);
        }
        const current = getContent(file.path) || "";
        const after = transform(current);
        contents.set(file.path, after);
        const editor = openEditors.get(file.path);
        if (editor) {
          editor.content = after;
        }
        return after;
      },
    },
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: parseFrontmatterFromContent(getContent(file.path)),
      }),
      getFirstLinkpathDest: (linkpath) => {
        const wanted = String(linkpath || "")
          .split(/[|#]/, 1)[0]
          .replace(/\.md$/i, "");
        if (!wanted) {
          return null;
        }
        const direct = `${wanted}.md`;
        if (contents.has(direct)) {
          return { path: direct };
        }
        const lowered = wanted.toLowerCase();
        const matches = [...contents.keys()].filter(
          (path) =>
            /\.md$/i.test(path) &&
            path.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
              lowered,
        );
        return matches.length === 1 ? { path: matches[0] } : null;
      },
    },
  };
  plugin.getFreshnessStampLine = () => testStamper;
  plugin.getFreshnessDateText = () => DATE_TEXT;
  plugin.getFreshnessApi = () => ({
    stampLine: testStamper,
    markUnblockedLine(line) {
      return String(line);
    },
  });
  plugin.getActiveMarkdownView = () => null;
  return { plugin, contents, processWrites, openEditors, files };
}

function openNote(harness, path, cursorLine = 0) {
  const editor = new TransactionEditor(String(harness.contents.get(path) || ""), {
    line: cursorLine,
    ch: 0,
  });
  harness.openEditors.set(path, editor);
  return editor;
}

function writerArgs() {
  return {
    today: TODAY,
    stamper: testStamper,
    dateText: DATE_TEXT,
    blocksLinesEnabled: true,
  };
}

function refFor(harness, path, blockId) {
  const content = liveNotes(harness)[path];
  const line = lineOf(content, blockId);
  assert.notEqual(line, -1, `missing ^${blockId} in ${path}`);
  return { path, line, blockId };
}

async function applyForward(harness, tPath, tBlockId, add, remove = []) {
  const content = liveNotes(harness)[tPath];
  const parentLine = tBlockId
    ? lineOf(content, tBlockId)
    : 0;
  assert.notEqual(parentLine, -1, `forward parent missing in ${tPath}`);
  let editor = harness.openEditors.get(tPath);
  if (!editor) {
    editor = openNote(harness, tPath, parentLine);
  }
  return harness.plugin.applyDependencyEdit({
    editor,
    parentPath: tPath,
    parentLine,
    add,
    remove,
    ...writerArgs(),
  });
}

async function applyReverse(harness, sources, add, remove = []) {
  return harness.plugin.applyBlocksEdit({
    sources,
    add,
    remove,
    ...writerArgs(),
  });
}

function assertParity(forwardHarness, reverseHarness, label) {
  const forward = liveNotes(forwardHarness);
  const reverse = liveNotes(reverseHarness);
  const keys = new Set([...Object.keys(forward), ...Object.keys(reverse)]);
  for (const path of keys) {
    assert.equal(
      reverse[path],
      forward[path],
      `${label} ${path}\nforward:\n${forward[path]}\nreverse:\n${reverse[path]}`,
    );
  }
}

function stubCountedModal(plugin, editor, filePath, cursorLine) {
  const content = String(editor.getValue() || "");
  const lines = content.split(/\r?\n/);
  const cursor = { line: cursorLine, ch: 0 };
  const config = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: ["x"] }],
  });
  const modal = new BulletPropertyPickerModal(
    {},
    plugin,
    editor,
    cursor,
    String(lines[cursorLine] || ""),
    config,
    { filePath },
  );
  modal.filePath = filePath;
  return modal;
}

test("RBW6 mergeTargetPreparations keeps one write at the strongest lane", () => {
  const original = "- [ ] #task Prerequisite ^n";
  const merged = mergeTargetPreparations([
    {
      path: "N.md",
      line: 0,
      from: original,
      text: "- [*] #task Prerequisite ^n",
      kind: "target-identity",
    },
    {
      path: "N.md",
      line: 0,
      from: original,
      text: "- [/] #task Prerequisite ^n",
      kind: "target-identity",
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].from, original);
  assert.equal(merged[0].text, "- [/] #task Prerequisite ^n");
});

test("§15.7 notices use curly quotes and the Ready → Blocked copy", () => {
  const notice = buildBlocksEditNotice({
    added: [
      {
        description: "Do cleanup tasks",
        fromStatus: " ",
      },
    ],
    takesLane: "*",
  });
  assert.equal(
    notice,
    "🧱 Now blocks “Do cleanup tasks” · Ready → Blocked · takes Next",
  );
});

test("RBP1 same-note add is one transaction and matches forward bytes", async () => {
  const notes = {
    "Tasks.md": [
      "- [ ] #task Do cleanup tasks",
      "- [ ] #task Prerequisite ^n",
    ].join("\n"),
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  const tEditor = openNote(forward, "Tasks.md", 0);
  const nEditor = openNote(reverse, "Tasks.md", 1);
  const forwardOut = await applyForward(forward, "Tasks.md", null, [
    { path: "Tasks.md", blockId: "n" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [{ path: "Tasks.md", line: 1, blockId: "n" }],
    [{ path: "Tasks.md", line: 0 }],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.equal(nEditor.undoGroups, 1);
  assert.match(nEditor.getValue(), /\[id:: /);
  assert.match(nEditor.getValue(), /🧱 \*\*BLOCKS:\*\*/);
  assert.match(nEditor.getValue(), /\[fresh:: 2026-10-17\]/);
  assert.doesNotMatch(
    nEditor.getValue().split(/\n/).find((line) => /\^n(?:\s|$)/.test(line)),
    /\[fresh::/,
  );
  assertParity(forward, reverse, "RBP1");
  void tEditor;
});

test("RBP2 background-leaf T matches forward bytes", async () => {
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [ ] #task Dependent ^t",
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", 0);
  openNote(reverse, "T.md", 0);
  openNote(reverse, "N.md", 0);
  const forwardOut = await applyForward(forward, "T.md", "t", [
    { path: "N.md", blockId: "n" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n")],
    [refFor(reverse, "T.md", "t")],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assertParity(forward, reverse, "RBP2");
});

test("RBP3 closed T is written through vault.process and matches forward bytes", async () => {
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [ ] #task Dependent ^t",
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", 0);
  openNote(reverse, "N.md", 0);
  const forwardOut = await applyForward(forward, "T.md", "t", [
    { path: "N.md", blockId: "n" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n")],
    [refFor(reverse, "T.md", "t")],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.ok(reverse.processWrites.includes("T.md"));
  assertParity(forward, reverse, "RBP3");
});

test("RBP4 ordinary transfer; a ^prj N is never raised", async () => {
  const nextNotes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [*] #task Dependent ^t",
  };
  const forwardNext = createHarness(cloneNotes(nextNotes));
  const reverseNext = createHarness(cloneNotes(nextNotes));
  openNote(forwardNext, "T.md", 0);
  openNote(reverseNext, "N.md", 0);
  assert.equal(
    (await applyForward(forwardNext, "T.md", "t", [
      { path: "N.md", blockId: "n" },
    ])).ok,
    true,
  );
  assert.equal(
    (
      await applyReverse(
        reverseNext,
        [refFor(reverseNext, "N.md", "n")],
        [refFor(reverseNext, "T.md", "t")],
      )
    ).ok,
    true,
  );
  assert.match(liveNotes(reverseNext)["N.md"], /- \[\*\] #task Prerequisite/);
  assertParity(forwardNext, reverseNext, "RBP4 next");

  const progressNotes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [/] #task Dependent ^t",
  };
  const forwardProgress = createHarness(cloneNotes(progressNotes));
  const reverseProgress = createHarness(cloneNotes(progressNotes));
  openNote(forwardProgress, "T.md", 0);
  openNote(reverseProgress, "N.md", 0);
  assert.equal(
    (await applyForward(forwardProgress, "T.md", "t", [
      { path: "N.md", blockId: "n" },
    ])).ok,
    true,
  );
  assert.equal(
    (
      await applyReverse(
        reverseProgress,
        [refFor(reverseProgress, "N.md", "n")],
        [refFor(reverseProgress, "T.md", "t")],
      )
    ).ok,
    true,
  );
  assert.match(liveNotes(reverseProgress)["N.md"], /- \[\/\] #task Prerequisite/);
  assertParity(forwardProgress, reverseProgress, "RBP4 progress");

  const projectNotes = {
    "N.md": [
      "---",
      'type: "[[project]]"',
      'status: "wip"',
      "---",
      "",
      "- [ ] #task #prj Ship the project ^prj",
    ].join("\n"),
    "T.md": "- [*] #task Dependent ^t",
  };
  const forwardPrj = createHarness(cloneNotes(projectNotes));
  const reversePrj = createHarness(cloneNotes(projectNotes));
  openNote(forwardPrj, "T.md", 0);
  openNote(reversePrj, "N.md", 5);
  assert.equal(
    (await applyForward(forwardPrj, "T.md", "t", [
      { path: "N.md", blockId: "prj" },
    ])).ok,
    true,
  );
  const reverseOut = await applyReverse(
    reversePrj,
    [refFor(reversePrj, "N.md", "prj")],
    [refFor(reversePrj, "T.md", "t")],
  );
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(liveNotes(reversePrj)["N.md"], /- \[ \] #task #prj Ship/);
  assert.doesNotMatch(liveNotes(reversePrj)["N.md"], /- \[\*\] #task #prj/);
  assertParity(forwardPrj, reversePrj, "RBP4 prj");
});

test("RBP5 consumed Pomodoro link matches forward bytes", async () => {
  const datePath = dailyPath();
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [ ] #task Dependent ^t",
    [datePath]: [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "  - [[T#^t]]",
    ].join("\n"),
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", 0);
  openNote(reverse, "N.md", 0);
  const forwardOut = await applyForward(forward, "T.md", "t", [
    { path: "N.md", blockId: "n" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n")],
    [refFor(reverse, "T.md", "t")],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(reverseOut.notice, /removed 1 Pomodoro link/);
  assert.doesNotMatch(liveNotes(reverse)[datePath], /\[\[T#\^t\]\]/);
  assertParity(forward, reverse, "RBP5");
});

test("RBP6 project T with residents and a sub-project matches forward bytes", async () => {
  const datePath = dailyPath();
  const projectNote = (parent, residents) =>
    [
      "---",
      'type: "[[project]]"',
      'status: "wip"',
      ...(parent ? [`parent: "[[${parent}]]"`] : []),
      "---",
      "",
      "- [ ] #task #prj Ship the project ^prj",
      ...residents,
    ].join("\n");
  const notes = {
    "T.md": projectNote(null, ["- [/] #task Parent work ^parent-work"]),
    "K.md": projectNote("T", ["- [*] #task Child work ^child-work"]),
    "N.md": [
      "---",
      'type: "[[area]]"',
      "---",
      "",
      "- [ ] #task Prerequisite ^n",
    ].join("\n"),
    [datePath]: [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "  - [[T#^prj]]",
      "  - [[T#^parent-work]]",
      "  - [[K#^prj]]",
      "  - [[K#^child-work]]",
    ].join("\n"),
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", lineOf(notes["T.md"], "prj"));
  openNote(reverse, "N.md", lineOf(notes["N.md"], "n"));
  const forwardOut = await applyForward(forward, "T.md", "prj", [
    { path: "N.md", blockId: "n" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n")],
    [refFor(reverse, "T.md", "prj")],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(liveNotes(reverse)["T.md"], /#prj_is_blocked/);
  assertParity(forward, reverse, "RBP6");
});

test("RBP7 two dependents in different lanes prepare N once at [/]", async () => {
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "A.md": "- [*] #task First ^t1",
    "B.md": "- [/] #task Second ^t2",
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "A.md", 0);
  openNote(forward, "B.md", 0);
  openNote(reverse, "N.md", 0);
  const first = await applyForward(forward, "A.md", "t1", [
    { path: "N.md", blockId: "n" },
  ]);
  const second = await applyForward(forward, "B.md", "t2", [
    { path: "N.md", blockId: "n" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n")],
    [refFor(reverse, "A.md", "t1"), refFor(reverse, "B.md", "t2")],
  );
  assert.equal(first.ok, true, first.reason);
  assert.equal(second.ok, true, second.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(liveNotes(reverse)["N.md"], /- \[\/\] #task Prerequisite/);
  assert.match(reverseOut.notice, /takes In Progress/);
  assertParity(forward, reverse, "RBP7");
});

test("RBP8 counted sources N1 and N2 match forward(T + N1, N2)", async () => {
  const notes = {
    "N.md": ["- [ ] #task First source ^n1", "- [ ] #task Second source ^n2"].join(
      "\n",
    ),
    "T.md": "- [ ] #task Dependent ^t",
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", 0);
  openNote(reverse, "N.md", 0);
  const forwardOut = await applyForward(forward, "T.md", "t", [
    { path: "N.md", blockId: "n1" },
    { path: "N.md", blockId: "n2" },
  ]);
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n1"), refFor(reverse, "N.md", "n2")],
    [refFor(reverse, "T.md", "t")],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(reverseOut.notice, /2 tasks now block/);
  assertParity(forward, reverse, "RBP8");
});

test("RBP9 blocks_lines false writes no BLOCKS and still ids N", async () => {
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [ ] #task Dependent ^t",
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", 0);
  openNote(reverse, "N.md", 0);
  const args = { ...writerArgs(), blocksLinesEnabled: false };
  const forwardOut = await forward.plugin.applyDependencyEdit({
    editor: forward.openEditors.get("T.md"),
    parentPath: "T.md",
    parentLine: 0,
    add: [{ path: "N.md", blockId: "n" }],
    ...args,
  });
  const reverseOut = await reverse.plugin.applyBlocksEdit({
    sources: [refFor(reverse, "N.md", "n")],
    add: [refFor(reverse, "T.md", "t")],
    ...args,
  });
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(liveNotes(reverse)["N.md"], /\[id:: /);
  assert.doesNotMatch(liveNotes(reverse)["N.md"], /🧱 \*\*BLOCKS:/);
  assert.doesNotMatch(liveNotes(reverse)["T.md"], /🧱 \*\*BLOCKS:/);
  assertParity(forward, reverse, "RBP9");
});

test("RBP10 removing the last reason matches forward removal", async () => {
  const notes = {
    "N.md": [
      "- [ ] #task Prerequisite [id:: N__n] ^n",
      "  - 🧱 **BLOCKS:** [[T#^t]]",
    ].join("\n"),
    "T.md": [
      "- [?] #task Dependent [dependsOn:: N__n] [fresh:: 2026-10-10] ^t",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]]",
    ].join("\n"),
  };
  const forward = createHarness(cloneNotes(notes));
  const reverse = createHarness(cloneNotes(notes));
  openNote(forward, "T.md", 0);
  openNote(reverse, "N.md", 0);
  const forwardOut = await applyForward(
    forward,
    "T.md",
    "t",
    [],
    [{ path: "N.md", blockId: "n" }],
  );
  const reverseOut = await applyReverse(
    reverse,
    [refFor(reverse, "N.md", "n")],
    [],
    [refFor(reverse, "T.md", "t")],
  );
  assert.equal(forwardOut.ok, true, forwardOut.reason);
  assert.equal(reverseOut.ok, true, reverseOut.reason);
  assert.match(liveNotes(reverse)["T.md"], /- \[ \] #task Dependent/);
  assert.match(liveNotes(reverse)["T.md"], /\[fresh:: 2026-10-17\]/);
  assert.doesNotMatch(liveNotes(reverse)["T.md"], /\[unblocked::/);
  assert.doesNotMatch(liveNotes(reverse)["N.md"], /🧱 \*\*BLOCKS:/);
  assertParity(forward, reverse, "RBP10");
});

test("RBW1 a changed source note writes nothing", async () => {
  resetNotices();
  let mutated = false;
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T.md": "- [ ] #task Dependent ^t",
  };
  const harness = createHarness(cloneNotes(notes), {
    mutateBeforeProcess(file, contents) {
      if (!mutated && file.path === "N.md") {
        mutated = true;
        contents.set("N.md", `${contents.get("N.md")}\n<!-- concurrent -->`);
      }
    },
  });
  const tEditor = openNote(harness, "T.md", 0);
  const outcome = await applyReverse(
    harness,
    [{ path: "N.md", line: 0, blockId: "n" }],
    [refFor(harness, "T.md", "t")],
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "changed — reopen");
  assert.match(notices.join("\n"), /changed — reopen/);
  assert.equal(tEditor.undoGroups, 0);
  assert.equal(liveNotes(harness)["T.md"], notes["T.md"]);
  assert.match(liveNotes(harness)["N.md"], /concurrent/);
});

test("RBW2 one changed T note still lands the others and omits it from BLOCKS", async () => {
  const notes = {
    "N.md": "- [ ] #task Prerequisite ^n",
    "T1.md": "- [ ] #task First ^t1",
    "T2.md": "- [ ] #task Second ^t2",
  };
  const harness = createHarness(cloneNotes(notes), {
    mutateBeforeProcess(file, contents) {
      if (file.path === "T2.md") {
        contents.set("T2.md", `${contents.get("T2.md")}\n<!-- concurrent -->`);
      }
    },
  });
  openNote(harness, "N.md", 0);
  const outcome = await applyReverse(
    harness,
    [refFor(harness, "N.md", "n")],
    [refFor(harness, "T1.md", "t1"), refFor(harness, "T2.md", "t2")],
  );
  assert.equal(outcome.ok, true, outcome.reason);
  assert.equal(outcome.reason, "partial");
  assert.match(outcome.notice, /1 task not updated \(changed — reopen\)/);
  assert.match(liveNotes(harness)["T1.md"], /DEPENDS ON/);
  assert.doesNotMatch(liveNotes(harness)["T2.md"], /DEPENDS ON/);
  assert.match(liveNotes(harness)["N.md"], /T1#\^t1/);
  assert.doesNotMatch(liveNotes(harness)["N.md"], /T2#\^t2/);
});

test("RBW3 already-present picks write nothing", async () => {
  const notes = {
    "N.md": [
      "- [ ] #task Prerequisite [id:: N__n] ^n",
      "  - 🧱 **BLOCKS:** [[T#^t]]",
    ].join("\n"),
    "T.md": [
      "- [?] #task Dependent [dependsOn:: N__n] ^t",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]]",
    ].join("\n"),
  };
  const harness = createHarness(cloneNotes(notes));
  const nEditor = openNote(harness, "N.md", 0);
  const tEditor = openNote(harness, "T.md", 0);
  const outcome = await applyReverse(
    harness,
    [refFor(harness, "N.md", "n")],
    [refFor(harness, "T.md", "t")],
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.reason, "unchanged");
  assert.equal(nEditor.undoGroups, 0);
  assert.equal(tEditor.undoGroups, 0);
  assert.equal(harness.processWrites.length, 0);
});

test("RBW4 cleanup folds into N when N lives in today's daily note", async () => {
  const datePath = dailyPath();
  const notes = {
    [datePath]: [
      "## Pomodoros",
      "",
      "- [ ] Current (0900-0930)",
      "  - [[T#^t]]",
      "",
      "- [ ] #task Prerequisite ^n",
    ].join("\n"),
    "T.md": "- [ ] #task Dependent ^t",
  };
  const harness = createHarness(cloneNotes(notes));
  const nEditor = openNote(harness, datePath, lineOf(notes[datePath], "n"));
  const outcome = await applyReverse(
    harness,
    [refFor(harness, datePath, "n")],
    [refFor(harness, "T.md", "t")],
  );
  assert.equal(outcome.ok, true, outcome.reason);
  assert.match(outcome.notice, /removed 1 Pomodoro link/);
  assert.doesNotMatch(nEditor.getValue(), /Current \(0900-0930\)/);
  assert.match(nEditor.getValue(), /🧱 \*\*BLOCKS:\*\* \[\[T#\^t\]\]/);
  assert.ok(
    nEditor.undoGroups <= 2,
    `daily note should fold cleanup, undo=${nEditor.undoGroups}`,
  );
  assert.equal(
    harness.processWrites.filter((path) => path === datePath).length,
    0,
  );
});

test("RBW6 counted forward two-lane dependents prepare N once", async () => {
  resetNotices();
  const tasks = [
    "- [*] #task First ^t1",
    "- [/] #task Second ^t2",
  ].join("\n");
  const harness = createHarness({
    "Tasks.md": tasks,
    "N.md": "- [ ] #task Prerequisite ^n",
  });
  const editor = openNote(harness, "Tasks.md", 0);
  const modal = stubCountedModal(harness.plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    valid: true,
    targets: [
      { line: 0, rawLine: "- [*] #task First ^t1" },
      { line: 1, rawLine: "- [/] #task Second ^t2" },
    ],
  };
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "N.md",
    line: 0,
    rawLine: "- [ ] #task Prerequisite ^n",
    displayText: "Prerequisite",
    existingIdField: null,
    blockId: "n",
  });
  assert.equal(applied, true, notices.join("\n"));
  assert.doesNotMatch(notices.join("\n"), /target-changed/);
  assert.match(liveNotes(harness)["N.md"], /- \[\/\] #task Prerequisite/);
  assert.equal(
    (editor.getValue().match(/DEPENDS ON/g) || []).length,
    2,
  );
});
