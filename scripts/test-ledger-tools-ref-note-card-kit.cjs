// Ref Card local identity and title shell: fixtures, safety, DOM affordances,
// gate and host handlers, in addition to shared species/precedence wiring.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

function yamlScalar(raw) {
  const value = String(raw || "").trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch (_) { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map((part) => yamlScalar(part));
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  return value.replace(/\s+#.*$/, "").trim();
}

function parseYaml(source) {
  const result = {};
  for (const line of String(source || "").split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (match) result[match[1]] = yamlScalar(match[2]);
  }
  return result;
}

class TestPlugin {}
const platform = { isDesktopApp: true, isMacOS: false };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {}, MarkdownRenderer: {}, MarkdownView: {}, Modal: class {},
    Notice: class {}, Platform: platform, Plugin: TestPlugin,
    PluginSettingTab: class {}, Setting: class {}, normalizePath: (value) => value,
    parseYaml,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect: { define: () => ({}) }, StateField: { define: () => ({}) }, RangeSetBuilder: class {} };
  if (request === "@codemirror/view") return { EditorView: {}, keymap: { of: (value) => value }, ViewPlugin: { fromClass: (value) => value }, Decoration: {}, WidgetType: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-26";
const PLAIN = "Notes/note.md";
const REF = "ref/paper.md";
const FIXTURES = path.join(__dirname, "fixtures", "ref-cards");
const instant = (value) => new Date(value);
const stampOptions = (extra = {}) => ({ now: instant("2026-06-11T15:00:00.000Z"), timeZone: "America/Chicago", ...extra });

function fixtureFiles(dir = FIXTURES, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return fixtureFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".md") && entry.name !== "README.md" ? [rel] : [];
  });
}

function fixtureVaultPath(relative) {
  if (relative === "sase_ref.md") return relative;
  if (relative.startsWith("ref_history/")) return relative;
  if (relative.startsWith("ref-sample.assets/")) return `ref/${relative}`;
  return `ref/${path.posix.basename(relative)}`;
}

function fixtureNote(relative) {
  const sourceText = fs.readFileSync(path.join(FIXTURES, relative), "utf8");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(sourceText);
  assert.ok(match, `${relative} has frontmatter`);
  return { sourceText, frontmatter: parseYaml(match[1]), path: fixtureVaultPath(relative) };
}

