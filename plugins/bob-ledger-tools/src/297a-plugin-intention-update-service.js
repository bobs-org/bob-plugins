// Intention (periods) update service. `bob periods update <SUBJECT>` is the
// only writer of the owned intention fields; this file builds its argv and
// envelope and decodes its typed result without validating writer semantics.
// Decoders stay additive: unknown future keys are preserved by wire-shape
// validation, never reinterpreted here. Inverse ops are opaque JSON: Undo can
// carry `summary.restore`, which restores the earlier stamps in one op.
const INTENTION_UPDATE_SCHEMA_VERSION = 1;
const INTENTION_UPDATE_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const INTENTION_UPDATE_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const INTENTION_UPDATE_PREVIEW_DEBOUNCE_MS = 250;
const INTENTION_UPDATE_OVERLAY_TTL_MS = 8000;

function intentionJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function intentionUpdateNullableString(value) {
  return value === null || value === undefined || typeof value === "string";
}

// Periods uses `-n` for the dry run, never the record writer's `-d` flag.
function intentionUpdateArgs(subject, options = {}) {
  const opts = intentionJsonObject(options) ? options : {};
  const args = ["periods", "update", String(subject), "-i", "-", "-f", "json"];
  if (opts.dryRun === true) args.push("-n");
  return args;
}

// The initial read is a dry run with only `{schema_version, ops}`: mutations
// always carry the current field fingerprint as `expect`.
function intentionUpdateEnvelope(expect, ops) {
  const body = { schema_version: INTENTION_UPDATE_SCHEMA_VERSION, ops: Array.isArray(ops) ? ops : [] };
  if (typeof expect === "string" && expect) body.expect = expect;
  return body;
}

function intentionUpdateEnvelopeText(expect, ops) {
  return JSON.stringify(intentionUpdateEnvelope(expect, ops));
}

function intentionIsStaleUpdateCode(code) {
  return code === "stale_note";
}

function intentionUpdateSubjectShape(subject) {
  if (!intentionJsonObject(subject)) return false;
  return typeof subject.id === "string" && typeof subject.kind === "string"
    && typeof subject.label === "string" && typeof subject.path === "string";
}

function intentionUpdateErrorShape(error) {
  if (error === null || error === undefined) return true;
  if (!intentionJsonObject(error)) return false;
  if (typeof error.code !== "string" || !error.code) return false;
  if (typeof error.message !== "string") return false;
  return intentionUpdateNullableString(error.hint)
    && (error.op_index === undefined || error.op_index === null || Number.isInteger(error.op_index));
}

function intentionUpdateFieldsShape(fields) {
  return fields === null || fields === undefined || intentionJsonObject(fields);
}

function intentionUpdateReportShape(body) {
  if (!intentionJsonObject(body) || body.schema_version !== INTENTION_UPDATE_SCHEMA_VERSION) return false;
  if (typeof body.ok !== "boolean") return false;
  if (body.ok === true) {
    if (!intentionUpdateSubjectShape(body.subject)) return false;
    if (typeof body.dry_run !== "boolean") return false;
    if (typeof body.fingerprint_before !== "string" || typeof body.fingerprint_after !== "string") return false;
    if (!intentionUpdateFieldsShape(body.before) || !intentionUpdateFieldsShape(body.after)) return false;
    if (typeof body.changed !== "boolean") return false;
    if (!Array.isArray(body.inverse_ops)) return false;
    if (body.warnings !== undefined && !Array.isArray(body.warnings)) return false;
  }
  return intentionUpdateErrorShape(body.error);
}

// Only an exit-2 usage error whose own text disowns the subcommand counts as
// an old bob. Real validation failures also exit 2 and must surface as
// refusals, never as an upgrade hint.
function intentionUpdateIsUnsupportedOutput(stdout, stderr, exitCode) {
  if (exitCode !== 2) return false;
  const text = `${String(stdout || "")}\n${String(stderr || "")}`;
  if (!/periods/i.test(text)) return false;
  return /unknown (subcommand|command)|unrecognized|no such (subcommand|command)|invalid subcommand|cannot.*update|update.*not (found|recognized|supported)/i.test(text);
}

