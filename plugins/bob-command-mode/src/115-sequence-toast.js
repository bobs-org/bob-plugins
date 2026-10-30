// Bob Command Mode: one summary card for a completed command sequence.

function cmSequenceToastStoppedAt(summary) {
  const explicit = Number(summary && summary.stoppedAt);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const results = Array.isArray(summary && summary.results) ? summary.results : [];
  const halt = results.find((row) => row && CM_SEQUENCE_HALT.has(String(row.outcome || "")));
  return halt ? Number(halt.index) || null : null;
}

function cmSequenceToastReason(value) {
  const lines = cmStripAnsi(String(value || ""))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || "";
}

function cmSequenceToastModel(summary = {}, catalog) {
  const source = summary && typeof summary === "object" ? summary : {};
  const steps = Array.isArray(source.steps) ? source.steps.map(cmSequenceStep) : [];
  const results = Array.isArray(source.results) ? source.results : [];
  const total = Math.max(0, Number(source.total) || steps.length);
  const rawOutcome = String(source.outcome || "unknown");
  const outcome = CM_TOAST_META[rawOutcome] ? rawOutcome : "unknown";
  const stoppedAt = cmSequenceToastStoppedAt(source);
  const lines = Array.from({ length: total }, (_, offset) => {
    const index = offset + 1;
    const result = results.find((row) => row && Number(row.index) === index) || null;
    const skipped = Boolean(result && result.skipped);
    const stepOutcome = result && CM_TOAST_META[result.outcome] ? result.outcome : "unknown";
    const reason = !skipped && stoppedAt === index
      ? cmSequenceToastReason(result && result.reason)
      : "";
    return {
      index,
      title: cmSequenceStepTitle(steps[offset] || {}, catalog),
      outcome: skipped ? "skipped" : stepOutcome,
      glyph: skipped ? "○" : CM_TOAST_META[stepOutcome].glyph,
      duration: skipped
        ? "skipped"
        : result && typeof result.durationMs === "number"
          ? cmFormatClock(result.durationMs)
          : "",
      reason,
      skipped,
    };
  });
  const title = stoppedAt
    ? "Sequence stopped at step " + stoppedAt + " of " + total
    : outcome === "attention"
      ? "Sequence needs attention · " + total + " commands"
      : outcome === "interrupted"
        ? "Sequence interrupted · " + total + " commands"
        : "Sequence · " + total + " commands";
  const actions = [{ id: "output", label: "Output" }];
  if (stoppedAt) {
    actions.push({ id: "resume", label: "Resume from " + stoppedAt });
    actions.push({ id: "rerun", label: "Rerun all" });
  } else {
    actions.push({ id: "rerun", label: "Rerun" });
  }
  actions.push({ id: "copy", label: "Copy" });
  return {
    id: String(source.id || ""),
    signature: String(source.signature || cmSequenceSignature(steps)),
    outcome,
    tone: outcome,
    title,
    duration: cmFormatClock(Number(source.durationMs) || 0),
    durationMs: Number(source.durationMs) || 0,
    total,
    stoppedAt,
    startedAtMs: typeof source.startedAtMs === "number"
      ? source.startedAtMs
      : Date.parse(source.started_at || ""),
    steps,
    results,
    lines,
    actions,
    focusRunId: cmSequenceFocusRunId({ ...source, steps, results, stoppedAt }, catalog),
    sticky: outcome === "failed" || outcome === "unknown",
    ariaLive: outcome === "failed" || outcome === "unknown" ? "assertive" : "polite",
  };
}

function cmSequenceToastNode(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function cmCreateSequenceToastFragment(model, onAction = () => {}, onOutput = () => {}) {
  if (typeof document === "undefined" || !document.createDocumentFragment) return null;
  const fragment = document.createDocumentFragment();
  const card = cmSequenceToastNode("section", "bob-cmd-toast bob-cmd-toast-sequence is-" + model.tone);
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", model.ariaLive);

  const header = cmSequenceToastNode("div", "bob-cmd-toast-header");
  const meta = CM_TOAST_META[model.outcome] || CM_TOAST_META.unknown;
  const mark = cmSequenceToastNode("span", "bob-cmd-toast-mark", meta.glyph);
  mark.setAttribute("aria-hidden", "true");
  header.append(
    mark,
    cmSequenceToastNode("span", "bob-cmd-toast-title", model.title),
    cmSequenceToastNode("span", "bob-cmd-toast-duration", model.duration),
  );
  card.appendChild(header);

  const body = cmSequenceToastNode("div", "bob-cmd-toast-body bob-cmd-toast-sequence-body");
  const list = cmSequenceToastNode("div", "bob-cmd-toast-steps");
  for (const line of model.lines || []) {
    const row = cmSequenceToastNode("div", "bob-cmd-toast-step" + (line.skipped ? " is-skipped" : " is-" + line.outcome));
    const heading = cmSequenceToastNode("div", "bob-cmd-toast-step-row");
    const glyph = cmSequenceToastNode("span", "bob-cmd-toast-step-glyph", line.glyph);
    glyph.setAttribute("aria-hidden", "true");
    heading.append(
      glyph,
      cmSequenceToastNode("span", "bob-cmd-toast-step-title", line.title),
      cmSequenceToastNode("span", "bob-cmd-toast-step-duration", line.duration),
    );
    row.appendChild(heading);
    if (line.reason) row.appendChild(cmSequenceToastNode("div", "bob-cmd-toast-step-reason", line.reason));
    list.appendChild(row);
  }
  body.appendChild(list);
  body.addEventListener("click", (event) => {
    if (event && event.defaultPrevented) return;
    onOutput(model.focusRunId);
  });
  card.appendChild(body);

  const actions = cmSequenceToastNode("div", "bob-cmd-toast-actions");
  for (const action of model.actions || []) {
    const button = cmSequenceToastNode("button", "bob-cmd-toast-action", action.label);
    button.type = "button";
    button.setAttribute("data-action-id", action.id);
    button.addEventListener("click", (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      onAction(action, model);
    });
    actions.appendChild(button);
  }
  card.appendChild(actions);
  fragment.appendChild(card);
  return fragment;
}
