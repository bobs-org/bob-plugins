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
  // §19: a mention row opens instead of toggling; only its text edit
  // (or reconcile) changes the entry.
  if (item.mention === true) {
    return "↵ opens it in its note · ⌃↵ adds a relation";
  }
  if (item.stageSection === "current") {
    return context.direction === "from"
      ? "↵ removes this source · ⌃↵ relabels"
      : "↵ unlinks · ⌃↵ relabels";
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

// Successor-label indications (`docs/task-relations.md` §20 SU5). A
// configured successor label never blocks a write; it only offers its source
// when its target is parked or done. Row meta, consequence, caveats, the
// inverse hint, and the rename warning all come from the shared
// `relation_successor` copy vectors.
function relationSuccessorSuggestionMeta() {
  return "🪢 offers";
}

function relationSuccessorRowMeta() {
  return "🪢 offers source";
}

function relationSuccessorOffersCopy(sourceText, targetText) {
  const source = String(sourceText || "").trim() || "that task";
  const target = String(targetText || "").trim() || "that task";
  return `🪢 Offers “${source}” when “${target}” is parked or done · never blocks`;
}

function relationSuccessorAlreadyParkedCopy(sourceText, targetText) {
  const source = String(sourceText || "").trim() || "that task";
  const target = String(targetText || "").trim() || "that task";
  return `“${target}” is already parked — “${source}” will be offered when it is done`;
}

function relationSuccessorAlreadyClosedCopy(targetText) {
  const target = String(targetText || "").trim() || "that task";
  return `“${target}” is already closed — nothing left to wait for`;
}

function relationSuccessorInverseHintCopy(typed, sourceText, label) {
  const typedText = String(typed || "").trim() || "that label";
  const source = String(sourceText || "").trim() || "that task";
  const name = String(label || "").trim() || "that label";
  return `“${typedText}” never offers anything · to offer “${source}” after this task, use ⇧L with “${name}”`;
}

function relationSuccessorRenameWarningCopy(label) {
  const name = String(label || "").trim() || "that label";
  return `“${name}” is a successor label in config.yml — update relations.successor_labels`;
}

function relationSuccessorPreviewForAuthoring(args = {}) {
  const sourceText = String(args.sourceText || "").trim() || "that task";
  const targetText = String(args.targetText || "").trim() || "that task";
  const status = args.targetStatus != null ? String(args.targetStatus) : null;
  const live = args.targetLive === true
    ? true
    : args.targetLive === false
      ? false
      : null;
  if (status != null && !OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
    return Object.freeze({
      verdict: "already_closed",
      message: relationSuccessorAlreadyClosedCopy(targetText),
    });
  }
  if (status === "/" && live === false) {
    return Object.freeze({
      verdict: "already_parked",
      message: relationSuccessorAlreadyParkedCopy(sourceText, targetText),
    });
  }
  return Object.freeze({
    verdict: "offers",
    message: relationSuccessorOffersCopy(sourceText, targetText),
  });
}

function mergeRelationSuccessorLabelSuggestions(rows, policy, query = "") {
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
      out[existingIndex] = { ...out[existingIndex], configuredSuccessor: true };
      continue;
    }
    if (query && !fuzzyMatchesText(label, query)) continue;
    positions.set(key, out.length);
    out.push({ key, label, count: 0, hidden: false, inverse: null, configuredSuccessor: true });
  }
  return out;
}

function relationSuccessorInverseLabel(label, policy) {
  return relationCancelInverseLabel(label, policy);
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

function mergeRelationCompleteLabelSuggestions(rows, policy, query = "") {
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
      out[existingIndex] = { ...out[existingIndex], configuredComplete: true };
      continue;
    }
    if (query && !fuzzyMatchesText(label, query)) continue;
    positions.set(key, out.length);
    out.push({
      key,
      label,
      count: 0,
      hidden: false,
      inverse: null,
      configuredComplete: true,
    });
  }
  return out;
}

function relationCompleteInverseLabel(label, policy) {
  return relationCancelInverseLabel(label, policy);
}

function relationCompleteHandEditHint(label) {
  const normalized = normalizeRelationLabel(String(label || ""));
  return normalized
    ? `✓ “${normalized}” completes only from the Links stage or capture · this task stays open`
    : null;
}

function relationCloseConfirmBanner(cancelCount, completeCount) {
  const cancels = Math.max(0, Math.floor(numericOrDefault(cancelCount, 0)));
  const completes = Math.max(0, Math.floor(numericOrDefault(completeCount, 0)));
  const closes = cancels + completes;
  if (closes < 2) return "";
  if (cancels > 0 && completes > 0) {
    return `Closes ${closes} tasks · ✓ ${completes} · ⊘ ${cancels} — ↵ again to confirm`;
  }
  if (completes > 0) {
    return `✓ Completes ${completes} tasks — ↵ again to confirm`;
  }
  return `⊘ Cancels ${cancels} tasks — ↵ again to confirm`;
}

