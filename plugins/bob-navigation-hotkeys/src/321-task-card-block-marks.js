// Task Card blocked-reason marks (bob-cli-ft task_card).
// Owned by bob-cli `docs/blocked-marks.md`. For a single Blocked target the
// header's BLOCKED lane chip carries the api.blockMarks v1 miniature plus a
// compact reason list (the touch and mobile path, where hover tooltips do
// not exist), and the P1-P4 strip shows a decorative hollow digit box
// beside each level's bars as the teaching moment that ties the checkbox
// digit to the strip. Everything here is display-only: without
// bob-ledger-tools or the api the card looks exactly as it does today.
// Every function is synchronous and never throws.
function getLedgerBlockMarksApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api =
      plugins &&
      plugins["bob-ledger-tools"] &&
      plugins["bob-ledger-tools"].api;
    const marks = api && api.blockMarks;
    if (!marks || typeof marks !== "object") {
      return null;
    }
    if (typeof marks.version !== "number" || marks.version < 1) {
      return null;
    }
    if (typeof marks.model !== "function") {
      return null;
    }
    if (typeof marks.render !== "function") {
      return null;
    }
    return marks;
  } catch (error) {
    return null;
  }
}

// Resolve the block-marks api for Task Card contexts and view options,
// mirroring the priority-marks pattern: an explicit `blockMarks` member
// wins when it can both classify and render, otherwise fall back to the
// live ledger plugin behind `app`.
function resolveTaskCardBlockMarksApi(settings) {
  try {
    const value = settings && typeof settings === "object" ? settings : {};
    const direct = value.blockMarks;
    if (
      direct &&
      typeof direct === "object" &&
      typeof direct.model === "function" &&
      typeof direct.render === "function"
    ) {
      return direct;
    }
    return getLedgerBlockMarksApi(value.app);
  } catch (error) {
    return null;
  }
}

// Stored-value to teaching digit for the P1-P4 strip. Only canonical
// ladder values get a digit; off-ladder values (`highest`, `High`, `P2`)
// show a hollow `?` on the row itself, so the strip shows no digit for
// them either.
const TASK_CARD_BLOCK_DIGIT_BY_VALUE = Object.freeze({
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
});

// Extract the `short date · relative` words for a date reason from the
// model's tooltip, so the card repeats the tooltip grammar verbatim
// instead of reformatting the ISO date a second way. Returns "" when the
// tooltip carries no date line. Never throws.
function taskCardBlockUntilWords(tooltip) {
  try {
    const lines = String(tooltip || "").split("\n");
    for (const line of lines) {
      const text = String(line || "").trim();
      let match =
        /^Blocked · (?:P[1-4] deferral · )?until (.+)$/.exec(text) ||
        /^Recurring · next run (.+)$/.exec(text) ||
        /^Also scheduled (.+)$/.exec(text);
      if (match) {
        return String(match[1] || "").trim();
      }
    }
  } catch (error) {
    // No date words; the caller falls back to the raw date text.
  }
  return "";
}

// The awaiting-reply tooltip line (`Awaiting reply from Ada · nudge …`,
// or its losing `Also awaiting reply …` form) as a reason line:
// `awaiting reply from Ada · nudge …`. Returns "" when the tooltip carries
// no awaiting line. Never throws.
function taskCardBlockAwaitingWords(tooltip) {
  try {
    const lines = String(tooltip || "").split("\n");
    for (const line of lines) {
      const match = /^(?:Also )?[Aa](waiting reply\b.*)$/.exec(
        String(line || "").trim(),
      );
      if (match) {
        return `a${match[1]}`;
      }
    }
  } catch (error) {
    // No awaiting words; the caller falls back to the raw date text.
  }
  return "";
}

