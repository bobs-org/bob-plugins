// Intention card editor painter: browse rows with stable arrange identities,
// the field stage (the summary shown read-only above Summary and Reflection
// edits), the auto-growing reflection textarea, and the status line.
const INTENTION_CARD_EDITOR_REFLECTION_MIN_PX = 64;

function intentionCardEditorBuildEl(options, doc, modal) {
  const host = intentionCardEditorCreateEl(doc, "div", "bob-intention-card-editor");
  if (!host) return null;
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", `Edit intentions · ${options.subject || options.subjectPath}`);
  intentionCardEditorPaintAll(host, options, doc, modal);
  try {
    host.addEventListener?.("click", (event) => modal?.intentionOnClick?.(event));
    host.addEventListener?.("keydown", (event) => modal?.intentionOnKeyDown?.(event));
    host.addEventListener?.("paste", (event) => intentionCardEditorPaste(modal, event));
    host.addEventListener?.("input", (event) => {
      if (event?.target?.hasAttribute?.("data-intention-input")) modal?.intentionOnStageInput?.(event);
    });
  } catch (_) {}
  return host;
}

// Summary provenance words for the editor: the same glyph and date the card
// shows, never a raw state name.
function intentionCardEditorProvenance(state, drafted) {
  if (state === "agent") {
    const date = drafted && typeof intentionCardDateShort === "function" ? intentionCardDateShort(drafted) : "";
    return `✦ agent${date ? ` · ${date}` : ""}`;
  }
  if (state === "edited") return "✎ edited";
  return "";
}

function intentionCardEditorRowButton(doc, host, target, selected) {
  const button = intentionCardEditorCreateEl(doc, "button", "bob-intention-row");
  if (!button) return null;
  button.setAttribute("type", "button");
  button.setAttribute("data-intention-key", target.key);
  if (target.arrangeId) button.setAttribute("data-arrange-id", target.arrangeId);
  if (selected) button.setAttribute("aria-current", "true");
  const keycap = target.kind === "intention" && target.index < 9
    ? `${target.index + 1} ` : target.kind === "add" ? "+ " : "";
  const provenance = target.kind === "summary" && target.value
    ? intentionCardEditorProvenance(target.summaryState, target.summaryDrafted) : "";
  const label = provenance ? `${target.label} ${provenance}` : target.label;
  intentionCardEditorSetText(button, `${keycap}${label}${target.value ? ` — ${target.value.slice(0, 80)}` : ""}`);
  host.appendChild(button);
  return button;
}

// The current summary, read-only, as context above the Summary and
// Reflection stages.
function intentionCardEditorSummaryContext(doc, fields) {
  const context = intentionCardEditorCreateEl(doc, "div", "bob-intention-stage-context");
  if (!context) return null;
  context.setAttribute("data-intention-context", "summary");
  const head = intentionCardEditorCreateEl(doc, "span", "bob-intention-stage-context-label");
  const provenance = fields && fields.summary ? intentionCardEditorProvenance(fields.summaryState, fields.summaryDrafted) : "";
  intentionCardEditorSetText(head, provenance ? `Summary · ${provenance}` : "Summary");
  context.appendChild(head);
  const body = intentionCardEditorCreateEl(doc, "p", "bob-intention-stage-current");
  intentionCardEditorSetText(body, fields && fields.summary ? fields.summary : "No summary yet.");
  if (!(fields && fields.summary)) body.setAttribute("data-empty", "true");
  context.appendChild(body);
  return context;
}

// The card editor mirrors the card's identity: the same leaf tile and
// species word as the day or period card. Omitted when the kit is missing.
function intentionCardEditorIdentityRow(doc, options) {
  try {
    if (typeof propertyCardBuildIdentityBadge !== "function"
      || typeof intentionCardIdentity !== "function" || typeof intentionCardSubjectForPath !== "function") return null;
    const subject = intentionCardSubjectForPath(options.subjectPath || "");
    const identity = intentionCardIdentity(subject);
    if (!identity) return null;
    const row = intentionCardEditorCreateEl(doc, "div", "bob-intention-editor-identity");
    if (!row) return null;
    row.setAttribute("data-card-kind", identity.kind);
    const badge = propertyCardBuildIdentityBadge(doc, {
      kind: identity.kind, band: identity.tile.band, value: identity.tile.value,
    });
    if (!badge) return null;
    row.appendChild(badge);
    return row;
  } catch (_) {
    return null;
  }
}

