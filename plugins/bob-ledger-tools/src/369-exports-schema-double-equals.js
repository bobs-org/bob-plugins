// Test-facing exports for the pure == schema-keymap helpers.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      schemaDoubleEqualsVimSnapshot,
      propertyCardSecondKeyGate,
      schemaDoubleEqualsGate,
      schemaDoubleEqualsTargetKind,
    });
  }
} catch (_) {}
