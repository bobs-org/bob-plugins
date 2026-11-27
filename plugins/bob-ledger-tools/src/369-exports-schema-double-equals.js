// Test-facing exports for the pure bare-key schema-keymap helpers.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      schemaDoubleEqualsVimSnapshot,
      propertyCardBareKeyGate,
      schemaDoubleEqualsTargetKind,
      schemaDoubleEqualsEventInContent,
    });
  }
} catch (_) {}
