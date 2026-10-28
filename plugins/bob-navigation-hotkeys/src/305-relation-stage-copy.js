// Links… stage copy: subtitle, consequence strip, and the live relation
// sentence (`docs/task-relations.md` Rules 7–8).

function relationStageSubtitle(stage, markedDiff, options = {}) {
  const currentCount = Array.isArray(stage && stage.current)
    ? stage.current.length
    : 0;
  const pool = Math.max(
    0,
    Math.floor(numericOrDefault(stage && stage.poolSize, 0)),
  );
  const marked = markedDiff && typeof markedDiff === "object" ? markedDiff : null;
  if (marked && (marked.add > 0 || marked.remove > 0 || marked.needId > 0)) {
    const parts = [];
    if (marked.add > 0) {
      parts.push(`${marked.add} to link`);
    }
    if (marked.remove > 0) {
      parts.push(`${marked.remove} to unlink`);
    }
    parts.push("↵ to apply");
    return parts.join(" · ");
  }
  const head = stage && stage.direction === "from"
    ? currentCount === 0
      ? `Nothing links here yet · searching ${pool} tasks`
      : `Linked from ${currentCount} · searching ${pool} tasks`
    : currentCount === 0
      ? `Links to nothing yet · searching ${pool} tasks`
      : `Links to ${currentCount} · searching ${pool} tasks`;
  return `${head} · ⇥ to mark several · does not block`;
}

function relationStageConsequenceStrip(item, context = {}) {
  if (context.cancelStayHint) {
    return String(context.cancelStayHint);
  }
  const marked = Array.isArray(context.marked) ? context.marked : [];
  if (marked.length > 0) {
    let add = 0;
    let remove = 0;
    for (const row of marked) {
      if (row.alreadyLinked || row.stageSection === "current") {
        remove += 1;
      } else {
        add += 1;
      }
    }
    const parts = [];
    if (add > 0) {
      parts.push(`↵ links ${add}`);
    }
    if (remove > 0) {
      parts.push(`↵ unlinks ${remove}`);
    }
    parts.push("never blocks, schedules, or changes status");
    return parts.join(" · ");
  }
  if (!item || item.kind === "stage-more") {
    return "";
  }
  if (item.disabled) {
    return item.disabledReason || "";
  }
  if (item.archived === true) {
    return "Archived · its LINKED FROM shows live only";
  }
  if (item.stageSection === "current") {
    return context.direction === "from"
      ? "↵ removes this source · ⇧↵ relabels"
      : "↵ unlinks · ⇧↵ relabels";
  }
  return "Links only · never blocks, schedules, or changes status";
}

// The live relation sentence for the label field: `S — ‹label› → T`.
function relationStageLiveSentence(sourceText, label, targetText) {
  const source = String(sourceText || "").trim() || "This task";
  const target = String(targetText || "").trim() || "that task";
  const middle = String(label || "").trim();
  return middle ? `${source} — ${middle} → ${target}` : `${source} → ${target}`;
}

// Configured cancel labels are suggestions even before their first use. Keep
// them in the zero-use tier, after the live catalog's ranked rows, and retain
// a hidden catalog row's preference when the same key is configured.
function mergeRelationCancelLabelSuggestions(rows, policy, query = "") {
  const out = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  const positions = new Map(
    out.map((row, index) => [relationCancelLabelKey(row.key || row.label), index]),
  );
  const keys = Array.isArray(policy && policy.keys) ? policy.keys : [];
  const labels = policy && policy.labels && typeof policy.labels === "object"
    ? policy.labels
    : {};
  for (const rawKey of keys) {
    const key = relationCancelLabelKey(rawKey);
    const label = String(labels[key] || rawKey || "").trim();
    if (!key || !label) continue;
    const existingIndex = positions.get(key);
    if (existingIndex !== undefined) {
      out[existingIndex] = { ...out[existingIndex], configuredCancel: true };
      continue;
    }
    if (query && !fuzzyMatchesText(label, query)) continue;
    positions.set(key, out.length);
    out.push({ key, label, count: 0, hidden: false, inverse: null, configuredCancel: true });
  }
  return out;
}

