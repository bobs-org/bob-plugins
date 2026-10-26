// Bob Command Mode: catalog cache (fingerprint, validation, refresh, lookup).

function cmCatalogFingerprint(stat, bobPath) {
  if (!stat) return null;
  return {
    path: String(bobPath || ""),
    mtimeMs: Number(stat.mtimeMs) || 0,
    size: Number(stat.size) || 0,
  };
}

function cmStatBobPath(fsModule, bobPath) {
  if (!bobPath || bobPath === "bob") return null;
  try {
    const stat = fsModule.statSync(bobPath);
    return cmCatalogFingerprint(stat, bobPath);
  } catch (error) {
    return null;
  }
}

function cmFingerprintsEqual(left, right) {
  if (!left || !right) return false;
  return left.path === right.path && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

const CM_KNOWN_EFFECTS = new Set(["reads", "writes", "syncs"]);
const CM_KNOWN_PRESENTATIONS = new Set(["report", "action", "inline"]);
const CM_KNOWN_POLICIES = new Set(["run", "preview-first", "confirm"]);
const CM_KNOWN_SLOTS = new Set([
  "ref", "area-note", "article-note", "ref-target", "url", "ref-query",
  "vault-note", "theme", "relation-label", "metric", "pdf", "text",
]);

// Light client-side validation. Unknown enum values stay valid here; the
// runner normalizes them to the safe defaults (writes/action/confirm/text).
function cmValidateCatalog(doc) {
  if (!doc || typeof doc !== "object") return { ok: false, error: "catalog is not an object" };
  if (doc.schema_version !== 1) return { ok: false, error: "unsupported catalog schema_version" };
  if (doc.ok !== true) return { ok: false, error: "catalog reports ok=false" };
  if (!Array.isArray(doc.entries)) return { ok: false, error: "catalog entries is not an array" };
  if (!Array.isArray(doc.sections)) return { ok: false, error: "catalog sections is not an array" };
  for (const entry of doc.entries) {
    if (!entry || typeof entry.id !== "string" || !entry.id) {
      return { ok: false, error: "catalog entry without an id" };
    }
    if (!Array.isArray(entry.path) || entry.path.length === 0) {
      return { ok: false, error: "catalog entry " + entry.id + " without a path" };
    }
    if (!Array.isArray(entry.fixed) || !Array.isArray(entry.args)) {
      return { ok: false, error: "catalog entry " + entry.id + " without fixed/args arrays" };
    }
  }
  return { ok: true, catalog: doc };
}

function cmNormalizeEffect(effect) {
  return CM_KNOWN_EFFECTS.has(effect) ? effect : "writes";
}

function cmNormalizePresentation(presentation) {
  return CM_KNOWN_PRESENTATIONS.has(presentation) ? presentation : "action";
}

function cmNormalizePolicy(policy) {
  return CM_KNOWN_POLICIES.has(policy) ? policy : "confirm";
}

function cmNormalizeSlot(slot) {
  return CM_KNOWN_SLOTS.has(slot) ? slot : "text";
}

// Fetch and validate the catalog: `bob __catalog --protocol 1`, 5 s, 8 MiB.
function cmRefreshCatalog(bobPath, options = {}) {
  const execFile = options.execFile || null;
  const timeout = options.timeoutMs || CM_CATALOG_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes || CM_CATALOG_MAX_BYTES;
  return new Promise((resolve) => {
    let runner = execFile;
    if (!runner) {
      try {
        runner = cmChildProcess().execFile;
      } catch (error) {
        resolve({ ok: false, error: "cannot spawn bob: " + String(error && error.message || error) });
        return;
      }
    }
    runner(bobPath, ["__catalog", "--protocol", "1"], { timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: String((error && error.message) || error || "catalog fetch failed") });
        return;
      }
      let doc;
      try {
        doc = JSON.parse(String(stdout || ""));
      } catch (parseError) {
        resolve({ ok: false, error: "catalog is not valid JSON" });
        return;
      }
      const validated = cmValidateCatalog(doc);
      if (!validated.ok) {
        resolve({ ok: false, error: validated.error, detail: String(stderr || "").slice(0, 200) });
        return;
      }
      resolve({ ok: true, catalog: validated.catalog });
    });
  });
}

function cmEntryById(catalog, entryId) {
  if (!catalog || !Array.isArray(catalog.entries)) return null;
  return catalog.entries.find((entry) => entry && entry.id === entryId) || null;
}

function cmPathPrefixLength(entryPath, argv) {
  if (!Array.isArray(entryPath)) return -1;
  if (entryPath.length > argv.length) return -1;
  for (let index = 0; index < entryPath.length; index += 1) {
    if (entryPath[index] !== argv[index]) return -1;
  }
  return entryPath.length;
}

// Longest catalog path prefix of argv. A typed argv whose longest prefix is an
// entry inherits that entry's metadata and guards.
function cmFindEntryForArgv(catalog, argv) {
  if (!catalog || !Array.isArray(catalog.entries)) return null;
  const words = Array.isArray(argv) ? argv : [];
  let best = null;
  let bestLength = 0;
  for (const entry of catalog.entries) {
    const length = cmPathPrefixLength(entry && entry.path, words);
    if (length > bestLength) {
      best = entry;
      bestLength = length;
    }
  }
  return best;
}

function cmExcludedReason(catalog, argv) {
  if (!catalog || !Array.isArray(catalog.excluded)) return null;
  const words = Array.isArray(argv) ? argv : [];
  let best = null;
  let bestLength = -1;
  for (const rule of catalog.excluded) {
    if (!rule || !Array.isArray(rule.path)) continue;
    const length = cmPathPrefixLength(rule.path, words);
    if (length > bestLength && length === rule.path.length && length > 0) {
      best = rule;
      bestLength = length;
    }
  }
  return best ? String(best.reason || "excluded") : null;
}

function cmIsEffectReads(entry) {
  return cmNormalizeEffect(entry && entry.effect) === "reads";
}

// Final argv: path + (preview ? preview : []) + fixed + user args. Preview args
// always come before the fixed args so `capture --dry-run -- -` works.
function cmAssembleArgv(entry, userArgs, options = {}) {
  const path = Array.isArray(entry && entry.path) ? entry.path : [];
  const fixed = Array.isArray(entry && entry.fixed) ? entry.fixed : [];
  const preview = options.preview && Array.isArray(entry && entry.preview) ? entry.preview : [];
  const rest = Array.isArray(userArgs) ? userArgs : [];
  return [...path, ...preview, ...fixed, ...rest];
}

function cmRequiredPositionals(entry) {
  if (!entry || !Array.isArray(entry.args)) return [];
  return entry.args.filter((arg) => arg && arg.required);
}

// Entries eligible for a Ctrl+P `run-<id>` command: every positional optional
// and a plain `run` policy.
function cmCommandPaletteEntries(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) return [];
  return catalog.entries.filter((entry) => {
    if (!entry || entry.policy !== "run") return false;
    return (Array.isArray(entry.args) ? entry.args : []).every((arg) => !arg || !arg.required);
  });
}
