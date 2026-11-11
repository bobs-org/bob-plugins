// Bank action service (bob-cli-kd.6.1.2): exact-selection acknowledgment,
// open-today / acknowledge-day commands, Enter continuation, category
// suggestions, and guarded ID-less checkbox edits. Pure argv/decoders and
// snapshot helpers are unit-tested; the mixin owns the desktop spawn
// boundary and cursor placement. Bob owns every total; this fragment only
// moves JSON and checkbox bytes.

// Defensive Obsidian suggest import: EditorSuggest exists on desktop but
// not in the node test stubs, so category suggestions degrade to a pure
// helper there.
let BankEditorSuggest = null;
try {
  const bankObsidianMod = require("obsidian");
  BankEditorSuggest =
    (bankObsidianMod && bankObsidianMod.EditorSuggest) || null;
} catch (error) {
  BankEditorSuggest = null;
}

const BANK_ENSURE_COMMAND_LABEL = "bob bank ensure";
const BANK_ACK_COMMAND_LABEL = "bob bank ack";
// Plain checkbox bytes for a fresh or acknowledged bank row.
const BANK_NEW_ROW_TEXT = "- [x] $";
const BANK_ROW_TASK_GESTURE_NOTICE =
  "Bank row · not a task status";
// Guards stay quiet inside tight loops; commands surface these.
const BANK_ACK_EMPTY_NOTICE = "Bank: nothing waiting on this day";
const BANK_ACK_BUSY_NOTICE = "Bank: acknowledgment already running";
const BANK_ACK_NO_DAY_NOTICE = "Bank: put the cursor on a bank day first";
const BANK_ACK_NO_IDS_NOTICE =
  "Bank: no imported rows here — tick each row's own checkbox";
const BANK_ENSURE_NO_PATH_NOTICE = "Bank: ensure returned no note path";

function bankActionText(value) {
  return typeof value === "string" ? value : "";
}

function bankEnsureArgsForDay(day) {
  const raw = bankActionText(day).trim();
  const args = ["bank", "ensure"];
  if (raw) {
    args.push("-D", raw);
  }
  args.push("-f", "json");
  return args;
}

function bankAckArgsForIds(ids) {
  const deduped = bankDedupeIds(ids);
  return ["bank", "ack", ...deduped, "-f", "json"];
}

function bankNormalizeAckId(raw) {
  const trimmed = bankActionText(raw).trim();
  if (!trimmed) {
    return "";
  }
  const noCaret = trimmed.startsWith("^") ? trimmed.slice(1) : trimmed;
  const noPrefix = noCaret.toLowerCase().startsWith("bank-")
    ? noCaret.slice(5)
    : noCaret;
  return noPrefix.trim().toLowerCase();
}

function bankDedupeIds(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const text = bankActionText(raw).trim();
    if (!text) {
      continue;
    }
    const key = bankNormalizeAckId(text);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(text);
  }
  return out;
}