// Compact reason list for the header: every reason, winner first, in the
// tooltip words. `after <text>` runs one line per open prerequisite, up to
// 3, then a `+N more` overflow line; then `via project <stem>`; then
// `awaiting reply from <who> · nudge <short date> · <relative>`; then
// `until <short date> · <relative>`. Frozen, possibly empty (stale).
function taskCardBlockReasonLines(mark) {
  try {
    const model = mark && typeof mark === "object" ? mark : {};
    const reasons = Array.isArray(model.reasons) ? model.reasons : [];
    const lines = [];
    const deps = reasons.filter(
      (reason) => reason && reason.kind === "dep",
    );
    let shown = 0;
    let dateShown = false;
    for (const reason of reasons) {
      if (!reason || typeof reason !== "object") {
        continue;
      }
      if (reason.kind === "dep") {
        if (shown < 3) {
          lines.push(`after ${String(reason.text || "").trim()}`);
        }
        shown += 1;
      } else if (reason.kind === "prj") {
        lines.push(`via project ${String(reason.text || "").trim()}`);
      } else if (reason.kind === "awaiting") {
        const words = taskCardBlockAwaitingWords(model.tooltip);
        lines.push(
          words || `awaiting reply · nudge ${String(reason.text || "").trim()}`,
        );
      } else if (reason.kind === "date" && !dateShown) {
        const words = taskCardBlockUntilWords(model.tooltip);
        lines.push(`until ${words || String(reason.text || "").trim()}`);
        dateShown = true;
      }
    }
    if (deps.length > 3) {
      lines.push(`+${deps.length - 3} more`);
    }
    return Object.freeze(lines);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Header-model half of the Task Card block mark. Returns a frozen
// `{ key, family, digit, more, reasons, tooltip, reasonLines }` for a
// single Blocked target, or null for batches, other lanes, and every
// fallback case (no api, neutral model). Never throws.
function buildTaskCardBlockedHeader(session, filePath, blockMarks) {
  try {
    if (!blockMarks || typeof blockMarks.model !== "function") {
      return null;
    }
    if (!session || session.valid === false) {
      return null;
    }
    if (session.type !== "single") {
      return null;
    }
    const targets = Array.isArray(session.targets) ? session.targets : [];
    if (targets.length !== 1) {
      return null;
    }
    const target = targets[0] && typeof targets[0] === "object"
      ? targets[0]
      : {};
    const rawLine = String(target.rawLine || session.lineText || "");
    if (getObsidianTaskCheckboxStatus(rawLine) !== "?") {
      return null;
    }
    const path = String(target.path || filePath || "");
    let mark = null;
    try {
      mark = blockMarks.model(rawLine, { path });
    } catch (error) {
      mark = null;
    }
    if (!mark || typeof mark !== "object") {
      return null;
    }
    const reasons = Array.isArray(mark.reasons)
      ? mark.reasons
          .filter((reason) => reason && typeof reason === "object")
          .map((reason) =>
            Object.freeze({
              kind: String(reason.kind || ""),
              key: String(reason.key || ""),
              text: String(reason.text || ""),
            }),
          )
      : [];
    const normalized = {
      key: String(mark.key || ""),
      family: String(mark.family || ""),
      digit: Number.isInteger(mark.digit) ? mark.digit : null,
      more: typeof mark.more === "string" ? mark.more : null,
      tooltip: String(mark.tooltip || ""),
    };
    if (
      [
        "dep",
        "prj",
        "awaiting",
        "p1",
        "p2",
        "p3",
        "p4",
        "repeat",
        "date",
        "stale",
      ].indexOf(
        normalized.key,
      ) === -1
    ) {
      return null;
    }
    return Object.freeze({
      ...normalized,
      reasons: Object.freeze(reasons),
      reasonLines: taskCardBlockReasonLines({
        reasons,
        tooltip: normalized.tooltip,
      }),
    });
  } catch (error) {
    return null;
  }
}

// Render the miniature block mark at the start of the header's BLOCKED
// lane chip and label the chip with the tooltip words for hover. The mark
// is meaningful (role="img" comes from the shared renderer), and the chip
// keeps its BLOCKED text. Returns true when the mark rendered, false when
// the caller should keep today's plain chip.
function renderTaskCardBlockedChipMark(chipEl, blocked, options) {
  try {
    if (!blocked || typeof blocked !== "object" || !blocked.key) {
      return false;
    }
    const api = resolveTaskCardBlockMarksApi(options);
    if (!api || typeof api.render !== "function") {
      return false;
    }
    if (!chipEl || typeof chipEl.createSpan !== "function") {
      return false;
    }
    const host = chipEl.createSpan({ cls: "bob-task-card-chip-mark" });
    let rendered = null;
    try {
      rendered = api.render(host, blocked, {});
    } catch (error) {
      rendered = null;
    }
    if (!rendered) {
      try {
        if (typeof host.remove === "function") {
          host.remove();
        } else if (chipEl && Array.isArray(chipEl.children)) {
          const index = chipEl.children.indexOf(host);
          if (index >= 0) {
            chipEl.children.splice(index, 1);
          }
        }
      } catch (error) {
        // Glyph cleanup never throws.
      }
      return false;
    }
    if (blocked.tooltip) {
      try {
        chipEl.setAttribute("title", blocked.tooltip);
        chipEl.setAttribute("aria-label", `BLOCKED. ${blocked.tooltip}`);
      } catch (error) {
        // Tooltip is best-effort.
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Compact reason list below the header chips. Listener-free text lines;
// the container repeats the tooltip for hover. No-op without lines.
function renderTaskCardBlockReasonList(container, blocked) {
  try {
    if (!container || typeof container.createDiv !== "function") {
      return null;
    }
    if (!blocked || typeof blocked !== "object") {
      return null;
    }
    const lines = Array.isArray(blocked.reasonLines)
      ? blocked.reasonLines
      : [];
    if (lines.length === 0) {
      return null;
    }
    const list = container.createDiv({
      cls: "bob-task-card-block-reasons",
      attr: blocked.tooltip ? { title: blocked.tooltip } : {},
    });
    if (blocked.tooltip && typeof list.setAttribute === "function") {
      list.setAttribute("title", blocked.tooltip);
    }
    for (const line of lines) {
      list.createDiv({
        cls: "bob-task-card-block-reason",
        text: String(line || ""),
      });
    }
    return list;
  } catch (error) {
    return null;
  }
}

// Decorative hollow digit box beside a P1-P4 level's signal bars, using a
// synthetic `p<n>` model through the shared renderer. Runs only when the
// api is present; without it the label is unchanged. Returns true when the
// digit rendered.
function renderTaskCardBlockDigit(labelEl, value, options) {
  try {
    const api = resolveTaskCardBlockMarksApi(options);
    if (!api || typeof api.render !== "function") {
      return false;
    }
    const digit = TASK_CARD_BLOCK_DIGIT_BY_VALUE[String(value || "")];
    if (!Number.isInteger(digit)) {
      return false;
    }
    if (!labelEl || typeof labelEl.createSpan !== "function") {
      return false;
    }
    const host = labelEl.createSpan({ cls: "bob-task-card-level-digit" });
    let rendered = null;
    try {
      rendered = api.render(
        host,
        { key: `p${digit}`, family: "waiting" },
        { decorative: true },
      );
    } catch (error) {
      rendered = null;
    }
    if (!rendered) {
      try {
        if (typeof host.remove === "function") {
          host.remove();
        } else if (labelEl && Array.isArray(labelEl.children)) {
          const index = labelEl.children.indexOf(host);
          if (index >= 0) {
            labelEl.children.splice(index, 1);
          }
        }
      } catch (error) {
        // Glyph cleanup never throws.
      }
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}
