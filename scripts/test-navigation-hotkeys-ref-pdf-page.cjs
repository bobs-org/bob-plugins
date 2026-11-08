const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const BASE = "/vault";

function makePageHarness(content, options = {}) {
  const files = new Map();
  const blocksByPath = new Map();
  const addFile = (filePath, body = "", frontmatter = {}, blocks = null) => {
    const file = {
      path: filePath,
      extension: path.extname(filePath).slice(1).toLowerCase(),
      content: body,
    };
    files.set(filePath, { file, body, frontmatter });
    if (blocks) {
      blocksByPath.set(filePath, blocks);
    }
    return file;
  };
  const currentPath = options.currentPath || "sase.md";
  const currentFile = addFile(
    currentPath,
    content,
    options.currentFrontmatter || {},
    options.currentBlocks || null,
  );
  for (const entry of options.files || []) {
    addFile(entry.path, entry.content, entry.frontmatter, entry.blocks || null);
  }
  const editorElement = {};
  const bodyElement = {};
  const activeElement = options.focusOutside
    ? { closest: () => null }
    : options.focusBody
      ? bodyElement
      : { closest: () => editorElement };
  const view = {
    file: currentFile,
    editor: {
      getValue: () => content,
      getCursor: () => ({ line: options.line || 0, ch: 0 }),
      replaceRange() {
        throw new Error("The PDF key must never write the editor");
      },
    },
    getMode: () => options.mode || "source",
    containerEl: {
      ownerDocument: { activeElement, body: bodyElement },
      contains: (element) => element === editorElement,
    },
  };
  const delegates = [];
  const launches = [];
  const pdfs = new Set(
    options.pdfs === undefined ? ["lib/chat/x.pdf"] : options.pdfs,
  );
  for (const pdfPath of pdfs) {
    if (!files.has(pdfPath)) {
      addFile(pdfPath);
    }
  }
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin._highlightsLaunchActive = false;
  plugin._highlightsLastLaunchEnd = 0;
  const linkpathDests = options.linkpathDests || {};
  plugin.app = {
    workspace: { getActiveViewOfType: () => (options.noView ? null : view) },
    commands: {
      executeCommandById: (id) => delegates.push(id),
    },
    metadataCache: {
      getFileCache: (file) => {
        const entry = file && files.get(file.path);
        if (!entry) {
          return null;
        }
        const blocks = file && blocksByPath.get(file.path);
        return {
          frontmatter: entry.frontmatter,
          blocks: blocks || undefined,
        };
      },
      getFirstLinkpathDest: (linkpath, sourcePath) => {
        void sourcePath;
        const destPath = linkpathDests[linkpath];
        if (!destPath) {
          return null;
        }
        return (files.get(destPath) || {}).file || null;
      },
    },
    vault: {
      adapter: {
        exists: async (filePath) => pdfs.has(filePath),
        getBasePath: () => BASE,
      },
      getAbstractFileByPath: (filePath) =>
        (files.get(filePath) || {}).file || null,
      getMarkdownFiles: () =>
        [...files.values()]
          .map((entry) => entry.file)
          .filter((file) => file && file.extension === "md"),
      cachedRead: async (file) => {
        const entry = file && files.get(file.path);
        return entry ? entry.body : null;
      },
      modify() {
        throw new Error("The PDF key must never modify the vault");
      },
      process() {
        throw new Error("The PDF key must never process the vault");
      },
    },
  };
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.getVaultBasePath = () => BASE;
  plugin.resolveLinkTargetFile = (target, sourcePath) => {
    const targetPath = String(target || "").split("#", 1)[0].trim();
    if (!targetPath) {
      return (files.get(sourcePath) || {}).file || null;
    }
    const candidates = [targetPath, `${targetPath}.md`];
    return (
      candidates
        .map((candidate) => (files.get(candidate) || {}).file)
        .find(Boolean) || null
    );
  };
  plugin.readLinkPickerNoteContent = async (filePath, file) => {
    const entry = files.get(filePath || (file && file.path));
    return entry ? entry.body : null;
  };
  const execFile = (executable, args, execOptions, callback) => {
    launches.push({ executable, args: [...args], options: execOptions });
    const outcome = (options.execOutcomes || [])[launches.length - 1] || {};
    queueMicrotask(() =>
      callback(outcome.error || null, "", outcome.stderr || ""),
    );
  };
  const boundOpen = plugin.openReferencePdfPath.bind(plugin);
  plugin.openReferencePdfPath = (filePath, openOptions = {}) =>
    boundOpen(filePath, {
      execFile,
      isMacOS: options.isMacOS !== false,
      basePath: BASE,
      exists: async (vaultPath) => pdfs.has(vaultPath),
      ...openOptions,
    });
  return { plugin, view, files, currentFile, delegates, launches };
}

