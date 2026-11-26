// Notebook Card model (bob-cli-qm notebook-card): REGION.
// The species phase derives the view model here from local frontmatter, the
// metadata cache, and the header's ancestry model: crumbs and hue, the title
// and its H1 adoption range, the summary or ghost, created, the @stem route,
// and the managed key set. Kit seeds: the species kind and the stem helper.
const NOTEBOOK_CARD_KIND = "notebook";

function notebookCardStem(path) {
  try {
    const text = String(path === null || path === undefined ? "" : path).replace(/\\/g, "/");
    const base = text.split("/").pop() || "";
    return base.replace(/\.md$/i, "");
  } catch (_) {
    return "";
  }
}
