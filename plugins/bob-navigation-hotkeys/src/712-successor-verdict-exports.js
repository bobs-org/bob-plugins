// Verdict helper exports (`api.successors` v4). Patches the shared
// helpers object so 700-exports.js stays under the 1000-line cap.
try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    const extra = {
      normalizeSuccessorCloseDescriptor,
      successorPickerCloseSupported,
      normalizeSuccessorVerdictOutcome,
      normalizeSuccessorCancelReason,
      normalizeSuccessorClosesForResult,
      successorModalCloseSupported,
      successorRowCloseFor,
      successorRowVerdictEligible,
      successorModalHasVerdicts,
      successorVerdictCounts,
      successorModalVerdictsActive,
      successorConsequenceForRow,
      successorStatusTextForRow,
      successorFooterSummaryText,
    };
    for (const [name, fn] of Object.entries(extra)) {
      if (typeof fn === "function" && module.exports.helpers[name] === undefined) {
        module.exports.helpers[name] = fn;
      }
    }
  }
} catch (_error) {
  // Tests fall back to the model normalizer without these helpers.
}
