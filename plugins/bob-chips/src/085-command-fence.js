// The `bob-run` sequence card for Live Preview and Reading view. One
// `registerMarkdownCodeBlockProcessor("bob-run", …)` covers both, as the
// `bob-copy` card does. The card mounts through the same command-chip
// runtime as inline chips: one paint model, one run store keyed by the
// resolved signature, and one activation path (commandChipActivate), so its
// Run button and ⌘↵ can never disagree. Only the header button runs; body
// clicks select text. Rendering never resolves a fresh catalog, spawns,
// copies, or writes.
const COMMAND_FENCE_EFFECT_RANK = copyChipFreeze({ reads: 1, writes: 2, syncs: 3 });
const COMMAND_FENCE_MARKS = copyChipFreeze([
  "idle", "queued", "current", "upcoming", "done", "attention", "stopped", "unknown", "failed", "skipped",
]);
// Text glyphs per step mark; queued and current paint Lucide icons so the
// current step spins like the header.
const COMMAND_FENCE_MARK_TEXT = copyChipFreeze({
  idle: "", upcoming: "○", done: "✓", attention: "◐", stopped: "■", unknown: "?", failed: "✗", skipped: "–",
});
const COMMAND_FENCE_MARK_ICON = copyChipFreeze({ queued: "queued", current: "running" });
const COMMAND_FENCE_MARK_LABEL = copyChipFreeze({
  idle: "", queued: "queued", current: "running", upcoming: "not run yet", done: "done",
  attention: "needs attention", stopped: "stopped", unknown: "unknown outcome", failed: "failed", skipped: "skipped",
});
const COMMAND_FENCE_OUTCOME_LABEL = copyChipFreeze({
  completed: "done", attention: "needs attention", stopped: "stopped", interrupted: "interrupted",
  unknown: "unknown outcome", refused: "refused", failed: "failed",
});
const commandFenceRecords = new WeakMap();
let commandFenceSeq = 0;

// Display-only step texts for a payload Command Mode has not resolved
// (loading, copy-only, refused): one step per non-blank line, split at
// unquoted `&&` with the resolver's quoting (single quotes literal, double
// quotes and bare words honor backslash escapes). Never throws.
function commandFenceSplitSteps(text) {
  try {
    const out = [];
    for (const line of String(text === undefined || text === null ? "" : text).split(/\r\n|\r|\n/)) {
      let quote = null;
      let escaped = false;
      let start = 0;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (escaped) {
          escaped = false;
        } else if (quote === "'") {
          if (char === "'") quote = null;
        } else if (char === "\\") {
          escaped = true;
        } else if (quote === "\"") {
          if (char === "\"") quote = null;
        } else if (char === "'" || char === "\"") {
          quote = char;
        } else if (char === "&" && line[index + 1] === "&") {
          out.push(line.slice(start, index));
          start = index + 2;
          index += 1;
        }
      }
      out.push(line.slice(start));
    }
    return copyChipFreeze(out.map((part) => part.trim()).filter((part) => part !== ""));
  } catch (error) {
    return copyChipFreeze([]);
  }
}

function commandFenceStepWord(count) {
  return count === 1 ? "1 step" : String(count) + " steps";
}

// The strongest resolved step effect (reads < writes < syncs), or null.
function commandFenceEffect(steps) {
  let best = null;
  for (const step of Array.isArray(steps) ? steps : []) {
    const effect = step && typeof step.effect === "string" ? step.effect : null;
    if (effect && COMMAND_FENCE_EFFECT_RANK[effect] && (!best || COMMAND_FENCE_EFFECT_RANK[effect] > COMMAND_FENCE_EFFECT_RANK[best])) {
      best = effect;
    }
  }
  return best;
}

function commandFenceMarkFor(outcome) {
  if (outcome === "completed") return "done";
  if (outcome === "attention") return "attention";
  if (outcome === "stopped" || outcome === "interrupted") return "stopped";
  if (outcome === "unknown") return "unknown";
  return "failed";
}

