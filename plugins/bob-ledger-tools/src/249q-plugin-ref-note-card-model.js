// Ref Card model (bob-cli-qp ref-card): local identity only. The tile,
// kicker, title, dek, byline, access chips, and foot paint synchronously
// from local frontmatter; reading-state facts patch in later through the
// shared ref-library snapshot. No spawn or write. Later phases fill the
// regions this stub names.
const REF_NOTE_CARD_KIND = "ref";
const REF_NOTE_CARD_MANAGED_KEYS = Object.freeze({
  id: true,
  ref_type: true,
  status: true,
  parent: true,
  source_markdown: true,
  source_pdf: true,
  source_pdf_sha256: true,
  pipeline_version: true,
});

function refNoteCardPath(value) {
  try {
    const raw = value && typeof value.path === "string" ? value.path : value;
    return typeof raw === "string" ? raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
  } catch (_) {
    return "";
  }
}

function refNoteCardStem(path) {
  try {
    const normalized = refNoteCardPath(path);
    const base = normalized.split("/").pop() || "";
    return base.replace(/\.md$/i, "");
  } catch (_) {
    return "";
  }
}

function refNoteCardOneLine(value) {
  if (value === null || value === undefined) return "";
  try {
    const line = String(value).split(/\r?\n/, 1)[0].trim();
    return typeof propertyCardCleanInlineText === "function" ? propertyCardCleanInlineText(line) : line;
  } catch (_) {
    return "";
  }
}

function refNoteCardTitleParts(frontmatter, path) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
    const explicit = refNoteCardOneLine(fm.title);
    if (explicit) return Object.freeze({ text: explicit, source: "title", fromStem: false });
    return Object.freeze({ text: refNoteCardStem(path), source: "stem", fromStem: true });
  } catch (_) {
    return Object.freeze({ text: "", source: "stem", fromStem: true });
  }
}
