// Bob Command Mode: live status-bar run indicator. Runner state stays authoritative.
// Brand indicator: icon-led ring plus `bob`, count, and clock. Model is pure;
// paint is idempotent and never recreates the spinning mark.

function cmChipRevealMs() {
  return typeof CM_CHIP_REVEAL_MS === "number" ? CM_CHIP_REVEAL_MS : 400;
}

function cmChipSettleMs() {
  return typeof CM_CHIP_SETTLE_MS === "number" ? CM_CHIP_SETTLE_MS : 1600;
}

function cmChipLeaveMs() {
  return typeof CM_CHIP_LEAVE_MS === "number" ? CM_CHIP_LEAVE_MS : 300;
}

function cmChipToastMeta() {
  if (typeof CM_TOAST_META !== "undefined" && CM_TOAST_META) return CM_TOAST_META;
  return {
    completed: { glyph: "✓", label: "Completed" },
    attention: { glyph: "◐", label: "Needs attention" },
    failed: { glyph: "✗", label: "Failed" },
    unknown: { glyph: "?", label: "Unknown · log preserved" },
    stopped: { glyph: "■", label: "Stopped" },
  };
}

function cmChipRecordAge(record, nowMs) {
  const started = record && record.started_at ? Date.parse(record.started_at) : NaN;
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, nowMs - started);
}

function cmChipIsOverdue(record, ageMs) {
  if (!record) return false;
  if (record.overdue) return true;
  const budget = Number(record.budget_secs);
  if (record.effect === "reads" || !Number.isFinite(budget) || budget <= 0) return false;
  return ageMs >= budget * 1000;
}

function cmChipShortArgv(record) {
  const args = cmRecordArgs(record);
  try {
    return cmFormatArgv(["bob", ...args]);
  } catch (error) {
    return "bob " + args.join(" ");
  }
}

function cmChipRunTitle(record) {
  return String((record && (record.title || record.entry_id)) || "bob");
}

function cmChipBudgetMins(record) {
  return Math.max(1, Math.round(Number(record.budget_secs) / 60) || 0);
}

// Pure model for the brand indicator (indicator_label = brand, indicator_runs = all).
// records: live plus adopted unfinished runs. state: {shown:Set, settle:null|{...}}.
// progressFor(runId): last progress line. Returns {visible, tone, outcome,
// label, count, clock, clockMs, tooltip, runId, runs, leaving}.
function cmStatusChipModel(records, nowMs, state, progressFor, options = {}) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const progress = typeof progressFor === "function" ? progressFor : () => "";
  const settleState = state && typeof state === "object" ? state : null;
  const settle = settleState && settleState.settle ? settleState.settle : null;
  const revealMs = cmChipRevealMs();
  const settleMs = cmChipSettleMs();
  const leaveMs = cmChipLeaveMs();
  const active = (Array.isArray(records) ? records : []).filter(
    (record) => record && (record.outcome === "running" || record.outcome === "queued"),
  );
  const ages = active.map((record) => cmChipRecordAge(record, now));

  if (active.length) {
    if (ages.every((age) => age < revealMs)) {
      return { visible: false, runs: active.length, count: active.length, runId: null };
    }
    const longest = Math.max(...ages);
    const overdue = active.some((record, index) => cmChipIsOverdue(record, ages[index]));
    const queuedOnly = active.every((record) => record && record.outcome === "queued");
    const tone = overdue ? "is-overdue" : queuedOnly ? "is-queued" : "is-running";
    const newest = active[active.length - 1];
    const count = active.length;
    const label = "bob";
    const clock = (() => {
      try {
        return cmFormatClock(longest);
      } catch (error) {
        return "0:00";
      }
    })();
    const header = count === 1 ? "bob · running" : "bob · " + count + " running";
    const ordered = [...active].reverse();
    const shownBlocks = [];
    const maxRows = 4;
    for (const record of ordered.slice(0, maxRows)) {
      const age = cmChipRecordAge(record, now);
      let clockText = "0:00";
      try {
        clockText = cmFormatClock(age);
      } catch (error) {
        clockText = "0:00";
      }
      const lines = [cmChipRunTitle(record) + " · " + clockText, cmChipShortArgv(record)];
      let suffix = "";
      if (record.outcome === "queued") suffix = "queued";
      else if (cmChipIsOverdue(record, age)) suffix = "past its ~" + cmChipBudgetMins(record) + " min budget";
      else if (record.adopted) suffix = "adopted after reload";
      if (suffix) lines[0] += " · " + suffix;
      let last = "";
      try {
        last = String(progress(record.id) || "").trim();
      } catch (error) {
        last = "";
      }
      if (last) lines.push("Last: " + last);
      else if (record.adopted && !suffix) lines[0] += " · adopted after reload";
      else if (record.adopted && suffix !== "adopted after reload" && record.outcome !== "queued" && !cmChipIsOverdue(record, age)) lines.push("adopted after reload");
      shownBlocks.push(lines.join("\n"));
    }
    if (ordered.length > maxRows) shownBlocks.push("…and " + (ordered.length - maxRows) + " more");
    shownBlocks.push("Click to open output");
    return {
      visible: true,
      tone,
      outcome: null,
      label,
      count,
      clock,
      clockMs: longest,
      tooltip: [header, ...shownBlocks].join("\n\n"),
      runId: newest.id,
      runs: active.length,
      leaving: false,
    };
  }

  if (settle && typeof settle.atMs === "number" && now - settle.atMs < settleMs) {
    const meta = cmChipToastMeta();
    const outcome = settle.outcome || "unknown";
    const entry = meta[outcome] || meta.unknown;
    let clockText = "0:00";
    try {
      clockText = cmFormatClock(settle.durationMs || 0);
    } catch (error) {
      clockText = "0:00";
    }
    const leaving = now - settle.atMs >= settleMs - leaveMs;
    const tooltip = settle.title + " · " + entry.label + " in " + clockText + "\n\nClick to open output";
    return {
      visible: true,
      tone: "is-settled",
      outcome,
      label: "bob",
      count: 1,
      clock: clockText,
      clockMs: settle.durationMs || 0,
      tooltip,
      runId: settle.runId,
      runs: 0,
      leaving,
    };
  }

  return { visible: false, runs: 0, count: 0, runId: null };
}

