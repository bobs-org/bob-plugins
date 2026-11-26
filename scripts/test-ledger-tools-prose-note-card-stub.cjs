// Prose Card local identity, title-page shell, numbering affordance, and gate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

function parseYaml(source) {
  const result = {};
  for (const line of String(source || "").split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim();
    if (value === "true") result[key] = true;
    else if (value === "false") result[key] = false;
    else if (value === "null" || value === "~") result[key] = null;
    else if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value.slice(1, -1).split(",").map((part) => scalar(part.trim()));
    } else result[key] = scalar(value);
  }
  return result;
}

function scalar(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml,
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const fixtures = path.join(__dirname, "fixtures", "note-cards");

function fixtureFrontmatter(name) {
  const text = fs.readFileSync(path.join(fixtures, name), "utf8");
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  assert.ok(match, `${name} has frontmatter`);
  return parseYaml(match[1]);
}

function tree(node) {
  return [node, ...(node.children || []).flatMap(tree)];
}

class MiniClassList {
  constructor(node) { this.node = node; this.values = new Set(); }
  add(...names) { for (const name of names) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  contains(name) { return this.values.has(name); }
  sync() { this.node.attributes.class = Array.from(this.values).join(" "); }
}

class MiniNode {
  constructor(tagName, ownerDocument, text = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.nodeValue = text;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.classList = new MiniClassList(this);
    this.parentNode = null;
    this._textContent = text === null ? "" : String(text);
  }
  get textContent() { return this.nodeValue === null ? this.children.map((child) => child.textContent).join("") : this._textContent; }
  set textContent(value) { this._textContent = String(value ?? ""); this.children = []; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { this.children = this.children.filter((child) => child !== node); node.parentNode = null; return node; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name, event = {}) { for (const handler of this.listeners[name] || []) handler({ preventDefault() {}, ...event }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    return tree(this).slice(1).filter((node) => className && node.classList.contains(className));
  }
}

function miniDocument() {
  return {
    createElement(tag) { return new MiniNode(tag, this); },
    createTextNode(text) { return new MiniNode("#text", this, text); },
  };
}

test("the prose kit seeds agree with the family and keep the file stem verbatim", () => {
  assert.equal(H.PROSE_NOTE_CARD_KIND, "prose");
  assert.equal(H.propertyCardSpecies(H.PROSE_NOTE_CARD_KIND).tile, "folio");
  assert.equal(H.propertyCardSpecies(H.PROSE_NOTE_CARD_KIND).foldDefault, false);
  assert.equal(H.PROSE_NOTE_CARD_HOST_KIND, "prose");
  assert.equal(H.PROSE_NOTE_CARD_MOUNT_ATTR, "data-prose-source");
  assert.equal(H.PROSE_NOTE_CARD_SURFACE_CLASS, "bob-prose-note-card");
  assert.equal(H.PROSE_NOTE_CARD_FOOT_KIND, "prose");
  assert.equal(H.PROSE_NOTE_CARD_OUTLINE_SLOT, "prose-outline");
  assert.equal(H.proseNoteCardStem("Notes/Why I built SASE.md"), "Why I built SASE");
  assert.equal(H.proseNoteCardStem("blog/sase_blog_contents.md"), "sase_blog_contents");
  assert.equal(H.proseNoteCardStem(""), "");
});

test("the local model handles fixtures, both prose spellings, titles, and numbering", () => {
  const legacy = H.proseNoteCardModel({
    path: "scripts/fixtures/note-cards/prose-article-legacy.md",
    frontmatter: fixtureFrontmatter("prose-article-legacy.md"),
  });
  assert.equal(legacy.kind, "prose");
  assert.equal(legacy.title.text, "prose-article-legacy");
  assert.equal(legacy.title.source, "stem");
  assert.equal(legacy.title.fromStem, true);
  assert.equal(legacy.numbering.state, "numbered");
  assert.equal(legacy.created, "2026-10-15");

  const titled = H.proseNoteCardModel({
    path: "scripts/fixtures/note-cards/prose-with-title.md",
    frontmatter: fixtureFrontmatter("prose-with-title.md"),
    resolveParent: () => ({ path: "area/sase.md", stem: "sase", title: "SASE", kind: "area", hue: "blue" }),
  });
  assert.deepEqual(titled.title, { text: "Why I built SASE", source: "title", fromStem: false, initial: "W" });
  assert.equal(titled.dek, "A short account of the ideas behind the tool.");
  assert.equal(titled.numbering.state, "numbered");
  assert.equal(titled.crumbs[0].text, "SASE");
  assert.equal(titled.crumbs[0].pip, "blue");
  assert.equal(titled.hue, "blue");

  const alias = H.proseNoteCardModel({ path: "notes/no-title.md", frontmatter: { type: "[[prose]]", aliases: ["First alias", "Second alias"] } });
  assert.equal(alias.title.text, "First alias");
  assert.equal(alias.title.source, "alias");
  assert.equal(alias.title.fromStem, false);

  const unnumbered = H.proseNoteCardModel({
    path: "scripts/fixtures/note-cards/prose-unnumbered.md",
    frontmatter: fixtureFrontmatter("prose-unnumbered.md"),
  });
  assert.equal(unnumbered.numbering.state, "unnumbered");
  assert.equal(unnumbered.numbering.numbered, false);

  const invalid = H.proseNoteCardModel({
    path: "scripts/fixtures/note-cards/prose-invalid-numbering.md",
    frontmatter: fixtureFrontmatter("prose-invalid-numbering.md"),
  });
  assert.equal(invalid.numbering.state, "invalid");
  assert.equal(invalid.numbering.numbered, null);

  const dual = H.proseNoteCardModel({
    path: "scripts/fixtures/note-cards/prose-dual-spelling.md",
    frontmatter: fixtureFrontmatter("prose-dual-spelling.md"),
  });
  assert.equal(dual?.kind, "prose");
  assert.equal(H.proseNoteCardModel({
    path: "scripts/fixtures/note-cards/prose-mixed-type.md",
    frontmatter: fixtureFrontmatter("prose-mixed-type.md"),
  }), null);
});

test("the folio uses a letter or digit, and falls back to the pilcrow for punctuation", () => {
  assert.equal(H.proseNoteCardInitial("7 habits"), "7");
  assert.equal(H.proseNoteCardInitial("✨ A bright idea"), "");
  assert.equal(H.proseNoteCardInitial("! Important"), "");
});

test("the title page is safe text with a reserved measure row, folded outline, and command-gated chip", () => {
  const doc = miniDocument();
  const model = H.proseNoteCardModel({
    path: "notes/emoji.md",
    frontmatter: { type: "[[prose]]", title: "✨ Launch <script>" , summary: "An <em>unsafe</em> dek." },
  });
  let toggles = 0;
  const card = H.proseNoteCardBuildEl(doc, model, {
    expanded: false,
    numberingCommandAvailable: true,
    onToggleNumbering: () => { toggles += 1; },
  });
  const nodes = tree(card);
  const heading = nodes.find((node) => node.classList?.contains("bob-property-card-title"));
  const tile = nodes.find((node) => node.getAttribute?.("data-tile-form") === "folio");
  const measure = nodes.find((node) => node.getAttribute?.("data-prose-measures") === "true");
  const outline = nodes.find((node) => node.getAttribute?.("data-prose-outline") === "true");
  const fold = nodes.find((node) => node.getAttribute?.("data-card-fold") === "prose");
  const numbering = nodes.find((node) => node.classList?.contains("bob-prose-note-card-numbering"));
  assert.equal(card.getAttribute("data-card-kind"), "prose");
  assert.equal(card.getAttribute("aria-label"), "Prose: ✨ Launch <script>");
  assert.equal(heading.textContent, "✨ Launch <script>");
  assert.equal(heading.getAttribute("title"), null);
  assert.equal(tile.querySelector?.(".bob-property-card-tile-value"), null);
  assert.equal(measure.textContent, "");
  assert.equal(outline.getAttribute("hidden"), "");
  assert.equal(fold.getAttribute("aria-controls"), outline.getAttribute("id"));
  assert.equal(numbering.tagName, "BUTTON");
  numbering.dispatch("click");
  assert.equal(toggles, 1);
  const dek = nodes.find((node) => node.classList?.contains("bob-prose-note-card-dek"));
  assert.equal(dek.textContent, "An <em>unsafe</em> dek.");

  const inert = H.proseNoteCardBuildEl(doc, model, { numberingCommandAvailable: false });
  const inertChip = tree(inert).find((node) => node.classList?.contains("bob-prose-note-card-numbering"));
  assert.equal(inertChip.tagName, "SPAN");
  assert.match(inertChip.getAttribute("title"), /command unavailable/);

  const stemModel = H.proseNoteCardModel({ path: "notes/Stem.md", frontmatter: { type: "[[prose]]" } });
  const stemCard = H.proseNoteCardBuildEl(doc, stemModel);
  const stemHeading = tree(stemCard).find((node) => node.classList?.contains("bob-property-card-title"));
  assert.equal(stemHeading.getAttribute("title"), "Title from the file name — press == to set one");
});

test("numbering accepts only literal booleans and defaults an absent property to numbered", () => {
  assert.equal(H.proseNoteCardNumbering({}).state, "numbered");
  assert.equal(H.proseNoteCardNumbering({ section_numbers: true }).state, "numbered");
  assert.equal(H.proseNoteCardNumbering({ section_numbers: false }).state, "unnumbered");
  assert.equal(H.proseNoteCardNumbering({ section_numbers: "false" }).state, "invalid");
  assert.equal(H.proseNoteCardNumbering({ section_numbers: null }).state, "invalid");
});

test("the prose == registration is preview-gated, focuses title, and reads plugin data once", async () => {
  let loads = 0;
  let registrations = [];
  let unregistered = [];
  let opens = [];
  let refreshes = 0;
  const plugin = Object.create(H.BobLedgerToolsProseNoteCardMixin.prototype);
  Object.assign(plugin, {
    app: { commands: {} },
    loadLedgerToolsPluginData: async () => { loads += 1; return { cardPreviewKinds: ["prose"] }; },
    registerPropertyCard: (entry) => { registrations.push(entry); return true; },
    unregisterPropertyCard: (kind) => { unregistered.push(kind); return true; },
    openPropertyEditor: (request) => { opens.push(request); },
    proseNoteCardFootBind() {},
    proseNoteCardFootUnbind() {},
    scheduleProseNoteCardRefresh() { refreshes += 1; },
  });
  plugin.proseNoteCardOnSetup();
  await H.propertyCardPreviewLoad(plugin);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.equal(refreshes, 1);
  const entry = registrations[0];
  assert.equal(entry.kind, "prose");
  assert.equal(entry.match({ path: "notes.md", frontmatter: { type: "[[prose]]" } }), true);
  assert.equal(entry.match({ path: "notes.md", frontmatter: { type: ["[[prose]]", "[[area]]"] } }), false);
  entry.open({ path: "notes.md" });
  assert.deepEqual(opens, [{ filePath: "notes.md", key: "title" }]);
  await H.propertyCardPreviewLoad(plugin);
  assert.equal(loads, 1);
  plugin.proseNoteCardOnDisposeStart();
  assert.deepEqual(unregistered, ["prose"]);
});
