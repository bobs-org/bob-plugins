// Ref Card host (bob-cli-qp ref-card): mounts behind the ref-owned preview
// gate and the precedence function, never `propertyCardKindLive`. Owns the
// title with matching-H1 adoption; wires the foot, `_` compact, and `==`
// through `registerPropertyCard`. The managed reading-task embed stays in
// the body untouched. Later phases fill the mount.
const REF_NOTE_CARD_HOST_KIND = "ref";
const REF_NOTE_CARD_MOUNT_ATTR = "data-ref-source";

function refNoteCardMountedInSurface(node, path) {
  try {
    if (!node || typeof node.getAttribute !== "function") return false;
    const wanted = refNoteCardPath(path);
    return node.getAttribute(REF_NOTE_CARD_MOUNT_ATTR) === wanted;
  } catch (_) {
    return false;
  }
}
