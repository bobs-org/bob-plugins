// Test helpers for the guarded bank config-update wire, session, and
// Category-card New category stage (bob-cli-lt category-new).
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      GUARDED_UPDATE_PREVIEW_DEBOUNCE_MS,
      createGuardedUpdateSession,
      BANK_CONFIG_UPDATE_SCHEMA_VERSION,
      BANK_CONFIG_UPDATE_TIMEOUT_MS,
      BANK_CONFIG_UPDATE_MAX_BUFFER,
      BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS,
      BANK_CONFIG_UPDATE_HUB_PATH,
      BANK_CONFIG_HOTKEY_ORDER,
      BANK_CONFIG_RESERVED_HOTKEY,
      bankConfigVaultSyncArgs,
      bankConfigUpdateArgs,
      bankConfigUpdateEnvelope,
      bankConfigUpdateEnvelopeText,
      bankDecodeConfigUpdateReport,
      bankDecodeConfigVaultSyncResult,
      bankIsStaleConfigUpdateCode,
      bankConfigUpdateErrorModel,
      bankConfigFingerprintFromReport,
      bankConfigFreeHotkeys,
      bankConfigHotkeyOwner,
      bankConfigIsHotkeyChar,
      bankConfigGroups,
      bankConfigAddOp,
      createBankConfigUpdateSession,
      bankConfigUpdateServiceDeps,
      BANK_CATEGORY_NEW_TILE_KEY,
      BANK_CATEGORY_NEW_NEEDS_BOB,
      bankCategoryNewTile,
      bankCategoryNewSuggestedHotkey,
      bankCategoryNewDefaultGroup,
      bankCategoryNewStageInit,
      bankCategoryNewHotkeyStatus,
      bankCategoryNewCycleGroup,
      bankCategoryNewDraftOp,
      bankCategoryNewCanApply,
      bankCategoryNewAddedKey,
      bankCategoryCardKeysText,
      bankCategoryNewStageKeysText,
      bankCategoryIsNewCategoryKey,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
