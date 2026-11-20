// Pure Run-kind authoring for the make-or-edit card: per-step validation
// through Command Mode's `resolve`, the Add-bob fix, and the predictable
// kind default. Nothing here reads the DOM, the editor, or the vault, and
// nothing spawns: `resolve` is the engine's pure, synchronous verdict over
// its cached catalog, injected by the caller (null without Command Mode).
const RUN_CHIP_AUTHOR_ONLY_BOB = "command chips run only bob";
const RUN_CHIP_AUTHOR_WHITESPACE = "whitespace only — nothing to run";
const RUN_CHIP_AUTHOR_UNCHECKED = "Command Mode is not enabled, so these commands can't be checked here";
const RUN_CHIP_AUTHOR_LOADING = "Command Mode is still loading bob's catalog, so these commands aren't checked yet";

// Trimmed step ranges of chip text, split where Command Mode splits: at
// unquoted `&&` and at line breaks, skipping blank steps. Quoting follows
// the engine's tokenizer: single quotes are literal, double quotes honor
// `\"` and `\\`, and a bare backslash escapes the next character. Frozen
// `[{ index, from, to, text }]` with one-based `index`. Never throws.
function runChipAuthorStepRanges(text) {
  try {
    const source = String(text === undefined || text === null ? "" : text);
    const out = [];
    const push = (start, end) => {
      let from = start;
      let to = end;
      while (from < to && /\s/.test(source[from])) from += 1;
      while (to > from && /\s/.test(source[to - 1])) to -= 1;
      if (to > from) out.push(copyChipFreeze({ index: out.length + 1, from, to, text: source.slice(from, to) }));
    };
    let start = 0;
    let quote = null;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quote === "'") {
        if (char === "'") quote = null;
        continue;
      }
      if (quote === "\"") {
        if (char === "\"") quote = null;
        else if (char === "\\" && (source[index + 1] === "\"" || source[index + 1] === "\\")) index += 1;
        continue;
      }
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "'" || char === "\"") {
        quote = char;
        continue;
      }
      if (char === "\n" || char === "\r") {
        push(start, index);
        start = index + 1;
        continue;
      }
      if (char === "&" && source[index + 1] === "&") {
        push(start, index);
        index += 1;
        start = index + 1;
      }
    }
    push(start, source.length);
    return copyChipFreeze(out);
  } catch (error) {
    return copyChipFreeze([]);
  }
}

// One engine verdict, never throwing; null without a resolver.
function runChipAuthorResolveOne(resolve, text) {
  try {
    if (typeof resolve !== "function") return null;
    const verdict = resolve(String(text));
    if (verdict && typeof verdict === "object" && typeof verdict.state === "string") return verdict;
  } catch (error) {
    // A throwing resolver reads as an unresolvable command.
  }
  return copyChipFreeze({
    ok: false,
    state: "invalid",
    signature: null,
    steps: copyChipFreeze([]),
    reason: "command could not be resolved",
    step: null,
  });
}

// True when a verdict names a bob command line: ready, or refused only
// because this host can't run it (a Mac-only chip authored on athena).
// Catalog-level unavailability (no bob, unreadable catalog) has no step.
function runChipAuthorRunnable(verdict) {
  try {
    if (!verdict || typeof verdict !== "object") return false;
    if (verdict.state === "ready") return true;
    return verdict.state === "unavailable" && Number.isInteger(verdict.step) && verdict.step > 0;
  } catch (error) {
    return false;
  }
}

// What a click on the finished chip will do for this step, as the card's
// policy note.
function runChipAuthorStepNote(step, total) {
  try {
    if (!step || typeof step !== "object") return "";
    if (step.policy === "confirm") return "asks first";
    if (step.presentation === "report" && total === 1) return "opens its output";
    if (step.policy === "preview-first" && step.hasPreview) return "preview skipped";
    return "runs now";
  } catch (error) {
    return "";
  }
}

