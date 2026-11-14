try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      getBankWalkApi,
      bankWalkSnapshot,
      bankWalkScope,
      buildBankWalkNoticeModel,
      renderBankWalkNoticeFragment,
      showBankWalkNotice,
      showBankWalkEmptyNotice,
      bracketModeAttentionMap,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