function intentionDecodeUpdateReport(stdout, stderr = "", exitCode = null) {
  if (intentionUpdateIsUnsupportedOutput(stdout, stderr, exitCode)) {
    return {
      ok: false, code: "needs-update",
      message: "This bob does not support `bob periods update`.",
      detail: statsFirstLine(stderr) || statsFirstLine(stdout),
      exitCode,
    };
  }
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false, code: "bad-json",
      message: "bob periods update returned invalid JSON.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (!intentionUpdateReportShape(body)) {
    if (intentionJsonObject(body) && body.schema_version !== INTENTION_UPDATE_SCHEMA_VERSION) {
      return {
        ok: false, code: "schema-mismatch",
        message: "bob periods update uses a different schema.",
        detail: statsFirstLine(stderr),
        exitCode,
      };
    }
    return {
      ok: false, code: "bad-shape",
      message: "bob periods update returned an incomplete report.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (body.ok === false || (intentionJsonObject(body.error) && body.error.code)) {
    if (body.ok !== false && !(intentionJsonObject(body.error) && body.error.code)) {
      return {
        ok: false, code: "bad-shape",
        message: "bob periods update returned an incomplete report.",
        detail: statsFirstLine(stderr),
        exitCode,
      };
    }
    return { ok: true, report: { ...body, ok: false }, exitCode };
  }
  return { ok: true, report: body, exitCode };
}

function intentionUpdateErrorModel(result) {
  const source = intentionJsonObject(result) ? result : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Intention editing needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found" || code === "needs-bob" || code === "needs-update") {
    return { code, hint: "Update bob to edit intentions." };
  }
  if (code === "timeout") {
    return { code, hint: "bob periods update timed out. Refresh and retry; never blind-retry." };
  }
  if (code === "stdin-failed") {
    return { code, hint: "The update envelope never reached bob. Nothing was written; preview again." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "The intention update failed. Refresh before retrying.",
  };
}

function intentionOverlayFields(report) {
  const after = report && intentionJsonObject(report.after) ? report.after : null;
  if (!after) return null;
  const fields = {};
  if (Object.prototype.hasOwnProperty.call(after, "intentions")) fields.intentions = after.intentions;
  if (Object.prototype.hasOwnProperty.call(after, "summary")) fields.summary = after.summary;
  if (Object.prototype.hasOwnProperty.call(after, "reflection")) fields.reflection = after.reflection;
  return fields;
}

function intentionOverlayFromReport(report) {
  if (!report || report.ok !== true) return null;
  const fields = intentionOverlayFields(report);
  if (!fields) return null;
  const fingerprint = typeof report.fingerprint_after === "string" ? report.fingerprint_after : "";
  return { fields, fingerprint, changed: report.changed === true };
}

class BobLedgerToolsIntentionUpdateMixin {
  intentionUpdateUndoStore() {
    if (!(this.intentionUpdateUndoByPath instanceof Map)) {
      this.intentionUpdateUndoByPath = new Map();
    }
    return this.intentionUpdateUndoByPath;
  }

  setupIntentionUpdate() {
    this.intentionUpdateUndoByPath = new Map();
    this.intentionUpdateFlight = null;
    this.intentionUpdateBusy = false;
    this.intentionUpdateEpoch = this.intentionUpdateEpoch || 0;
  }

  teardownIntentionUpdate() {
    this.intentionUpdateBusy = false;
    this.intentionUpdateFlight = null;
    this.intentionUpdateEpoch = (this.intentionUpdateEpoch || 0) + 1;
    if (this.intentionUpdateUndoByPath instanceof Map) this.intentionUpdateUndoByPath.clear();
  }

  intentionUpdateRememberUndo(path, inverseOps, afterFingerprint) {
    try {
      const key = typeof intentionCardPath === "function" ? intentionCardPath(path) : String(path || "");
      if (!key || !Array.isArray(inverseOps) || !inverseOps.length) return null;
      const record = {
        inverseOps: inverseOps.map((op) => (op && typeof op === "object" ? { ...op } : op)),
        afterFingerprint: typeof afterFingerprint === "string" ? afterFingerprint : "",
      };
      this.intentionUpdateUndoStore().set(key, record);
      return record;
    } catch (_) {
      return null;
    }
  }

