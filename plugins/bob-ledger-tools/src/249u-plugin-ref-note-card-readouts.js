// Ref Card readouts (bob-cli-qp ref-readouts): subscribes to the shared
// ref-library snapshot and patches the lane chip, vN, identifiers, and foot
// into existing rows with no layout shift. Later phases fill the patch.
const REF_NOTE_CARD_READOUT_SLOT = "ref-readouts";

function refNoteCardReadoutSlots() {
  return Object.freeze(["lane", "counts", "identifiers", "foot"]);
}