function commandFenceOutcomeLabel(outcome, face) {
  return COMMAND_FENCE_OUTCOME_LABEL[outcome] || COMMAND_FENCE_OUTCOME_LABEL[face] || "failed";
}

// "m:ss", as Command Mode's sequence summary prints step durations.
function commandFenceClock(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return "";
  const seconds = Math.floor(durationMs / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

function commandFenceRow(index, text, mark, fields) {
  const f = fields || {};
  const settled = mark !== "idle" && mark !== "queued" && mark !== "current" && mark !== "upcoming" && mark !== "skipped";
  const reason = mark === "done" ? "" : commandChipFirstLine(f.reason);
  return copyChipFreeze({
    index,
    text,
    mark,
    duration: settled ? commandFenceClock(f.durationMs) : "",
    reason,
    runId: f.runId && mark !== "done" && settled ? String(f.runId) : null,
  });
}

// Per-step marks from the face and the run snapshot.
function commandFenceRows(texts, face, paint) {
  const snapshot = (paint && paint.snapshot) || {};
  const verdict = paint && paint.verdict;
  const total = texts.length;
  const settled = new Map();
  for (const row of Array.isArray(snapshot.steps) ? snapshot.steps : []) {
    if (row && Number(row.index) > 0) settled.set(Number(row.index), row);
  }
  const live = face === "queued" || face === "running";
  const current = live ? Math.min(total, Math.max(1, Number(snapshot.step) || 1)) : 0;
  const stop = Number(snapshot.stoppedAt) > 0 ? Number(snapshot.stoppedAt) : null;
  const halt = stop !== null ? stop : settled.size === 0 && face !== "completed" ? Math.max(1, Number(snapshot.step) || 1) : null;
  return copyChipFreeze(texts.map((text, offset) => {
    const index = offset + 1;
    if (face === "unavailable") {
      const failing = verdict && Number(verdict.step) === index;
      return commandFenceRow(index, text, failing ? "failed" : "idle", failing ? { reason: verdict.reason } : null);
    }
    if (!live && face !== "completed" && face !== "attention" && face !== "failed") return commandFenceRow(index, text, "idle");
    const row = settled.get(index);
    if (row) return commandFenceRow(index, text, commandFenceMarkFor(row.outcome), row);
    if (live) {
      if (index === current) return commandFenceRow(index, text, face === "queued" ? "queued" : "current");
      return commandFenceRow(index, text, index < current ? "done" : "upcoming");
    }
    if (face === "completed") return commandFenceRow(index, text, "done");
    if (halt !== null && index === halt) {
      return commandFenceRow(index, text, commandFenceMarkFor(snapshot.outcome || face), {
        reason: snapshot.reason, runId: snapshot.runId,
      });
    }
    return commandFenceRow(index, text, halt !== null && index < halt ? "done" : "skipped");
  }));
}

function commandFenceMeta(face, rows, paint) {
  const total = rows.length;
  const snapshot = (paint && paint.snapshot) || {};
  const verdict = paint && paint.verdict;
  if (face === "queued") return total > 1 ? "queued · " + (Number(snapshot.step) || 1) + " of " + total : "queued";
  if (face === "running") {
    return total > 1 ? Math.min(total, Math.max(1, Number(snapshot.step) || 1)) + " of " + total : "running";
  }
  if (face === "completed") return "done";
  if (face === "attention" || face === "failed") {
    const label = commandFenceOutcomeLabel(snapshot.outcome, face);
    const stop = Number(snapshot.stoppedAt) > 0 ? Number(snapshot.stoppedAt) : null;
    if (stop !== null && total > 1) return "stopped at " + stop + " · " + label;
    if (total > 1 && face === "attention") return "finished · " + label;
    return label;
  }
  if (face === "unavailable") return commandFenceStepWord(total) + " · can't run";
  if (face === "copy" || face === "loading") return commandFenceStepWord(total);
  const steps = verdict && verdict.state === "ready" && Array.isArray(verdict.steps) ? verdict.steps : [];
  const effect = commandFenceEffect(steps);
  const asks = steps.some((step) => step && step.policy === "confirm");
  return commandFenceStepWord(total) + (effect ? " · " + effect : "") + (asks ? " · asks first" : "");
}

function commandFenceReasonLine(face, paint) {
  const reason = commandChipFirstLine(paint && paint.reason);
  if (face === "copy") return "Copy only" + (reason ? ": " + reason : "");
  if (face === "unavailable") {
    const step = paint && paint.verdict && Number(paint.verdict.step) > 0 ? " (step " + Number(paint.verdict.step) + ")" : "";
    return "Can't run: " + (reason || "command could not be resolved") + step;
  }
  return "";
}

// What one card shows for `chip` ({ label, text }) under `paint` (from
// commandChipPaintModel; null paints Loading). Pure and frozen:
// `{ face, title, meta, reason, button, sequence, rows }`, each row
// `{ index, text, mark, duration, reason, runId }`. Never throws.
function commandFenceModel(chip, paint) {
  try {
    const text = chip && typeof chip.text === "string" ? chip.text : "";
    const p = paint && typeof paint === "object" ? paint : { face: "loading", verdict: null, snapshot: null, reason: null };
    const face = COMMAND_CHIP_FACES.includes(p.face) ? p.face : "loading";
    const verdict = p.verdict;
    const resolved = face !== "copy" && verdict && verdict.state === "ready" && Array.isArray(verdict.steps) && verdict.steps.length
      ? verdict.steps.map((step) => String((step && step.text) || ""))
      : commandFenceSplitSteps(text);
    const rows = commandFenceRows(resolved, face, p);
    const label = chip && typeof chip.label === "string" && chip.label.trim() !== "" ? chip.label : null;
    return copyChipFreeze({
      face,
      title: label || "Run · " + commandFenceStepWord(rows.length),
      meta: commandFenceMeta(face, rows, p),
      reason: commandFenceReasonLine(face, p),
      button: face === "copy" ? "Copy" : face === "queued" || face === "running" ? "Output" : "Run",
      sequence: rows.length > 1,
      rows,
    });
  } catch (error) {
    return copyChipFreeze({ face: "loading", title: "Run", meta: "", reason: "", button: "Run", sequence: false, rows: copyChipFreeze([]) });
  }
}

function commandFenceEl(doc, tag, className, text) {
  return commandChipEl(doc, tag, className, text);
}

// Builds one card. `chip` is `{ label, text }`. The payload travels only
// through text nodes and the record WeakMap, never attributes or
// innerHTML. `options.interactive === false` builds an inert preview (the
// author card) whose buttons are aria-hidden spans. Never registers
// gestures; returns the card or null. Paint it with commandFencePaint.
function commandFenceBuild(doc, chip, options) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !chip || typeof chip !== "object") return null;
    if (typeof chip.text !== "string") return null;
    if (chip.label !== null && chip.label !== undefined && typeof chip.label !== "string") return null;
    const interactive = !(options && options.interactive === false);
    const card = commandFenceEl(doc, "div", "bob-run-fence");
    const header = commandFenceEl(doc, "div", "bob-run-fence-header");
    // The glyph carries the copy-chip glyph class so copy-only clicks reuse
    // the copy feedback unchanged.
    const glyph = commandFenceEl(doc, "span", "bob-run-fence-glyph bob-copy-chip-glyph");
    const title = commandFenceEl(doc, "span", "bob-run-fence-title");
    const meta = commandFenceEl(doc, "span", "bob-run-fence-meta");
    const button = commandFenceEl(doc, interactive ? "button" : "span", "bob-run-fence-run");
    const reason = commandFenceEl(doc, "div", "bob-run-fence-reason is-empty");
    const body = commandFenceEl(doc, "div", "bob-run-fence-body");
    if (!card || !header || !glyph || !title || !meta || !button || !reason || !body) return null;
    commandFenceSeq += 1;
    const ids = { title: "bob-run-fence-title-" + commandFenceSeq, button: "bob-run-fence-run-" + commandFenceSeq };
    commandChipSetAttr(glyph, "aria-hidden", "true");
    commandChipSetAttr(title, "id", ids.title);
    if (interactive) {
      commandChipSetAttr(button, "type", "button");
      commandChipSetAttr(button, "id", ids.button);
      commandChipSetAttr(button, "aria-labelledby", ids.button + " " + ids.title);
    } else {
      commandChipSetAttr(button, "aria-hidden", "true");
    }
    header.appendChild(glyph);
    header.appendChild(title);
    header.appendChild(meta);
    header.appendChild(button);
    card.appendChild(header);
    card.appendChild(reason);
    card.appendChild(body);
    commandFenceRecords.set(card, {
      text: chip.text,
      label: chip.label === undefined ? null : chip.label,
      interactive,
      plugin: null,
      glyph,
      title,
      meta,
      button,
      reason,
      body,
      rows: [],
      rowsSignature: null,
      glyphFace: null,
    });
    commandFencePaint(card, null, { chip });
    return card;
  } catch (error) {
    return null;
  }
}