function resetNotices() {
  notices.length = 0;
}

function refNoteWithBlock() {
  return [
    "# Example",
    "",
    "- [ ] #task #ref [[lib/chat/x.pdf]] ^ref",
    "",
    "## Highlights",
    "",
    "<!-- highlights:begin -->",
    "",
    "### Page 12",
    "",
    "> [!quote] Latency is not throughput.",
    ">",
    "> > [!note] Comment Compare.",
    "",
    "^h-2b91f0a4c7de",
    "",
    "<!-- highlights:end -->",
  ].join("\n");
}

test("same-note bookmark opens the exact path with an encoded page request", async () => {
  resetNotices();
  const refBody = refNoteWithBlock();
  const harness = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: refBody,
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(harness.launches.length, 2);
  assert.deepEqual(harness.launches[0].args, [
    "-b",
    "net.highlightsapp.universal",
    `${BASE}/lib/chat/x.pdf`,
  ]);
  const pageCall = harness.launches[1];
  assert.equal(pageCall.executable, "/usr/bin/open");
  assert.deepEqual(pageCall.args.slice(0, 1), ["-g"]);
  const url = pageCall.args[1];
  assert.match(url, /^hammerspoon:\/\/bob-highlights-page\?/);
  assert.match(url, /path=%2Fvault%2Flib%2Fchat%2Fx\.pdf/);
  assert.match(url, /page=12/);
  assert.equal(harness.delegates.length, 0);
  assert.match(notices[0], /Opening x in Highlights at p\. 12/);
});

