// Album schema update wire helpers. `bob albums update` is the only
// writer of album schema YAML; these helpers build its argv and envelope
// and decode its typed result without validating schema semantics.
// Report decoders stay additive: unknown future keys are preserved by
// validation of the wire shape, never reinterpreted here.
const ALBUM_UPDATE_SCHEMA_VERSION = 1;
// The writer timeout follows the existing guarded sync path, not the
// list default on its own: an update takes the shared vault lock and
// runs the same pre-sync lifecycle as `bob albums sync`.
const ALBUM_UPDATE_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const ALBUM_UPDATE_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
// Typing settles before a preview is submitted; navigation and reopening
// are reads and never schedule one.
const ALBUM_UPDATE_PREVIEW_DEBOUNCE_MS = 250;
// Sync-only recovery after a locally committed write never replays the
// mutation and never runs `albums sync`: it runs `bob vault-sync` only.
function albumVaultSyncArgs() {
  return ["vault-sync"];
}

function albumUpdateArgs(stem, options = {}) {
  const opts = albumJsonObject(options) ? options : {};
  const args = ["albums", "update", String(stem), "-f", "json", "-i", "-"];
  if (opts.dryRun === true) {
    args.push("-d");
  }
  return args;
}

// The request body is always JSON on stdin, never shell text: labels,
// defaults, and inverse metadata can look like shell (`$(...)`, `;`,
// emoji) and must survive byte-identical.
function albumUpdateEnvelope(expect, ops) {
  return {
    schema_version: ALBUM_UPDATE_SCHEMA_VERSION,
    expect: String(expect),
    ops: Array.isArray(ops) ? ops : [],
  };
}

function albumUpdateEnvelopeText(expect, ops) {
  return JSON.stringify(albumUpdateEnvelope(expect, ops));
}

function albumUpdateCount(value) {
  return value === null || value === undefined || (Number.isInteger(value) && value >= 0);
}

function albumUpdateNullableString(value) {
  return value === null || value === undefined || typeof value === "string";
}

function albumUpdatePerOpShape(entry) {
  if (!albumJsonObject(entry)) {
    return false;
  }
  if (!Number.isInteger(entry.index) || entry.index < 0) {
    return false;
  }
  if (typeof entry.op !== "string" || !entry.op) {
    return false;
  }
  if (typeof entry.summary !== "string") {
    return false;
  }
  if (!albumUpdateNullableString(entry.derived_key)) {
    return false;
  }
  if (!albumUpdateCount(entry.filled) || !albumUpdateCount(entry.count)) {
    return false;
  }
  if (!albumUpdateCount(entry.newly_invalid)) {
    return false;
  }
  return true;
}

function albumUpdateErrorShape(error) {
  if (error === null || error === undefined) {
    return true;
  }
  if (!albumJsonObject(error)) {
    return false;
  }
  if (typeof error.code !== "string" || !error.code) {
    return false;
  }
  if (typeof error.message !== "string") {
    return false;
  }
  return albumUpdateNullableString(error.hint) &&
    albumUpdateCount(error.op_index) &&
    albumUpdateNullableString(error.field) &&
    albumUpdateNullableString(error.choice) &&
    albumUpdateNullableString(error.path) &&
    albumUpdateCount(error.line) &&
    albumUpdateNullableString(error.key_path) &&
    albumUpdateCount(error.affected);
}

function albumUpdateCommitShape(commit) {
  if (commit === null || commit === undefined) {
    return true;
  }
  return albumJsonObject(commit) &&
    typeof commit.sha === "string" &&
    typeof commit.subject === "string";
}

function albumUpdateSyncShape(sync) {
  if (sync === null || sync === undefined) {
    return true;
  }
  return albumJsonObject(sync);
}

function albumUpdateReportShape(body) {
  if (!albumJsonObject(body)) {
    return false;
  }
  if (body.schema_version !== ALBUM_UPDATE_SCHEMA_VERSION) {
    return false;
  }
  if (body.command !== "update" || typeof body.ok !== "boolean") {
    return false;
  }
  if (typeof body.dry_run !== "boolean" || typeof body.changed !== "boolean") {
    return false;
  }
  if (typeof body.stem !== "string" || typeof body.path !== "string") {
    return false;
  }
  if (typeof body.before_fingerprint !== "string" || typeof body.after_fingerprint !== "string") {
    return false;
  }
  if (typeof body.consequence !== "string") {
    return false;
  }
  if (body.group_before !== null && body.group_before !== undefined && typeof body.group_before !== "string") {
    return false;
  }
  if (body.group_after !== null && body.group_after !== undefined && typeof body.group_after !== "string") {
    return false;
  }
  if (!Array.isArray(body.per_op) || !body.per_op.every(albumUpdatePerOpShape)) {
    return false;
  }
  if (!Array.isArray(body.derived_keys) || !body.derived_keys.every(albumUpdateNullableString)) {
    return false;
  }
  if (!Array.isArray(body.inverse_ops)) {
    return false;
  }
  if (!Array.isArray(body.changes)) {
    return false;
  }
  if (!Array.isArray(body.warnings) || !body.warnings.every((warning) => typeof warning === "string")) {
    return false;
  }
  return albumUpdateCommitShape(body.commit) &&
    albumUpdateSyncShape(body.sync) &&
    albumUpdateErrorShape(body.error);
}

// Decode a typed update result. The wire shape is validated, never the
// schema semantics inside it. Exit 2 is a valid refusal document and
// exit 1 may also carry a typed failure, so a decodable body is
// transport success (`ok: true`) with the operation outcome in
// `report.ok`; only an undecodable body is a transport failure. All
// typed refusal detail — `error.affected`, hint, path/line, and
// operation identity (`op_index`, `field`, `choice`, `key_path`) — is
// preserved untouched for the card to paint.
function albumDecodeUpdateReport(stdout, stderr = "", exitCode = null) {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob albums update returned invalid JSON.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (!albumUpdateReportShape(body)) {
    if (albumJsonObject(body) && body.schema_version !== ALBUM_UPDATE_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "schema-mismatch",
        message: "bob albums update uses a different schema.",
        detail: statsFirstLine(stderr),
        exitCode,
      };
    }
    return {
      ok: false,
      code: "bad-shape",
      message: "bob albums update returned an incomplete report.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  return { ok: true, report: body, exitCode };
}

function albumIsStaleUpdateCode(code) {
  return code === "stale_schema" || code === "stale_note";
}

// Sync-only recovery runs `bob vault-sync` with no JSON contract: exit 0
// is success and anything else carries the first stderr line. It never
// replays the mutation and never runs `albums sync`.
function albumDecodeVaultSyncResult(stdout, stderr = "", exitCode = null) {
  void stdout;
  if (exitCode === null || exitCode === undefined || exitCode === 0) {
    return { ok: true, report: { ok: true, output: String(stdout === undefined ? "" : stdout) } };
  }
  return {
    ok: false,
    code: "sync-failed",
    message: "bob vault-sync reported a failure.",
    detail: statsFirstLine(stderr),
  };
}

function albumUpdateErrorModel(result) {
  const source = albumJsonObject(result) ? result : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Schema editing needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found") {
    return { code, hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  }
  if (code === "timeout") {
    return { code, hint: "bob albums update timed out. Refresh and reconcile before retrying; never blind-retry." };
  }
  if (code === "stdin-failed") {
    return { code, hint: "The update envelope never reached bob. Nothing was written; preview again." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "The schema update failed. Refresh before retrying.",
  };
}