function commandFencePayloadOf(card) {
  try {
    const record = card ? commandFenceRecords.get(card) : null;
    return record ? record.text : null;
  } catch (error) {
    return null;
  }
}

function commandFenceButtonOf(card) {
  try {
    const record = card ? commandFenceRecords.get(card) : null;
    return record ? record.button : null;
  } catch (error) {
    return null;
  }
}

// Open one settled step's output. A deliberate click only: the engine is
// looked up fresh, and opening output never starts a run.
function commandFenceOpenStepOutput(record, rowRecord, event) {
  try {
    commandChipPrevent(event);
    const runId = rowRecord && rowRecord.runId;
    const app = record && record.plugin && record.plugin.app;
    if (!runId || !app) return;
    commandChipOpenOutput(commandChipEngineOf(app).engine, runId);
  } catch (error) {
    // Opening output never throws.
  }
}

function commandFenceBuildRows(record, rows) {
  const doc = record.body.ownerDocument || null;
  commandChipSetText(record.body, "");
  record.rows = rows.map((row) => {
    const el = commandFenceEl(doc, "div", "bob-run-fence-step");
    const num = commandFenceEl(doc, "span", "bob-run-fence-num", String(row.index));
    const mark = commandFenceEl(doc, "span", "bob-run-fence-mark");
    const label = commandFenceEl(doc, "span", "bob-run-fence-mark-label");
    const text = commandFenceEl(doc, "span", "bob-run-fence-text", row.text);
    const duration = commandFenceEl(doc, "span", "bob-run-fence-duration");
    const detail = commandFenceEl(doc, "div", "bob-run-fence-detail is-empty");
    const why = commandFenceEl(doc, "span", "bob-run-fence-why");
    const output = commandFenceEl(doc, record.interactive ? "button" : "span", "bob-run-fence-output is-hidden", "Output");
    commandChipSetAttr(num, "aria-hidden", "true");
    commandChipSetAttr(mark, "aria-hidden", "true");
    if (record.interactive) commandChipSetAttr(output, "type", "button");
    else commandChipSetAttr(output, "aria-hidden", "true");
    for (const child of [num, mark, label, text, duration]) el.appendChild(child);
    detail.appendChild(why);
    detail.appendChild(output);
    el.appendChild(detail);
    record.body.appendChild(el);
    const rowRecord = { el, mark, label, duration, detail, why, output, markFace: null, runId: null };
    if (record.interactive && typeof output.addEventListener === "function") {
      output.addEventListener("mousedown", (event) => commandChipPrevent(event));
      output.addEventListener("click", (event) => commandFenceOpenStepOutput(record, rowRecord, event));
    }
    return rowRecord;
  });
}

