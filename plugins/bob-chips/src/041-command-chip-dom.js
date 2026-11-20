// The shared command-chip face: one `.bob-run-chip` builder and one in-place
// painter for Live Preview widgets and Reading buttons. The payload lives in
// a WeakMap and in DOM text only, never in innerHTML or an attribute. The
// painter only reads a frozen commandChipPaintModel; it never resolves,
// spawns, copies, or writes.
const COMMAND_CHIP_FACES = copyChipFreeze([
  "ready", "armed", "loading", "queued", "running", "completed", "attention", "failed", "unavailable", "copy",
]);
// Lucide names per face, first known name wins (`loader-circle` was
// `loader-2` in older Lucide builds).
const COMMAND_CHIP_GLYPHS = copyChipFreeze({
  ready: ["play"],
  armed: ["play"],
  loading: ["play"],
  queued: ["hourglass"],
  running: ["loader-circle", "loader-2", "loader"],
  completed: ["check"],
  attention: ["play"],
  failed: ["play"],
  unavailable: ["ban"],
  copy: ["copy"],
});
const COMMAND_CHIP_SHIFT_HINT = "⇧Click opens Command Mode";
const COMMAND_CHIP_EDIT_HINT = " · ⌥Click edits";

let CommandChipsGetIcon = null;
try {
  const obsidian = require("obsidian");
  if (obsidian && typeof obsidian.getIcon === "function") CommandChipsGetIcon = obsidian.getIcon;
} catch (error) {
  CommandChipsGetIcon = null;
}

const commandChipDomRecords = new WeakMap();
const commandChipIconChoice = new Map();
let commandChipDomSeq = 0;

function commandChipIconFor(face) {
  const names = COMMAND_CHIP_GLYPHS[face] || COMMAND_CHIP_GLYPHS.ready;
  if (commandChipIconChoice.has(face)) return commandChipIconChoice.get(face);
  let chosen = names[0];
  if (typeof CommandChipsGetIcon === "function") {
    for (const name of names) {
      try {
        if (CommandChipsGetIcon(name)) {
          chosen = name;
          break;
        }
      } catch (error) {
        // An unknown icon falls through to the next name.
      }
    }
  }
  commandChipIconChoice.set(face, chosen);
  return chosen;
}

function commandChipFirstLine(text) {
  const line = String(text === undefined || text === null ? "" : text).split(/\r\n|\r|\n/).find((part) => /\S/.test(part));
  return line ? line.trim() : "";
}

// A later step's leading `bob` word becomes the faint `›` separator.
function commandChipLaterStepText(text) {
  const value = String(text);
  return /^bob(?:\s|$)/.test(value) ? value.replace(/^bob\s*/, "") : value;
}

// What the face shows, from the chip and its verdict: a label (with a step
// count once resolved), the resolved step texts, or the verbatim payload
// while loading, copy-only, or refused. Frozen `{ form, label, count, parts }`.
function commandChipFaceModel(chip, verdict) {
  try {
    const text = chip && typeof chip.text === "string" ? chip.text : "";
    const steps = verdict && verdict.state === "ready" && Array.isArray(verdict.steps) ? verdict.steps : null;
    if (chip && chip.label !== null && chip.label !== undefined) {
      return copyChipFreeze({ form: "label", label: String(chip.label), count: steps ? steps.length : 0, parts: copyChipFreeze([]) });
    }
    if (steps && steps.length) {
      const parts = steps.map((step, index) => {
        const stepText = step && typeof step.text === "string" ? step.text : "";
        return index === 0 ? stepText : commandChipLaterStepText(stepText);
      });
      return copyChipFreeze({ form: "steps", label: null, count: steps.length, parts: copyChipFreeze(parts) });
    }
    return copyChipFreeze({ form: "verbatim", label: null, count: 0, parts: copyChipFreeze([text]) });
  } catch (error) {
    return copyChipFreeze({ form: "verbatim", label: null, count: 0, parts: copyChipFreeze([""]) });
  }
}

// The face as one line of text, for announcements.
function commandChipFaceName(faceModel) {
  if (!faceModel) return "";
  if (faceModel.form === "label") return faceModel.label;
  return faceModel.parts.join(" › ");
}

// One honest line about what a click does, from the resolved steps.
function commandChipPolicyText(verdict) {
  try {
    const steps = verdict && verdict.state === "ready" && Array.isArray(verdict.steps) ? verdict.steps : [];
    if (!steps.length) return null;
    const confirm = steps.find((step) => step && step.policy === "confirm");
    if (confirm) return "Asks first: " + String(confirm.confirm || "This command needs confirmation.");
    if (steps.length === 1 && steps[0].presentation === "report") return "Opens its output";
    const skips = steps.some((step) => step && step.policy === "preview-first" && step.hasPreview);
    if (steps.length === 1) return "Runs now" + (skips ? " · skips its preview" : "");
    return "Runs " + steps.length + " steps now" + (skips ? " · skips previews" : "");
  } catch (error) {
    return null;
  }
}

