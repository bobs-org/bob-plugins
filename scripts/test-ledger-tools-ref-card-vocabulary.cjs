// Ref kit: one shared vocabulary feeds the card and the Reading Board. The
// board's seven kinds stay byte-identical; other kinds gain their words.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

test("the vocabulary carries the word, emoji, and icon per kind", () => {
  assert.deepEqual(H.refCardKindEntry("papers"), { word: "Paper", emoji: "📄", icon: "graduation-cap" });
  assert.deepEqual(H.refCardKindEntry("blogs"), { word: "Blog", emoji: "📰", icon: "newspaper" });
  assert.deepEqual(H.refCardKindEntry("chat"), { word: "Chat", emoji: "💬", icon: "bot" });
  assert.deepEqual(H.refCardKindEntry("ai"), { word: "AI", emoji: "🤖", icon: "sparkles" });
  assert.equal(H.refCardKindWord("books"), "Book");
  assert.equal(H.refCardKindEmoji("books"), "📕");
  assert.equal(H.refCardKindIcon("books"), "book");
  assert.equal(H.refCardKindIcon("unknown-kind"), "bookmark");
  assert.equal(H.refCardKindWord(""), "Ref");
});

test("every vocabulary icon has a fallback", () => {
  const icons = [];
  for (const key of Object.keys(H.REF_CARD_KIND_VOCABULARY)) {
    const entry = H.REF_CARD_KIND_VOCABULARY[key];
    assert.ok(entry.word && entry.emoji && entry.icon, `${key} names word, emoji, and icon`);
    assert.match(entry.icon, /^[a-z0-9-]+$/, `${key} icon is a Lucide id`);
    icons.push(entry.icon);
  }
  assert.ok(icons.includes("bookmark") === false, "kinds use distinct icons; fallback is bookmark");
  assert.equal(H.REF_CARD_KIND_FALLBACK.icon, "bookmark");
});

test("the board map derives from the vocabulary and stays identical for seven", () => {
  assert.deepEqual(H.READING_BOARD_KIND_MAP.ai, { icon: "🤖", label: "AI" });
  assert.deepEqual(H.READING_BOARD_KIND_MAP.papers, { icon: "📄", label: "Paper" });
  assert.deepEqual(H.READING_BOARD_KIND_MAP.blogs, { icon: "📰", label: "Blog" });
  assert.deepEqual(H.READING_BOARD_KIND_MAP.docs, { icon: "📚", label: "Docs" });
  assert.deepEqual(H.READING_BOARD_KIND_MAP.chat, { icon: "💬", label: "Chat" });
  assert.deepEqual(H.READING_BOARD_KIND_MAP.podcasts, { icon: "🎙️", label: "Podcast" });
  assert.deepEqual(H.READING_BOARD_KIND_MAP.meetings, { icon: "🤝", label: "Meeting" });
  assert.deepEqual(H.readingBoardKind("books"), { type: "books", icon: "📕", label: "Book", text: "📕 Book" });
  assert.deepEqual(H.readingBoardKind("ai"), { type: "ai", icon: "🤖", label: "AI", text: "🤖 AI" });
});
