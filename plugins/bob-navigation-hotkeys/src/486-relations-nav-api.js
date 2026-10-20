// Additive relation capability for bob-ledger-tools (`docs/task-relations.md`
// §10). Both stage directions and live chip removal are now available. Calls
// settle and never throw.
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
    version: 1,
    openStage(ref) {
      const direction = ref && ref.direction;
      if (
        (!direction || direction === "to" || direction === "from") &&
        plugin &&
        typeof plugin.openRelationStageForRef === "function"
      ) {
        return settle(() => plugin.openRelationStageForRef(ref || {}));
      }
      return Promise.resolve({ ok: false, reason: "invalid-direction" });
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