// The gesture line. A keyboard binding is advertised only once the keymap
// phase sets `plugin.commandChipRunHotkey` from the live binding.
function commandChipHintText(plugin, face) {
  if (face === "copy") return "Click to copy";
  if (face === "unavailable") return "Click to see why";
  if (face === "queued" || face === "running") return "Click opens its output";
  let hotkey = null;
  try {
    const value = plugin && plugin.commandChipRunHotkey;
    hotkey = typeof value === "string" && value.trim() ? value.trim() : null;
  } catch (error) {
    hotkey = null;
  }
  const verb = face === "attention" || face === "failed" ? " to run again" : " to run";
  return (hotkey ? "Click or " + hotkey + verb : "Click" + verb) + " · " + COMMAND_CHIP_SHIFT_HINT;
}

function commandChipStateLine(paint) {
  const face = paint && paint.face;
  const snapshot = (paint && paint.snapshot) || {};
  const reason = commandChipFirstLine(paint && paint.reason);
  const step = paint && paint.verdict && Number(paint.verdict.step) > 1 ? " (step " + Number(paint.verdict.step) + ")" : "";
  if (face === "copy") return "Copy only" + (reason ? ": " + reason : "");
  if (face === "loading") return "Loading bob's command catalog";
  if (face === "unavailable") return "Can't run: " + (reason || "command could not be resolved") + step;
  if (face === "queued") return "Queued";
  if (face === "running") {
    return Number(snapshot.total) > 1 ? "Running step " + (Number(snapshot.step) || 1) + " of " + Number(snapshot.total) : "Running";
  }
  if (face === "completed") return "Completed";
  if (face === "attention") return "Needs attention" + (reason ? ": " + reason : "");
  if (face === "failed") return "Failed" + (reason ? ": " + reason : "");
  return null;
}

// Tooltip rows: state, the full command line(s), policy, gestures.
// `editable` appends the Alt+Click edit gesture (Live Preview only).
function commandChipTipRows(plugin, chip, paint, editable) {
  const rows = [];
  const state = commandChipStateLine(paint);
  if (state) rows.push(["state", state]);
  const verdict = paint && paint.verdict;
  const steps = paint && paint.face !== "copy" && verdict && verdict.state === "ready" && Array.isArray(verdict.steps)
    ? verdict.steps
    : null;
  if (steps && steps.length) {
    for (const step of steps) rows.push(["command", String((step && step.text) || "")]);
  } else {
    rows.push(["command", String((chip && chip.text) || "")]);
  }
  const policy = paint && paint.face !== "copy" && paint.face !== "unavailable" ? commandChipPolicyText(verdict) : null;
  if (policy) rows.push(["policy", policy]);
  rows.push(["hint", commandChipHintText(plugin, paint && paint.face) + (editable === true ? COMMAND_CHIP_EDIT_HINT : "")]);
  return rows;
}

function commandChipSetText(el, text) {
  try {
    el.textContent = String(text);
  } catch (error) {
    // Text setup is best-effort on fake nodes.
  }
}

function commandChipEl(doc, tag, className, text) {
  const el = copyChipMakeEl(doc, tag, className);
  if (el && text !== undefined) commandChipSetText(el, text);
  return el;
}

function commandChipSetAttr(el, name, value) {
  try {
    if (el && typeof el.setAttribute === "function") el.setAttribute(name, String(value));
  } catch (error) {
    // Attributes are best-effort.
  }
}

function commandChipRemoveAttr(el, name) {
  try {
    if (el && typeof el.removeAttribute === "function") el.removeAttribute(name);
    else if (el && el.attrs && typeof el.attrs.delete === "function") el.attrs.delete(name);
  } catch (error) {
    // Attributes are best-effort.
  }
}

function commandChipSetClass(el, name, on) {
  try {
    if (!el || !el.classList) return;
    if (on) el.classList.add(name);
    else el.classList.remove(name);
  } catch (error) {
    // Class changes are best-effort.
  }
}

function commandChipSetStyleVar(el, name, value) {
  try {
    const style = el && el.style;
    if (!style) return;
    if (value === null) {
      if (typeof style.removeProperty === "function") style.removeProperty(name);
      else delete style[name];
    } else if (typeof style.setProperty === "function") {
      style.setProperty(name, value);
    } else {
      style[name] = value;
    }
  } catch (error) {
    // Progress paint is best-effort.
  }
}

