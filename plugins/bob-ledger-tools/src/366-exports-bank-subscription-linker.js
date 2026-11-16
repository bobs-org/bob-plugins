try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bankDecodeSubscriptions,
      bankDecodeRecordCreation,
      bankBuildArgs,
      bankSubscriptionPickerRecord,
      bankSubscriptionPickerItems,
      bankSubscriptionCandidateProposal,
      bankSubscriptionAmountInput,
      bankSubscriptionCreateStageInit,
      bankSubscriptionCreateArgs,
      bankCategorySubscriptionWritePlan,
      bankSubscriptionContextLine,
      bankSubscriptionPickerStatus,
    });
  }
} catch (_) {}
