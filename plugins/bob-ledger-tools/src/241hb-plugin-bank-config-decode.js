// Bank `config` report JSON boundary (bob-cli-lt setup-header). Decodes
// `bob bank config -f json` without duplicating accounting: the effective
// setup plus fully located findings. Tolerates absent fields; an older bob
// without the subcommand decodes to `unsupported`, never a failure.

// An older bob has no `bank config` subcommand: clap exits 2 with usage on
// stderr and no JSON on stdout. Decode that as `unsupported` (the "needs a
// newer bob" state), never as a config failure.
function bankConfigUnsupported(stdout, stderr, exitCode) {
  if (exitCode !== 2) {
    return false;
  }
  const text = [String(stdout || ""), String(stderr || "")].join("\n");
  return /unrecognized subcommand|unknown subcommand/i.test(text)
    && /config/i.test(text);
}

function bankUnsupportedConfig(commandLabel, stderr) {
  return {
    ok: false,
    code: "unsupported",
    message: `${commandLabel} needs a newer bob — run bob update.`,
    detail: statsFirstLine(stderr),
  };
}

function bankConfigState(value) {
  return value === "valid" || value === "invalid" || value === "missing" || value === "teaching_empty"
    ? value
    : null;
}

function bankConfigLine(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function bankNormalizeConfigCategory(value) {
  if (!bankJsonObject(value) || bankText(value.key) === null || bankText(value.label) === null) {
    return null;
  }
  const line = value.line === null || value.line === undefined ? null : bankConfigLine(value.line);
  if (value.line !== null && value.line !== undefined && line === null) {
    return null;
  }
  const sourceLine = value.source_line === null || value.source_line === undefined
    ? null
    : bankConfigLine(value.source_line);
  return {
    key: value.key,
    emoji: bankText(value.emoji) || "",
    label: value.label,
    builtin: value.builtin === true,
    declared: value.declared !== false,
    hotkey: bankNormalizeHotkey(value.hotkey),
    hotkey_source: value.hotkey_source === "explicit" || value.hotkey_source === "builtin_default"
      || value.hotkey_source === "derived" || value.hotkey_source === "none"
      ? value.hotkey_source
      : "none",
    group: bankNormalizeGroup(value.group),
    hidden: value.hidden === true,
    line,
    source_line: sourceLine,
    rows: bankCount(value.rows),
    rule_refs: bankCount(value.rule_refs),
  };
}

function bankNormalizeConfigAccount(value) {
  if (!bankJsonObject(value) || bankText(value.alias) === null || bankText(value.label) === null) {
    return null;
  }
  const balanceRaw = value.balance_cents === undefined ? null : value.balance_cents;
  const deltaRaw = value.delta_cents === undefined ? null : value.delta_cents;
  const balance = bankSafeCents(balanceRaw, { allowNull: true });
  const delta = bankSafeCents(deltaRaw, { allowNull: true });
  if (!balance.ok || !delta.ok) {
    return null;
  }
  return {
    alias: value.alias,
    label: value.label,
    kind: bankString(value.kind),
    default: value.default === true,
    start: bankString(value.start),
    line: value.line === null || value.line === undefined ? null : bankConfigLine(value.line),
    source_line: value.source_line === null || value.source_line === undefined
      ? null
      : bankConfigLine(value.source_line),
    rows: value.rows === null || value.rows === undefined ? null : bankCount(value.rows),
    journal_events: value.journal_events === null || value.journal_events === undefined
      ? null
      : bankCount(value.journal_events),
    status: bankString(value.status),
    hint: bankText(value.hint),
    last_import: value.last_import === null || value.last_import === undefined
      ? null
      : bankString(value.last_import),
    balance_cents: balance.value,
    balance_asof: value.balance_asof === null || value.balance_asof === undefined
      ? null
      : bankString(value.balance_asof),
    delta_cents: delta.value,
  };
}

function bankNormalizeConfigRule(value) {
  if (!bankJsonObject(value) || bankText(value.match) === null) {
    return null;
  }
  const line = value.line === null || value.line === undefined ? null : bankConfigLine(value.line);
  const sourceLine = value.source_line === null || value.source_line === undefined
    ? null
    : bankConfigLine(value.source_line);
  return {
    index: Number.isInteger(value.index) && value.index >= 0 ? value.index : null,
    match: value.match,
    payee: value.payee === null || value.payee === undefined ? null : bankText(value.payee),
    cat: value.cat === null || value.cat === undefined ? null : bankText(value.cat),
    link: value.link === null || value.link === undefined ? null : bankText(value.link),
    line: line !== null ? line : sourceLine,
    source_line: sourceLine !== null ? sourceLine : line,
  };
}

function bankNormalizeConfigFinding(value) {
  if (!bankJsonObject(value) || bankText(value.message) === null) {
    return null;
  }
  const line = value.line === null || value.line === undefined ? null : bankConfigLine(value.line);
  if (value.line !== null && value.line !== undefined && line === null) {
    return null;
  }
  return {
    code: bankString(value.code),
    severity: value.severity === "warning" ? "warning" : "error",
    path: bankString(value.path),
    line,
    key_path: value.key_path === null || value.key_path === undefined ? null : bankText(value.key_path),
    message: value.message,
    hint: value.hint === null || value.hint === undefined ? null : bankText(value.hint),
  };
}

function bankNormalizeConfigStaleAfter(value) {
  if (value === null || value === undefined) {
    return { days: 10, explicit: false, line: null };
  }
  if (!bankJsonObject(value)) {
    return null;
  }
  const days = bankCount(value.days);
  if (days === null) {
    return null;
  }
  return {
    days,
    explicit: value.explicit === true,
    line: value.line === null || value.line === undefined ? null : bankConfigLine(value.line),
  };
}

function bankNormalizeConfigFreeKeys(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry.length === 1);
}