function commandFencePaintRow(rowRecord, row) {
  if (rowRecord.markFace !== row.mark) {
    rowRecord.markFace = row.mark;
    for (const mark of COMMAND_FENCE_MARKS) commandChipSetClass(rowRecord.el, "is-" + mark, mark === row.mark);
    const icon = COMMAND_FENCE_MARK_ICON[row.mark];
    if (icon) {
      commandChipSetText(rowRecord.mark, "");
      copyChipPaintGlyph(rowRecord.mark, commandChipIconFor(icon));
    } else {
      commandChipRemoveAttr(rowRecord.mark, "data-copy-chip-icon");
      commandChipSetText(rowRecord.mark, COMMAND_FENCE_MARK_TEXT[row.mark] || "");
    }
    commandChipSetText(rowRecord.label, COMMAND_FENCE_MARK_LABEL[row.mark] || "");
  }
  commandChipSetText(rowRecord.duration, row.duration);
  commandChipSetText(rowRecord.why, row.reason);
  rowRecord.runId = row.runId;
  commandChipSetClass(rowRecord.output, "is-hidden", !row.runId);
  commandChipSetClass(rowRecord.detail, "is-empty", !row.reason && !row.runId);
}

// Repaint `card` in place from a frozen paint model (null paints Loading).
// Rows rebuild only when the step texts change; marks change in place, so
// the current step's spinner never restarts. Returns true when painted.
function commandFencePaint(card, paint, options) {
  try {
    const record = card ? commandFenceRecords.get(card) : null;
    if (!record) return false;
    const opts = options && typeof options === "object" ? options : {};
    if (opts.plugin) record.plugin = opts.plugin;
    const chip = opts.chip || { label: record.label, text: record.text };
    const model = commandFenceModel(chip, paint);
    const face = model.face;
    if (face !== "copy" && copyChipFeedbackTimers.has(card)) {
      copyChipClearFeedback(card);
      record.glyphFace = null;
    }
    const copyFeedback = copyChipFeedbackTimers.has(card);
    for (const name of COMMAND_CHIP_FACES) {
      if (name === "failed" && face === "copy" && copyFeedback) continue;
      commandChipSetClass(card, "is-" + name, name === face);
    }
    commandChipSetClass(card, "is-sequence", model.sequence);
    if (record.glyphFace !== face && !(face === "copy" && copyFeedback)) {
      copyChipPaintGlyph(record.glyph, commandChipIconFor(face));
      record.glyphFace = face;
    }
    commandChipSetText(record.title, model.title);
    commandChipSetText(record.meta, model.meta);
    if (!copyChipFenceButtonTimers.has(record.button)) commandChipSetText(record.button, model.button);
    commandChipSetText(record.reason, model.reason);
    commandChipSetClass(record.reason, "is-empty", !model.reason);
    const signature = JSON.stringify(model.rows.map((row) => row.text));
    if (signature !== record.rowsSignature) {
      record.rowsSignature = signature;
      commandFenceBuildRows(record, model.rows);
    }
    model.rows.forEach((row, index) => {
      if (record.rows[index]) commandFencePaintRow(record.rows[index], row);
    });
    if (face === "queued" || face === "running") commandChipSetAttr(card, "aria-busy", "true");
    else commandChipRemoveAttr(card, "aria-busy");
    return true;
  } catch (error) {
    return false;
  }
}