function runChipAuthorRow(range, mark, fields) {
  const f = fields && typeof fields === "object" ? fields : {};
  return copyChipFreeze({
    index: range.index,
    text: range.text,
    mark,
    title: f.title == null ? null : String(f.title),
    effect: f.effect == null ? null : String(f.effect),
    note: f.note == null ? null : String(f.note),
    reason: f.reason == null ? null : String(f.reason),
    fixable: f.fixable === true,
  });
}

// Insert `bob ` before each listed step (one-based indexes into
// runChipAuthorStepRanges), keeping every other byte. Never throws.
function runChipAuthorWithBob(text, indexes) {
  try {
    const source = String(text === undefined || text === null ? "" : text);
    const want = new Set(Array.isArray(indexes) ? indexes : []);
    if (!want.size) return source;
    const ranges = runChipAuthorStepRanges(source).filter((range) => want.has(range.index));
    let out = source;
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
      const at = ranges[index].from;
      out = out.slice(0, at) + "bob " + out.slice(at);
    }
    return out;
  } catch (error) {
    return String(text === undefined || text === null ? "" : text);
  }
}

// Live Run validation for the card. `resolve` is Command Mode's pure
// resolver (or null); `options.uncheckedReason` explains a missing one.
// Returns frozen:
//   state     "empty" | "invalid" | "ready" | "warn" | "unchecked"
//   canSave   invalid steps and structural faults block; host-unavailable
//             steps warn; an absent or loading catalog can't check and allows
//   reason    the blocking reason (with "(step k)" in a sequence), or null
//   warning   a non-blocking note, or null
//   steps     one row per step: { index, text, mark, title, effect, note,
//             reason, fixable }, mark "ok" | "invalid" | "warn" | "unchecked"
//   addBob    { text, steps } when prefixing `bob` fixes bob-less steps
// Never throws.
function runChipAuthorValidate(resolve, text, options) {
  const opts = options && typeof options === "object" ? options : {};
  const freeze = (fields) => copyChipFreeze({
    state: fields.state,
    canSave: Boolean(fields.canSave),
    reason: fields.reason == null ? null : String(fields.reason),
    warning: fields.warning == null ? null : String(fields.warning),
    steps: copyChipFreeze(fields.steps || []),
    addBob: fields.addBob ? copyChipFreeze({ text: fields.addBob.text, steps: copyChipFreeze(fields.addBob.steps.slice()) }) : null,
  });
  try {
    const value = String(text === undefined || text === null ? "" : text);
    if (!copyChipHasNonWhitespace(value)) {
      return freeze({
        state: "empty",
        canSave: false,
        reason: value !== "" ? RUN_CHIP_AUTHOR_WHITESPACE : RUN_CHIP_NOTHING_TO_RUN,
      });
    }
    const ranges = runChipAuthorStepRanges(value);
    if (typeof resolve !== "function") {
      return freeze({
        state: "unchecked",
        canSave: true,
        warning: opts.uncheckedReason ? String(opts.uncheckedReason) : RUN_CHIP_AUTHOR_UNCHECKED,
        steps: ranges.map((range) => runChipAuthorRow(range, "unchecked")),
      });
    }
    const total = ranges.length;
    const fixes = [];
    const rows = ranges.map((range) => {
      const verdict = runChipAuthorResolveOne(resolve, range.text);
      const step = verdict.state === "ready" && Array.isArray(verdict.steps) && verdict.steps.length === 1
        ? verdict.steps[0]
        : null;
      if (step) {
        return runChipAuthorRow(range, "ok", {
          title: step.title || step.text,
          effect: step.effect,
          note: runChipAuthorStepNote(step, total),
        });
      }
      if (verdict.state === "ready") {
        // One range resolved to several steps: the splitter disagrees with
        // the engine, so let the whole-text verdict decide.
        return runChipAuthorRow(range, "unchecked");
      }
      if (verdict.state === "loading") return runChipAuthorRow(range, "unchecked", { reason: verdict.reason });
      if (verdict.state === "unavailable") {
        const host = Number.isInteger(verdict.step) && verdict.step > 0;
        return runChipAuthorRow(range, host ? "warn" : "unchecked", { reason: verdict.reason });
      }
      let fixable = false;
      if (verdict.reason === RUN_CHIP_AUTHOR_ONLY_BOB) {
        const fixed = runChipAuthorResolveOne(resolve, "bob " + range.text);
        fixable = fixed.state !== "invalid";
        if (fixable) fixes.push(range.index);
      }
      return runChipAuthorRow(range, "invalid", { reason: verdict.reason, fixable });
    });
    const addBob = fixes.length ? { text: runChipAuthorWithBob(value, fixes), steps: fixes } : null;
    const stepSuffix = (index) => (total > 1 && Number.isInteger(index) ? " (step " + index + ")" : "");
    const invalid = rows.find((row) => row.mark === "invalid");
    if (invalid) {
      return freeze({
        state: "invalid",
        canSave: false,
        reason: (invalid.reason || "command could not be resolved") + stepSuffix(invalid.index),
        steps: rows,
        addBob,
      });
    }
    const whole = runChipAuthorResolveOne(resolve, value);
    if (whole.state === "invalid") {
      return freeze({
        state: "invalid",
        canSave: false,
        reason: (whole.reason || "command could not be resolved") + stepSuffix(whole.step),
        steps: rows,
        addBob,
      });
    }
    const warn = rows.find((row) => row.mark === "warn");
    if (warn) {
      return freeze({
        state: "warn",
        canSave: true,
        warning: (warn.reason || "not available on this host") + stepSuffix(warn.index),
        steps: rows,
      });
    }
    if (whole.state !== "ready" || rows.some((row) => row.mark === "unchecked")) {
      const reason = whole.state === "loading" ? RUN_CHIP_AUTHOR_LOADING : whole.reason || RUN_CHIP_AUTHOR_LOADING;
      return freeze({ state: "unchecked", canSave: true, warning: reason, steps: rows });
    }
    return freeze({ state: "ready", canSave: true, steps: rows });
  } catch (error) {
    return freeze({ state: "invalid", canSave: false, reason: "command could not be resolved" });
  }
}

