// Bob Command Mode: command text parsing and shared activation policy.

const CM_SHELL_REFUSAL = "command chips run bob, not a shell";
const CM_CATALOG_LOADING_REASON = "Command Mode is still loading bob's catalog";

function cmShellRefusal(op) {
  return CM_SHELL_REFUSAL + " — remove " + (op === "`" ? "the backtick" : "`" + op + "`");
}

// The unquoted shell operator starting at index, or null. `~` and globs stay
// literal: bob expands them itself where it chooses to.
function cmShellOperatorAt(source, index) {
  const char = source[index];
  const next = source[index + 1];
  if (char === ";" || char === "<" || char === "`") return char;
  if (char === "|") return next === "|" ? "||" : "|";
  if (char === ">") return next === ">" ? ">>" : ">";
  if (char !== "$") return null;
  if (next === "(" || next === "{") return "$" + next;
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index + 1));
  if (name) return "$" + name[0];
  if (next && /[0-9?$@*#!-]/.test(next)) return "$" + next;
  return null;
}

// Split chip text into trimmed step texts at unquoted `&&` and line breaks.
// Quotes and escapes follow cmTokenizeBobArgv; blank lines are skipped, and a
// line break right after `&&` continues the same chain.
function cmSplitCommandText(text) {
  if (typeof text !== "string") return { ok: false, reason: "command text must be a string" };
  const source = text;
  if (!source.trim()) return { ok: false, reason: "no command given" };

  const segments = [];
  const stepNumber = () => segments.filter((segment) => segment.text.trim()).length + 1;
  const refuse = (reason) => ({ ok: false, reason, step: stepNumber() });
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && (source[index + 1] === '"' || source[index + 1] === "\\")) index += 1;
      continue;
    }
    if (escaped) {
      escaped = false;
      if (char === "\n" || char === "\r") return refuse("command chips do not join lines with `\\`");
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\n") {
      segments.push({ text: source.slice(start, index), after: "\n" });
      start = index + 1;
      continue;
    }
    if (char === "&") {
      if (source[index + 1] !== "&") return refuse(cmShellRefusal("&"));
      segments.push({ text: source.slice(start, index), after: "&&" });
      index += 1;
      start = index + 1;
      continue;
    }
    const op = cmShellOperatorAt(source, index);
    if (op) return refuse(cmShellRefusal(op));
  }
  if (escaped) return refuse("Unfinished escape");
  if (quote) return refuse("Unbalanced quote");
  segments.push({ text: source.slice(start), after: "end" });

  const parts = [];
  let afterAnd = false;
  for (const segment of segments) {
    const trimmed = segment.text.trim();
    if (!trimmed) {
      if (segment.after === "&&") {
        return { ok: false, reason: afterAnd ? "empty step after `&&`" : "empty step before `&&`", step: parts.length + 1 };
      }
      continue;
    }
    parts.push(trimmed);
    afterAnd = segment.after === "&&";
  }
  if (afterAnd) return { ok: false, reason: "empty step after `&&`", step: parts.length + 1 };
  if (!parts.length) return { ok: false, reason: "no command given" };
  return { ok: true, parts };
}

function cmResolveFailure(state, reason, step) {
  return Object.freeze({
    ok: false,
    state,
    signature: null,
    steps: Object.freeze([]),
    reason: String(reason || "command could not be resolved"),
    step: Number.isInteger(step) && step > 0 ? step : null,
  });
}

function cmCatalogUnavailableReason(status) {
  if (status === "missing-bob") return "Command Mode cannot find bob";
  if (status === "old-bob" || status === "protocol-skew") return "Command Mode cannot read bob's command catalog";
  return null;
}

function cmResolvedStep(index, text, argv, entry) {
  const policy = cmNormalizePolicy(entry.policy);
  return Object.freeze({
    index,
    text,
    argv: Object.freeze([...argv]),
    entryId: entry.id,
    entry_id: entry.id,
    title: entry.title || entry.id,
    effect: cmNormalizeEffect(entry.effect),
    policy,
    presentation: cmNormalizePresentation(entry.presentation),
    hasPreview: Boolean(Array.isArray(entry.preview) && entry.preview.length),
    confirm: policy === "confirm" ? String(entry.confirm || "This command needs confirmation.") : null,
  });
}

