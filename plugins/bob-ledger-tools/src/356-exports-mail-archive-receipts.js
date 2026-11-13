// Test exports for the display-only Gmail archive receipt chips and notice.
try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers && typeof module.exports === "function") {
    Object.assign(module.exports.helpers, {
      MAIL_ARCHIVE_CHIP_CLASS,
      MAIL_ARCHIVE_CHIP_SIDE,
      MAIL_ARCHIVE_LIST_ARGS,
      mailArchiveReceiptDatePart,
      mailArchiveReceiptIsValid,
      mailArchiveNoteIdentityFromFrontmatter,
      mailArchiveReceiptTaskStatus,
      mailArchiveReceiptTooltip,
      mailArchiveReceiptChipModel,
      mailArchiveReceiptModelsForTask,
      mailArchiveReceiptDecodeList,
      mailArchiveReceiptDecodeListOutput,
      mailArchiveReceiptCacheCreate,
      mailArchiveReceiptCacheInvalidate,
      mailArchiveReceiptCacheRefresh,
      mailArchiveReceiptCacheStateForNote,
      buildMailArchiveChipElement,
      buildMailArchiveChipGroupElement,
      MailArchiveChipWidget,
      gmailEventsRecentArchiveCount,
      gmailEventsShowRecentArchiveNotice,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
