// Pure note-stage normalization, write planning, and preview copy. This file
// deliberately has no Obsidian dependencies so the rules can be tested in Node.

const BANK_NOTE_WRITE_REFUSAL = "Bank: couldn't place the note safely — nothing written";
const BANK_NOTE_TASK_REFUSAL = "Bank: #task is not allowed in a row note";
const BANK_NOTE_STRUCTURED_REFUSAL = "Bank: this note has links or fields — edit it on the row";

function bankNoteNormalize(text) {
  const original = String(text === null || text === undefined ? "" : text);
  let value = original;
  const changes = [];
  const changed = (from, to, why) => changes.push({ from, to, why });

  const compact = value.replace(/[\t\r\n\s]+/g, " ").trim();
  if (compact !== value) {
    changed("whitespace", "single spaces", "one line per row");
    value = compact;
  }
  if (/(^|\s)#task(?=$|\s|[.,!?;:)\]}])/i.test(value)) {
    return { ok: false, text: value, changes, refusal: BANK_NOTE_TASK_REFUSAL };
  }
  const marker = value.match(/^(?:—|--)(?:\s+|$)/);
  if (marker) {
    const next = value.slice(marker[0].length).trimStart();
    changed(marker[0].trim(), "", "the caption adds the dash");
    value = next;
  }
  const substitutions = [
    [/!!/g, "‼", "!!", "‼", "!! would flag the row"],
    [/⚑/g, "⚐", "⚑", "⚐", "⚑ would flag the row"],
    [/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2", "[[target|alias]]", "alias", "links in notes would be learned into future imports"],
    [/\[\[([^\]]+)\]\]/g, "$1", "[[target]]", "target", "links in notes would be learned into future imports"],
    [/\[([A-Za-z][A-Za-z0-9_-]*)\s*::\s*([^\]]*)\]/g, "($1: $2)", "[k:: v]", "(k: v)", "fields belong to the row"],
    [/(^|[\s([{])#([\p{L}_][\p{L}\p{N}_/-]*)/gu, "$1$2", "#tag", "tag", "tags in notes are not supported yet"],
    [/%%/g, "%", "%%", "%", "%% opens a comment that hides text"],
    [/<!--/g, "< !--", "<!--", "< !--", "an HTML comment would hide text"],
  ];
  for (const [pattern, replacement, from, to, why] of substitutions) {
    const next = value.replace(pattern, replacement);
    if (next !== value) {
      changed(from, to, why);
      value = next;
    }
  }
  if (/(^|\s)#task(?=$|\s|[.,!?;:)\]}])/i.test(value)) {
    return { ok: false, text: value, changes, refusal: BANK_NOTE_TASK_REFUSAL };
  }
  const blockId = value.match(/\^([A-Za-z0-9_-]+)\s*$/);
  if (blockId) {
    const next = value.slice(0, blockId.index) + `^ ${blockId[1]}`;
    if (next !== value) {
      changed(`^${blockId[1]}`, `^ ${blockId[1]}`, "it would become the row's block ID");
      value = next;
    }
  }
  return { ok: true, text: value, changes, refusal: null };
}

function bankNoteStableTokens(token) {
  return {
    status: token.status,
    cents: token.cents,
    payee: token.payee,
    category: token.category ? token.category.key : null,
    account: token.account ? token.account.alias : null,
    extraFields: (token.extraFields || []).map((field) => [field.key, field.value]),
    flagged: token.flagged,
    links: (token.links || []).map((link) => link.text),
    bankId: token.bankId,
    customId: token.customId,
  };
}

function bankNoteWritePlan(input = {}) {
  const capture = input.capture && typeof input.capture === "object" ? input.capture : null;
  const normalized = bankNoteNormalize(input.text);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid-note", message: normalized.refusal, changes: normalized.changes };
  }
  const resolved = bankCategoryResolveForCommit(capture, input.currentPath, input.currentSource);
  if (!resolved.ok) return resolved;
  const { line, raw, token } = resolved;
  if (token.note && !token.noteEditable) {
    return { ok: false, reason: "structured-note", message: BANK_NOTE_STRUCTURED_REFUSAL, changes: normalized.changes };
  }

  const note = normalized.text || null;
  let action = "noop";
  let fromCh = raw.length;
  let toCh = raw.length;
  let insert = "";
  if (token.note && note) {
    if (token.note === note) {
      return { ok: true, line, lineText: raw, action, edits: [], note, changes: normalized.changes };
    }
    action = "replace";
    fromCh = token.noteSpan.start;
    toCh = token.noteSpan.end;
    insert = note;
  } else if (token.note && !note) {
    action = "remove";
    const marker = token.noteMarkerSpan;
    fromCh = marker ? marker.start : token.noteSpan.start;
    while (fromCh > 0 && /[ \t]/.test(raw[fromCh - 1])) fromCh -= 1;
    toCh = token.noteSpan.end;
  } else if (!token.note && note) {
    action = "insert";
    const id = token.bankIdSpan || token.customIdSpan;
    fromCh = id ? id.start : raw.trimEnd().length;
    toCh = fromCh;
    // Keep the existing separator before an ID and add one after the note.
    insert = id ? `— ${note} ` : ` — ${note}`;
  }
  const planned = raw.slice(0, fromCh) + insert + raw.slice(toCh);
  let after = null;
  try { after = bankTokenizeLine(planned); } catch (error) { after = null; }
  const expectedNote = action === "remove" ? null : note;
  if (!after || after.note !== expectedNote ||
      JSON.stringify(bankNoteStableTokens(token)) !== JSON.stringify(bankNoteStableTokens(after))) {
    return { ok: false, reason: "unsafe-round-trip", message: BANK_NOTE_WRITE_REFUSAL, changes: normalized.changes };
  }
  const edits = action === "noop" ? [] : [{ line, fromCh, toCh, insert }];
  return { ok: true, line, lineText: planned, action, edits, note: expectedNote, changes: normalized.changes };
}

function bankNoteStagePreview(input = {}) {
  const editable = input.editable !== false;
  const normalized = bankNoteNormalize(input.draft);
  const existing = String(input.existingNote === null || input.existingNote === undefined ? "" : input.existingNote);
  let refusal = normalized.ok ? null : normalized.refusal;
  if (!editable) refusal = BANK_NOTE_STRUCTURED_REFUSAL;
  const text = normalized.ok ? normalized.text : String(input.draft === null || input.draft === undefined ? "" : input.draft);
  let action = "noop";
  if (!refusal) {
    if (!existing && text) action = "insert";
    else if (existing && text !== existing) action = text ? "replace" : "remove";
  }
  const copy = {
    insert: ["Adds a note · stays on this row", "↵ save · esc back"],
    replace: ["Updates the note · stays on this row", "↵ save · esc back"],
    remove: ["Removes the note", "↵ remove note · esc back"],
    noop: ["No change", "↵ back · esc back"],
  }[action];
  return { action, text, changes: normalized.changes, refusal, consequence: copy[0], keys: copy[1] };
}