// Every `bob-run` fence in `markdown`, in note order: frozen
// `{ label, text, open, close }` with zero-based line indexes (`close` is
// null for an unclosed fence). Other fences are skipped whole, so a
// `bob-run` sample inside a ```markdown fence never counts. A fence inside
// a blockquote or callout is read through one `>` level. Never throws.
function commandFenceCollect(markdown) {
  const out = [];
  try {
    const lines = String(markdown === undefined || markdown === null ? "" : markdown).split("\n").map((line) => line.replace(/\r$/, ""));
    let stripped = null;
    for (let index = 0; index < lines.length; index += 1) {
      let view = lines;
      let opening = copyChipFenceOpeningFromLine(lines[index]);
      if (!opening && /^[ \t]*>/.test(lines[index])) {
        if (!stripped) stripped = lines.map((line) => line.replace(/^[ \t]*>[ \t]?/, ""));
        opening = copyChipFenceOpeningFromLine(stripped[index]);
        view = stripped;
      }
      if (!opening) continue;
      const closeAt = copyChipScanFenceClose(view, index, opening);
      const block = { openIndex: index, opening, closeIndex: closeAt < 0 ? null : closeAt };
      const body = chipFenceBlockBody(view, block, runChipParseFenceInfo);
      if (body) out.push(copyChipFreeze({ label: body.label, text: body.text, open: index, close: block.closeIndex }));
      if (closeAt < 0) break;
      index = closeAt;
    }
  } catch (error) {
    return copyChipFreeze(out);
  }
  return copyChipFreeze(out);
}

