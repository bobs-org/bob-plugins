// Test-facing exports for the shared soft-line field helper.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bobSoftLineFold,
      bobSoftLinePasteText,
      bobSoftLineAttach,
      bobSoftLineAutosize,
    });
  }
} catch (_) {}