// Builds one inert face. `chip` is `{ label, text }`; `options.interactive`
// selects a real <button type="button"> (Reading), otherwise a focusable
// span with role button (Live Preview). Never registers gestures and never
// throws: bad input yields null. Paint it with commandChipPaint.
function commandChipBuildInline(doc, chip, options) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !chip || typeof chip !== "object") return null;
    const text = chip.text;
    if (typeof text !== "string" || !/\S/.test(text)) return null;
    const opts = options && typeof options === "object" ? options : {};
    const interactive = Boolean(opts.interactive);
    const labeled = chip.label !== null && chip.label !== undefined;
    const host = copyChipMakeEl(doc, interactive ? "button" : "span", "bob-run-chip" + (labeled ? " is-labeled" : " is-literal"));
    if (!host) return null;
    if (interactive) commandChipSetAttr(host, "type", "button");
    else {
      commandChipSetAttr(host, "role", "button");
      commandChipSetAttr(host, "tabindex", "0");
    }
    commandChipDomSeq += 1;
    const ids = {
      action: "bob-run-chip-action-" + commandChipDomSeq,
      face: "bob-run-chip-face-" + commandChipDomSeq,
      tip: "bob-run-chip-tip-" + commandChipDomSeq,
    };
    // The glyph also carries the copy-chip glyph class, so copy-only clicks
    // reuse the copy chips' feedback unchanged.
    const glyph = commandChipEl(doc, "span", "bob-run-chip-glyph bob-copy-chip-glyph");
    const action = commandChipEl(doc, "span", "bob-run-chip-action", "Run");
    const face = commandChipEl(doc, "span", "bob-run-chip-face");
    const tip = commandChipEl(doc, "span", "bob-run-chip-tip");
    if (!glyph || !action || !face || !tip) return null;
    commandChipSetAttr(glyph, "aria-hidden", "true");
    commandChipSetAttr(action, "id", ids.action);
    commandChipSetAttr(face, "id", ids.face);
    commandChipSetAttr(tip, "id", ids.tip);
    commandChipSetAttr(tip, "role", "tooltip");
    host.appendChild(glyph);
    host.appendChild(face);
    host.appendChild(action);
    host.appendChild(tip);
    commandChipSetAttr(host, "aria-labelledby", ids.action + " " + ids.face);
    commandChipSetAttr(host, "aria-describedby", ids.tip);
    commandChipDomRecords.set(host, {
      text,
      label: labeled ? String(chip.label) : null,
      glyph,
      action,
      face,
      tip,
      steps: [],
      glyphFace: null,
      faceSignature: null,
      tipSignature: null,
      progress: null,
    });
    commandChipPaint(host, null, { chip });
    return host;
  } catch (error) {
    return null;
  }
}

// The payload a built face carries, for tests and renderers. Never an
// attribute: a WeakMap lookup.
function commandChipPayloadOf(el) {
  try {
    const record = el ? commandChipDomRecords.get(el) : null;
    return record ? record.text : null;
  } catch (error) {
    return null;
  }
}

function commandChipPaintFace(record, faceModel) {
  const signature = JSON.stringify(faceModel);
  if (record.faceSignature === signature) return;
  record.faceSignature = signature;
  const faceEl = record.face;
  commandChipSetText(faceEl, "");
  record.steps = [];
  const doc = faceEl.ownerDocument || null;
  if (faceModel.form === "label") {
    faceEl.appendChild(commandChipEl(doc, "span", "bob-run-chip-label", faceModel.label));
    if (faceModel.count > 1) faceEl.appendChild(commandChipEl(doc, "span", "bob-run-chip-count", " · " + faceModel.count));
    return;
  }
  faceModel.parts.forEach((part, index) => {
    if (index > 0) faceEl.appendChild(commandChipEl(doc, "span", "bob-run-chip-sep", " › "));
    const stepEl = commandChipEl(doc, "span", "bob-run-chip-step", part);
    faceEl.appendChild(stepEl);
    record.steps.push(stepEl);
  });
}

function commandChipPaintTip(record, rows) {
  const signature = JSON.stringify(rows);
  if (record.tipSignature === signature) return;
  record.tipSignature = signature;
  const tipEl = record.tip;
  commandChipSetText(tipEl, "");
  const doc = tipEl.ownerDocument || null;
  for (const [kind, text] of rows) {
    tipEl.appendChild(commandChipEl(doc, "span", "bob-run-chip-tip-row is-" + kind, text));
  }
}

// The 2 px segmented underline: one segment per step, done in green, the
// current step in the run ink, upcoming faint. Theme variables only.
function commandChipProgressGradient(step, total) {
  const n = Math.max(1, Math.floor(Number(total) || 1));
  const current = Math.min(n, Math.max(1, Math.floor(Number(step) || 1)));
  const gap = n > 1 ? Math.min(2, 30 / n) : 0;
  const stops = [];
  for (let index = 0; index < n; index += 1) {
    const color = index + 1 < current
      ? "var(--color-green)"
      : index + 1 === current ? "var(--bob-run-chip-ink, var(--interactive-accent))" : "var(--text-faint)";
    const from = (index * 100) / n;
    const to = ((index + 1) * 100) / n - (index + 1 < n ? gap : 0);
    stops.push(color + " " + from.toFixed(2) + "% " + to.toFixed(2) + "%");
    if (index + 1 < n) stops.push("transparent " + to.toFixed(2) + "% " + (((index + 1) * 100) / n).toFixed(2) + "%");
  }
  return "linear-gradient(to right, " + stops.join(", ") + ")";
}

