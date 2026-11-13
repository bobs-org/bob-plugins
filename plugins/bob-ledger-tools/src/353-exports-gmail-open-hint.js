// Gmail open hint exports, beside the mail-link-marks surface in
// `350-exports.js`. Kept in its own fragment so `350-exports.js` stays at
// or below 1000 lines.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      GMAIL_OPEN_HINT_CLASS,
      GMAIL_OPEN_HINT_SIDE,
      GMAIL_OPEN_HINT_ARIA,
      gmailOpenHintIsGmailUrl,
      gmailOpenHintIsMac,
      gmailOpenHintLabel,
      gmailOpenHintIsTaskRow,
      gmailOpenHintIndent,
      gmailOpenHintFirstMailPath,
      gmailOpenHintLinkOnlyTarget,
      gmailOpenHintIsMailFrontmatter,
      gmailOpenHintResolveMail,
      gmailOpenHintLineResolves,
      gmailOpenHintChildResolves,
      gmailOpenHintTaskLinkHopTarget,
      gmailOpenHintFindBlockLineIndex,
      gmailOpenHintTaskLinkHopResolves,
      gmailOpenHintCanOpen,
      buildGmailOpenHintElement,
      GmailOpenHintWidget,
      ensureGmailOpenHintRefresh,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