function relationCloseFooterEnterLabel(details = {}) {
  if (details.disabled) return "unavailable";
  if (details.confirming) return "again to confirm";
  const cancels = Math.max(0, Math.floor(numericOrDefault(details.cancelCount, 0)));
  const completes = Math.max(0, Math.floor(numericOrDefault(details.completeCount, 0)));
  if (cancels > 0 && completes > 0) return "link & close";
  if (completes > 0) return "link & complete";
  if (cancels > 0) return "link & cancel";
  return details.relabel === true ? "relabel" : "link";
}

function relationCompleteAlreadyClosedCopy(source) {
  if (!source) return "Links only · never blocks, schedules, or changes status";
  if (source.status === "x" || source.status === "X") return "Already Done · link only";
  if (source.status === "-") return "Stays Cancelled · link only";
  if (source.verdict === "already_closed") {
    return `Stays ${relationCancelStatusName(source.status)} · link only`;
  }
  return "Links only · never blocks, schedules, or changes status";
}

function relationLabelCompleteConsequenceText(preview) {
  const completed = Array.isArray(preview && preview.completes) ? preview.completes : [];
  if (completed.length === 0) return "";
  const source = completed[0];
  const more = completed.length > 1
    ? ` +${completed.length - 1} ${completed.length === 2 ? "task" : "tasks"}`
    : "";
  const parts = [`✓ Completes “${(source && source.text) || "task"}”${more}`];
  parts.push("unblocks dependents");
  parts.push("offers successors");
  if (source && source.projectOpenTasks !== null && source.projectOpenTasks !== undefined) {
    if (source.projectOpenTasks === 1) {
      parts.push("its 1 open task stays open");
    } else {
      parts.push(`its ${source.projectOpenTasks} open tasks stay open`);
    }
  }
  return parts.join(" · ");
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
  const preview = context.preview || item.cancelPreview || item.closePreview || null;
  if (preview && preview.staysDone) {
    return "stays Done · reopen with Alt+[";
  }
  if (preview && preview.completeRefusal) return String(preview.completeRefusal);
  const completed = Array.isArray(preview && preview.completes) ? preview.completes : [];
  const cancelled = Array.isArray(preview && preview.cancels) ? preview.cancels : [];
  if (preview && preview.refusal) return String(preview.refusal);
  if (
    preview &&
    preview.inverseHint &&
    cancelled.length === 0 &&
    completed.length === 0
  ) {
    return String(preview.inverseHint);
  }
  if (
    preview &&
    preview.successorHint &&
    cancelled.length === 0 &&
    completed.length === 0
  ) {
    return String(preview.successorHint);
  }
  if (
    preview &&
    preview.configuredSuccessor &&
    preview.successorMessage &&
    cancelled.length === 0 &&
    completed.length === 0
  ) {
    return String(preview.successorMessage);
  }
  if (preview && preview.staysCancelled) {
    return "⊘ Stays Cancelled · reopen with Alt+]";
  }
  if (completed.length > 0) {
    return relationLabelCompleteConsequenceText(preview);
  }
  if (preview && Array.isArray(preview.completeSources) && preview.completeSources.length > 0 && completed.length === 0) {
    const source = preview.completeSources[0];
    if (source && (source.verdict === "already_closed" || source.status === "x" || source.status === "X" || source.status === "-")) {
      return relationCompleteAlreadyClosedCopy(source);
    }
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
      if (source.projectOpenTasks === 1) {
        parts.push("its 1 open task stays open");
      } else {
        parts.push(`its ${source.projectOpenTasks} open tasks stay open`);
      }
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
  // §19 MN15: 💬-first labels are reserved for text mentions.
  if (relationLabelIsReservedStart(text)) {
    return TASK_MENTION_RESERVED_MESSAGE;
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

// Merge-label indications (`docs/task-relations.md` §21 ML1). A configured
// merge label never lands as a plain relation: committing it folds the
// source's notes into the target and cancels the source at commit time.
function relationMergeSuggestionMeta() {
  return "⤵ merges";
}

function relationMergeRowMeta() {
  return "⤵ merges source";
}

function relationMergeRenameWarningCopy(label) {
  const name = String(label || "").trim() || "that label";
  return `“${name}” is a merge label in config.yml — update relations.merge_labels`;
}

// Configured merge labels are suggestions even before their first use, like
// the cancel/complete/successor overlays above.
function mergeRelationMergeLabelSuggestions(rows, policy, query = "") {
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
      out[existingIndex] = { ...out[existingIndex], configuredMerge: true };
      continue;
    }
    if (query && !fuzzyMatchesText(label, query)) continue;
    positions.set(key, out.length);
    out.push({
      key,
      label,
      count: 0,
      hidden: false,
      inverse: null,
      configuredMerge: true,
    });
  }
  return out;
}

function relationMergeInverseLabel(label, policy) {
  return relationCancelInverseLabel(label, policy);
}

// Normalize one decoded `bob task merge -f json` report into the strip,
// banner, and offer-picker inputs. Pure: never touches the vault.
function taskMergePreviewSummary(report) {
  const body = report && typeof report === "object" ? report : {};
  const merges = Array.isArray(body.merges) ? body.merges : [];
  const sources = merges.map((record) => {
    const source = record && typeof record.source === "object" ? record.source : {};
    const target = record && typeof record.target === "object" ? record.target : {};
    return Object.freeze({
      title: String(source.title || "that task"),
      path: String(source.path || ""),
      blockId: source.block_id != null ? String(source.block_id) : "",
      outcome: String(record.outcome || ""),
      movedNotes: Math.max(0, Math.floor(numericOrDefault(record.moved_notes, 0))),
      dependents: Array.isArray(record.dependents_repointed)
        ? record.dependents_repointed.map(String)
        : [],
      offers: Array.isArray(record.offers) ? record.offers.slice() : [],
      targetTitle: target.title != null ? String(target.title) : "",
      targetPath: String(target.path || ""),
      targetKind: String(target.kind || "task"),
      targetDrawer: target.drawer != null ? String(target.drawer) : "",
      targetSection: target.section != null ? String(target.section) : "",
    });
  });
  const first = merges.length > 0 && merges[0] && typeof merges[0] === "object"
    ? merges[0]
    : {};
  const firstTarget = first.target && typeof first.target === "object" ? first.target : {};
  const offers = [];
  for (const record of merges) {
    for (const offer of (record && Array.isArray(record.offers) ? record.offers : [])) {
      if (offer && typeof offer === "object") offers.push(offer);
    }
  }
  const merged = sources.filter((source) => source.outcome === "merged" || source.outcome === "");
  return Object.freeze({
    sources: Object.freeze(sources),
    count: sources.length,
    mergedCount: merged.length,
    targetTitle: firstTarget.title != null ? String(firstTarget.title || "") : "",
    targetPath: String(firstTarget.path || ""),
    targetKind: String(firstTarget.kind || "task"),
    targetDrawer: firstTarget.drawer != null ? String(firstTarget.drawer) : "",
    targetSection: firstTarget.section != null ? String(firstTarget.section) : "",
    movedNotes: sources.reduce((sum, source) => sum + source.movedNotes, 0),
    dependents: Object.freeze(
      sources.flatMap((source) => source.dependents),
    ),
    offers: Object.freeze(offers),
    nonce: JSON.stringify({
      sources: sources.map((source) => `${source.path}\x00${source.blockId}\x00${source.outcome}`),
      target: `${String(firstTarget.path || "")}\x00${String(firstTarget.block_id || firstTarget.blockId || "")}\x00${String(firstTarget.kind || "")}`,
      offers: offers.map((offer) => String(offer.key || offer.n || "")),
    }),
  });
}

// The Links-stage consequence strip for a merge preview
// (`docs/task-relations.md` §21 ML1, canonical copy in
// `docs/task-merge.md` §10): `⤵ Merges “S” into “T” · moves N notes ·
// cancels “S” · N dependent(s) now wait on “T” · offers “T” under ENTRY`.
function formatTaskMergeConsequenceStrip(summary) {
  if (!summary || !Array.isArray(summary.sources) || summary.sources.length === 0) {
    return "⤵ previewing…";
  }
  const target = summary.targetTitle
    ? `“${summary.targetTitle}”`
    : summary.targetSection
      ? `## ${summary.targetSection}`
      : "that task";
  const firstSource = summary.sources.length === 1 ? `“${summary.sources[0].title}”` : `${summary.sources.length} tasks`;
  const parts = [`⤵ Merges ${firstSource} into ${target}`];
  if (summary.movedNotes > 0) {
    parts.push(
      summary.movedNotes === 1 ? "moves 1 note" : `moves ${summary.movedNotes} notes`,
    );
  }
  if (summary.sources.length === 1) {
    parts.push(`cancels “${summary.sources[0].title}”`);
  } else {
    parts.push(`cancels ${summary.sources.length} tasks`);
  }
  if (summary.dependents.length > 0) {
    parts.push(
      summary.dependents.length === 1
        ? `1 dependent now waits on ${target}`
        : `${summary.dependents.length} dependents now wait on ${target}`,
    );
  }
  const offerEntries = [...new Set(
    summary.offers.map((offer) => String((offer && offer.entry_name) || "").trim()).filter(Boolean),
  )];
  if (offerEntries.length > 0) {
    parts.push(`offers ${target} under ${offerEntries.join(", ")}`);
  }
  return parts.join(" · ");
}

function relationMergeConfirmBanner(mergeCount) {
  const merges = Math.max(0, Math.floor(numericOrDefault(mergeCount, 0)));
  if (merges < 2) return "";
  return `⤵ Merges ${merges} tasks — ↵ again to confirm`;
}