// `bob bank config -f json`: the effective bank setup plus fully located
// findings. Unlike list/report, `ok: false` is a state here (invalid, missing,
// teaching_empty) with partial data — never a spawn failure.
function bankDecodeConfig(stdout, stderr, exitCode = null) {
  if (bankConfigUnsupported(stdout, stderr, exitCode)) {
    return bankUnsupportedConfig("bob bank config", stderr);
  }
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return bankFail("bad-json", "bob bank config returned output that is not JSON.", stderr);
  }
  if (!bankJsonObject(body)) {
    return bankFail("bad-shape", "bob bank config returned an unexpected JSON shape.", stderr);
  }
  if (body.schema_version !== BANK_SCHEMA_VERSION) {
    return bankFail(
      "schema-mismatch",
      `bob bank config returned schema ${String(body.schema_version)}, this block reads schema ${BANK_SCHEMA_VERSION}.`,
      stderr,
    );
  }
  const state = bankConfigState(body.state);
  // A bare failure without a state is a real error, not a config state.
  if (body.ok === false && (state === null || state === "valid")) {
    const inner = bankJsonObject(body.error) ? body.error : {};
    const message = bankString(inner.message)
      || (typeof body.error === "string" && body.error ? body.error : null)
      || "bob bank config reported an error.";
    return {
      ok: false,
      code: bankString(inner.code) || "bob-error",
      message,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok !== true && body.ok !== false) {
    return bankFail("bad-shape", "bob bank config returned a report without ok: true.", stderr);
  }
  if (state === null) {
    return bankFail("bad-shape", "bob bank config returned a report without a state.", stderr);
  }
  const categories = [];
  for (const entry of Array.isArray(body.categories) ? body.categories : []) {
    const normalized = bankNormalizeConfigCategory(entry);
    if (!normalized) {
      return bankFail("bad-shape", "bob bank config returned a malformed category.", stderr);
    }
    categories.push(normalized);
  }
  const accounts = [];
  for (const entry of Array.isArray(body.accounts) ? body.accounts : []) {
    const normalized = bankNormalizeConfigAccount(entry);
    if (!normalized) {
      return bankFail("bad-shape", "bob bank config returned a malformed account.", stderr);
    }
    accounts.push(normalized);
  }
  const rules = [];
  for (const entry of Array.isArray(body.rules) ? body.rules : []) {
    const normalized = bankNormalizeConfigRule(entry);
    if (!normalized) {
      return bankFail("bad-shape", "bob bank config returned a malformed rule.", stderr);
    }
    rules.push(normalized);
  }
  const findings = [];
  for (const entry of Array.isArray(body.findings) ? body.findings : []) {
    const normalized = bankNormalizeConfigFinding(entry);
    if (!normalized) {
      return bankFail("bad-shape", "bob bank config returned a malformed finding.", stderr);
    }
    findings.push(normalized);
  }
  const staleAfter = bankNormalizeConfigStaleAfter(body.stale_after);
  if (!staleAfter) {
    return bankFail("bad-shape", "bob bank config returned a malformed stale_after.", stderr);
  }
  return {
    ok: true,
    report: {
      schema_version: BANK_SCHEMA_VERSION,
      command: "config",
      ok: body.ok,
      state,
      teaching_empty: body.teaching_empty === true || state === "teaching_empty",
      partial: body.partial === true,
      today: bankString(body.today),
      path: bankString(body.path),
      line: body.line === null || body.line === undefined ? null : bankConfigLine(body.line),
      fingerprint: bankString(body.fingerprint) || bankString(body.config_fingerprint),
      accounts,
      categories,
      free_hotkeys: bankNormalizeConfigFreeKeys(body.free_hotkeys),
      rules,
      stale_after: staleAfter,
      findings,
      issues: bankJsonObject(body.issues)
        ? {
          errors: bankCount(body.issues.errors) || 0,
          warnings: bankCount(body.issues.warnings) || 0,
        }
        : {
          errors: findings.filter((entry) => entry.severity === "error").length,
          warnings: findings.filter((entry) => entry.severity === "warning").length,
        },
      starter: body.starter === null || body.starter === undefined ? null : bankText(body.starter),
    },
  };
}