function bankDecodeEnsureResponse(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: `${BANK_ENSURE_COMMAND_LABEL} returned output that is not JSON.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${BANK_ENSURE_COMMAND_LABEL} returned an unexpected JSON shape.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== BANK_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: `${BANK_ENSURE_COMMAND_LABEL} returned schema ${String(
        body.schema_version,
      )}, this block reads schema ${BANK_SCHEMA_VERSION}.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const inner =
      body.error !== null && typeof body.error === "object" && !Array.isArray(body.error)
        ? body.error
        : {};
    return {
      ok: false,
      code: typeof inner.code === "string" && inner.code ? inner.code : "bob-error",
      message:
        (typeof inner.message === "string" && inner.message) ||
        (typeof body.error === "string" && body.error) ||
        `${BANK_ENSURE_COMMAND_LABEL} reported an error.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok !== true) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${BANK_ENSURE_COMMAND_LABEL} returned a report without ok: true.`,
      detail: statsFirstLine(stderr),
    };
  }
  const path = bankString(body.path);
  const line = bankCount(body.line);
  if (!path || line === null) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${BANK_ENSURE_COMMAND_LABEL} returned no note path or row line.`,
      detail: statsFirstLine(stderr),
    };
  }
  return {
    ok: true,
    report: {
      schema_version: BANK_SCHEMA_VERSION,
      today: bankString(body.today),
      path,
      line,
      day: bankString(body.day),
      created_note: body.created_note === true,
      created_heading: body.created_heading === true,
      categories: Array.isArray(body.categories)
        ? body.categories.map(bankNormalizeCategory).filter(Boolean)
        : [],
      accounts: Array.isArray(body.accounts)
        ? body.accounts.map(bankNormalizeAccount).filter(Boolean)
        : [],
    },
  };
}

function bankDecodeAckResponse(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: `${BANK_ACK_COMMAND_LABEL} returned output that is not JSON.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${BANK_ACK_COMMAND_LABEL} returned an unexpected JSON shape.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== BANK_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: `${BANK_ACK_COMMAND_LABEL} returned schema ${String(
        body.schema_version,
      )}, this block reads schema ${BANK_SCHEMA_VERSION}.`,
      detail: statsFirstLine(stderr),
    };
  }
  // A reported failure never needs an acknowledged list to be
  // understood: surface the CLI error first, then validate the shape.
  if (body.ok === false) {
    const inner =
      body.error !== null && typeof body.error === "object" && !Array.isArray(body.error)
        ? body.error
        : {};
    const unknown = Array.isArray(body.unknown) ? body.unknown : [];
    return {
      ok: false,
      code: typeof inner.code === "string" && inner.code ? inner.code : "bob-error",
      message:
        (typeof inner.message === "string" && inner.message) ||
        (unknown.length > 0
          ? `${BANK_ACK_COMMAND_LABEL} did not recognize: ${unknown.join(", ")}.`
          : `${BANK_ACK_COMMAND_LABEL} reported an error.`),
      detail: statsFirstLine(stderr),
      report: {
        acknowledged: Array.isArray(body.acknowledged) ? body.acknowledged : [],
        already: Array.isArray(body.already) ? body.already : [],
        unknown,
      },
    };
  }
  const acknowledged = Array.isArray(body.acknowledged) ? body.acknowledged : null;
  const already = Array.isArray(body.already) ? body.already : [];
  const unknown = Array.isArray(body.unknown) ? body.unknown : [];
  if (!acknowledged) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${BANK_ACK_COMMAND_LABEL} returned no acknowledged list.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "unknown-ids",
      message: `${BANK_ACK_COMMAND_LABEL} did not recognize: ${unknown.join(", ")}.`,
      detail: statsFirstLine(stderr),
      report: { acknowledged, already, unknown },
    };
  }
  return {
    ok: true,
    report: {
      schema_version: BANK_SCHEMA_VERSION,
      today: bankString(body.today),
      acknowledged,
      already,
      unknown,
    },
  };
}

// Waiting imported rows for one day, in displayed row order. ID-less rows
// are counted, never submitted: they need their own checkbox edit.
function bankDayWaitingSnapshot(rows, dateIso) {
  const ids = [];
  let idLess = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.date !== dateIso || row.acknowledged) {
      continue;
    }
    // Source rows carry ackId (`^bank-<hex>`); JSON rows carry id.
    const ackId = typeof row.ackId === "string" && row.ackId.trim()
      ? row.ackId.trim()
      : typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : "";
    if (ackId) {
      ids.push(ackId);
    } else {
      idLess += 1;
    }
  }
  return { ids: bankDedupeIds(ids), idLess };
}

function bankAckResultSummary(report, idLess = 0) {
  const acknowledged = report && Array.isArray(report.acknowledged)
    ? report.acknowledged.length
    : 0;
  const already = report && Array.isArray(report.already) ? report.already.length : 0;
  const remaining = Number.isInteger(idLess) && idLess > 0 ? idLess : 0;
  const parts = [];
  if (acknowledged > 0) {
    parts.push(`acknowledged ${acknowledged}`);
  }
  if (already > 0) {
    parts.push(`${already} already done`);
  }
  let text = parts.length > 0 ? `Bank: ${parts.join(", ")}` : "Bank: nothing new";
  if (remaining > 0) {
    text += ` · ${remaining} row${remaining === 1 ? "" : "s"} still need${
      remaining === 1 ? "s" : ""
    } their own checkbox`;
  }
  return {
    text,
    acknowledged,
    already,
    idLess: remaining,
    // Never report a day fully acknowledged while ID-less rows remain.
    fullyAcknowledged: acknowledged > 0 && remaining === 0,
  };
}

