// Notify Ledger Tools after a managed Done write. Optional APIs make the
// bridge harmless when Ledger Tools or the cached Bob report is unavailable.
function taskStatusCyclerNotifyGmailClose(plugin, taskStatus) {
  try {
    const plugins = plugin.app && plugin.app.plugins && plugin.app.plugins.plugins;
    const api = plugins && plugins["bob-ledger-tools"] && plugins["bob-ledger-tools"].api;
    const closeNotice = api && api.gmailArchiveCloseNotice;
    const active = plugin.app && plugin.app.workspace && plugin.app.workspace.getActiveFile();
    if (closeNotice && Number(closeNotice.version) >= 1 && typeof closeNotice.showForTask === "function") {
      closeNotice.showForTask({ path: String(active && active.path || ""), line: taskStatus.line });
    }
  } catch (error) {
    // Informational UI never affects task completion.
  }
}
