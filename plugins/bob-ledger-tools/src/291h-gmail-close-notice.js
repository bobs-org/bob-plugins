// Close-time Gmail notice from Bob's last sync report; this renderer never
// starts Bob or contacts Gmail during a task gesture.
function gmailEventsShowCloseNotice(plugin, task) {
  try {
    const report = plugin && plugin.gmailArchiveLatestSyncReport;
    if (!report || report.archive_enabled !== true || !task || !task.path || !Number.isInteger(task.line)) return false;
    const row = Array.isArray(report.watch) && report.watch.find((candidate) =>
      candidate && typeof candidate.note === "string" && Array.isArray(candidate.tasks) &&
      candidate.tasks.some((watched) => watched && watched.path === task.path && watched.line === task.line + 1));
    if (!row) return false;
    const metadata = plugin.app && plugin.app.metadataCache;
    const file = metadata && typeof metadata.getFirstLinkpathDest === "function"
      ? metadata.getFirstLinkpathDest(row.note, task.path)
      : null;
    const cache = file && metadata && typeof metadata.getFileCache === "function" ? metadata.getFileCache(file) : null;
    const frontmatter = cache && cache.frontmatter;
    const subject = String(frontmatter && (frontmatter.subject || frontmatter.title) || "").trim() ||
      String(row.note).replace(/\\/g, "/").split("/").pop().replace(/\.md$/i, "").replace(/[_-]+/g, " ");
    new Notice(`✉ ${subject} leaves Gmail's Inbox at the next Bob sync · reopen the task to keep it`);
    return true;
  } catch (error) {
    return false;
  }
}
