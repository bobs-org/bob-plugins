// Bob Command Mode: catalog-keyed outcome adapters. These stay pure: action
// descriptors carry data, and the plugin decides how to present and execute it.

function cmAdapterJson(text) {
  const source = String((text && text.stdout) || "").trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(source.slice(start, end + 1)); }
    catch (ignored) { return null; }
  }
}

function cmAdapterAction(id, label, extra = {}) {
  return { id, label, ...extra };
}

function cmAdapterRefCreate(run, text) {
  const source = String((text && text.stdout) || "");
  const queued = source.match(/queued:\s*(.+?)\s*\(([^)]*)\)/i);
  if (queued) {
    const detail = queued[2].replace(/^\s*[^:]+:\s*/, "").trim();
    return {
      outcome: "attention",
      summary: detail ? "Queued — " + detail : "Queued for intake",
      actions: [cmAdapterAction("run", "Scan intake", { entryId: "ref-scan-intake", argv: ["ref", "scan"] })],
    };
  }
  const ingested = source.match(/ingested:\s*.+?\s+→\s+([^\r\n]+)/i);
  if (ingested) {
    const note = ingested[1].replace(/\s+(?:·\s+task\s+→|\(adopted\)).*$/i, "").trim();
    return {
      outcome: "completed",
      summary: "Added " + note,
      actions: [cmAdapterAction("open-vault-note", "Open note", { path: note })],
    };
  }
  return null;
}

function cmAdapterRefScan(run, text) {
  const report = cmAdapterJson(text);
  let held = report && report.summary ? Number(report.summary.held) || 0 : 0;
  if (!held) {
    const match = String((text && text.stdout) || "").match(/\b(\d+)\s+held\b|(?:pdfs?_held|pdf_markers_held|held)\s*:\s*(\d+)/i);
    if (match) held = Number(match[1] || match[2]) || 0;
  }
  if (held > 0) return { outcome: "attention", summary: held + " PDF writes held" };
  const combined = String((text && text.stdout) || "") + "\n" + String((text && text.stderr) || "");
  if (run.exitCode === 1 && /still\s+queued/i.test(combined)) {
    return { outcome: "attention", summary: "Intake is still queued" };
  }
  return null;
}

function cmAdapterVaultSync(run, text) {
  const stdout = String((text && text.stdout) || "").trim();
  const stderr = String((text && text.stderr) || "").trim();
  if (run.exitCode === 0 && !stdout && !stderr) {
    return { outcome: "attention", summary: "Skipped — another bob maintenance run holds the lock", retry: true };
  }
  const match = (stdout + "\n" + stderr).match(/[^\r\n]*(?:conflict|_conflicts\/)[^\r\n]*/i);
  if (match) {
    return {
      outcome: "attention",
      summary: cmLastMeaningfulLine(match[0]) || "Sync conflict needs review",
      actions: [cmAdapterAction("open-vault-note", "Open conflict log", { path: "_conflicts/sync_conflicts.md" })],
    };
  }
  return null;
}

function cmAdapterJsonWrite(run, text) {
  const result = cmAdapterJson(text);
  if (!result || typeof result !== "object") return null;
  const code = String(result.code || "");
  const message = String(result.message || "").trim();
  if (result.ok === false) {
    if (code === "unchanged") return { outcome: "attention", summary: message || "Already up to date" };
    return {
      outcome: "failed",
      summary: message || "Command failed",
      ...(code === "lock_busy" ? { retry: true } : {}),
    };
  }
  if (result.ok !== true) return null;
  const names = [result.hidden, result.unhidden].find(Array.isArray)
    ? [result.hidden, result.unhidden].find(Array.isArray).join(", ")
    : (result.name ? String(result.name) : "");
  const entryId = String(run.entry_id || "");
  const verb = /(?:themes|relations)-hide$/.test(entryId) ? "Hid"
    : /(?:themes|relations)-unhide$/.test(entryId) ? "Unhid"
      : /themes-color$/.test(entryId) ? "Pinned" : "Updated";
  return { outcome: "completed", summary: names ? verb + " " + names : message || "Updated" };
}

