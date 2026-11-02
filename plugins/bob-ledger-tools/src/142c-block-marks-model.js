// --- Blocked-reason marks: pure model ------------------------------------
// Owned by bob-cli `docs/blocked-marks.md`. These helpers only classify a
// canonical Blocked #task line; they do not render or write anything. Keep
// every helper synchronous and defensive, and reuse the existing date,
// recurrence, priority, dependency, and Tasks-status parsers.

const BLOCK_MARK_DEFAULT_DIGITS = Object.freeze({
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
});

const BLOCK_MARK_DEPENDENCY_HINT = "Ctrl+Shift+B to edit prerequisites";
const BLOCK_MARK_RESCHEDULE_HINT = "Ctrl+Shift+P to reschedule";
const BLOCK_MARK_PRIORITY_HINT =
  "Ctrl+Shift+P to reschedule or change priority";

// Replace inline code spans with spaces while preserving UTF-16 offsets. The
// matching delimiter must have the same number of backticks, as in Markdown.
// An unmatched delimiter is literal text. Never throws.
function blockMarkMaskInlineCode(lineText) {
  try {
    const text = String(lineText || "");
    const chars = text.split("");
    const escapedAt = (index) => {
      let slashes = 0;
      for (let at = index - 1; at >= 0 && text[at] === "\\"; at -= 1) {
        slashes += 1;
      }
      return slashes % 2 === 1;
    };
    let index = 0;
    while (index < text.length) {
      if (text[index] !== "`" || escapedAt(index)) {
        index += 1;
        continue;
      }
      let delimiterEnd = index + 1;
      while (text[delimiterEnd] === "`") delimiterEnd += 1;
      const delimiterLength = delimiterEnd - index;
      let closeStart = -1;
      let searchAt = delimiterEnd;
      while (searchAt < text.length) {
        const next = text.indexOf("`", searchAt);
        if (next === -1) break;
        let nextEnd = next + 1;
        while (text[nextEnd] === "`") nextEnd += 1;
        if (
          nextEnd - next === delimiterLength &&
          (next === 0 || text[next - 1] !== "`") &&
          (nextEnd === text.length || text[nextEnd] !== "`")
        ) {
          closeStart = next;
          break;
        }
        searchAt = nextEnd;
      }
      if (closeStart === -1) {
        index = delimiterEnd;
        continue;
      }
      let closeEnd = closeStart + delimiterLength;
      for (let at = index; at < closeEnd; at += 1) chars[at] = " ";
      index = closeEnd;
    }
    return chars.join("");
  } catch (error) {
    return String(lineText || "");
  }
}

// True only for a `[?]` task carrying the exact #task token. The status
// parser handles quoted task prefixes; masking excludes inline code from the
// tag check. Live Preview callers also use the shared syntax-tree code guard
// for surrounding fenced blocks.
function blockMarkEligible(lineText) {
  try {
    if (typeof lineText !== "string" || freshnessTaskStatus(lineText) !== "?") {
      return false;
    }
    const visible = blockMarkMaskInlineCode(lineText);
    return /(?:^|\s)#task(?![A-Za-z0-9_/-])/.test(visible);
  } catch (error) {
    return false;
  }
}