// Day section containing a 0-based cursor line, or null. Boundaries come
// from the shared source scan so cards and commands agree.
function bankCursorDayContext(scan, cursorLine) {
  if (!scan || !Array.isArray(scan.days)) {
    return null;
  }
  const line = Number(cursorLine);
  if (!Number.isInteger(line) || line < 0) {
    return null;
  }
  let current = null;
  for (const day of scan.days) {
    if (!day || !Number.isInteger(day.line)) {
      continue;
    }
    const headingLine = day.line - 1;
    if (headingLine <= line) {
      current = day;
    } else {
      break;
    }
  }
  return current;
}

// Guarded ID-less checkbox plan: the live buffer must still show exactly
// the rendered row, open, in a bank month note with day context. Anything
// else refuses without touching bytes.
function bankGuardedCheckboxPlan(path, source, cursorLine, expectedLineText) {
  if (bankMonthFromPath(path) === null) {
    return { ok: false, reason: "not-bank-note" };
  }
  if (typeof source !== "string") {
    return { ok: false, reason: "not-a-string" };
  }
  const lines = source.replace(/^\uFEFF/, "").split("\n");
  if (!Number.isInteger(cursorLine) || cursorLine < 0 || cursorLine >= lines.length) {
    return { ok: false, reason: "out-of-range" };
  }
  const current = lines[cursorLine].replace(/\r$/, "");
  if (bankActionText(expectedLineText) !== "" && current !== bankActionText(expectedLineText)) {
    return { ok: false, reason: "moved-or-edited" };
  }
  const lineNumber = Number(cursorLine) + 1;
  const scan = bankScanSource(path, source);
  const row = bankRecognizeRow(path, source, lineNumber);
  if (!row) {
    return { ok: false, reason: "not-a-row" };
  }
  if (row.acknowledged) {
    return { ok: false, reason: "already-acknowledged" };
  }
  // Source rows carry ackId (`^bank-<hex>`); JSON rows carry id. Either
  // way this row is imported, so only the bulk ack path may touch it.
  const rowAckId = typeof row.ackId === "string" && row.ackId.trim()
    ? row.ackId.trim()
    : typeof row.id === "string"
      ? row.id.trim()
      : "";
  if (rowAckId) {
    return { ok: false, reason: "has-id" };
  }
  const day = bankCursorDayContext(scan, cursorLine);
  if (!day || day.date !== row.date) {
    return { ok: false, reason: "no-day-context" };
  }
  // The status byte sits one char inside the `[ ]` span: replace exactly
  // one byte so the rest of the row (and undo history) is untouched.
  const statusAt = row.spans.checkbox.start + 1;
  return {
    ok: true,
    line: cursorLine,
    statusStart: statusAt,
    statusEnd: statusAt + 1,
    date: row.date,
  };
}

// Pure Enter behavior for bank month notes. Only a complete row's end
// continues, and only an exactly-empty stub clears; everything else falls
// through to ordinary Enter.
function bankEnterDecision(path, source, cursorLine, cursorCh, hasSelection) {
  if (bankMonthFromPath(path) === null) {
    return { action: "none", reason: "not-bank-note" };
  }
  if (hasSelection === true) {
    return { action: "none", reason: "selection" };
  }
  if (typeof source !== "string") {
    return { action: "none", reason: "not-a-string" };
  }
  const lines = source.replace(/^\uFEFF/, "").split("\n");
  if (!Number.isInteger(cursorLine) || cursorLine < 0 || cursorLine >= lines.length) {
    return { action: "none", reason: "out-of-range" };
  }
  const raw = lines[cursorLine].replace(/\r$/, "");
  if (!Number.isInteger(cursorCh) || cursorCh < raw.length) {
    return { action: "none", reason: "mid-line" };
  }
  const fenced = bankSourceFenceLines(source);
  if (fenced.has(cursorLine)) {
    return { action: "none", reason: "fenced" };
  }
  const classified = bankClassifyLine(raw);
  if (classified.kind === "stub") {
    const trimmed = raw.trim();
    if (trimmed === "- [x] $" || trimmed === "- [ ] $") {
      return { action: "clear-stub", line: cursorLine };
    }
    return { action: "none", reason: "not-an-empty-stub" };
  }
  if (classified.kind !== "checkbox") {
    return { action: "none", reason: "not-a-row" };
  }
  if (classified.status !== "x" && classified.status !== "X") {
    return { action: "none", reason: "not-complete" };
  }
  if (classified.lead.kind !== "amount") {
    return { action: "none", reason: "unparsed-amount" };
  }
  const row = bankRecognizeRow(path, source, Number(cursorLine) + 1);
  if (!row) {
    return { action: "none", reason: "outside-day" };
  }
  return { action: "insert-ack-row", line: cursorLine };
}