function cmAdapterPluginsSync(run, text) {
  const result = cmAdapterJson(text);
  if (!result || typeof result !== "object" || result.ok !== true || !Array.isArray(result.plugins)) return null;
  const changed = [];
  let dirty = 0;
  for (const plugin of result.plugins) {
    if (!plugin || typeof plugin.id !== "string" || !Array.isArray(plugin.files)) continue;
    if (plugin.files.some((file) => file && ["created", "updated", "forced"].includes(file.action))) changed.push(plugin.id);
    dirty += plugin.files.filter((file) => file && file.action === "skipped_dirty").length;
  }
  const actions = changed.length
    ? [cmAdapterAction("reload-plugins", "Reload " + changed.length + " plugin" + (changed.length === 1 ? "" : "s"), { pluginIds: changed })]
    : [];
  if (dirty > 0) {
    return {
      outcome: "attention",
      summary: changed.length
        ? "Deployed " + changed.length + ": " + changed.join(", ") + " · " + dirty + " dirty file" + (dirty === 1 ? " left alone" : "s left alone")
        : dirty + " dirty file" + (dirty === 1 ? " left alone" : "s left alone"),
      actions,
    };
  }
  return {
    outcome: "completed",
    summary: changed.length ? "Deployed " + changed.length + ": " + changed.join(", ") : "Plugins already up to date",
    actions,
  };
}

function cmAdapterTaskReroll(run, text) {
  if (!run.preview) return null;
  const result = cmAdapterJson(text);
  const source = String((text && text.stdout) || "");
  const seed = (result && result.seed) || (source.match(/\bseed\s+(0x[\da-f]+|\d+)/i) || [])[1];
  if (!seed) return null;
  return {
    carry: ["--seed", String(seed)],
    actions: [cmAdapterAction("rerun-with-carry", "Apply", { carry: ["--seed", String(seed)] })],
  };
}

function cmAdapterPomodoroStatus(run, text) {
  if (run.exitCode !== 0) return { outcome: "failed", summary: String((text && (text.err || text.out)) || "Pomodoro status failed").trim() };
  return { outcome: "completed", summary: String((text && text.out) || "").trim() || "No Pomodoro running" };
}

function cmAdapterCaptureSession(run, text) {
  const summary = String((text && (text.out || text.err)) || "").trim() || (run.exitCode === 0 ? "Pomodoro updated" : "Command refused");
  return { outcome: run.exitCode === 0 ? "completed" : "failed", summary };
}

function cmAdapterGkeepPull(run, text) {
  const result = cmAdapterJson(text);
  const source = String((text && text.stdout) || "");
  const pulled = result && Number(result.pulled ?? result.notes_pulled ?? result.imported);
  const saysEmpty = pulled === 0 || /\b0\s+(?:notes|items)\s+(?:pulled|imported)\b/i.test(source);
  if (run.exitCode === 0 && saysEmpty) return { outcome: "completed", summary: "Keep inbox already empty" };
  return null;
}

function cmAdapterGcalSync(run, text) {
  const report = cmAdapterJson(text);
  if (!report || report.schema_version !== 1 || report.ok !== true) return null;
  if (report.status === "waiting") {
    return { outcome: "attention", summary: "Calendar waiting for today's note" };
  }
  if (!Array.isArray(report.rows) || !report.pomodoro || typeof report.pomodoro !== "object") return null;
  const added = (kind) => report.rows.filter((row) => row && row.action === "added" && row.kind === kind).length;
  const tasks = added("task");
  const context = added("context");
  const links = Number(report.pomodoro.links_added) || 0;
  const parts = [];
  if (tasks) parts.push(`+${tasks} task${tasks === 1 ? "" : "s"}`);
  if (context) parts.push(`+${context} context`);
  if (links) parts.push(`MEET +${links} link${links === 1 ? "" : "s"}`);
  return {
    outcome: "completed",
    summary: parts.length ? `Calendar · ${parts.join(", ")}` : "Calendar unchanged",
  };
}

cmRegisterOutcomeAdapter("ref-create", cmAdapterRefCreate);
cmRegisterOutcomeAdapter("ref-scan", cmAdapterRefScan);
cmRegisterOutcomeAdapter("vault-sync", cmAdapterVaultSync);
cmRegisterOutcomeAdapter("json-write", cmAdapterJsonWrite);
cmRegisterOutcomeAdapter("plugins-sync", cmAdapterPluginsSync);
cmRegisterOutcomeAdapter("task-reroll", cmAdapterTaskReroll);
cmRegisterOutcomeAdapter("pomodoro-status", cmAdapterPomodoroStatus);
cmRegisterOutcomeAdapter("capture-session", cmAdapterCaptureSession);
cmRegisterOutcomeAdapter("gkeep-pull", cmAdapterGkeepPull);
cmRegisterOutcomeAdapter("gcal-sync", cmAdapterGcalSync);
