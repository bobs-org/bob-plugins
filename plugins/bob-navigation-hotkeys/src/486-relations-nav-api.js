// Additive relation capability for bob-ledger-tools (`docs/task-relations.md`
// §10). Ships at version 0: `removeLink` works, `openStage` settles false
// until nav-linked-from raises the namespace to v1 once both stage
// directions open. Calls settle and never throw.
function createRelationsNavApi(plugin) {
  const settle = (call) => {
    try {
      return Promise.resolve()
        .then(call)
        .then(
          (result) =>
            result && typeof result === "object" && "ok" in result
              ? result
              : { ok: false, reason: "unexpected-result" },
          () => ({ ok: false, reason: "api-failed" }),
        );
    } catch (_error) {
      return Promise.resolve({ ok: false, reason: "api-failed" });
    }
  };
  return Object.freeze({
    version: 0,
    openStage(_ref) {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    },
    removeLink(sourceRef, targetRef) {
      if (!plugin || typeof plugin.removeRelationLinkByRef !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return settle(() =>
        plugin.removeRelationLinkByRef(sourceRef || {}, targetRef || {}),
      );
    },
  });
}
