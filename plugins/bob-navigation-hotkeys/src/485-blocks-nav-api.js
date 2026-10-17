// Additive reverse dependency capability for bob-ledger-tools (§15.8).
function createBlocksNavApi(plugin) {
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
      if (!plugin || typeof plugin.openBlocksStageForRef !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return settle(() => plugin.openBlocksStageForRef(ref || {}));
    },
    removeDependent(ownerRef, target) {
      if (!plugin || typeof plugin.removeBlocksDependentByRef !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return settle(() =>
        plugin.removeBlocksDependentByRef(ownerRef || {}, target || {}),
      );
    },
  });
}