function relationCancelInverseLabel(label, policy) {
  const key = relationCancelLabelKey(label);
  if (!key) return null;
  const keys = Array.isArray(policy && policy.keys) ? policy.keys : [];
  const labels = policy && policy.labels && typeof policy.labels === "object"
    ? policy.labels
    : {};
  for (const configuredKey of keys) {
    const configuredLabel = String(labels[configuredKey] || configuredKey || "");
    const inverse = inverseRelationPhrase(configuredLabel);
    if (
      inverse &&
      !inverse.endsWith(" → this") &&
      relationCancelLabelKey(inverse) === key
    ) {
      return configuredLabel;
    }
  }
  return null;
}

function relationCancelStatusName(status) {
  switch (String(status == null ? "" : status)) {
    case " ": return "Ready";
    case "*": return "Next";
    case "/": return "In Progress";
    case "?": return "Blocked";
    case "x":
    case "X": return "Done";
    case "-": return "Cancelled";
    default: return "Closed";
  }
}

function relationLabelCancelConsequenceStrip(item, context = {}) {
  if (context.confirmBanner) return String(context.confirmBanner);
  if (context.cancelStayHint) return String(context.cancelStayHint);
  if (!item || item.plain || item.kind === "relation-label-invalid") {
    return item && item.reason ? String(item.reason) : "Links only · never blocks, schedules, or changes status";
  }
  const preview = context.preview || item.cancelPreview || null;
  if (preview && preview.refusal) return String(preview.refusal);
  if (preview && preview.inverseHint && (!preview.cancels || preview.cancels.length === 0)) {
    return String(preview.inverseHint);
  }
  if (preview && preview.staysCancelled) {
    return "⊘ Stays Cancelled · reopen with Alt+]";
  }
  if (preview && Array.isArray(preview.sources) && preview.sources.length > 0) {
    const cancelled = Array.isArray(preview.cancels) ? preview.cancels : [];
    if (cancelled.length === 0) {
      const source = preview.sources[0];
      if (source && source.status === "-") return "Already Cancelled · link only";
      if (source && (source.status === "x" || source.status === "X")) return "Stays Done · link only";
      if (source && source.verdict === "already_closed") return `${relationCancelStatusName(source.status)} · link only`;
      return "Links only · never blocks, schedules, or changes status";
    }
    const source = cancelled[0];
    const more = cancelled.length > 1 ? ` +${cancelled.length - 1} ${cancelled.length === 2 ? "task" : "tasks"}` : "";
    const parts = [`⊘ Cancels “${source.text || "task"}”${more}`];
    if (source.blockId) parts.push("removes its links from today's open Pomodoros");
    parts.push("unblocks dependents");
    if (source.projectOpenTasks !== null && source.projectOpenTasks !== undefined) {
      parts.push(`its ${source.projectOpenTasks} open tasks stay open`);
    }
    return parts.join(" · ");
  }
  return "Links only · never blocks, schedules, or changes status";
}

function relationCancelHandEditHint(label) {
  const normalized = normalizeRelationLabel(String(label || ""));
  return normalized
    ? `⊘ “${normalized}” cancels only from the Links stage or capture · this task stays open`
    : null;
}

// Inline validation reason for the relation field, mirroring
// `normalizeRelationLabel` (empty / too long / forbidden character).
// Returns null when the label commits.
function describeRelationLabelRefusal(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/, "")
    .trim();
  if (!text) {
    return null;
  }
  const length = Array.from(text).length;
  if (length > 40) {
    return "Keep the relation to 40 characters";
  }
  if (/[[\]()"\\|•*~]/.test(text)) {
    return "A relation cannot contain brackets, quotes, |, •, * or ~";
  }
  if (/^[·,]/.test(text)) {
    return "A relation cannot start with · or ,";
  }
  return null;
}

function relationStageLabelPlaceholder(suggestions) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (list.length === 0) {
    return "Relation (optional) — e.g. see also";
  }
  const first = list[0] && list[0].label ? String(list[0].label) : "";
  return first
    ? `Relation (optional) — e.g. ${first}`
    : "Relation (optional) — e.g. see also";
}