// Category suggestions in declared JSON order. Matching is a
// case-insensitive substring over key, label, and emoji; an empty query
// lists every category.
function bankCategoryCompletions(categories, query) {
  const list = Array.isArray(categories) ? categories : [];
  const needle = bankActionText(query).trim().toLowerCase();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry.key !== "string" || !entry.key) {
      continue;
    }
    const haystack = `${entry.key} ${bankActionText(entry.label)} ${bankActionText(entry.emoji)}`.toLowerCase();
    if (needle && haystack.indexOf(needle) === -1) {
      continue;
    }
    out.push({ key: entry.key, label: bankActionText(entry.label), emoji: bankActionText(entry.emoji) });
  }
  return out;
}

class BobLedgerToolsBankActionsMixin {
  // One spawn boundary for both bank write commands, mirroring
  // bankSpawnFetch conventions (vault env, timeout, bounded output).
  // Tests inject execFile/resolved through spawnOptions.
  bankSpawnBankCommand(args, decoder, label, spawnOptions = {}) {
    const injected = spawnOptions && typeof spawnOptions === "object" ? spawnOptions : {};
    return bobSpawnJson(args, decoder, {
      execFile: injected.execFile,
      resolved: injected.resolved,
      tried: injected.tried,
      commandLabel: label,
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function"
          ? this.statsVaultBasePath()
          : null,
      timeout: BOB_SPAWN_TIMEOUT_MS,
      maxBuffer: BOB_SPAWN_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  setupBankActions() {
    this.bankAckPending = false;
    this.bankCategorySuggest = null;
    this.addCommand({
      id: "bank-open-today",
      name: "Bank: open today",
      callback: () => {
        void this.bankEnsureOpenDay("today").catch((error) => {
          new Notice(`Bank: could not open today (${error && error.message ? error.message : error})`);
        });
      },
    });
    this.addCommand({
      id: "bank-ack-day",
      name: "Bank: acknowledge this day",
      editorCallback: (editor, view) => {
        void this.bankAckDayAtCursor(editor, view).catch((error) => {
          new Notice(`Bank: acknowledgment failed (${error && error.message ? error.message : error})`);
        });
      },
    });
    if (typeof this.registerEditorExtension === "function" && keymap && typeof keymap.of === "function") {
      this.registerEditorExtension(
        keymap.of([
          {
            key: "Enter",
            run: () => this.bankHandleEnter(),
          },
        ]),
      );
    }
    this.setupBankCategorySuggest();
  }

  teardownBankActions() {
    this.bankAckPending = false;
    try {
      if (this.bankCategorySuggest && typeof this.bankCategorySuggest.close === "function") {
        this.bankCategorySuggest.close();
      }
    } catch (error) {
      // Suggest teardown is best-effort.
    }
    this.bankCategorySuggest = null;
  }

  apiBankActions() {
    return Object.freeze({
      version: 1,
      ensureOpenDay: (day, options) => this.bankEnsureOpenDay(day, options),
      ackDayAtCursor: (editor, view) => this.bankAckDayAtCursor(editor, view),
      ackIds: (ids, options) => this.bankAckIds(ids, options),
      toggleIdLessRowAtCursor: (editor, expectedLineText) =>
        this.bankToggleIdLessRowAtCursor(editor, expectedLineText),
    });
  }

  bankActiveFilePath(view = null) {
    const file = (view && view.file) ||
      (this.app && this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    return file && typeof file.path === "string" ? file.path : "";
  }

  bankActiveEditor(view = null) {
    if (view && view.editor) {
      return view.editor;
    }
    try {
      const active = this.app && this.app.workspace &&
        typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
      if (active && active instanceof MarkdownView && active.editor) {
        return active.editor;
      }
    } catch (error) {
      // Editor lookup is best-effort.
    }
    return null;
  }

  // Open-today (and daily-chip) action: ensure the day, open its note, and
  // land the cursor on the returned next-row line. JSON lines are 1-based;
  // editor lines are 0-based. Never passes `-o`: one leaf, one open.
  async bankEnsureOpenDay(day, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const args = bankEnsureArgsForDay(day);
    const decoded = await this.bankSpawnBankCommand(
      args,
      bankDecodeEnsureResponse,
      BANK_ENSURE_COMMAND_LABEL,
      opts.spawnOptions,
    );
    if (!decoded || decoded.ok !== true || !decoded.report) {
      const message = (decoded && decoded.message) || `${BANK_ENSURE_COMMAND_LABEL} reported an error.`;
      new Notice(`Bank: ${message}`);
      return { ok: false, reason: (decoded && decoded.code) || "bob-error" };
    }
    const report = decoded.report;
    if (!report.path) {
      new Notice(`Bank: ${BANK_ENSURE_NO_PATH_NOTICE}`);
      return { ok: false, reason: "no-path" };
    }
    if (typeof this.apiBankInvalidate === "function") {
      try {
        this.apiBankInvalidate("ensure");
      } catch (error) {
        // Refresh is best-effort after a successful ensure.
      }
    }
    const opened = await this.bankOpenMonthPathAtLine(report.path, report.line);
    if (!opened) {
      new Notice("Bank: could not open the bank note");
      return { ok: false, reason: "open-failed", report };
    }
    return { ok: true, report };
  }

  async bankOpenMonthPathAtLine(path, oneBasedLine) {
    const target = bankActionText(path);
    if (!target) {
      return false;
    }
    const vault = this.app && this.app.vault;
    const file = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(target)
      : null;
    if (!file) {
      return false;
    }
    // Pending saves first: bob already wrote the file on disk, so flush
    // the in-memory buffer to avoid an external-change conflict.
    try {
      const leaves = this.app.workspace && typeof this.app.workspace.getLeavesOfType === "function"
        ? this.app.workspace.getLeavesOfType("markdown")
        : [];
      for (const leaf of Array.isArray(leaves) ? leaves : []) {
        const leafView = leaf && leaf.view;
        if (leafView && leafView.file && leafView.file.path === target && typeof leafView.save === "function") {
          await leafView.save();
        }
      }
    } catch (error) {
      // Save is best-effort; the open below still reloads.
    }
    let openedView = null;
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
      const openInActiveLeaf = nav && nav.api && nav.api.openFileInActiveLeaf;
      if (typeof openInActiveLeaf === "function") {
        const result = await openInActiveLeaf.call(nav.api, file);
        if (result && result.ok === true) {
          openedView = result.view || null;
        }
      }
    } catch (error) {
      openedView = null;
    }
    if (!openedView) {
      try {
        const workspace = this.app && this.app.workspace;
        const leaf = workspace && typeof workspace.getLeaf === "function" ? workspace.getLeaf(false) : null;
        if (leaf && typeof leaf.openFile === "function") {
          await leaf.openFile(file);
          openedView = leaf.view || null;
        }
      } catch (error) {
        openedView = null;
      }
    }
    const editor = (openedView && openedView.editor) || this.bankActiveEditor(openedView);
    if (!editor || typeof editor.getValue !== "function") {
      return Boolean(openedView);
    }
    const zeroBased = Math.max(0, Number(oneBasedLine || 1) - 1);
    try {
      if (typeof editor.setCursor === "function") {
        editor.setCursor({ line: zeroBased, ch: 0 });
      }
      if (typeof editor.focus === "function") {
        editor.focus();
      }
    } catch (error) {
      // Cursor placement is best-effort after a successful open.
    }
    return true;
  }

  // Acknowledge-this-day: snapshot the waiting IDs under the cursor and
  // submit exactly that set. Never recomputes at click time, never sends
  // an empty selection, never falls back to `ack -D`.
  async bankAckDayAtCursor(editor, view = null, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const path = this.bankActiveFilePath(view);
    if (!editor || typeof editor.getValue !== "function" || typeof editor.getCursor !== "function") {
      return { ok: false, reason: "no-editor" };
    }
    if (bankMonthFromPath(path) === null) {
      return { ok: false, reason: "not-bank-note" };
    }
    const source = String(editor.getValue());
    const cursor = editor.getCursor();
    const scan = bankScanSource(path, source);
    const day = bankCursorDayContext(scan, cursor && cursor.line);
    if (!day) {
      new Notice(`Bank: ${BANK_ACK_NO_DAY_NOTICE}`);
      return { ok: false, reason: "no-day" };
    }
    const snapshot = bankDayWaitingSnapshot(scan.rows, day.date);
    if (snapshot.ids.length === 0) {
      new Notice(`Bank: ${snapshot.idLess > 0 ? BANK_ACK_NO_IDS_NOTICE : BANK_ACK_EMPTY_NOTICE}`);
      return { ok: false, reason: snapshot.idLess > 0 ? "id-less-only" : "empty", day: day.date, idLess: snapshot.idLess };
    }
    return this.bankAckIds(snapshot.ids, { ...opts, label: day.date, idLess: snapshot.idLess });
  }

  // Bulk acknowledgment over an exact rendered snapshot (month/queue
  // cards pass their own IDs). Reports remaining ID-less rows and never
  // claims the day acknowledged while any remain.
  async bankAckIds(ids, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const idLess = Number.isInteger(opts.idLess) && opts.idLess > 0 ? opts.idLess : 0;
    const label = bankActionText(opts.label) || "this day";
    if (this.bankAckPending === true) {
      new Notice(`Bank: ${BANK_ACK_BUSY_NOTICE}`);
      return { ok: false, reason: "busy" };
    }
    const deduped = bankDedupeIds(ids);
    if (deduped.length === 0) {
      new Notice(`Bank: ${BANK_ACK_EMPTY_NOTICE}`);
      return { ok: false, reason: "empty" };
    }
    this.bankAckPending = true;
    try {
      const args = bankAckArgsForIds(deduped);
      const decoded = await this.bankSpawnBankCommand(
        args,
        bankDecodeAckResponse,
        BANK_ACK_COMMAND_LABEL,
        opts.spawnOptions,
      );
      if (!decoded || decoded.ok !== true || !decoded.report) {
        const message = (decoded && decoded.message) || `${BANK_ACK_COMMAND_LABEL} reported an error.`;
        new Notice(`Bank: ${message}`);
        return { ok: false, reason: (decoded && decoded.code) || "bob-error", label };
      }
      if (typeof this.apiBankInvalidate === "function") {
        try {
          this.apiBankInvalidate("ack");
        } catch (error) {
          // Refresh is best-effort after a successful ack.
        }
      }
      const summary = bankAckResultSummary(decoded.report, idLess);
      new Notice(summary.text);
      return { ok: true, ...summary, label };
    } finally {
      this.bankAckPending = false;
    }
  }

  // Individual ID-less queue checkbox: flip exactly one status byte after
  // verifying the live row still matches the rendered snapshot and its
  // day context. Refuses ambiguous, moved, or changed rows.
  bankToggleIdLessRowAtCursor(editor, expectedLineText = "") {
    if (!editor || typeof editor.getValue !== "function" || typeof editor.getCursor !== "function") {
      return { ok: false, reason: "no-editor" };
    }
    const path = this.bankActiveFilePath(null);
    const source = String(editor.getValue());
    const cursor = editor.getCursor();
    const plan = bankGuardedCheckboxPlan(path, source, cursor && cursor.line, expectedLineText);
    if (!plan.ok) {
      return plan;
    }
    try {
      editor.replaceRange(
        "x",
        { line: plan.line, ch: plan.statusStart },
        { line: plan.line, ch: plan.statusEnd },
      );
    } catch (error) {
      return { ok: false, reason: "write-failed" };
    }
    if (typeof this.apiBankInvalidate === "function") {
      try {
        this.apiBankInvalidate("ack-checkbox");
      } catch (error) {
        // Refresh is best-effort after a successful edit.
      }
    }
    return { ok: true, line: plan.line, date: plan.date };
  }

  bankExpansionGuardTripped(editor, path) {
    try {
      if (bankMonthFromPath(path || "") === null) {
        return false;
      }
      if (!editor || typeof editor.getCursor !== "function" || typeof editor.getLine !== "function") {
        return false;
      }
      const cursor = editor.getCursor();
      if (!cursor || !Number.isInteger(cursor.line)) {
        return false;
      }
      const kind = bankClassifyLine(editor.getLine(cursor.line) || "").kind;
      return kind === "checkbox" || kind === "stub" || kind === "amount-no-checkbox";
    } catch (error) {
      return false;
    }
  }

  bankHandleEnter() {
    try {
      const view = this.app && this.app.workspace && typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
      if (!view || !(view instanceof MarkdownView) || !view.editor || !view.file) {
        return false;
      }
      const editor = view.editor;
      const path = view.file.path || "";
      if (bankMonthFromPath(path) === null) {
        return false;
      }
      if (typeof editor.listSelections === "function") {
        const selections = editor.listSelections();
        if (!Array.isArray(selections) || selections.length !== 1) {
          return false;
        }
        const selection = selections[0];
        if (!sameEditorPosition(selection.anchor, selection.head)) {
          return false;
        }
      }
      if (typeof editor.getCursor !== "function" || typeof editor.getValue !== "function") {
        return false;
      }
      const cursor = editor.getCursor();
      const source = String(editor.getValue());
      const decision = bankEnterDecision(path, source, cursor.line, cursor.ch, false);
      if (decision.action === "insert-ack-row") {
        const anchor = { line: decision.line, ch: String(source.split("\n")[decision.line] || "").replace(/\r$/, "").length };
        editor.replaceRange(`\n${BANK_NEW_ROW_TEXT}`, anchor, anchor);
        if (typeof editor.setCursor === "function") {
          editor.setCursor({ line: decision.line + 1, ch: BANK_NEW_ROW_TEXT.length });
        }
        return true;
      }
      if (decision.action === "clear-stub") {
        const raw = String(source.split("\n")[decision.line] || "").replace(/\r$/, "");
        editor.replaceRange("", { line: decision.line, ch: 0 }, { line: decision.line, ch: raw.length });
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  bankLastCategories() {
    try {
      const store = typeof this.bankCacheStore === "function" ? this.bankCacheStore() : null;
      if (!store || typeof store.values !== "function") {
        return [];
      }
      for (const entry of store.values()) {
        const report = entry && entry.report;
        if (report && Array.isArray(report.categories) && report.categories.length > 0) {
          return report.categories;
        }
      }
    } catch (error) {
      // Category lookup is best-effort.
    }
    return [];
  }

  // `[cat:: ` suggestions from JSON categories in declared order. Only
  // the key is inserted. No default hotkey; the suggest owns its popup.
  setupBankCategorySuggest() {
    try {
      if (!BankEditorSuggest || typeof this.registerEditorSuggest !== "function") {
        return;
      }
      const plugin = this;
      class BankCategorySuggest extends BankEditorSuggest {
        constructor(app) {
          super(app, plugin);
          this.pluginRef = plugin;
        }

        onTrigger(cursor, editor, file) {
          try {
            const path = (file && file.path) || "";
            if (bankMonthFromPath(path) === null) {
              return null;
            }
            const line = editor.getLine(cursor.line) || "";
            const before = line.slice(0, cursor.ch);
            const match = before.match(/\[cat::\s*([^\]\n]*)$/);
            if (!match) {
              return null;
            }
            const classified = bankClassifyLine(line);
            if (classified.kind !== "checkbox" && classified.kind !== "stub" && classified.kind !== "amount-no-checkbox") {
              return null;
            }
            return { start: { line: cursor.line, ch: cursor.ch - match[1].length }, end: cursor, query: match[1] };
          } catch (error) {
            return null;
          }
        }

        getSuggestions(context) {
          try {
            return bankCategoryCompletions(this.pluginRef.bankLastCategories(), context && context.query);
          } catch (error) {
            return [];
          }
        }

        renderSuggestion(value, el) {
          try {
            el.setText(`${bankActionText(value.emoji) ? `${value.emoji} ` : ""}${value.label || value.key}`);
          } catch (error) {
            // Rendering is best-effort.
          }
        }

        selectSuggestion(value) {
          try {
            const editor = (this.context && this.context.editor) || null;
            const start = this.context && this.context.start;
            const end = this.context && this.context.end;
            if (editor && start && end && value && value.key) {
              editor.replaceRange(value.key, start, end);
            }
          } catch (error) {
            // Selection is best-effort.
          } finally {
            try {
              this.close();
            } catch (error) {
              // Close is best-effort.
            }
          }
        }
      }
      this.bankCategorySuggest = new BankCategorySuggest(this.app);
      this.registerEditorSuggest(this.bankCategorySuggest);
    } catch (error) {
      this.bankCategorySuggest = null;
    }
  }
}