// Where this card's fence sits: frozen `{ label, open, close }`. Section
// info wins (the fence within the section whose body equals the payload);
// otherwise the open editor's text, when exactly one fence there holds the
// payload. Unknown placement is `{ label: null, open: null, close: null }`:
// the generic title, no ⌘↵ identity, and a whole-note source check.
function commandFencePlace(plugin, ctx, el, payload) {
  const unknown = copyChipFreeze({ label: null, open: null, close: null });
  try {
    const pick = (fences) => {
      const matches = fences.filter((fence) => copyChipFencePayloadEquals(fence.text, payload));
      return matches.length === 1 ? copyChipFreeze({ label: matches[0].label, open: matches[0].open, close: matches[0].close }) : null;
    };
    const section = commandChipReadingSection(ctx, el);
    if (section) {
      const inside = commandFenceCollect(section.text).filter((fence) => fence.open >= section.lineStart && fence.open <= section.lineEnd);
      const placed = pick(inside);
      if (placed) return placed;
    }
    const markdown = copyChipFenceMarkdownFromPlugin(plugin, ctx);
    if (typeof markdown === "string") {
      const placed = pick(commandFenceCollect(markdown));
      if (placed) return placed;
    }
    return unknown;
  } catch (error) {
    return unknown;
  }
}

// The note's freshest text: an open editor's buffer (unsaved edits count),
// else the vault's; null when the note is gone; undefined without a way to
// tell (no evidence).
async function commandFenceReadSource(render) {
  const path = commandChipReadingSourcePath(render);
  const markdown = copyChipFenceMarkdownFromPlugin(render.plugin, { sourcePath: path });
  if (typeof markdown === "string") return markdown;
  return commandChipReadingReadText(render.app, path);
}

// Fresh activation evidence: the fence at the rendered opening line still
// holds the payload (or, with unknown placement, some `bob-run` fence in
// the note does).
async function commandFenceCheckSource(render, record) {
  let text;
  try {
    text = await commandFenceReadSource(render);
  } catch (error) {
    return commandChipSourceVerdict(false);
  }
  if (text === undefined) return commandChipSourceVerdict(true);
  if (typeof text !== "string") return commandChipSourceVerdict(false, COMMAND_CHIP_READING_SOURCE_GONE);
  const fences = commandFenceCollect(text).filter((fence) => copyChipFencePayloadEquals(fence.text, record.payload));
  const found = record.place.open === null ? fences.length > 0 : fences.some((fence) => fence.open === record.place.open);
  return commandChipSourceVerdict(found, record.place.open === null ? COMMAND_CHIP_READING_SOURCE_GONE : COMMAND_CHIP_SOURCE_CHANGED);
}

// Copy-only feedback on the card and its button.
function commandFenceCopyFeedback(card, button, written) {
  if (written && written.ok) {
    copyChipShowFeedback(card, "success");
    copyChipFenceFlashButton(button, "Copied ✓", COPY_CHIP_SUCCESS_MS);
  } else {
    copyChipFail(card, (written && written.reason) || "copy failed");
    copyChipFenceFlashButton(button, "Copy failed", COPY_CHIP_FAILURE_MS);
  }
}

