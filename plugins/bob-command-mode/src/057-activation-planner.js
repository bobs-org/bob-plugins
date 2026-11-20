// Bob Command Mode: command text parsing and shared activation policy.

const CM_SHELL_REFUSAL = "command chips run bob, not a shell";

function cmSplitCommandText(text) {
  if (typeof text !== "string") return { ok: false, reason: "command text must be a string" };
  const source = text.trim();
  if (!source) return { ok: false, reason: "no command given" };

  const parts = [];
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
    if (char === "&") {
      if (source[index + 1] === "&") {
        parts.push(source.slice(start, index).trim());
        index += 1;
        start = index + 1;
      } else {
        return { ok: false, reason: CM_SHELL_REFUSAL };
      }
      continue;
    }
    if (char === ";" || char === "|" || char === "<" || char === ">" || char === "`" || (char === "$" && source[index + 1] === "(")) {
      return { ok: false, reason: CM_SHELL_REFUSAL };
    }
  }
  if (escaped) return { ok: false, reason: "Unfinished escape" };
  if (quote) return { ok: false, reason: "Unbalanced quote" };
  parts.push(source.slice(start).trim());
  if (parts.some((part) => !part)) return { ok: false, reason: "empty command between `&&`" };
  return { ok: true, parts };
}

function cmResolveCommandText(catalog, text, options = {}) {
  if (!catalog) return { ok: false, reason: "catalog unavailable" };
  const split = cmSplitCommandText(text);
  if (!split.ok) return split;
  const host = options.host || null;
  const steps = [];
  for (const part of split.parts) {
    const parsed = cmTokenizeBobArgv(part);
    if (parsed.error) return { ok: false, reason: parsed.error };
    const words = cmTokenizedWords(parsed);
    if (!words.length || words[0] !== "bob") {
      return { ok: false, reason: words.length ? "command chips run only bob" : "no command given" };
    }
    const argv = cmApplyCatalogAliases(catalog, words.slice(1));
    if (!argv.length) return { ok: false, reason: "no command given" };
    const excluded = cmExcludedReason(catalog, argv);
    if (excluded) return { ok: false, reason: excluded };
    const entry = cmFindEntryForArgv(catalog, argv);
    if (!entry) {
      return { ok: false, reason: "bob has no command `" + cmFormatArgv(argv) + "`" };
    }
    const unavailable = cmSheetEntryUnavailable(entry, host);
    if (unavailable) return { ok: false, reason: unavailable };
    const userArgs = argv.slice(entry.path.length);
    const missing = cmArgPositionals(entry, userArgs).missing;
    if (missing) return { ok: false, reason: "missing " + String(missing.name || missing.slot || "value") };
    steps.push({ argv: [...argv], entry_id: entry.id, title: entry.title || entry.id });
  }
  if (!steps.length) return { ok: false, reason: "no command given" };
  return { ok: true, steps, signature: cmSequenceSignature(steps) };
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