// Pure and synchronous over the cached catalog. Returns a frozen
// {ok, state, signature, steps, reason, step}; state is ready, invalid,
// unavailable (this host or bob), or loading (no catalog yet). Syntax faults
// win over catalog faults, so a malformed chip is invalid even while loading.
function cmResolveCommandText(catalog, text, options = {}) {
  const split = cmSplitCommandText(text);
  if (!split.ok) return cmResolveFailure("invalid", split.reason, split.step);
  const words = [];
  for (let index = 0; index < split.parts.length; index += 1) {
    const parsed = cmTokenizeBobArgv(split.parts[index]);
    if (parsed.error) return cmResolveFailure("invalid", parsed.error, index + 1);
    const stepWords = cmTokenizedWords(parsed);
    if (!stepWords.length) return cmResolveFailure("invalid", "no command given", index + 1);
    if (stepWords[0] !== "bob") return cmResolveFailure("invalid", "command chips run only bob", index + 1);
    if (stepWords.length < 2) return cmResolveFailure("invalid", "no command given", index + 1);
    words.push(stepWords.slice(1));
  }
  if (!catalog) {
    const unavailable = cmCatalogUnavailableReason(options.catalogStatus);
    if (unavailable) return cmResolveFailure("unavailable", unavailable, null);
    return cmResolveFailure("loading", CM_CATALOG_LOADING_REASON, null);
  }
  const host = options.host || null;
  const steps = [];
  for (let index = 0; index < words.length; index += 1) {
    const step = index + 1;
    const argv = cmApplyCatalogAliases(catalog, words[index]);
    if (!argv.length) return cmResolveFailure("invalid", "no command given", step);
    const excluded = cmExcludedReason(catalog, argv);
    if (excluded) return cmResolveFailure("invalid", excluded, step);
    const entry = cmFindEntryForArgv(catalog, argv);
    if (!entry) return cmResolveFailure("invalid", "bob has no command `" + cmFormatArgv(argv) + "`", step);
    if (cmSheetEntryUnavailable(entry, host)) {
      const hosts = (Array.isArray(entry.hosts) ? entry.hosts : []).filter(Boolean).map(String);
      return cmResolveFailure("unavailable", "not available on this host: runs only on " + hosts.join(", "), step);
    }
    const missing = cmArgPositionals(entry, argv.slice(entry.path.length)).missing;
    if (missing) return cmResolveFailure("invalid", "needs `" + String(missing.name || missing.slot || "value") + "`", step);
    steps.push(cmResolvedStep(step, split.parts[index], argv, entry));
  }
  const frozen = Object.freeze(steps);
  return Object.freeze({
    ok: true,
    state: "ready",
    signature: cmSequenceSignature(frozen),
    steps: frozen,
    reason: null,
    step: null,
  });
}

// Shared by sheet activation and api.commandMode text activation. A forced
// run skips preview-first, while a catalog confirm policy always gets review.
function cmPlanActivation(steps, catalog, options = {}) {
  const stored = (Array.isArray(steps) ? steps : []).map(cmSequenceStep);
  if (!stored.length) return { ok: false, reason: "empty sequence", steps: stored, guards: [] };
  const intent = String(options.intent || "run");
  const firstEntry = cmSequenceLookupEntry(stored[0], catalog);
  const isSingle = stored.length === 1;
  const hasPreview = Boolean(firstEntry && Array.isArray(firstEntry.preview) && firstEntry.preview.length);
  const presentation = firstEntry ? cmNormalizePresentation(firstEntry.presentation) : "action";
  const policy = firstEntry ? cmNormalizePolicy(firstEntry.policy) : "run";
  let guards = cmSequenceGuards(stored, catalog);
  let action = "run";

  if (intent === "open") {
    if (isSingle && policy === "confirm") action = "review";
    else if (isSingle && presentation === "report") action = "report";
    else if (isSingle && policy === "preview-first" && hasPreview) action = "preview";
    else action = "review";
  } else if (intent === "preview") {
    if (isSingle && policy === "confirm" && !hasPreview) action = "review";
    else if (isSingle && presentation === "report") action = "report";
    else if (isSingle && hasPreview) action = "preview";
    else if (isSingle && policy === "confirm") action = "review";
    else action = "run";
  } else if (intent === "force" || intent === "chip") {
    guards = guards.filter((guard) => guard.kind === "confirm");
    if (guards.length) action = "review";
    else if (isSingle && presentation === "report") action = "report";
    else action = "run";
  } else {
    if (isSingle && policy === "confirm") action = "review";
    else if (isSingle && presentation === "report") action = "report";
    else if (isSingle && policy === "preview-first" && hasPreview) action = "preview";
    else if (guards.length) action = "review";
  }

  return { ok: true, action, steps: stored, guards, signature: cmSequenceSignature(stored) };
}
