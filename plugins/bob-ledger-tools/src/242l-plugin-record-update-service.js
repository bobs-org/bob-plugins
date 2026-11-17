// Record value update service. Preview is a dry-run with no vault bytes;
// apply reuses album own-path echo suppression so the write never schedules
// an automatic albums sync, then invalidates the cached album report.
const RECORD_UPDATE_SCHEMA_VERSION = 1;
const RECORD_UPDATE_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const RECORD_UPDATE_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const RECORD_UPDATE_PREVIEW_DEBOUNCE_MS = 250;

function recordJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordUpdateNullableString(value) {
  return value === null || value === undefined || typeof value === "string";
}

function recordShowArgs(typeId, stem) {
  return ["records", "show", String(typeId), String(stem), "-f", "json"];
}

function recordUpdateArgs(typeId, stem, options = {}) {
  const opts = recordJsonObject(options) ? options : {};
  const args = ["records", "update", String(typeId), String(stem), "-f", "json", "-i", "-"];
  if (opts.dryRun === true) args.push("-d");
  return args;
}

function recordUpdateEnvelope(expect, ops) {
  return {
    schema_version: RECORD_UPDATE_SCHEMA_VERSION,
    expect: String(expect || ""),
    ops: Array.isArray(ops) ? ops : [],
  };
}

function recordUpdateEnvelopeText(expect, ops) {
  return JSON.stringify(recordUpdateEnvelope(expect, ops));
}

function recordIsStaleUpdateCode(code) {
  return code === "stale_record";
}

function recordUpdateErrorShape(error) {
  if (error === null || error === undefined) return true;
  if (!recordJsonObject(error)) return false;
  if (typeof error.code !== "string" || !error.code) return false;
  if (typeof error.message !== "string") return false;
  return recordUpdateNullableString(error.hint) && recordUpdateNullableString(error.field);
}

function recordShowRecordShape(record) {
  if (!recordJsonObject(record)) return false;
  if (typeof record.stem !== "string" || typeof record.path !== "string") return false;
  if (typeof record.fingerprint !== "string") return false;
  return Array.isArray(record.properties);
}

function recordShowReportShape(body) {
  if (!recordJsonObject(body) || body.schema_version !== RECORD_UPDATE_SCHEMA_VERSION) return false;
  if (recordJsonObject(body.error) && typeof body.error.message === "string") return true;
  return typeof body.type === "string" && recordShowRecordShape(body.record);
}

function recordUpdateReportShape(body) {
  if (!recordJsonObject(body) || body.schema_version !== RECORD_UPDATE_SCHEMA_VERSION) return false;
  if (body.command !== "update" || typeof body.ok !== "boolean") return false;
  if (typeof body.dry_run !== "boolean") return false;
  if (!Array.isArray(body.changed)) return false;
  if (typeof body.stem !== "string" || typeof body.path !== "string") return false;
  if (typeof body.fingerprint_before !== "string" || typeof body.fingerprint_after !== "string") return false;
  if (typeof body.consequence !== "string") return false;
  if (!Array.isArray(body.inverse_ops) || !Array.isArray(body.properties) || !Array.isArray(body.changes)) return false;
  if (body.record !== undefined && body.record !== null && !recordShowRecordShape(body.record)) return false;
  return recordUpdateErrorShape(body.error);
}

function recordDecodeShowReport(stdout, stderr = "", exitCode = null) {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob records show returned invalid JSON.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (!recordShowReportShape(body)) {
    if (recordJsonObject(body) && body.schema_version !== RECORD_UPDATE_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "schema-mismatch",
        message: "bob records show uses a different schema.",
        detail: statsFirstLine(stderr),
        exitCode,
      };
    }
    return {
      ok: false,
      code: "bad-shape",
      message: "bob records show returned an incomplete report.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (recordJsonObject(body.error) && !recordShowRecordShape(body.record)) {
    return { ok: true, report: { ...body, ok: false }, exitCode };
  }
  return { ok: true, report: { ...body, ok: true }, exitCode };
}

