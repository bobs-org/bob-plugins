// Ref Card foot (bob-cli-qp ref-card): created/captured stamp, lint slot,
// and the Properties drawer with the Managed group. Later phases paint it.
const REF_NOTE_CARD_FOOT_KIND = "ref";

function refNoteCardFootModel(frontmatter) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
    return Object.freeze({ created: fm.created ?? null, captured: fm.captured ?? null });
  } catch (_) {
    return Object.freeze({ created: null, captured: null });
  }
}