// Repaint `host` in place from a frozen paint model. Only what changed is
// touched: the glyph icon is replaced only when the face changes, so a
// running spinner never restarts between steps. A null paint shows Loading.
function commandChipPaint(host, paint, options) {
  try {
    const record = host ? commandChipDomRecords.get(host) : null;
    if (!record) return false;
    const opts = options && typeof options === "object" ? options : {};
    const chip = opts.chip || { label: record.label, text: record.text };
    const p = paint && typeof paint === "object" ? paint : { face: "loading", verdict: null, snapshot: null, reason: null };
    const face = COMMAND_CHIP_FACES.includes(p.face) ? p.face : "loading";
    if (face !== "copy" && copyChipFeedbackTimers.has(host)) {
      // Copy feedback from a copy-only click must not outlive the copy face.
      copyChipClearFeedback(host);
      record.glyphFace = null;
    }
    const copyFeedback = copyChipFeedbackTimers.has(host);
    for (const name of COMMAND_CHIP_FACES) {
      // A copy failure borrows `is-failed` for its dwell; keep it.
      if (name === "failed" && face === "copy" && copyFeedback) continue;
      commandChipSetClass(host, "is-" + name, name === face);
    }
    const snapshot = p.snapshot || {};
    const total = Number(snapshot.total) || 0;
    const faceModel = commandChipFaceModel(chip, p.verdict);
    commandChipSetClass(host, "is-sequence", total > 1 || faceModel.count > 1);
    if (record.glyphFace !== face && !(face === "copy" && copyFeedback)) {
      copyChipPaintGlyph(record.glyph, commandChipIconFor(face));
      record.glyphFace = face;
    }
    commandChipSetText(record.action, face === "copy" ? "Copy" : "Run");
    commandChipPaintFace(record, faceModel);
    const running = face === "running" && total > 1;
    const current = running ? Math.min(total, Math.max(1, Number(snapshot.step) || 1)) : 0;
    record.steps.forEach((stepEl, index) => {
      commandChipSetClass(stepEl, "is-done", running && index + 1 < current);
      commandChipSetClass(stepEl, "is-current", running && index + 1 === current);
    });
    const progress = running ? commandChipProgressGradient(current, total) : null;
    if (progress !== record.progress) {
      record.progress = progress;
      commandChipSetClass(host, "has-progress", progress !== null);
      commandChipSetStyleVar(host, "--bob-run-progress", progress);
    }
    if (face === "queued" || face === "running") commandChipSetAttr(host, "aria-busy", "true");
    else commandChipRemoveAttr(host, "aria-busy");
    commandChipPaintTip(record, commandChipTipRows(opts.plugin || null, chip, p, opts.editable === true));
    return true;
  } catch (error) {
    return false;
  }
}

// Polite announcements, once per run transition however many faces show
// the same run. Keyed per runtime so a reload starts fresh.
const commandChipAnnounced = new WeakMap();
const COMMAND_CHIP_ANNOUNCE_MAX = 256;

function commandChipAnnouncement(face, name) {
  if (face === "running") return "Running " + name;
  if (face === "completed") return name + " finished";
  if (face === "attention") return name + " needs attention";
  if (face === "failed") return name + " failed";
  return null;
}

function commandChipAnnounceTransition(plugin, paint, chip, doc) {
  try {
    const runtime = commandChipRuntimeOf(plugin);
    const snapshot = paint && paint.snapshot;
    if (!runtime || !snapshot || !snapshot.seq) return false;
    const message = commandChipAnnouncement(paint.face, copyChipPreviewText(commandChipFaceName(commandChipFaceModel(chip, paint.verdict))));
    if (!message) return false;
    let seen = commandChipAnnounced.get(runtime);
    if (!seen) {
      seen = new Map();
      commandChipAnnounced.set(runtime, seen);
    }
    const mark = snapshot.seq + ":" + paint.face;
    if (seen.get(paint.key) === mark) return false;
    seen.delete(paint.key);
    seen.set(paint.key, mark);
    while (seen.size > COMMAND_CHIP_ANNOUNCE_MAX) seen.delete(seen.keys().next().value);
    copyChipAnnounce(doc || (typeof document !== "undefined" ? document : null), message);
    return true;
  } catch (error) {
    return false;
  }
}
