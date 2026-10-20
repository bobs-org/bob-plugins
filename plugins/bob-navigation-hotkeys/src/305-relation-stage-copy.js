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
