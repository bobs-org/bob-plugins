// Props v1 client: argv, envelope, and show/update decoders for `bob props`.
// Recovery show reports (null fingerprint) are accepted for rendering and
// never authorize a write. Unknown-subcommand output from an old bob is the
// only exit-2 that means capability unavailable.
const PROPERTY_UPDATE_SCHEMA_VERSION = 1;
const PROPERTY_UPDATE_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const PROPERTY_UPDATE_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS = 250;
const PROPERTY_HISTORY_LIMIT = 20;
const PROPERTY_OVERLAY_TTL_MS = 5000;
const PROPERTY_CAPABILITY = "props_v1";

function propertyJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertyNullableString(value) {
  return value === null || value === undefined || typeof value === "string";
}

function propertyNullableLine(value) {
  return value === null || value === undefined || (Number.isInteger(value) && value >= 0);
}

function propertyCloneJson(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return value;
  }
}

function propertyNotePath(value) {
  if (typeof albumReportPath === "function") {
    return albumReportPath(value);
  }
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function propertyShowArgs(notePath) {
  return ["props", "show", String(notePath || ""), "-f", "json"];
}

function propertyUpdateArgs(notePath, options = {}) {
  const opts = propertyJsonObject(options) ? options : {};
  const args = ["props", "update", String(notePath || ""), "-f", "json", "-i", "-"];
  if (opts.dryRun === true) args.push("-d");
  return args;
}

function propertyUpdateEnvelope(expect, ops) {
  return {
    schema_version: PROPERTY_UPDATE_SCHEMA_VERSION,
    expect: String(expect || ""),
    ops: Array.isArray(ops) ? ops : [],
  };
}

function propertyUpdateEnvelopeText(expect, ops) {
  return JSON.stringify(propertyUpdateEnvelope(expect, ops));
}

function propertyIsStaleUpdateCode(code) {
  return code === "prop_stale";
}

function propertyHasCapability(report) {
  return Boolean(
    propertyJsonObject(report) &&
    Array.isArray(report.capabilities) &&
    report.capabilities.includes(PROPERTY_CAPABILITY),
  );
}

function propertyFingerprintOf(report) {
  if (!propertyJsonObject(report)) return "";
  if (typeof report.fingerprint === "string" && report.fingerprint) return report.fingerprint;
  return "";
}

function propertyShowAllowsWrite(report) {
  return propertyHasCapability(report) && Boolean(propertyFingerprintOf(report));
}

function propertyErrorShape(error) {
  if (error === null || error === undefined) return true;
  if (!propertyJsonObject(error)) return false;
  if (typeof error.code !== "string" || !error.code) return false;
  if (typeof error.message !== "string") return false;
  return propertyNullableString(error.hint) &&
    propertyNullableString(error.key) &&
    propertyNullableLine(error.line) &&
    (error.op_index === undefined || error.op_index === null || Number.isInteger(error.op_index));
}

function propertyFrontmatterShape(frontmatter) {
  if (!propertyJsonObject(frontmatter)) return false;
  if (typeof frontmatter.state !== "string" || !frontmatter.state) return false;
  return propertyNullableLine(frontmatter.start_line) && propertyNullableLine(frontmatter.end_line);
}

function propertyRowShape(row) {
  if (!propertyJsonObject(row)) return false;
  if (typeof row.key !== "string") return false;
  if (row.line !== undefined && !propertyNullableLine(row.line)) return false;
  if (row.end_line !== undefined && !propertyNullableLine(row.end_line)) return false;
  if (row.kind !== undefined && row.kind !== null && typeof row.kind !== "string") return false;
  if (row.style !== undefined && row.style !== null && !propertyJsonObject(row.style)) return false;
  if (row.role !== undefined && !propertyNullableString(row.role)) return false;
  if (row.owner !== undefined && !propertyNullableString(row.owner)) return false;
  if (row.editor !== undefined && !propertyNullableString(row.editor)) return false;
  if (row.reason !== undefined && !propertyNullableString(row.reason)) return false;
  if (row.duplicate !== undefined && typeof row.duplicate !== "boolean") return false;
  if (row.opaque !== undefined && typeof row.opaque !== "boolean") return false;
  return true;
}

function propertyRowsShape(rows) {
  return Array.isArray(rows) && rows.every(propertyRowShape);
}

function propertyShowReportShape(body) {
  if (!propertyJsonObject(body) || body.schema_version !== PROPERTY_UPDATE_SCHEMA_VERSION) return false;
  if (typeof body.ok !== "boolean") return false;
  if (body.ok === false) return propertyErrorShape(body.error);
  if (typeof body.path !== "string") return false;
  if (typeof body.note_kind !== "string") return false;
  if (!Array.isArray(body.capabilities)) return false;
  if (!(typeof body.fingerprint === "string" || body.fingerprint === null)) return false;
  if (!propertyFrontmatterShape(body.frontmatter)) return false;
  return propertyRowsShape(body.properties);
}

function propertyUpdateReportShape(body) {
  if (!propertyJsonObject(body) || body.schema_version !== PROPERTY_UPDATE_SCHEMA_VERSION) return false;
  if (typeof body.ok !== "boolean") return false;
  if (body.ok === false) {
    if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") return false;
    if (body.changed !== undefined && typeof body.changed !== "boolean") return false;
    if (body.path !== undefined && typeof body.path !== "string") return false;
    return propertyErrorShape(body.error);
  }
  if (typeof body.path !== "string") return false;
  if (typeof body.dry_run !== "boolean") return false;
  if (typeof body.changed !== "boolean") return false;
  if (typeof body.fingerprint_before !== "string" || typeof body.fingerprint_after !== "string") return false;
  if (!Array.isArray(body.inverse_ops) || !Array.isArray(body.changes)) return false;
  return propertyRowsShape(body.properties);
}

// Only an exit-2 usage error whose own text disowns the `props` subcommand
// counts as an old bob. Real validation failures also exit 2.
function propertyIsUnsupportedOutput(stdout, stderr, exitCode) {
  if (exitCode !== 2) return false;
  const text = `${String(stdout || "")}\n${String(stderr || "")}`;
  if (!/\bprops\b/i.test(text)) return false;
  return /unknown (subcommand|command)|unrecognized|no such (subcommand|command)|invalid subcommand/i.test(text);
}

function propertyUnsupportedResult(commandLabel, stdout, stderr, exitCode) {
  return {
    ok: false,
    code: "needs-bob",
    message: `This bob does not support \`${commandLabel}\`.`,
    detail: (typeof statsFirstLine === "function" ? statsFirstLine(stderr) : "") ||
      (typeof statsFirstLine === "function" ? statsFirstLine(stdout) : String(stderr || stdout || "")),
    exitCode,
  };
}

function propertyDecodeFailure(code, message, stderr, exitCode) {
  return {
    ok: false,
    code,
    message,
    detail: typeof statsFirstLine === "function" ? statsFirstLine(stderr) : String(stderr || ""),
    exitCode,
  };
}

function propertyParseJson(stdout) {
  return JSON.parse(String(stdout === undefined ? "" : stdout));
}

function propertyDecodeShowReport(stdout, stderr = "", exitCode = null) {
  if (propertyIsUnsupportedOutput(stdout, stderr, exitCode)) {
    return propertyUnsupportedResult("bob props show", stdout, stderr, exitCode);
  }
  let body;
  try {
    body = propertyParseJson(stdout);
  } catch (error) {
    return propertyDecodeFailure("bad-json", "bob props show returned invalid JSON.", stderr, exitCode);
  }
  if (!propertyShowReportShape(body)) {
    if (propertyJsonObject(body) && body.schema_version !== PROPERTY_UPDATE_SCHEMA_VERSION) {
      return propertyDecodeFailure("schema-mismatch", "bob props show uses a different schema.", stderr, exitCode);
    }
    return propertyDecodeFailure("bad-shape", "bob props show returned an incomplete report.", stderr, exitCode);
  }
  if (body.ok === false) {
    return { ok: true, report: { ...body, ok: false }, exitCode };
  }
  return { ok: true, report: { ...body, ok: true }, exitCode };
}

function propertyDecodeUpdateReport(stdout, stderr = "", exitCode = null) {
  if (propertyIsUnsupportedOutput(stdout, stderr, exitCode)) {
    return propertyUnsupportedResult("bob props update", stdout, stderr, exitCode);
  }
  let body;
  try {
    body = propertyParseJson(stdout);
  } catch (error) {
    return propertyDecodeFailure("bad-json", "bob props update returned invalid JSON.", stderr, exitCode);
  }
  if (!propertyUpdateReportShape(body)) {
    if (propertyJsonObject(body) && body.schema_version !== PROPERTY_UPDATE_SCHEMA_VERSION) {
      return propertyDecodeFailure("schema-mismatch", "bob props update uses a different schema.", stderr, exitCode);
    }
    return propertyDecodeFailure("bad-shape", "bob props update returned an incomplete report.", stderr, exitCode);
  }
  return { ok: true, report: body, exitCode };
}

function propertyUpdateErrorModel(result) {
  const source = propertyJsonObject(result) ? result : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Property editing needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found" || code === "needs-bob") {
    return { code, hint: "Update bob to edit properties here — y opens YAML." };
  }
  if (code === "timeout") {
    return { code, hint: "bob props update timed out. Refresh and reconcile before retrying; never blind-retry." };
  }
  if (code === "stdin-failed") {
    return { code, hint: "The update envelope never reached bob. Nothing was written; preview again." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  if (code === "prop_stale") {
    return { code, hint: source.hint || "Re-read the note and preview the retained draft against the current fingerprint." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "The property update failed. Refresh before retrying.",
  };
}

function propertyDeletedKeys(beforeProperties, afterProperties) {
  const afterKeys = new Set();
  for (const row of Array.isArray(afterProperties) ? afterProperties : []) {
    if (row && typeof row.key === "string") afterKeys.add(row.key);
  }
  const deleted = [];
  for (const row of Array.isArray(beforeProperties) ? beforeProperties : []) {
    if (row && typeof row.key === "string" && row.key && !afterKeys.has(row.key) && !deleted.includes(row.key)) {
      deleted.push(row.key);
    }
  }
  return deleted;
}

function propertyOverlayBeforeFromProperties(properties) {
  return {
    properties: propertyCloneJson(Array.isArray(properties) ? properties : []) || [],
    deletedKeys: [],
  };
}

function propertyOverlayFromReport(report, beforeProperties) {
  const properties = propertyCloneJson(Array.isArray(report && report.properties) ? report.properties : []) || [];
  return {
    properties,
    deletedKeys: propertyDeletedKeys(beforeProperties, properties),
    fingerprint: report && typeof report.fingerprint_after === "string" ? report.fingerprint_after : "",
    before: propertyOverlayBeforeFromProperties(beforeProperties),
  };
}

function propertyOverlayPaintFrontmatter(frontmatter, overlay) {
  const base = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
    ? { ...frontmatter }
    : {};
  if (!overlay || typeof overlay !== "object") return base;
  const next = { ...base };
  if (Array.isArray(overlay.deletedKeys)) {
    for (const key of overlay.deletedKeys) {
      if (typeof key === "string" && key) delete next[key];
    }
  }
  if (Array.isArray(overlay.properties)) {
    for (const row of overlay.properties) {
      if (!row || typeof row.key !== "string" || !row.key) continue;
      next[row.key] = row.value;
    }
  }
  return next;
}
