// Canonical intention models, metadata fail-open, display ownership, and source reads.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}
const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    parseYaml: (text) => JSON.parse(text), normalizePath: (value) => value,
    editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return { EditorView: { editorAttributes: { of: (value) => value } } };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

function findCliFixture() {
  const candidates = [process.env.BOB_CLI_DIR].filter(Boolean);
  let parent = path.resolve(__dirname);
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(parent);
    parent = path.dirname(parent);
  }
  for (const root of candidates) {
    const file = path.join(root, "tests/fixtures/intentions/digest-vectors.json");
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function wrappedFrontmatter(fields, body = "# note\n") {
  return `---\n${JSON.stringify(fields)}\n---\n\n${body}`;
}

function fakeTimers(plugin) {
  const timers = new Map();
  let next = 0;
  plugin.albumSetTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; };
  plugin.albumClearTimeout = (id) => timers.delete(id);
  return timers;
}

function fakeScope() {
  const scope = {
    classList: { contains: (name) => name === "markdown-preview-view" },
    closest: () => null,
    ownerDocument: { defaultView: {} },
    children: [],
  };
  return scope;
}

test("intention subjects accept only canonical day and period notes, including ISO W53", () => {
  const today = "2026-11-19";
  const thursday = H.intentionCardSubjectForPath("2026/20261119.md", today);
  assert.equal(thursday.kind, "day");
  assert.equal(thursday.parent.id, "2026-W47");
  assert.equal(thursday.state, "current");
  assert.equal(H.intentionCardSubjectForPath("./2026/20261119.md", today).kind, "day");
  assert.equal(H.intentionCardSubjectForPath("/2026/20261119.md", today), null);
  assert.equal(H.intentionCardSubjectForPath("2026/archive/20261119.md", today), null);
  assert.equal(H.intentionCardSubjectForPath("2026/20261340.md", today), null);
  assert.equal(H.intentionCardSubjectForPath("all_time.md", today), null);

  const week53 = H.intentionCardSubjectForPath("2026/2026-W53.md", today);
  assert.equal(week53.start, "2026-12-28");
  assert.equal(week53.end, "2027-01-03");
  assert.equal(week53.parent.id, "2026-Q4");
  assert.equal(week53.parent.end, "2027-01-03");
  assert.equal(H.intentionCardWeeksInIsoYear(2026), 53);
  assert.equal(H.intentionCardSubjectForPath("2025/2025-W53.md", today), null);

  const nextYearWeek = H.intentionCardSubjectForPath("2027/2027-W01.md", today);
  assert.equal(nextYearWeek.start, "2027-01-04");
  assert.equal(nextYearWeek.parent.id, "2027-Q1");
  assert.equal(H.intentionCardSubjectForPath("2026/2026-Q4.md", today).end, "2027-01-03");
  assert.equal(H.intentionCardSubjectForPath("2026.md", today).parent, null);
  assert.equal(H.intentionCardShiftDate("2026-03-08", 1), "2026-03-09");
});

test("frontmatter validation is strict and summary provenance follows digest parity", () => {
  const digest = H.intentionCardDigest("A useful summary");
  const fields = H.intentionCardReadFields({
    intentions: ["Ship the card", "Keep the source safe"],
    summary: "A useful summary", summary_digest: digest, summary_drafted: "2026-11-19",
    reflection: "First paragraph.\n\nSecond paragraph.", review_digest: digest,
  });
  assert.equal(fields.ok, true);
  assert.equal(fields.summaryState, "agent");
  assert.equal(fields.reflection, "First paragraph.\n\nSecond paragraph.");
  assert.equal(H.intentionCardReadFields({ intentions: "one" }).ok, false);
  assert.equal(H.intentionCardReadFields({ intentions: ["", "two"] }).ok, false);
  assert.equal(H.intentionCardReadFields({ intentions: ["one\ntwo"] }).ok, false);
  assert.equal(H.intentionCardReadFields({ summary: "two\nlines" }).ok, false);
  assert.equal(H.intentionCardReadFields({ reflection: ["not", "a string"] }).ok, false);
  assert.equal(H.intentionCardReadFields({ summary_digest: "sha256:BAD" }).ok, false);
  assert.equal(H.intentionCardReadFields({ summary: "Changed by Bryan", summary_digest: digest }).summaryState, "edited");

  const source = wrappedFrontmatter({ intentions: ["A"], summary: "A" });
  assert.equal(H.intentionCardFrontmatterEvidence(source, { intentions: ["A"], summary: "A" }).ok, true);
  assert.equal(H.intentionCardFrontmatterEvidence(source, { intentions: ["A"] }).reason, "stale-metadata-cache");
  assert.equal(H.intentionCardParseFrontmatter("---\nsummary: \"a\"\nsummary: \"b\"\n---").reason, "duplicate-owned-key");
  assert.equal(H.intentionCardParseFrontmatter("---\nsummary: [broken\n").reason, "unclosed-frontmatter");
});

