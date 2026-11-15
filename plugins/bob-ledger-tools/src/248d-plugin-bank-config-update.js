// Bank config update wire helpers. `bob bank config update` is the only
// writer of bank: YAML; these helpers build its argv and envelope and
// decode its typed result. Report decoders stay additive: unknown future
// keys are preserved by validating the wire shape, never reinterpreted.
const BANK_CONFIG_UPDATE_SCHEMA_VERSION = 1;
const BANK_CONFIG_UPDATE_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const BANK_CONFIG_UPDATE_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS = GUARDED_UPDATE_PREVIEW_DEBOUNCE_MS;
const BANK_CONFIG_UPDATE_HUB_PATH = "bank.md";
const BANK_CONFIG_HOTKEY_ORDER = "abcdefghijklmnopqrstuvwxyz1234567890";
const BANK_CONFIG_RESERVED_HOTKEY = "q";

function bankConfigVaultSyncArgs() {
  return ["vault-sync"];
}

function bankConfigUpdateArgs(options = {}) {
  const opts = bankJsonObject(options) ? options : {};
  const args = ["bank", "config", "update", "-f", "json", "-i", "-"];
  if (opts.dryRun === true) {
    args.push("-d");
  }
  return args;
}

function bankConfigUpdateEnvelope(expect, ops) {
  return {
    schema_version: BANK_CONFIG_UPDATE_SCHEMA_VERSION,
    expect: String(expect),
    ops: Array.isArray(ops) ? ops : [],
  };
}

function bankConfigUpdateEnvelopeText(expect, ops) {
  return JSON.stringify(bankConfigUpdateEnvelope(expect, ops));
}

function bankConfigUpdateCount(value) {
  return value === null || value === undefined || (Number.isInteger(value) && value >= 0);
}

function bankConfigUpdateNullableString(value) {
  return value === null || value === undefined || typeof value === "string";
}