// Comma-separated IDs from canonical square or parenthesized Depends-On
// fields. IDs inside inline code are ignored and repeated IDs collapse in
// first-seen order. Never throws.
function blockMarkDependsOnIds(lineText) {
  try {
    const visible = blockMarkMaskInlineCode(lineText);
    const ids = [];
    const seen = new Set();
    const fields = /\[[ \t]*dependsOn[ \t]*::[ \t]*([^\]\r\n]*)\]|\([ \t]*dependsOn[ \t]*::[ \t]*([^\)\r\n]*)\)/g;
    let match = fields.exec(visible);
    while (match !== null) {
      const value = match[1] !== undefined ? match[1] : match[2];
      for (const id of blocksTaskIds(value)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      match = fields.exec(visible);
    }
    return Object.freeze(ids);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The teaching digit for a canonical stored priority. A configured P1–P4
// label wins; any other label or an unknown ladder uses the standard map.
// Never throws.
function blockMarkDigit(value, ladder) {
  try {
    const fallback = BLOCK_MARK_DEFAULT_DIGITS[value];
    if (fallback === undefined) return null;
    if (Array.isArray(ladder)) {
      for (const level of ladder) {
        if (!level || level.value !== value) continue;
        const match = /^P([1-4])$/.exec(String(level.label || ""));
        if (match) return Number(match[1]);
        break;
      }
    }
    return fallback;
  } catch (error) {
    return null;
  }
}

function blockMarkReason(kind, key, text) {
  return Object.freeze({
    kind,
    key,
    text: String(text || ""),
  });
}

// Resolve the precedence decision selected by this epic: own open
// prerequisite, project, then future date. Unknown prerequisites remain
// neutral because they could outrank either later reason. Never throws.
function blockMarkClassify(inputs) {
  try {
    const value = inputs && typeof inputs === "object" ? inputs : {};
    const dependencyState = value.dependencyState;
    if (dependencyState === "unknown") return null;

    const dependencies = Array.isArray(value.dependencies)
      ? value.dependencies
          .map((entry) => String(entry && entry.text || "").trim())
          .filter(Boolean)
      : [];
    const project = value.project && typeof value.project === "object"
      ? value.project
      : null;
    const date = value.date && typeof value.date === "object" ? value.date : null;
    const projectBlocked = Boolean(project && project.blocked);
    const dateKey = date && ["p1", "p2", "p3", "p4", "repeat", "date"].includes(date.key)
      ? date.key
      : null;

    const reasons = [];
    if (dependencyState === "open" && dependencies.length > 0) {
      for (const text of dependencies) {
        reasons.push(blockMarkReason("dep", "dep", text));
      }
    }
    if (projectBlocked) {
      reasons.push(blockMarkReason("prj", "prj", project.text || "project"));
    }
    if (dateKey) {
      reasons.push(blockMarkReason("date", dateKey, date.date));
    }

    let key = "stale";
    let family = "stale";
    let digit = null;
    if (dependencyState === "open" && dependencies.length > 0) {
      key = "dep";
      family = "held";
    } else if (projectBlocked) {
      key = "prj";
      family = "held";
    } else if (dateKey) {
      key = dateKey;
      family = "waiting";
      digit = Number.isInteger(date.digit) ? date.digit : null;
    }

    let more = null;
    if (key === "dep") {
      const losingProject = projectBlocked;
      const losingDate = Boolean(dateKey);
      more = losingProject ? "prj" : losingDate ? dateKey : null;
    } else if (key === "prj" && dateKey) {
      more = dateKey;
    }

    return Object.freeze({
      key,
      family,
      digit,
      more,
      reasons: Object.freeze(reasons),
    });
  } catch (error) {
    return null;
  }
}

function blockMarkDateWords(dateText, todayText) {
  try {
    const date = String(dateText || "");
    const today = String(todayText || "");
    const model = dateMarkModel("scheduled", date, today);
    if (!model) return null;
    return Object.freeze({
      date,
      short: freshnessShortDate(date, today) || date,
      relative: dateMarkRelativePhrase(model.delta),
      delta: model.delta,
    });
  } catch (error) {
    return null;
  }
}

// Build tooltip copy from the classifier result and the line-local facts.
// The copy deliberately avoids inline-field syntax (`::`). Never throws.
function blockMarkTooltip(model, facts) {
  try {
    if (!model || typeof model !== "object") return "";
    const value = facts && typeof facts === "object" ? facts : {};
    const reasons = Array.isArray(model.reasons) ? model.reasons : [];
    const dependencies = reasons.filter((reason) => reason && reason.kind === "dep");
    const project = reasons.find((reason) => reason && reason.kind === "prj") || null;
    const date = reasons.find((reason) => reason && reason.kind === "date") || null;
    const dateWords = date
      ? blockMarkDateWords(date.text, value.today)
      : null;
    const datePhrase = dateWords
      ? dateWords.short + " · " + dateWords.relative
      : date
        ? String(date.text || "")
        : "";
    const lines = [];

    if (model.key === "dep") {
      const first = dependencies[0] && dependencies[0].text || "another task";
      lines.push(
        "Blocked · after " +
          first +
          (dependencies.length > 1 ? " +" + (dependencies.length - 1) : ""),
      );
      lines.push(BLOCK_MARK_DEPENDENCY_HINT);
    } else if (model.key === "prj") {
      const stem = project && project.text || value.projectStem || "project";
      lines.push("Blocked · via project " + stem);
      const projectReason = String(value.projectReason || "").trim();
      if (projectReason) lines.push(projectReason);
    } else if (["p1", "p2", "p3", "p4"].includes(model.key)) {
      lines.push(
        "Blocked · P" +
          String(model.digit) +
          " deferral · until " +
          datePhrase,
      );
      lines.push(BLOCK_MARK_PRIORITY_HINT);
    } else if (model.key === "date") {
      lines.push("Blocked · until " + datePhrase);
      lines.push(BLOCK_MARK_RESCHEDULE_HINT);
    } else if (model.key === "repeat") {
      lines.push("Recurring · next run " + datePhrase);
    } else {
      lines.push("Blocked, but no reason is left");
      lines.push("Clears on the next reconcile");
    }

    if (model.key !== "prj" && project) {
      lines.push("Also via project " + (project.text || value.projectStem || "project"));
    }
    if (date && model.key !== date.key) {
      lines.push("Also scheduled " + datePhrase);
    }
    return lines.join("\n");
  } catch (error) {
    return "";
  }
}

function blockMarkDependencyFacts(ids, lookupId) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return Object.freeze({ state: "closed", dependencies: Object.freeze([]) });
    }
    if (typeof lookupId !== "function") {
      return Object.freeze({ state: "unknown", dependencies: Object.freeze([]) });
    }
    let unresolved = false;
    const dependencies = [];
    for (const id of ids) {
      let matches = null;
      try {
        matches = lookupId(id);
      } catch (error) {
        matches = null;
      }
      if (matches === null || matches === undefined) {
        return Object.freeze({ state: "unknown", dependencies: Object.freeze([]) });
      }
      const tasks = Array.isArray(matches) ? matches : [];
      if (tasks.length === 0) {
        unresolved = true;
        continue;
      }
      let open = null;
      for (const task of tasks) {
        if (blocksTaskIsOpen(task)) {
          open = task;
          break;
        }
      }
      if (open) {
        const clean = dependencyCleanTaskText(planTaskDescription(open) || "");
        dependencies.push(clean || "another task");
      }
    }
    if (dependencies.length > 0) {
      return Object.freeze({
        state: "open",
        dependencies: Object.freeze(dependencies),
      });
    }
    return Object.freeze({
      state: unresolved ? "unknown" : "closed",
      dependencies: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({ state: "unknown", dependencies: Object.freeze([]) });
  }
}