class MiniNode {
  constructor(tagName, ownerDocument, text = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.nodeType = text === null ? 1 : 3;
    this.nodeValue = text;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    const self = this;
    this.classList = {
      add(...names) { const values = new Set(self.getAttribute("class")?.split(/\s+/).filter(Boolean) || []); names.forEach((name) => values.add(name)); self.setAttribute("class", [...values].join(" ")); },
      remove(...names) { const values = new Set(self.getAttribute("class")?.split(/\s+/).filter(Boolean) || []); names.forEach((name) => values.delete(name)); self.setAttribute("class", [...values].join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((node) => node.textContent).join(""); }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  insertBefore(node, before) { node.parentNode?.removeChild?.(node); const at = before ? this.childNodes.indexOf(before) : -1; node.parentNode = this; if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node); return node; }
  removeChild(node) { this.childNodes = this.childNodes.filter((child) => child !== node); node.parentNode = null; return node; }
  addEventListener(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  fire(type, event = {}) { for (const handler of this.listeners.get(type) || []) handler({ preventDefault() {}, ...event }); }
  querySelectorAll(selector) {
    const className = /^\.([\w-]+)$/.exec(selector)?.[1];
    const attrName = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if ((className && child.classList.contains(className)) || (attrName && child.getAttribute(attrName) !== null)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function miniDocument() {
  return {
    createElement(tag) { return new MiniNode(tag, this); },
    createTextNode(text) { return new MiniNode("#text", this, String(text)); },
  };
}

test("the registry carries the ref species", () => {
  assert.ok(H.PROPERTY_CARD_KINDS.includes("ref"));
  assert.deepEqual(H.propertyCardSpecies("ref"), {
    kind: "ref", word: "Ref", tile: "ribbon", icon: "bookmark",
    band: "", temporal: false, foldDefault: true,
  });
  assert.equal(H.propertyCardAccessibleName("ref", "Attention"), "Ref: Attention");
  assert.equal(H.propertyCardAccessibleName("ref", ""), "Ref");
});

test("the ribbon tile ships in styles.css with a Ref Card region", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"), "utf8",
  );
  for (const token of [
    '.bob-property-card-tile[data-tile-form="ribbon"]',
    "/* Ref Card (bob-cli-qp ref-card): start.",
    "/* Ref Card (bob-cli-qp ref-card): end.",
  ]) {
    assert.ok(css.includes(token), `styles.css carries ${token}`);
  }
});

test("ref omits a missing created stamp", () => {
  assert.equal(H.propertyCardFormatCreatedStamp(stampOptions({ kind: "ref" })).text, "");
  assert.equal(
    H.propertyCardFormatCreatedStamp(stampOptions({ kind: "ref", value: "2026-06-09" })).text,
    "created Jun 9",
  );
});

test("the ref predicate claims exactly [[ref]]", () => {
  assert.equal(H.noteCardIsRefKind({ type: "[[ref]]" }), true);
  assert.equal(H.noteCardIsRefKind({ type: "ref" }), true);
  assert.equal(H.noteCardIsRefKind({ type: ["[[ref]]"] }), true);
  assert.equal(H.noteCardIsRefKind({ type: ["[[ref]]", "[[ref]]"] }), false);
  assert.equal(H.noteCardIsRefKind({ type: ["[[ref]]", "[[project]]"] }), false);
  assert.equal(H.noteCardIsRefKind({ type: "[[prose]]" }), false);
  assert.equal(H.noteCardIsRefKind({}), false);
  assert.equal(H.noteCardIsRefKind(null), false);
  assert.equal(H.noteCardIsRefKind({ type: "[[Ref]]" }), true);
});

test("the ref coverage predicate gates the library", () => {
  assert.equal(H.noteCardIsRefLibraryPath("ref/paper.md"), true);
  assert.equal(H.noteCardIsRefLibraryPath("ref/papers/paper.md"), true);
  assert.equal(H.noteCardIsRefLibraryPath("sase_ref.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("Notes/paper.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref_history/old.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/.hidden/paper.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/x.assets/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/_generated/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/_templates/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/_conflicts/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/paper (conflict 2026).md"), false);
  assert.equal(H.noteCardIsRefLibraryPath(""), false);
});

test("precedence slots ref after prose and claims only library notes", () => {
  const fm = (names) => {
    if (!names) return {};
    if (names.length === 1) return { type: `[[${names[0]}]]` };
    return { type: names.map((name) => `[[${name}]]`) };
  };
  assert.equal(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["ref"]), today: TODAY }), "ref");
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "sase_ref.md", frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "ref_history/old.md", frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "ref/x.assets/note.md", frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.notEqual(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["ref", "project"]), today: TODAY }), "ref");
  assert.equal(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["prose"]), today: TODAY }), "prose");
  assert.equal(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["notebook"]), today: TODAY }), "notebook");
});

test("the coordinator knows the ref mount attribute", () => {
  assert.equal(H.REF_NOTE_CARD_MOUNT_ATTR, "data-ref-source");
  const mount = (source) => ({ getAttribute: (name) => (name === source ? "ref/paper.md" : null) });
  assert.equal(H.propertyCardFrontmatterMountPath(mount("data-ref-source"), "ref"), "ref/paper.md");
});