// The kind a new chip starts as, never switched afterwards: Run when the
// text is a bob command line (or becomes one once `bob` is added, which
// also offers the fix), otherwise Copy. Frozen `{ kind, addBob }`.
function runChipAuthorDefaultKind(resolve, text) {
  const copy = copyChipFreeze({ kind: "copy", addBob: false });
  try {
    const value = String(text === undefined || text === null ? "" : text);
    if (typeof resolve !== "function" || !copyChipHasNonWhitespace(value)) return copy;
    if (runChipAuthorRunnable(runChipAuthorResolveOne(resolve, value))) {
      return copyChipFreeze({ kind: "run", addBob: false });
    }
    const validation = runChipAuthorValidate(resolve, value);
    if (validation.addBob && runChipAuthorRunnable(runChipAuthorResolveOne(resolve, validation.addBob.text))) {
      return copyChipFreeze({ kind: "run", addBob: true });
    }
    return copy;
  } catch (error) {
    return copy;
  }
}

// The live resolver for a plugin: Command Mode's own `resolve`, looked up
// fresh so a disabled or reloaded engine is never used. Frozen
// `{ resolve, reason }`; `resolve` is null when commands can't be checked.
function runChipAuthorEngine(plugin) {
  try {
    const found = commandChipEngineOf(plugin && plugin.app);
    if (!found.engine) {
      return copyChipFreeze({
        resolve: null,
        reason: (found.reason || COMMAND_CHIP_ENGINE_MISSING) + ", so these commands can't be checked here",
      });
    }
    const engine = found.engine;
    return copyChipFreeze({ resolve: (text) => commandChipFreshResolve(engine, text), reason: null });
  } catch (error) {
    return copyChipFreeze({ resolve: null, reason: RUN_CHIP_AUTHOR_UNCHECKED });
  }
}