test("summary digest matches the bob-cli golden vectors", () => {
  const local = require("./fixtures/intentions/digest-vectors.json");
  const canonicalPath = findCliFixture();
  const canonical = canonicalPath ? JSON.parse(fs.readFileSync(canonicalPath, "utf8")) : local;
  assert.deepEqual(local.vectors, canonical.vectors);
  for (const vector of canonical.vectors) {
    assert.equal(H.intentionCardDigest(vector.input), vector.digest, vector.name);
  }
});

test("placement skips only canonical navigation and direct-child link lines", () => {
  const today = "2026-11-19";
  const subject = H.intentionCardSubjectForPath("2026/2026-W45.md", today);
  const children = Array.from({ length: 7 }, (_, index) => `[[2026/202611${String(index + 2).padStart(2, "0")}]]`).join(" · ");
  const source = [
    "---", "{\"intentions\":[\"Plan\"]}", "---", "", "# 2026-W45", "",
    "[[2026/2026-W44|‹ 2026-W44]] · [[2026/2026-Q4|↑ 2026-Q4]] · [[2026/2026-W46|2026-W46 ›]]",
    "", children, "", "```bob-stats-strip", "", "```", "", "## Days", "",
  ].join("\n");
  const placement = H.intentionCardPlacement(source, subject, today);
  assert.equal(placement.headingLine, 4);
  assert.equal(placement.insertBeforeLine, 10);
  assert.equal(placement.skippedLines, 5);

  const prose = "# 2026-W45\n\nRead [[2026/2026-W44|last week]] before planning.\n\n```bob-stats-strip\n```";
  const prosePlacement = H.intentionCardPlacement(prose, subject, today);
  assert.equal(prosePlacement.insertBeforeLine, 2);
  assert.equal(prosePlacement.skippedLines, 1);
  assert.equal(H.intentionCardPlacement("```md\n# fake\n```\nordinary text", subject, today), null);
});

test("Reading anchor follows canonical nav and child DOM rows, then stops at unrelated links", () => {
  const today = "2026-11-19";
  const subject = H.intentionCardSubjectForPath("2026/2026-W45.md", today);
  const para = (targets, labels) => {
    const links = targets.map((target, index) => ({
      textContent: labels[index] || target,
      getAttribute: (name) => name === "data-href" ? target : null,
    }));
    return {
      textContent: labels.join(" · "),
      querySelectorAll: () => links,
      nextElementSibling: null,
    };
  };
  const nav = para(["2026/2026-W44", "2026/2026-Q4", "2026/2026-W46"], ["‹ 2026-W44", "↑ 2026-Q4", "2026-W46 ›"]);
  const children = para(Array.from({ length: 7 }, (_, i) => `2026/202611${String(i + 2).padStart(2, "0")}`), Array(7).fill("day"));
  const prose = para(["work#^block"], ["unrelated"]);
  const heading = { nextElementSibling: nav };
  nav.nextElementSibling = children;
  children.nextElementSibling = prose;
  const root = { querySelector: () => heading };
  assert.equal(H.intentionCardDomAnchor(root, subject, today), children);
});

test("missing file, heading, and block links are detected through Obsidian resolution", () => {
  const file = { path: "notes.md" };
  let cache = { headings: [{ heading: "Found" }], blocks: { present: { id: "present" } } };
  const plugin = { app: {
    metadataCache: { getFirstLinkpathDest: () => file, getFileCache: () => cache },
    vault: { getAbstractFileByPath: (path) => path === file.path ? file : null },
  } };
  assert.equal(H.intentionCardDomTargetExists(plugin, "notes#Found", "source.md").ok, true);
  assert.equal(H.intentionCardDomTargetExists(plugin, "notes#Missing", "source.md").reason, "missing-heading");
  assert.equal(H.intentionCardDomTargetExists(plugin, "notes#^missing", "source.md").reason, "missing-block");
  plugin.app.metadataCache.getFirstLinkpathDest = () => null;
  plugin.app.vault.getAbstractFileByPath = () => null;
  assert.equal(H.intentionCardDomTargetExists(plugin, "gone", "source.md").reason, "missing-file");
  cache = null;
});