test("the local identity model handles every reference fixture and excludes non-claims", () => {
  const notes = fixtureFiles().map((relative) => ({ relative, ...fixtureNote(relative) }));
  const claims = notes.filter((note) => H.refNoteCardModel(note));
  const rejected = notes.filter((note) => !H.refNoteCardModel(note)).map((note) => note.path).sort();
  assert.ok(claims.length >= 10, "the populated ref fixtures paint a local identity shell");
  assert.deepEqual(rejected, ["ref/ref-mixed-type.md", "ref/ref-sample.assets/note.md", "ref_history/old-capture.md", "sase_ref.md"].sort());
  const stem = H.refNoteCardModel(fixtureNote("ref-no-title.md"));
  assert.equal(stem.title.source, "stem");
  assert.equal(stem.title.fromStem, true);
  assert.ok(stem.title.text);
  const mismatch = H.refNoteCardModel(fixtureNote("ref-title-mismatch.md"));
  assert.equal(mismatch.title.text, "Chosen title");
  assert.equal(mismatch.title.range, null, "a different opening H1 remains visible");
});

test("titles adopt only a matching opening H1 and citation values keep written precision", () => {
  const blog = H.refNoteCardModel(fixtureNote("ref-finished-blog.md"));
  assert.equal(blog.title.text, "Agentic coding is straining CI");
  assert.equal(blog.title.source, "title");
  assert.equal(blog.title.range.title, blog.title.text);
  assert.equal(blog.title.range.headingLine, 15);
  assert.deepEqual(blog.byline.map(({ kind, text }) => [kind, text]), [
    ["author", "Sachin Malhotra"],
    ["source", "claude.com"],
    ["published", "Sep 14, 2026"],
  ]);
  const paper = H.refNoteCardModel(fixtureNote("ref-arxiv-paper.md"));
  assert.equal(paper.byline.find((part) => part.kind === "published").text, "Jun 2017");
  assert.equal(paper.byline.find((part) => part.kind === "published").precision, "month");
  const blocked = H.refNoteCardModel(fixtureNote("ref-blocked-chat.md"));
  assert.ok(blocked.byline.some((part) => part.text === "agent report · research.5.final"));
  assert.equal(H.refNoteCardPublished("2024-02-30"), null);
});

test("local access paths and citation links reject unsafe values", () => {
  assert.deepEqual(H.refNoteCardSourceUrl("https://www.example.com/story?q=1"), {
    href: "https://www.example.com/story?q=1", host: "example.com",
  });
  for (const url of ["javascript:alert(1)", "file:///tmp/source.pdf", "//example.com/path", "not a URL"]) {
    assert.equal(H.refNoteCardSourceUrl(url), null, url);
  }
  assert.equal(H.refNoteCardVaultPath("lib/paper.pdf", ".pdf"), "lib/paper.pdf");
  for (const value of ["../paper.pdf", "/tmp/paper.pdf", "C:\\paper.pdf", "lib\\..\\paper.pdf", "lib/paper.md"]) {
    assert.equal(H.refNoteCardVaultPath(value, ".pdf"), "", value);
  }
});

test("Managed follows the sync-owned key set and leaves citation prose editable", () => {
  const managed = H.refNoteCardManagedMap({
    id: "x", ref_type: "papers", source_pdf: "lib/x.pdf", source_pdf_sha256: "abc",
    highlights_count: 4, zorg_source: "old", source_block: "^id",
    title: "A title", author: "A Person", url: "https://example.com", summary: "Text", topics: ["x"],
  });
  for (const key of ["id", "ref_type", "source_pdf", "source_pdf_sha256", "highlights_count", "zorg_source", "source_block"]) {
    assert.equal(managed[key], true, `${key} is Managed`);
  }
  for (const key of ["title", "author", "url", "summary", "topics"]) assert.equal(managed[key], undefined, `${key} stays editable`);
});