test("routed bookmark and done bullet resolve through the target note", async () => {
  resetNotices();
  const refBody = refNoteWithBlock();
  const harness = makePageHarness(
    "- [ ] #task See [[ref/chat/x#^h-2b91f0a4c7de|🔖]]",
    {
      files: [
        {
          path: "ref/chat/x.md",
          content: refBody,
          frontmatter: { source_pdf: "lib/chat/x.pdf" },
        },
      ],
    },
  );
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(harness.launches.length, 2);
  assert.match(notices[0], /at p\. 12/);

  resetNotices();
  const done = makePageHarness("- [x] Done [[ref/chat/x#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "done/2026-11-08.md",
    files: [
      {
        path: "ref/chat/x.md",
        content: refBody,
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  await done.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(done.launches.length, 2);
  assert.match(notices[0], /at p\. 12/);
});

test("dangling same-note bookmark falls back to a unique block id", async () => {
  resetNotices();
  const movedBody = refNoteWithBlock();
  const harness = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "sase.md",
    files: [
      {
        path: "sase.md",
        content: "- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]",
      },
      {
        path: "ref/other/y.md",
        content: movedBody,
        frontmatter: { source_pdf: "lib/other/y.pdf" },
      },
    ],
    pdfs: ["lib/other/y.pdf"],
  });
  harness.files
    .get("ref/other/y.md")
    .file.path = "ref/other/y.md";
  const withBlocks = makePageHarness(
    "- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]",
    {
      currentPath: "sase.md",
      files: [
        {
          path: "ref/other/y.md",
          content: movedBody,
          frontmatter: { source_pdf: "lib/other/y.pdf" },
          blocks: { "h-2b91f0a4c7de": {} },
        },
      ],
      pdfs: ["lib/other/y.pdf"],
    },
  );
  await withBlocks.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(withBlocks.launches.length, 2);
  assert.match(withBlocks.launches[0].args[2], /lib\/other\/y\.pdf/);
});

test("zero and duplicate block ids report missing without launching", async () => {
  for (const blocksSetup of [[], ["a", "b"]]) {
    resetNotices();
    const files = [];
    const pdfs = ["lib/chat/x.pdf"];
    if (blocksSetup.length === 2) {
      files.push(
        {
          path: "ref/a.md",
          content: "# A",
          frontmatter: { source_pdf: "lib/chat/x.pdf" },
          blocks: { "h-missing1": {} },
        },
        {
          path: "ref/b.md",
          content: "# B",
          frontmatter: { source_pdf: "lib/chat/x.pdf" },
          blocks: { "h-missing1": {} },
        },
      );
    }
    const harness = makePageHarness("- [ ] #task See [[#^h-missing1|🔖]]", {
      currentPath: "sase.md",
      files,
      pdfs,
    });
    await harness.plugin.openReferencePdfInHighlightsOrLink();
    assert.deepEqual(harness.launches, []);
    assert.deepEqual(harness.delegates, []);
    assert.equal(notices.at(-1), "Can't find highlight h-missing1");
  }
});

test("task link to an annotation task opens its page", async () => {
  resetNotices();
  const refBody = refNoteWithBlock();
  const harness = makePageHarness("- [[sase#^ann1]]", {
    files: [
      {
        path: "sase.md",
        content: "- [ ] #task Annotation [[ref/chat/x#^h-2b91f0a4c7de|🔖]] ^ann1",
      },
      {
        path: "ref/chat/x.md",
        content: refBody,
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(harness.launches.length, 2);
  assert.match(notices[0], /at p\. 12/);
});

test("task link to a reading task is unchanged and sends no page", async () => {
  resetNotices();
  const harness = makePageHarness("- [[sase#^ref-x]]", {
    files: [
      {
        path: "sase.md",
        content: "- [?] #task #ref [[ref/chat/x]] ^ref-x",
      },
      {
        path: "ref/chat/x.md",
        content: "# Reference",
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(harness.launches.length, 1);
  assert.deepEqual(harness.launches[0].args.slice(0, 2), [
    "-b",
    "net.highlightsapp.universal",
  ]);
  assert.match(notices[0], /resumes where you left off/);
});

test("stub follows to its group and cycles report cant-follow", async () => {
  const sectioned = [
    "# Sectioned",
    "",
    "<!-- highlights:begin -->",
    "",
    "### Page 12",
    "",
    "> [!info] Grouped highlight",
    ">",
    "> Now shown in [[#^h-target1|the group]].",
    "",
    "^h-stub1",
    "",
    "> [!quote] Target passage.",
    "",
    "^h-target1",
    "",
    "<!-- highlights:end -->",
  ].join("\n");
  resetNotices();
  const harness = makePageHarness("- [ ] #task See [[#^h-stub1|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: sectioned,
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  const target = await harness.plugin.resolveHighlightsTargetAtCursor(
    harness.view.editor,
    harness.view.file,
  );
  assert.equal(target.kind, "page");
  assert.equal(target.blockId, "h-target1");

  const cyclic = [
    "# Cyclic",
    "",
    "<!-- highlights:begin -->",
    "",
    "### Page 1",
    "",
    "> [!info] Grouped highlight",
    ">",
    "> Now shown in [[#^h-b|loop]].",
    "",
    "^h-a",
    "",
    "> [!info] Grouped highlight",
    ">",
    "> Now shown in [[#^h-a|loop]].",
    "",
    "^h-b",
    "",
    "<!-- highlights:end -->",
  ].join("\n");
  resetNotices();
  const cycle = makePageHarness("- [ ] #task See [[#^h-a|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: cyclic,
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  await cycle.plugin.openReferencePdfInHighlightsOrLink();
  assert.deepEqual(cycle.launches, []);
  assert.equal(notices.at(-1), "Can't follow highlight h-a");
});

test("tombstone reports removed and launches nothing", async () => {
  resetNotices();
  const body = [
    "# Example",
    "",
    "<!-- highlights:begin -->",
    "",
    "### Removed highlights",
    "",
    "> [!warning] Removed highlight Gone.",
    "",
    "^h-deadbeef",
    "",
    "<!-- highlights:end -->",
  ].join("\n");
  const harness = makePageHarness("- [ ] #task See [[#^h-deadbeef|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: body,
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.deepEqual(harness.launches, []);
  assert.equal(
    notices.at(-1),
    "This highlight was removed in Highlights — no page to open",
  );
  const target = await harness.plugin.resolveHighlightsTargetAtCursor(
    harness.view.editor,
    harness.view.file,
  );
  assert.equal(target.kind, "removed");
  assert.equal(target.blockId, "h-deadbeef");
});

test("ref_history archive opens its annotated pdf and never the live pdf", async () => {
  resetNotices();
  const archiveBody = refNoteWithBlock();
  const harness = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "ref_history/papers/x__2026-10-26.md",
    currentFrontmatter: {
      annotated_pdf: "[[ref_history/papers/x__2026-10-26__annotated.pdf]]",
      replaced: "2026-10-26",
    },
    files: [
      {
        path: "ref_history/papers/x__2026-10-26.md",
        content: archiveBody,
        frontmatter: {
          annotated_pdf: "[[ref_history/papers/x__2026-10-26__annotated.pdf]]",
          replaced: "2026-10-26",
        },
      },
      { path: "lib/live/x.pdf", content: "", frontmatter: {} },
    ],
    pdfs: ["ref_history/papers/x__2026-10-26__annotated.pdf", "lib/live/x.pdf"],
    linkpathDests: {
      "ref_history/papers/x__2026-10-26__annotated.pdf":
        "ref_history/papers/x__2026-10-26__annotated.pdf",
    },
  });
  const target = await harness.plugin.resolveHighlightsTargetAtCursor(
    harness.view.editor,
    harness.view.file,
  );
  assert.equal(target.kind, "page");
  assert.equal(
    target.pdfPath,
    "ref_history/papers/x__2026-10-26__annotated.pdf",
  );
  assert.deepEqual(target.archived, { replaced: "2026-10-26" });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.match(harness.launches[0].args[2], /__annotated\.pdf/);
  assert.doesNotMatch(harness.launches[0].args[2], /lib\/live\/x\.pdf/);
});

test("exact path, encoding, page-only, failed jump, and re-entry lock", async () => {
  resetNotices();
  const harness = makePageHarness("- [ ] #task #ref [[ref/chat/x]]", {
    files: [
      {
        path: "ref/chat/x.md",
        content: "# R",
        frontmatter: { source_pdf: "lib/a b&c#d%e.pdf" },
      },
    ],
    pdfs: ["lib/a b&c#d%e.pdf"],
  });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(harness.launches.length, 1);

  resetNotices();
  const spaced = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/a b&c#d%e.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: refNoteWithBlock(),
        frontmatter: { source_pdf: "lib/a b&c#d%e.pdf" },
      },
    ],
    pdfs: ["lib/a b&c#d%e.pdf"],
  });
  await spaced.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(spaced.launches.length, 2);
  const url = spaced.launches[1].args[1];
  assert.match(url, /path=%2Fvault%2Flib%2Fa%20b%26c%23d%25e\.pdf/);

  resetNotices();
  const jumpFail = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: refNoteWithBlock(),
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
    execOutcomes: [{}, { error: new Error("no handler") }],
  });
  await jumpFail.plugin.openReferencePdfInHighlightsOrLink();
  assert.equal(jumpFail.launches.length, 2);
  assert.match(
    notices.at(-1),
    /Opened x — jumping to p\. 12 needs Hammerspoon/,
  );

  resetNotices();
  const locked = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: refNoteWithBlock(),
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
  });
  locked.plugin._highlightsLaunchActive = true;
  await locked.plugin.openReferencePdfInHighlightsOrLink();
  assert.deepEqual(locked.launches, []);
  assert.deepEqual(notices, []);
  locked.plugin._highlightsLaunchActive = false;
  locked.plugin._highlightsLastLaunchEnd = Date.now();
  await locked.plugin.openReferencePdfInHighlightsOrLink();
  assert.deepEqual(locked.launches, []);
});

test("off macOS, archive-live isolation, and no vault writes", async () => {
  resetNotices();
  const harness = makePageHarness("- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "ref/chat/x.md",
        content: refNoteWithBlock(),
        frontmatter: { source_pdf: "lib/chat/x.pdf" },
      },
    ],
    isMacOS: false,
  });
  await harness.plugin.openReferencePdfInHighlightsOrLink();
  assert.deepEqual(harness.launches, []);
  assert.equal(notices.at(-1), "Highlights is macOS-only: lib/chat/x.pdf");
});

