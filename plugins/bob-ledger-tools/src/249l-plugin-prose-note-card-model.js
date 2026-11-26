// Prose Card model (bob-cli-qm prose-card): REGION.
// The species phase derives the view model here from local data: the
// dual-spelling detection (from kit), the title precedence and stem-fallback
// flag, the tile initial or pilcrow, the dek, the numbering state, created,
// and the crumbs and hue from the home-card resolver. Kit seeds: the
// species kind and the verbatim stem fallback helper.
const PROSE_NOTE_CARD_KIND = "prose";

function proseNoteCardStem(path) {
  try {
    const text = String(path === null || path === undefined ? "" : path).replace(/\\/g, "/");
    const base = text.split("/").pop() || "";
    // Verbatim: no humanizing, no case folding. The tooltip invites ==.
    return base.replace(/\.md$/i, "");
  } catch (_) {
    return "";
  }
}