function blockMarkDateFacts(lineText, today, ladder) {
  try {
    const visible = blockMarkMaskInlineCode(lineText);
    const scheduled = dateMarkCanonicalFields(visible).find(
      (field) => field.field === "scheduled",
    );
    if (!scheduled) return Object.freeze({ date: null, invalidToday: false });
    const dateModel = dateMarkModel("scheduled", scheduled.date, today);
    if (!dateModel) return Object.freeze({ date: null, invalidToday: true });
    if (dateModel.delta <= 0) {
      return Object.freeze({ date: null, invalidToday: false });
    }

    let key = "date";
    let digit = null;
    const recurrence = recurrenceMarkCanonicalField(visible);
    const recurrenceParts = recurrence
      ? recurrenceRuleParts(recurrence.rule)
      : null;
    if (recurrence && recurrenceParts) {
      key = "repeat";
    } else {
      const priority = priorityMarkCanonicalField(visible);
      const priorityDigit = priority
        ? blockMarkDigit(priority.value, ladder)
        : null;
      if (priorityDigit !== null) {
        digit = priorityDigit;
        key = "p" + String(priorityDigit);
      }
    }
    return Object.freeze({
      date: Object.freeze({
        key,
        digit,
        date: scheduled.date,
      }),
      invalidToday: false,
    });
  } catch (error) {
    return Object.freeze({ date: null, invalidToday: false });
  }
}

// Pure classifier for one line. `lookupId` returns task[] when the Tasks
// cache is ready, [] for a missing ID, and null while the cache is cold.
// `projectReason` is intentionally one-hop and optional. Never throws.
function blockMarkModel(lineText, ctx) {
  try {
    if (!blockMarkEligible(lineText)) return null;
    const context = ctx && typeof ctx === "object" ? ctx : {};
    const visible = blockMarkMaskInlineCode(lineText);
    const ids = blockMarkDependsOnIds(visible);
    const dependency = blockMarkDependencyFacts(ids, context.lookupId);
    const projectBlocked = /(?:^|\s)#prj_is_blocked(?![A-Za-z0-9_/-])/.test(visible);
    const notePath = String(context.notePath || "");
    const projectStem = notePath.split("/").pop().replace(/\.md$/i, "") || "project";
    const projectReason = projectBlocked && typeof context.projectReason === "function"
      ? context.projectReason(notePath)
      : null;
    const dateFacts = blockMarkDateFacts(lineText, context.today, context.ladder);
    if (dateFacts.invalidToday) return null;
    const result = blockMarkClassify({
      dependencyState: dependency.state,
      dependencies: dependency.dependencies.map((text) => ({ text })),
      project: projectBlocked
        ? { blocked: true, text: projectStem }
        : null,
      date: dateFacts.date,
    });
    if (!result) return null;

    let tooltip = "";
    try {
      tooltip = blockMarkTooltip(result, {
        today: context.today,
        projectStem,
        projectReason,
      });
    } catch (error) {
      tooltip = "";
    }
    const modelKey = JSON.stringify([
      result.key,
      result.family,
      result.digit,
      result.more,
      result.reasons.map((reason) => [reason.kind, reason.key, reason.text]),
      tooltip,
    ]);
    return Object.freeze({
      key: result.key,
      family: result.family,
      digit: result.digit,
      more: result.more,
      reasons: result.reasons,
      tooltip,
      modelKey,
    });
  } catch (error) {
    return null;
  }
}