  intentionUpdateLastUndo(path) {
    try {
      const key = typeof intentionCardPath === "function" ? intentionCardPath(path) : String(path || "");
      return this.intentionUpdateUndoStore().get(key) || null;
    } catch (_) {
      return null;
    }
  }

  intentionSpawnJson(args, decode, options = {}) {
    const opts = intentionJsonObject(options) ? options : {};
    return bobSpawnJson(args, decode, {
      ...opts,
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: INTENTION_UPDATE_TIMEOUT_MS,
      maxBuffer: INTENTION_UPDATE_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  intentionSpawnUpdate(subject, envelopeText, options = {}) {
    const opts = intentionJsonObject(options) ? options : {};
    const dryRun = opts.dryRun === true;
    return this.intentionSpawnJson(
      intentionUpdateArgs(subject, { dryRun }),
      intentionDecodeUpdateReport,
      {
        ...opts,
        stdin: typeof envelopeText === "string" ? envelopeText : "",
        commandLabel: dryRun ? "bob periods update -n" : "bob periods update",
      },
    );
  }

  apiIntentionUpdatePreview(subject, envelopeText, options = {}) {
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Ledger data has unloaded." });
    }
    return this.intentionSpawnUpdate(subject, envelopeText, { ...options, dryRun: true });
  }

  apiIntentionUpdateApply(subject, envelopeText, options = {}) {
    const opts = intentionJsonObject(options) ? options : {};
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Ledger data has unloaded." });
    }
    if (this.intentionUpdateFlight) {
      return Promise.resolve({
        ok: false, code: "apply-busy",
        message: "Another intention apply is already running.",
        hint: "Wait for it to settle, then preview again.",
      });
    }
    const epoch = this.albumDataEpoch || 0;
    const ownPaths = (Array.isArray(opts.ownPaths) ? opts.ownPaths : [opts.ownPath])
      .map((path) => (typeof albumReportPath === "function" ? albumReportPath(path) : String(path || "")))
      .filter(Boolean);
    const waitForSync = this.albumSyncFlight && typeof this.albumSyncFlight.then === "function"
      ? this.albumSyncFlight.catch(() => null)
      : null;
    const run = async () => {
      if (waitForSync) {
        try { await waitForSync; } catch (_) {}
      }
      if (this.albumDataActive === false || (this.albumDataEpoch || 0) !== epoch) {
        return { ok: false, code: "unloaded", message: "Ledger data has unloaded." };
      }
      if (this.intentionUpdateFlight && this.intentionUpdateFlight !== applyPromise) {
        return {
          ok: false, code: "apply-busy",
          message: "Another intention apply is already running.",
          hint: "Wait for it to settle, then preview again.",
        };
      }
      this.intentionUpdateBusy = true;
      for (const ownPath of ownPaths) {
        try { this.albumUpdateOwnPathsStore().add(ownPath); } catch (_) {}
      }
      let outcome;
      try {
        try {
          outcome = await this.intentionSpawnUpdate(subject, envelopeText, { ...opts, dryRun: false });
        } catch (error) {
          outcome = {
            ok: false, code: "failed",
            message: error && error.message ? String(error.message) : "bob periods update failed.",
          };
        }
        const wrote = Boolean(
          outcome && outcome.ok && outcome.report && outcome.report.ok === true
          && outcome.report.dry_run === false && outcome.report.changed === true,
        );
        const unknown = Boolean(outcome && !outcome.ok && (outcome.code === "timeout" || outcome.code === "failed"));
        if (this.albumDataActive === false || (this.albumDataEpoch || 0) !== epoch) {
          return { ...outcome, refreshed: this.albumReportState?.() || null, wrote, unknown };
        }
        let refreshed = this.albumReportState?.() || null;
        if (wrote || unknown) {
          try { refreshed = this.apiAlbumInvalidate("intention-update"); } catch (_) {}
        }
        return { ...outcome, refreshed, wrote, unknown };
      } finally {
        this.intentionUpdateBusy = false;
        if (this.intentionUpdateFlight === applyPromise) this.intentionUpdateFlight = null;
        for (const ownPath of ownPaths) {
          try { this.albumUpdateOwnPathsStore().delete(ownPath); } catch (_) {}
        }
      }
    };
    const applyPromise = Promise.resolve().then(run);
    this.intentionUpdateFlight = applyPromise;
    return applyPromise;
  }
}
