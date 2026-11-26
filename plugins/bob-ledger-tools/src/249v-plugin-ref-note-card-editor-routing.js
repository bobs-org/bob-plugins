// Ref Card editor routing (bob-cli-qp ref-editor): `==` opens the shared
// Property Editor on bob's REFERENCE contract when the note carries
// `props_ref_contract_v1`, else qm.1 focus-or-add on `title`. Later phases
// fill the routing.
const REF_NOTE_CARD_EDITOR_KIND = "ref";

function refNoteCardEditorRoute(capabilities) {
  try {
    const list = Array.isArray(capabilities) ? capabilities : [];
    if (list.includes("props_ref_contract_v1")) return "settings";
    return "title-fallback";
  } catch (_) {
    return "title-fallback";
  }
}
