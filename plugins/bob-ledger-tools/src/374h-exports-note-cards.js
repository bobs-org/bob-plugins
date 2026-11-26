// Test-facing exports for the Notebook and Prose Card kit scaffolding.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      NOTEBOOK_CARD_KIND,
      notebookCardStem,
      NOTEBOOK_CARD_SURFACE_CLASS,
      NOTEBOOK_CARD_HOST_KIND,
      NOTEBOOK_CARD_MOUNT_ATTR,
      NOTEBOOK_CARD_FOOT_KIND,
      NOTEBOOK_CARD_READOUT_SLOT,
      PROSE_NOTE_CARD_KIND,
      proseNoteCardStem,
      PROSE_NOTE_CARD_SURFACE_CLASS,
      PROSE_NOTE_CARD_HOST_KIND,
      PROSE_NOTE_CARD_MOUNT_ATTR,
      PROSE_NOTE_CARD_FOOT_KIND,
      PROSE_NOTE_CARD_OUTLINE_SLOT,
    });
  }
} catch (_) {}