function intentionCardEditorPaintAll(host, options, doc, modal) {
  while (host.firstChild) host.removeChild(host.firstChild);
  const identity = intentionCardEditorIdentityRow(doc, options);
  if (identity) host.appendChild(identity);
  const title = intentionCardEditorCreateEl(doc, "h2", "bob-intention-editor-title");
  intentionCardEditorSetText(title, `Edit intentions · ${options.subject || options.subjectPath}`);
  host.appendChild(title);

  const list = intentionCardEditorCreateEl(doc, "div", "bob-intention-editor-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Intention fields");
  for (const target of options.targets) {
    intentionCardEditorRowButton(doc, list, target, target.key === options.selectedKey);
  }
  host.appendChild(list);

  if (options.softCapHint) {
    const hint = intentionCardEditorCreateEl(doc, "p", "bob-intention-editor-hint");
    intentionCardEditorSetText(hint, options.softCapHint);
    host.appendChild(hint);
  }

  if (options.stage) {
    const stageHost = intentionCardEditorCreateEl(doc, "div", "bob-intention-editor-stage");
    stageHost.setAttribute("data-intention-stage", options.stage.kind);
    const label = intentionCardEditorCreateEl(doc, "label", "bob-intention-stage-label");
    const target = intentionCardEditorTargetByKey(options.targets, options.stage.field);
    const stageName = options.stage.field === "add" ? "New intention" : target ? target.label : "Edit";
    const keys = options.stage.kind === "reflection"
      ? "Enter saves · Shift+Enter new line · Ctrl+Enter saves and closes · Esc cancels"
      : "Enter saves · Esc cancels";
    intentionCardEditorSetText(label, `${stageName} · ${keys}`);
    stageHost.appendChild(label);
    if ((options.stage.kind === "summary" || options.stage.kind === "reflection") && options.fields) {
      const context = intentionCardEditorSummaryContext(doc, options.fields);
      if (context) stageHost.appendChild(context);
    }
    const reflection = options.stage.kind === "reflection";
    const input = reflection
      ? intentionCardEditorCreateEl(doc, "textarea", "bob-intention-stage-input is-reflection")
      : intentionCardEditorCreateEl(doc, "input", "bob-intention-stage-input");
    if (input) {
      input.setAttribute("data-intention-input", options.stage.kind);
      if (reflection) input.setAttribute("rows", "3");
      input.setAttribute("aria-label", stageName);
      input.value = String(options.stageDraft || "");
      stageHost.appendChild(input);
    }
    if (options.stageNote) {
      const note = intentionCardEditorCreateEl(doc, "p", "bob-intention-stage-note");
      intentionCardEditorSetText(note, options.stageNote);
      stageHost.appendChild(note);
    }
    const save = intentionCardEditorCreateEl(doc, "button", "bob-intention-stage-save");
    save.setAttribute("type", "button");
    save.setAttribute("data-intention-action", "save-stage");
    intentionCardEditorSetText(save, "Save");
    stageHost.appendChild(save);
    host.appendChild(stageHost);
  }

  const status = intentionCardEditorCreateEl(doc, "p", "bob-intention-editor-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const model = options.status;
  if (model.retained) status.setAttribute("data-intention-retry", model.retained.intent?.kind || "retry");
  intentionCardEditorSetText(status, [model.announce, model.refusalMessage, model.refusalHint]
    .filter(Boolean).join(" · ") || intentionCardEditorStatusFallback(model));
  host.appendChild(status);
}

// The reflection textarea grows with its content on entry, input, paste, and
// repaint; CSS caps it and scrolls beyond the cap. Selection is untouched.
function intentionCardEditorAutogrow(input) {
  try {
    if (!input || input.getAttribute?.("data-intention-input") !== "reflection" || !input.style) return false;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.style.height = "auto";
    const border = Math.max(0, Number(input.offsetHeight || 0) - Number(input.clientHeight || 0));
    const content = Number(input.scrollHeight || 0);
    const height = Math.max(INTENTION_CARD_EDITOR_REFLECTION_MIN_PX, content + border);
    input.style.height = `${height}px`;
    if (Number.isInteger(start) && Number.isInteger(end)
      && (input.selectionStart !== start || input.selectionEnd !== end)
      && typeof input.setSelectionRange === "function") {
      input.setSelectionRange(start, end);
    }
    return true;
  } catch (_) {
    return false;
  }
}