function bankConfigUpdatePerOpShape(entry) {
  if (!bankJsonObject(entry)) {
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
  if (!bankConfigUpdateNullableString(entry.key) || !bankConfigUpdateNullableString(entry.hotkey)) {
    return false;
  }
  if (!bankConfigUpdateCount(entry.rows) || !bankConfigUpdateCount(entry.rule_refs)) {
    return false;
  }
  return true;
}

function bankConfigUpdateFailureShape(failure) {
  if (failure === null || failure === undefined) {
    return true;
  }
  if (!bankJsonObject(failure)) {
    return false;
  }
  if (typeof failure.code !== "string" || !failure.code) {
    return false;
  }
  if (typeof failure.message !== "string") {
    return false;
  }
  return bankConfigUpdateNullableString(failure.hint) &&
    bankConfigUpdateCount(failure.op_index) &&
    bankConfigUpdateNullableString(failure.key_path) &&
    bankConfigUpdateCount(failure.line) &&
    bankConfigUpdateCount(failure.affected);
}

function bankConfigUpdateCommitShape(commit) {
  if (commit === null || commit === undefined) {
    return true;
  }
  return bankJsonObject(commit) &&
    typeof commit.sha === "string" &&
    typeof commit.subject === "string";
}

function bankConfigUpdateSyncShape(sync) {
  if (sync === null || sync === undefined) {
    return true;
  }
  return bankJsonObject(sync);
}

function bankConfigUpdateHotkeysShape(hotkeys) {
  if (hotkeys === null || hotkeys === undefined) {
    return true;
  }
  if (!bankJsonObject(hotkeys)) {
    return false;
  }
  if (hotkeys.shifted !== undefined && !Array.isArray(hotkeys.shifted)) {
    return false;
  }
  if (hotkeys.free !== undefined && !Array.isArray(hotkeys.free)) {
    return false;
  }
  return true;
}

function bankConfigUpdateReportShape(body) {
  if (!bankJsonObject(body)) {
    return false;
  }
  if (body.schema_version !== BANK_CONFIG_UPDATE_SCHEMA_VERSION) {
    return false;
  }
  if (body.command !== "update" || typeof body.ok !== "boolean") {
    return false;
  }
  if (typeof body.dry_run !== "boolean" || typeof body.changed !== "boolean") {
    return false;
  }
  if (typeof body.before_fingerprint !== "string" || typeof body.after_fingerprint !== "string") {
    return false;
  }
  if (typeof body.consequence !== "string") {
    return false;
  }
  if (!Array.isArray(body.per_op) || !body.per_op.every(bankConfigUpdatePerOpShape)) {
    return false;
  }
  if (!bankConfigUpdateHotkeysShape(body.hotkeys)) {
    return false;
  }
  if (body.categories !== undefined && body.categories !== null && !Array.isArray(body.categories)) {
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
  return bankConfigUpdateCommitShape(body.commit) &&
    bankConfigUpdateSyncShape(body.sync) &&
    bankConfigUpdateFailureShape(body.failure);
}

function bankDecodeConfigUpdateReport(stdout, stderr = "", exitCode = null) {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    if (bankConfigUnsupported(stdout, stderr, exitCode)) {
      return bankUnsupportedConfig("bob bank config update", stderr);
    }
    return {
      ok: false,
      code: "bad-json",
      message: "bob bank config update returned invalid JSON.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  if (!bankConfigUpdateReportShape(body)) {
    if (bankJsonObject(body) && body.schema_version !== BANK_CONFIG_UPDATE_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "schema-mismatch",
        message: "bob bank config update uses a different schema.",
        detail: statsFirstLine(stderr),
        exitCode,
      };
    }
    return {
      ok: false,
      code: "bad-shape",
      message: "bob bank config update returned an incomplete report.",
      detail: statsFirstLine(stderr),
      exitCode,
    };
  }
  const categories = Array.isArray(body.categories)
    ? body.categories.map((entry) => bankNormalizeConfigCategory(entry) || bankNormalizeCategory(entry)).filter(Boolean)
    : [];
  return {
    ok: true,
    report: {
      ...body,
      categories,
    },
    exitCode,
  };
}

function bankDecodeConfigVaultSyncResult(stdout, stderr = "", exitCode = null) {
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

function bankIsStaleConfigUpdateCode(code) {
  return code === "stale_config";
}

function bankConfigUpdateErrorModel(result) {
  const source = bankJsonObject(result) ? result : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Bank setup editing needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found") {
    return { code, hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  }
  if (code === "unsupported") {
    return { code, hint: "Setup needs a newer bob — run bob update." };
  }
  if (code === "timeout") {
    return { code, hint: "bob bank config update timed out. Refresh and reconcile before retrying; never blind-retry." };
  }
  if (code === "stdin-failed") {
    return { code, hint: "The update envelope never reached bob. Nothing was written; preview again." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "The config update failed. Refresh before retrying.",
  };
}

function bankConfigFingerprintFromReport(report) {
  if (!bankJsonObject(report)) {
    return "";
  }
  return bankString(report.config_fingerprint) || bankString(report.fingerprint) || "";
}

function bankConfigFreeHotkeys(categories) {
  const claimed = new Set();
  claimed.add(BANK_CONFIG_RESERVED_HOTKEY);
  for (const entry of Array.isArray(categories) ? categories : []) {
    const hotkey = typeof entry?.hotkey === "string" && entry.hotkey.length === 1
      ? entry.hotkey.toLowerCase()
      : null;
    if (hotkey) claimed.add(hotkey);
  }
  return [...BANK_CONFIG_HOTKEY_ORDER].filter((key) => !claimed.has(key));
}

function bankConfigHotkeyOwner(categories, hotkey) {
  const wanted = typeof hotkey === "string" && hotkey.length === 1 ? hotkey.toLowerCase() : "";
  if (!wanted) return null;
  for (const entry of Array.isArray(categories) ? categories : []) {
    const claimed = typeof entry?.hotkey === "string" && entry.hotkey.length === 1
      ? entry.hotkey.toLowerCase()
      : "";
    if (claimed === wanted) return entry;
  }
  return null;
}

function bankConfigIsHotkeyChar(value) {
  return typeof value === "string" && value.length === 1 && /[a-z0-9]/i.test(value);
}

function bankConfigGroups(categories) {
  const groups = [];
  const seen = new Set();
  for (const entry of Array.isArray(categories) ? categories : []) {
    const group = typeof entry?.group === "string" && entry.group.trim() ? entry.group.trim() : null;
    if (!group || seen.has(group)) continue;
    seen.add(group);
    groups.push(group);
  }
  return groups;
}

function bankConfigAddOp(draft) {
  const label = typeof draft?.label === "string" ? draft.label.trim() : "";
  if (!label) return null;
  const op = { op: "category.add", label };
  const group = typeof draft?.group === "string" ? draft.group.trim() : "";
  if (group) op.group = group;
  const hotkey = typeof draft?.hotkey === "string" ? draft.hotkey.trim().toLowerCase() : "";
  if (hotkey) op.hotkey = hotkey;
  if (draft?.hidden === true) op.hidden = true;
  return op;
}
