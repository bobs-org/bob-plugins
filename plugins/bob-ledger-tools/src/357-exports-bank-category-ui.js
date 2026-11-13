// UI-level test helpers for the Category card. Kept apart from the pure
// models so the fragment manifest remains the source of truth.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      BankCategoryCardModal,
      bankCategoryUiEventKey,
      bankCategoryApplyLineEdits,
    });
  }
} catch (_) {}