test("dry and live targets agree and rail lines are set", async () => {
  const cases = [
    {
      content: "- [ ] #task #ref [[ref/chat/x]]",
      options: {
        files: [
          {
            path: "ref/chat/x.md",
            content: "# R",
            frontmatter: { source_pdf: "lib/chat/x.pdf" },
          },
        ],
      },
    },
    {
      content: "- [ ] #task See [[#^h-2b91f0a4c7de|🔖]]",
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        files: [
          {
            path: "ref/chat/x.md",
            content: refNoteWithBlock(),
            frontmatter: { source_pdf: "lib/chat/x.pdf" },
          },
        ],
      },
    },
    {
      content: refNoteWithBlock(),
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        files: [
          {
            path: "ref/chat/x.md",
            content: refNoteWithBlock(),
            frontmatter: { source_pdf: "lib/chat/x.pdf" },
          },
        ],
        line: 10,
      },
    },
  ];
  for (const item of cases) {
    const harness = makePageHarness(item.content, item.options);
    const live = await harness.plugin.resolveHighlightsTargetAtCursor(
      harness.view.editor,
      harness.view.file,
    );
    const dry = await harness.plugin.resolveHighlightsTargetAtCursor(
      harness.view.editor,
      harness.view.file,
      { dry: true },
    );
    assert.deepEqual(dry, live);
    assert.ok(dry.railLines);
    assert.ok(Object.isFrozen(dry));
  }
});

