// Test helpers for the Bank Setup header (bob-cli-lt setup-header):
// config decode, setup model, shared tile painter, lint mapping, and the
// queue config pointer. Kept separate so every hand-edited fragment stays
// at or below 1000 lines.
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bankDecodeConfig,
      bankConfigUnsupported,
      bankSetupStateKind,
      bankSetupCollapsedLine,
      bankSetupModel,
      bankSetupModelSignature,
      bankSetupSignature,
      bankSetupTile,
      bankSetupLintMarks,
      bankSetupLintDeltas,
      bankSetupMapFindingLines,
      bankSetupBuildEl,
      bankSharedCategoryTile,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