// The renderer's fresh activation context. Origin is read from the code
// block's ancestors (its own `block-language-bob-run` element is skipped)
// at every paint and activation, like Reading buttons.
function commandFenceContext(card, record) {
  const render = record.render;
  const where = commandChipReadingOrigin(record.el);
  record.attached = where.attached;
  const ctx = {
    origin: where.origin === "reading" ? "fence" : where.origin,
    refresh: () => commandChipReadingRefresh(card, record),
    copyFeedback: (written) => commandFenceCopyFeedback(card, record.button, written),
  };
  const unknown = () => ({ ...ctx, resolveSourcePath: () => null });
  if (where.origin === "query") {
    ctx.sourceVerified = false;
    return ctx;
  }
  if (!where.attached && !render.section) return unknown();
  if (where.embed && commandChipReadingEmbedMismatch(render.app, where.embed, render.path)) return unknown();
  ctx.resolveSourcePath = () => commandChipReadingSourcePath(render);
  if (record.place.open !== null) ctx.line = record.place.open;
  ctx.checkSource = () => commandFenceCheckSource(render, record);
  return ctx;
}

function commandFenceUnmount(card, record) {
  try {
    if (record) {
      record.disposed = true;
      for (const cleanup of record.cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          // Cleanup is best-effort.
        }
      }
      copyChipFenceClearButtonTimer(record.button);
    }
    return commandChipUnmount(card);
  } catch (error) {
    return false;
  }
}

// One processor render: payload from `source`, label and lines from the
// section, then the mounted card replaces the code block. Never throws and
// never writes the vault.
function commandFenceRender(plugin, source, el, ctx) {
  try {
    if (!el) return null;
    const doc = el.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.createElement !== "function") return null;
    const payload = copyChipFencePayloadFromSource(source);
    const place = commandFencePlace(plugin, ctx, el, payload);
    const card = commandFenceBuild(doc, { label: place.label, text: payload });
    if (!card) return null;
    try {
      if (typeof el.empty === "function") el.empty();
      else el.textContent = "";
      el.appendChild(card);
    } catch (error) {
      return null;
    }
    const render = commandChipReadingRenderState(plugin, el, ctx);
    const record = { render, el, payload, place, button: commandFenceButtonOf(card), attached: null, disposed: false, cleanups: [] };
    const chip = {
      form: "block",
      label: place.label,
      text: payload,
      line: place.open,
      from: 0,
      to: 0,
      fence: place.open === null ? null : { open: place.open, close: place.close },
    };
    commandChipMount(plugin, card, chip, {
      context: () => commandFenceContext(card, record),
      paint: commandFencePaint,
      gestureHost: record.button,
    });
    commandChipReadingWatchAttach(card, record);
    const cleanup = () => commandFenceUnmount(card, record);
    if (CopyChipsMarkdownRenderChild && ctx && typeof ctx.addChild === "function") {
      const child = new CopyChipsMarkdownRenderChild(el);
      if (typeof child.register === "function") {
        child.register(cleanup);
      } else {
        const previous = child.onunload;
        child.onunload = function onunload() {
          cleanup();
          return typeof previous === "function" ? previous.call(this) : undefined;
        };
      }
      ctx.addChild(child);
    } else if (plugin && typeof plugin.register === "function") {
      plugin.register(cleanup);
    }
    return card;
  } catch (error) {
    return null;
  }
}

function commandFenceSetup(plugin) {
  try {
    if (!plugin || typeof plugin.registerMarkdownCodeBlockProcessor !== "function") return false;
    if (plugin.commandChipFenceSetupDone === true) return true;
    plugin.commandChipFenceSetupDone = true;
    plugin.registerMarkdownCodeBlockProcessor("bob-run", (source, el, ctx) => {
      commandFenceRender(plugin, source, el, ctx);
    });
    return true;
  } catch (error) {
    return false;
  }
}