test("pure page helpers validate and encode", () => {
  assert.equal(helpers.normalizeHighlightsPageOption(4), 4);
  assert.equal(helpers.normalizeHighlightsPageOption("12"), 12);
  assert.equal(helpers.normalizeHighlightsPageOption(0), null);
  assert.equal(helpers.normalizeHighlightsPageOption("4a"), 4);
  assert.equal(helpers.normalizeHighlightsPageOption(1000000), null);
  assert.equal(helpers.normalizeHighlightsPageOption(null), null);
  const url = helpers.buildHighlightsPageUrl("/vault/a b.pdf", 4);
  assert.equal(
    url,
    "hammerspoon://bob-highlights-page?path=%2Fvault%2Fa%20b.pdf&page=4",
  );
  assert.equal(helpers.buildHighlightsPageUrl("/vault/a.pdf", null), null);
  assert.equal(helpers.getHighlightsRefTitle({ title: "T" }, "ref/a.md", "lib/a.pdf"), "T");
  assert.equal(helpers.getHighlightsRefTitle({}, "ref/my-note.md", "lib/a.pdf"), "my-note");
});

test("nav api passes a positive integer page without a version bump", async () => {
  resetNotices();
  const harness = makePageHarness("# prose");
  const api = helpers.createDependencyNavApi(harness.plugin);
  assert.equal(api.version, 3);
  assert.deepEqual(await api.openReferencePdf("lib/chat/x.pdf", { page: 7 }), {
    ok: true,
  });
  assert.equal(harness.launches.length, 2);
  assert.match(harness.launches[1].args[1], /page=7/);
  assert.deepEqual(await api.openReferencePdf("lib/chat/x.pdf", { page: 0 }), {
    ok: true,
  });
});
