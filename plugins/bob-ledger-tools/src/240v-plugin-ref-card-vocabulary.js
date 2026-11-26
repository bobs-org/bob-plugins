// Shared ref vocabulary (bob-cli-qp ref-kit): one vocabulary feeds both the
// Ref Card and the Reading Board. It holds the word, the board emoji, and
// the card's Lucide icon per `ref_type`. The board's seven words and emoji
// stay byte-identical; the other kinds gain their words. Every icon exists
// in Obsidian's bundled Lucide set; any missing icon falls back to
// `bookmark`. Pure: no DOM, no spawns, never throws.
const REF_CARD_KIND_VOCABULARY = Object.freeze({
  papers: Object.freeze({ word: "Paper", emoji: "📄", icon: "graduation-cap" }),
  blogs: Object.freeze({ word: "Blog", emoji: "📰", icon: "newspaper" }),
  chat: Object.freeze({ word: "Chat", emoji: "💬", icon: "bot" }),
  ai: Object.freeze({ word: "AI", emoji: "🤖", icon: "sparkles" }),
  docs: Object.freeze({ word: "Docs", emoji: "📚", icon: "book-open-text" }),
  books: Object.freeze({ word: "Book", emoji: "📕", icon: "book" }),
  slides: Object.freeze({ word: "Slides", emoji: "🖼️", icon: "presentation" }),
  code: Object.freeze({ word: "Code", emoji: "🧩", icon: "code-xml" }),
  notes: Object.freeze({ word: "Note", emoji: "🗒️", icon: "file-pen" }),
  forums: Object.freeze({ word: "Forum", emoji: "🗣️", icon: "messages-square" }),
  podcasts: Object.freeze({ word: "Podcast", emoji: "🎙️", icon: "podcast" }),
  meetings: Object.freeze({ word: "Meeting", emoji: "🤝", icon: "users" }),
  zorg: Object.freeze({ word: "Zorg", emoji: "🗄️", icon: "archive" }),
});

const REF_CARD_KIND_FALLBACK = Object.freeze({ word: "Ref", emoji: "🔖", icon: "bookmark" });

function refCardKindKey(value) {
  try {
    const text = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
    return text || "";
  } catch (_) {
    return "";
  }
}

function refCardKindEntry(refType) {
  try {
    const key = refCardKindKey(refType);
    if (key && Object.prototype.hasOwnProperty.call(REF_CARD_KIND_VOCABULARY, key)) {
      return REF_CARD_KIND_VOCABULARY[key];
    }
    if (!key || key === "other" || key === "none") return REF_CARD_KIND_FALLBACK;
    return Object.freeze({
      word: key.split(/[_\s-]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") || "Ref",
      emoji: REF_CARD_KIND_FALLBACK.emoji,
      icon: REF_CARD_KIND_FALLBACK.icon,
    });
  } catch (_) {
    return REF_CARD_KIND_FALLBACK;
  }
}

function refCardKindWord(refType) {
  try {
    return refCardKindEntry(refType).word || "Ref";
  } catch (_) {
    return "Ref";
  }
}

function refCardKindEmoji(refType) {
  try {
    return refCardKindEntry(refType).emoji || REF_CARD_KIND_FALLBACK.emoji;
  } catch (_) {
    return REF_CARD_KIND_FALLBACK.emoji;
  }
}

function refCardKindIcon(refType) {
  try {
    return refCardKindEntry(refType).icon || REF_CARD_KIND_FALLBACK.icon;
  } catch (_) {
    return REF_CARD_KIND_FALLBACK.icon;
  }
}

// Board-shaped entry for one `ref_type`: { icon, label } with the board's
// emoji and word. Unknown kinds humanize the dir name with the bookmark.
function refCardBoardKindEntry(refType) {
  try {
    const entry = refCardKindEntry(refType);
    return Object.freeze({ icon: entry.emoji, label: entry.word });
  } catch (_) {
    return Object.freeze({ icon: REF_CARD_KIND_FALLBACK.emoji, label: REF_CARD_KIND_FALLBACK.word });
  }
}

// Lane words shared by the card and the board (the Reading Board's words).
const REF_CARD_LANE_WORDS = Object.freeze({
  reading: "Reading",
  next: "Next",
  ready: "Ready",
  snoozed: "Snoozed",
  read: "Read",
  dropped: "Dropped",
  legacy: "Legacy",
});

function refCardLaneWord(lane) {
  try {
    const key = refCardKindKey(lane);
    if (key && Object.prototype.hasOwnProperty.call(REF_CARD_LANE_WORDS, key)) return REF_CARD_LANE_WORDS[key];
    if (!key) return "";
    return key.split(/[_\s-]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  } catch (_) {
    return "";
  }
}