function cmChipEnsureChildren(element) {
  const doc = (typeof document !== "undefined" && document) || null;
  const children = Array.from(element.children || []);
  const find = (cls) => {
    for (const child of children) {
      const classes = child.classes || [];
      const className = child.className || "";
      if (classes.includes(cls) || String(className).split(/\s+/).includes(cls)) return child;
    }
    return null;
  };
  let mark = find("bob-cmd-chip-mark");
  let label = find("bob-cmd-chip-label");
  let clock = find("bob-cmd-chip-clock");
  if (mark && label && clock) return { mark, label, clock, created: false };
  const create = (cls, text) => {
    if (doc && typeof doc.createElement === "function") {
      const el = doc.createElement("span");
      el.className = cls;
      if (text !== undefined) el.textContent = text;
      return el;
    }
    if (typeof element.createEl === "function") {
      const el = element.createEl("span", { cls, text });
      // Obsidian's createEl appends immediately; keep the snapshot in sync.
      children.push(el);
      return el;
    }
    const ElementCtor = element && element.constructor;
    const el = new ElementCtor({ tag: "span", cls });
    if (text !== undefined) el.textContent = text;
    return el;
  };
  if (!mark) {
    mark = create("bob-cmd-chip-mark");
    try {
      if (typeof mark.setAttribute === "function") mark.setAttribute("aria-hidden", "true");
    } catch (error) {
      // Best effort.
    }
  }
  if (!label) label = create("bob-cmd-chip-label", "bob");
  if (!clock) clock = create("bob-cmd-chip-clock", "0:00");
  // Append in anatomy order exactly once; never reorder afterwards.
  let created = false;
  for (const node of [mark, label, clock]) {
    const present = children.includes(node);
    if (!present) {
      if (typeof element.appendChild === "function") element.appendChild(node);
      else if (typeof element.append === "function") element.append(node);
      children.push(node);
      created = true;
    }
  }
  return { mark, label, clock, created };
}

function cmChipToneClasses() {
  return ["is-running", "is-queued", "is-overdue", "is-settled", "is-completed", "is-attention", "is-failed", "is-unknown", "is-stopped", "is-leaving"];
}