function recordDecodeUpdateReport(stdout, stderr = "", exitCode = null) {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob records update returned invalid JSON.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (!recordUpdateReportShape(body)) {
    if (recordJsonObject(body) && body.schema_version !== RECORD_UPDATE_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "schema-mismatch",
        message: "bob records update uses a different schema.",
        detail: statsFirstLine(stderr),
        exitCode,
      };
    }
    return {
      ok: false,
      code: "bad-shape",
      message: "bob records update returned an incomplete report.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  return { ok: true, report: body, exitCode };
}

function recordUpdateErrorModel(result) {
  const source = recordJsonObject(result) ? result : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Record editing needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found") {
    return { code, hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  }
  if (code === "needs-bob") {
    return { code, hint: "Update bob (just install) to edit records here." };
  }
  if (code === "timeout") {
    return { code, hint: "bob records update timed out. Refresh and reconcile before retrying; never blind-retry." };
  }
  if (code === "stdin-failed") {
    return { code, hint: "The update envelope never reached bob. Nothing was written; preview again." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "The record update failed. Refresh before retrying.",
  };
}

function recordOverlayFromReport(report) {
  const properties = {};
  const unsetKeys = [];
  const changedKeys = Array.isArray(report && report.changed)
    ? report.changed.map((key) => String(key || "")).filter(Boolean)
    : [];
  for (const row of Array.isArray(report && report.properties) ? report.properties : []) {
    if (!row || typeof row.key !== "string" || !row.key) continue;
    const empty = row.state === "none" || row.state === "missing" || row.value === null || row.value === undefined;
    if (empty) {
      properties[row.key] = null;
      unsetKeys.push(row.key);
    } else {
      properties[row.key] = row.value;
    }
  }
  return { properties, unsetKeys, changedKeys };
}

class BobLedgerToolsRecordUpdateMixin {
  recordUpdateUndoStore() {
    if (!(this.recordUpdateUndoByPath instanceof Map)) {
      this.recordUpdateUndoByPath = new Map();
    }
    return this.recordUpdateUndoByPath;
  }

  setupRecordUpdate() {
    this.recordUpdateUndoByPath = new Map();
    this.recordUpdateFlight = null;
    this.recordUpdateBusy = false;
    this.recordUpdateEpoch = this.recordUpdateEpoch || 0;
  }

  teardownRecordUpdate() {
    this.recordUpdateBusy = false;
    this.recordUpdateFlight = null;
    this.recordUpdateEpoch = (this.recordUpdateEpoch || 0) + 1;
    if (this.recordUpdateUndoByPath instanceof Map) this.recordUpdateUndoByPath.clear();
  }

  recordUpdateRememberUndo(path, inverseOps, afterFingerprint) {
    try {
      const key = typeof albumReportPath === "function" ? albumReportPath(path) : String(path || "");
      if (!key || !Array.isArray(inverseOps) || !inverseOps.length) return null;
      const record = {
        inverseOps: inverseOps.map((op) => (op && typeof op === "object" ? { ...op } : op)),
        afterFingerprint: typeof afterFingerprint === "string" ? afterFingerprint : "",
      };
      this.recordUpdateUndoStore().set(key, record);
      return record;
    } catch (_) {
      return null;
    }
  }

  recordUpdateLastUndo(path) {
    try {
      const key = typeof albumReportPath === "function" ? albumReportPath(path) : String(path || "");
      return this.recordUpdateUndoStore().get(key) || null;
    } catch (_) {
      return null;
    }
  }

  apiRecordUpdateCapable() {
    try {
      const report = typeof this.albumReportState === "function"
        ? this.albumReportState()?.report
        : null;
      return typeof recordSheetHasValuesCapability === "function"
        && recordSheetHasValuesCapability(report);
    } catch (_) {
      return false;
    }
  }

  recordSpawnJson(args, decode, options = {}) {
    const opts = recordJsonObject(options) ? options : {};
    return bobSpawnJson(args, decode, {
      ...opts,
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: RECORD_UPDATE_TIMEOUT_MS,
      maxBuffer: RECORD_UPDATE_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  recordSpawnShow(typeId, stem, options = {}) {
    return this.recordSpawnJson(
      recordShowArgs(typeId, stem),
      recordDecodeShowReport,
      { ...options, commandLabel: "bob records show" },
    );
  }

  recordSpawnUpdate(typeId, stem, envelopeText, options = {}) {
    const opts = recordJsonObject(options) ? options : {};
    const dryRun = opts.dryRun === true;
    return this.recordSpawnJson(
      recordUpdateArgs(typeId, stem, { dryRun }),
      recordDecodeUpdateReport,
      {
        ...opts,
        stdin: typeof envelopeText === "string" ? envelopeText : "",
        commandLabel: dryRun ? "bob records update -d" : "bob records update",
      },
    );
  }

  apiRecordShow(typeId, stem, options = {}) {
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Album data has unloaded." });
    }
    return this.recordSpawnShow(typeId, stem, options);
  }

  apiRecordUpdatePreview(typeId, stem, envelopeText, options = {}) {
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Album data has unloaded." });
    }
    if (!this.apiRecordUpdateCapable()) {
      return Promise.resolve({
        ok: false,
        code: "needs-bob",
        message: "Update bob (just install) to edit records here.",
      });
    }
    return this.recordSpawnUpdate(typeId, stem, envelopeText, { ...options, dryRun: true });
  }

  apiRecordUpdateApply(typeId, stem, envelopeText, options = {}) {
    const opts = recordJsonObject(options) ? options : {};
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Album data has unloaded." });
    }
    if (!this.apiRecordUpdateCapable()) {
      return Promise.resolve({
        ok: false,
        code: "needs-bob",
        message: "Update bob (just install) to edit records here.",
      });
    }
    if (this.recordUpdateFlight) {
      return Promise.resolve({
        ok: false,
        code: "apply-busy",
        message: "Another record apply is already running.",
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
        return { ok: false, code: "unloaded", message: "Album data has unloaded." };
      }
      if (this.recordUpdateFlight && this.recordUpdateFlight !== applyPromise) {
        return {
          ok: false,
          code: "apply-busy",
          message: "Another record apply is already running.",
          hint: "Wait for it to settle, then preview again.",
        };
      }
      this.recordUpdateBusy = true;
      for (const ownPath of ownPaths) this.albumUpdateOwnPathsStore().add(ownPath);
      let outcome;
      try {
        try {
          outcome = await this.recordSpawnUpdate(typeId, stem, envelopeText, { ...opts, dryRun: false });
        } catch (error) {
          outcome = {
            ok: false,
            code: "failed",
            message: error && error.message ? String(error.message) : "bob records update failed.",
          };
        }
        const wrote = Boolean(
          outcome && outcome.ok && outcome.report && outcome.report.ok === true &&
          outcome.report.dry_run === false && guardedUpdateReportChanged(outcome.report),
        );
        const unknown = Boolean(outcome && !outcome.ok && (outcome.code === "timeout" || outcome.code === "failed"));
        if (this.albumDataActive === false || (this.albumDataEpoch || 0) !== epoch) {
          return { ...outcome, refreshed: this.albumReportState?.() || null, wrote, unknown };
        }
        let refreshed = this.albumReportState?.() || null;
        if (wrote || unknown) {
          try { refreshed = this.apiAlbumInvalidate("record-update"); } catch (_) {}
        }
        return { ...outcome, refreshed, wrote, unknown };
      } finally {
        this.recordUpdateBusy = false;
        if (this.recordUpdateFlight === applyPromise) this.recordUpdateFlight = null;
        for (const ownPath of ownPaths) this.albumUpdateOwnPathsStore().delete(ownPath);
      }
    };
    const applyPromise = Promise.resolve().then(run);
    this.recordUpdateFlight = applyPromise;
    return applyPromise;
  }
}