test("only recent closed notes with intentions show missing summary and reflection bands", () => {
  const fields = H.intentionCardReadFields({ intentions: ["Remember the walk"] });
  const today = "2026-11-19";
  const recent = H.intentionCardSubjectForPath("2026/20261112.md", today);
  assert.deepEqual(H.intentionCardMissingBands(recent, fields, today), { summary: true, reflection: true });
  assert.equal(H.intentionCardMissingBands(H.intentionCardSubjectForPath("2026/20261111.md", today), fields, today), null);
  assert.equal(H.intentionCardMissingBands(H.intentionCardSubjectForPath("2026/20261119.md", today), fields, today), null);
  assert.equal(H.intentionCardMissingBands(recent, H.intentionCardReadFields({ reflection: "Done" }), today), null);
});

test("parent cache updates are re-read from the vault and property ownership releases cleanly", async () => {
  const files = new Map();
  const caches = new Map();
  const contents = new Map();
  let reads = 0;
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      async read(file) { reads += 1; return contents.get(file.path); },
    },
    metadataCache: {
      getFileCache: (file) => caches.get(file.path) || null,
      getFirstLinkpathDest: (target) => files.get(String(target).replace(/\.md$/i, "") + ".md") || null,
    },
    workspace: { getLeavesOfType: () => [], on: () => ({}) },
    spawn() { throw new Error("intention cards must not spawn bob or other commands"); },
    exec() { throw new Error("intention cards must not execute subprocesses"); },
  };
  const plugin = new LedgerToolsPlugin(app);
  fakeTimers(plugin);
  plugin.intentionCardActive = true;
  const dayPath = "2026/20261119.md";
  const parentPath = "2026/2026-W47.md";
  const dayFields = { intentions: ["Keep the promise"] };
  const parentFields = { intentions: ["Make room for the important work"] };
  for (const [path, fm] of [[dayPath, dayFields], [parentPath, parentFields]]) {
    const file = { path };
    files.set(path, file);
    caches.set(path, { frontmatter: fm });
    contents.set(path, wrappedFrontmatter(fm, `# ${path}\n`));
  }
  await plugin.intentionCardEnsureSource(parentPath);
  await plugin.intentionCardEnsureSource(dayPath);
  let model = plugin.intentionCardModelFor(dayPath)?.model;
  assert.deepEqual(model.parentIntentions, ["Make room for the important work"]);

  parentFields.intentions = ["Protect a quiet morning"];
  caches.set(parentPath, { frontmatter: parentFields });
  contents.set(parentPath, wrappedFrontmatter(parentFields, "# 2026-W47\n"));
  plugin.intentionCardOnMetadata(files.get(parentPath));
  assert.equal(plugin.intentionCardSourceCache.has(parentPath), false);
  await plugin.intentionCardEnsureSource(parentPath);
  model = plugin.intentionCardModelFor(dayPath)?.model;
  assert.deepEqual(model.parentIntentions, ["Protect a quiet morning"]);

  caches.set(dayPath, { frontmatter: { intentions: ["stale cached value"] } });
  plugin.intentionCardOnMetadata(files.get(dayPath));
  assert.equal(await plugin.intentionCardEnsureSource(dayPath), null);
  assert.equal(plugin.intentionCardSourceCache.has(dayPath), false);
  caches.set(dayPath, { frontmatter: dayFields });
  await plugin.intentionCardEnsureSource(dayPath);
  assert.equal(reads, 5);

  const scope = fakeScope();
  plugin.intentionCardOwn(scope, dayPath);
  assert.equal(plugin.intentionCardKeySlots.has(scope), true);
  assert.deepEqual(H.INTENTION_CARD_OWNED_KEYS, ["intentions", "summary", "summary_digest", "summary_drafted", "reflection", "review_digest", "review_drafted"]);
  assert.equal(plugin.intentionCardRelease(scope, dayPath), true);
  assert.equal(plugin.intentionCardKeySlots.has(scope), false);
  plugin.teardownIntentionCard();
});

test("intention host registers Reading and Live Preview once and keeps embeds out", () => {
  const handlers = new Map();
  const workspace = {
    getLeavesOfType: () => [],
    on(name, callback) { handlers.set(name, callback); return { name }; },
  };
  const plugin = new LedgerToolsPlugin({ workspace, vault: {}, metadataCache: { on: () => ({}) } });
  const timers = fakeTimers(plugin);
  plugin.setupIntentionCard();
  plugin.setupIntentionCard();
  assert.equal(plugin.intentionCardActive, true);
  assert.equal(plugin.postProcessors.length, 1);
  assert.equal(handlers.has("layout-change"), true);
  assert.equal(handlers.has("file-open"), true);
  assert.equal(plugin.intentionCardCanDisplay("2026/20261119.md", { closest: () => null }), true);
  assert.equal(plugin.intentionCardCanDisplay("2026/20261119.md", { closest: () => ({}) }), false);
  plugin.teardownIntentionCard();
  assert.equal(plugin.intentionCardActive, false);
  assert.equal(timers.size, 0);
});