function cmChipApplyTone(element, model) {
  const tones = cmChipToneClasses();
  const current = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
  for (const tone of tones) current.delete(tone);
  if (model.visible && model.tone) {
    current.add(model.tone);
    if (model.tone === "is-settled" && model.outcome) current.add("is-" + model.outcome);
    if (model.leaving) current.add("is-leaving");
  }
  const next = [...current].join(" ");
  if (element.className !== undefined) element.className = next;
  else if (element.classes) element.classes = next.split(/\s+/).filter(Boolean);
  // Keep the classList stub in sync when present.
  try {
    if (element.classList) {
      for (const tone of tones) {
        const want = model.visible && (model.tone === tone || (model.tone === "is-settled" && model.outcome && "is-" + model.outcome === tone) || (model.leaving && tone === "is-leaving"));
        if (typeof element.classList.toggle === "function") element.classList.toggle(tone, want);
        else if (want && typeof element.classList.add === "function") element.classList.add(tone);
        else if (!want && typeof element.classList.remove === "function") element.classList.remove(tone);
      }
    }
  } catch (error) {
    // Class sync is best effort.
  }
}

// Idempotent paint. Keeps the current signature with an optional trailing
// state for the preview script and old callers. Never recreates the mark.
function cmRenderStatusChip(element, records, nowMs = Date.now(), onOpen = () => {}, progressFor = () => "", state) {
  if (!element) return { visible: false, runs: 0 };
  let progressFn = progressFor;
  let chipState = state;
  if (typeof progressFn !== "function" && chipState === undefined) {
    chipState = progressFn;
    progressFn = () => "";
  }
  if (chipState && !(chipState.shown instanceof Set)) {
    try {
      chipState.shown = new Set(chipState.shown || []);
    } catch (error) {
      chipState.shown = new Set();
    }
  }
  const model = cmStatusChipModel(records, nowMs, chipState || null, progressFn);
  const active = (Array.isArray(records) ? records : []).filter(
    (record) => record && (record.outcome === "running" || record.outcome === "queued"),
  );
  // One engine, one honest busy signal: any active run replaces a settle at once.
  if (chipState && active.length && chipState.settle) chipState.settle = null;
  if (!model.visible) {
    // Expired settles clear so the next paint stays hidden.
    if (chipState && chipState.settle) {
      const settleMs = cmChipSettleMs();
      const now = typeof nowMs === "number" ? nowMs : Date.now();
      if (typeof chipState.settle.atMs !== "number" || now - chipState.settle.atMs >= settleMs) chipState.settle = null;
    }
    try {
      element.style.display = "none";
    } catch (error) {
      element.style = { display: "none" };
    }
    cmChipApplyTone(element, model);
    try {
      element.removeAttribute("title");
    } catch (error) {
      // Best effort.
    }
    return { visible: false, runs: active.length || model.runs || 0 };
  }
  if (chipState && chipState.shown instanceof Set) {
    for (const record of active) {
      if (record && record.id) chipState.shown.add(record.id);
    }
  }
  const parts = cmChipEnsureChildren(element);
  const countText = model.count > 1 ? "bob ×" + model.count : "bob";
  if (parts.label.textContent !== countText) parts.label.textContent = countText;
  if (parts.clock.textContent !== model.clock) parts.clock.textContent = model.clock;
  try {
    if (parts.mark.textContent !== (model.tone === "is-settled" ? (cmChipToastMeta()[model.outcome] || {}).glyph || "" : "")) {
      parts.mark.textContent = model.tone === "is-settled" ? (cmChipToastMeta()[model.outcome] || {}).glyph || "" : "";
    }
  } catch (error) {
    // Best effort.
  }
  cmChipApplyTone(element, model);
  try {
    element.style.display = "";
  } catch (error) {
    // Best effort.
  }
  try {
    element.removeAttribute("title");
  } catch (error) {
    // Native tooltip uses aria-label only.
  }
  try {
    element.setAttribute("aria-label", model.tooltip);
    element.setAttribute("data-tooltip-position", "top");
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
  } catch (error) {
    // Headless stubs may not store attributes.
  }
  const runId = model.runId;
  try {
    element.onclick = () => onOpen(runId);
  } catch (error) {
    // Best effort.
  }
  const overdue = model.tone === "is-overdue";
  return { visible: true, runs: model.runs || model.count, overdue, runId };
}
