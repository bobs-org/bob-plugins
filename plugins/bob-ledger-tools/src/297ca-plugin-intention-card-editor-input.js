// Intention card editor input behavior: stage focus and caret, one-line paste
// normalization, and the generation-only retry. Browse mode keeps focus on its
// row buttons; an explicitly opened stage owns focus with the caret at the end.
// Repaints rebuild the stage input, so a focused caret is carried across them.
const INTENTION_CARD_EDITOR_PASTE_NOTE = "Line breaks became spaces — an intention is one line.";

// Caret of the focused stage input before a repaint, or null.
function intentionCardEditorCaptureCaret(modal, doc) {
  try {
    const input = modal?.contentEl?.querySelector?.("[data-intention-input]");
    if (!input || !doc || doc.activeElement !== input) return null;
    return {
      kind: input.getAttribute?.("data-intention-input") || "",
      start: Number.isInteger(input.selectionStart) ? input.selectionStart : null,
      end: Number.isInteger(input.selectionEnd) ? input.selectionEnd : null,
    };
  } catch (_) {
    return null;
  }
}

// Focus after a paint: the stage input when a stage is open (caret restored,
// else at the end), otherwise the selected browse row.
function intentionCardEditorFocus(modal, caret = null) {
  try {
    const card = modal?.contentEl?.querySelector?.(".bob-intention-card-editor");
    if (!card) return false;
    if (modal.stage) {
      const input = card.querySelector?.("[data-intention-input]");
      if (!input || typeof input.focus !== "function") return false;
      input.focus();
      const length = String(input.value || "").length;
      const same = caret && caret.kind === modal.stage.kind;
      const start = same && Number.isInteger(caret.start) ? Math.min(caret.start, length) : length;
      const end = same && Number.isInteger(caret.end) ? Math.min(caret.end, length) : length;
      if (typeof input.setSelectionRange === "function") input.setSelectionRange(start, end);
      return true;
    }
    const row = card.querySelector?.(`[data-intention-key="${modal.selectedKey}"]`);
    if (row && typeof row.focus === "function") {
      row.focus();
      return true;
    }
  } catch (_) {}
  return false;
}

// Retired: pasted line breaks in the one-line intention and summary stages now
// fold through the shared soft-line field (`bobSoftLineAttach`), so a paste is
// never handled twice. Kept as a no-op so existing callers stay green.
function intentionCardEditorPaste(modal, event) {
  return false;
}

// An empty-op dry run reads malformed frontmatter as `ok` with warnings and
// empty fields. Invalid YAML and malformed stored intentions are refusals for
// the editor and for YAML Done; the four-intention soft cap stays advisory.
function intentionCardEditorBlockingWarning(report) {
  const warnings = report && Array.isArray(report.warnings) ? report.warnings : [];
  return warnings.find((warning) => {
    const code = String(warning && warning.code || "");
    return code === "frontmatter_invalid" || (code.startsWith("intentions_") && code !== "intentions_over_soft_cap");
  }) || null;
}

function intentionCardEditorApplyBlockingWarning(modal, report) {
  const warning = intentionCardEditorBlockingWarning(report);
  if (!modal || !warning) return false;
  modal.malformed = true;
  modal.writable = false;
  modal.stage = null;
  modal.statusKind = "refusal";
  modal.refusalMessage = String(warning.message || "The intention fields on this note are malformed.");
  modal.refusalHint = "Press y to repair the frontmatter in Source, then Done.";
  modal.paintIntentionCard();
  return true;
}

// The guarded session also refuses when the vault generation moves between
// preview and apply — including the event from the card's own pane save, as
// when a body-only edit in another pane is flushed first. Bob's field
// fingerprint is the conflict guard, so a generation-only refusal re-previews
// and applies again (bounded); a real field change still returns stale_note.
const INTENTION_CARD_EDITOR_GENERATION_RETRIES = 3;
const INTENTION_CARD_EDITOR_GENERATION_CODES = new Set(["stale_generation", "save-invalidated", "superseded-during-save"]);

function intentionCardEditorGenerationOnly(result) {
  return Boolean(result && result.ok !== true && INTENTION_CARD_EDITOR_GENERATION_CODES.has(String(result.code || "")));
}

// Returns { preview, applied } (applied absent when the preview refused), or
// { superseded: true } once the caller's request is no longer live.
async function intentionCardEditorPreviewApply(session, live) {
  let preview = null;
  let applied = null;
  for (let attempt = 0; attempt < INTENTION_CARD_EDITOR_GENERATION_RETRIES; attempt += 1) {
    preview = await session.previewNow();
    if (!live()) return { superseded: true };
    if (intentionCardEditorGenerationOnly(preview)) continue;
    if (!preview || preview.ok !== true || !preview.report || preview.report.ok !== true) return { preview };
    applied = await session.apply();
    if (!live()) return { superseded: true };
    if (!intentionCardEditorGenerationOnly(applied)) return { preview, applied };
  }
  return applied ? { preview, applied } : { preview };
}

// Status line when nothing is announced or refused: progress words and the
// browse keys, never a raw internal state name.
const INTENTION_CARD_EDITOR_BROWSE_KEYS = "j/k move · Enter edit · o add · r reflect · Alt+J/K reorder · Ctrl+D remove · u undo · [ ] = travel · y YAML";

function intentionCardEditorStatusFallback(model) {
  const kind = model && model.statusKind;
  if (kind === "reading") return INTENTION_CARD_EDITOR_READING_TEXT;
  if (kind === "saving") return INTENTION_CARD_EDITOR_SAVING_TEXT;
  if (model && model.stage) return "";
  return model && model.writable === false ? "Read-only · [ ] = travel · y YAML" : INTENTION_CARD_EDITOR_BROWSE_KEYS;
}