test("the shell has accessible access, readout, fold, and narrow-state slots", () => {
  const doc = miniDocument();
  let pdfTarget = "";
  let audioTarget = "";
  let collapsed = null;
  const model = H.refNoteCardModel(fixtureNote("ref-finished-blog.md"));
  const card = H.refNoteCardBuildEl(doc, model, {
    pdfMode: "highlights",
    onOpenPdf: (target) => { pdfTarget = target; },
    onListen: (target) => { audioTarget = target; },
    onToggleFold: (value) => { collapsed = value; },
  });
  assert.ok(card);
  assert.equal(card.getAttribute("role"), "group");
  assert.equal(card.querySelectorAll(".bob-property-card-tile").length, 1);
  assert.equal(card.querySelectorAll("[data-ref-lane]").length, 1);
  assert.equal(card.querySelectorAll("[data-ref-version]").length, 1);
  assert.equal(card.querySelectorAll("[data-ref-identifiers]").length, 1);
  assert.equal(card.querySelectorAll("[data-ref-annotations]").length, 1);
  const pdf = card.querySelectorAll("[data-ref-pdf]")[0];
  const audio = card.querySelectorAll("[data-ref-audio]")[0];
  pdf.fire("click");
  audio.fire("click");
  assert.equal(pdfTarget, "lib/agentic-coding-ci.pdf");
  assert.equal(audioTarget, "lib/agentic-coding-ci.mp3");
  assert.ok(pdf.getAttribute("aria-label").includes("Highlights"));
  card.querySelectorAll(".bob-ref-card-fold")[0].fire("click");
  assert.equal(collapsed, true);

  const noAccess = H.refNoteCardBuildEl(doc, H.refNoteCardModel(fixtureNote("ref-blocked-paper.md")));
  assert.equal(noAccess.querySelectorAll("[data-ref-access-row]").length, 0);
});

test("the Ref host gate controls eligibility and title key routes to title", () => {
  const host = new H.BobLedgerToolsRefNoteCardMixin();
  const note = fixtureNote("ref-finished-blog.md");
  host.refNoteCardActive = true;
  host.refCardPreview = false;
  assert.equal(host.refNoteCardEligible(note.path, note.frontmatter), false);
  host.refCardPreview = true;
  assert.equal(host.refNoteCardEligible(note.path, note.frontmatter), true);
  assert.equal(host.refNoteCardEligible("Notes/paper.md", note.frontmatter), false);

  let registration;
  let editor;
  host.registerPropertyCard = (value) => { registration = value; return true; };
  host.openPropertyEditor = (value) => { editor = value; };
  assert.equal(host.refNoteCardRegisterTitleKey(), true);
  assert.equal(registration.kind, "ref");
  assert.equal(registration.match({ path: note.path, frontmatter: note.frontmatter }), true);
  registration.open({ path: note.path });
  assert.deepEqual(editor, { filePath: note.path, key: "title" });
});

test("PDF opens through the macOS Highlights API when present and otherwise through Obsidian", async () => {
  const host = new H.BobLedgerToolsRefNoteCardMixin();
  const opened = [];
  const fallback = [];
  host.app = {
    workspace: { openLinkText: (...args) => { fallback.push(args); } },
    plugins: { plugins: { "bob-navigation-hotkeys": { api: { openReferencePdf: (target) => { opened.push(target); } } } } },
  };
  platform.isMacOS = true;
  assert.equal(host.refNoteCardPdfMode(), "highlights");
  assert.equal(host.refNoteCardOpenPdf("ref/paper.md", "lib/paper.pdf"), true);
  await Promise.resolve();
  assert.deepEqual(opened, ["lib/paper.pdf"]);
  platform.isMacOS = false;
  assert.equal(host.refNoteCardPdfMode(), "obsidian");
  assert.equal(host.refNoteCardOpenPdf("ref/paper.md", "lib/paper.pdf"), true);
  assert.deepEqual(fallback, [["lib/paper.pdf", "ref/paper.md", true]]);
  assert.equal(host.refNoteCardOpenPdf("ref/paper.md", "../escape.pdf"), false);
});
