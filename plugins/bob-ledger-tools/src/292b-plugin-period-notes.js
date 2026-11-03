// Period-note creation hook (period-notes): runs `bob periods ensure -q -f json`
// after today's daily note is created and once per local day, so the
// week → quarter → year → all_time tree exists before anything reads it.
// Bob remains the only writer; this hook only spawns ensure and opens notes.
// The adoption gate is `all_time.md`: without it the hook stays inert and the
// "Open this week's note" command points at `bob periods migrate`.

const PERIOD_NOTES_ENSURE_TIMEOUT_MS = 15000;
const PERIOD_NOTES_MIDNIGHT_TICK_MS = 5000;
const PERIOD_NOTES_LOCK_RETRY_MS = 60000;
// Templater fills a new empty note ~300 ms after creation; wait past that
// before reading a created period note, so bob fills the stub it leaves.
const PERIOD_NOTES_STUB_SETTLE_MS = 1500;
// How long a navigation waits for Obsidian to index a note bob just made.
const PERIOD_NOTES_INDEX_WAIT_MS = 3000;
const PERIOD_NOTES_ADOPTION_PATH = "all_time.md";
const PERIOD_NOTES_MIGRATE_COMMAND = "bob periods migrate";

// Fresh argv for `bob periods ensure -q -f json`, plus `-d DATE` when a
// period other than today's is wanted. A function so no caller can mutate a
// shared array that another spawn reuses.
function periodNotesEnsureArgs(date) {
  const args = ["periods", "ensure", "-q", "-f", "json"];
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) args.push("-d", date);
  return args;
}

function periodNotesAdoptionPath() {
  return PERIOD_NOTES_ADOPTION_PATH;
}

function periodNotesMigrateCommand() {
  return PERIOD_NOTES_MIGRATE_COMMAND;
}

// Only Date instances and finite timestamps count as dates here: unlike
// coerceDate, invalid input degrades to null instead of now, so a bad caller
// cannot silently open this week's note for the wrong week.
function periodNotesDateOrNull(value) {
  try {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// ISO week-year of a date, in local time: `{ isoYear, week }` with week 1..53,
// or null when the value is not a date. The Thursday of the week decides the
// ISO year; Jan 4 is always in week 1, so its Thursday anchors week 1.
function periodNotesIsoWeekYear(value) {
  try {
    const date = periodNotesDateOrNull(value);
    if (!date) return null;
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayNr = (day.getDay() + 6) % 7;
    const thursday = new Date(day);
    thursday.setDate(day.getDate() - dayNr + 3);
    const isoYear = thursday.getFullYear();
    const jan4 = new Date(isoYear, 0, 4);
    const jan4Nr = (jan4.getDay() + 6) % 7;
    const week1Thursday = new Date(jan4);
    week1Thursday.setDate(jan4.getDate() - jan4Nr + 3);
    const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / 6048e5);
    if (!Number.isInteger(week) || week < 1 || week > 53) return null;
    return { isoYear, week };
  } catch (error) {
    return null;
  }
}

// Vault-relative path of the week note holding a date, e.g.
// `2026/2026-W45.md`, filed under its ISO week-year. Null when not a date.
function periodNotesWeekNotePath(value) {
  try {
    const parts = periodNotesIsoWeekYear(value);
    if (!parts) return null;
    const weekText = String(parts.week).padStart(2, "0");
    return `${parts.isoYear}/${parts.isoYear}-W${weekText}.md`;
  } catch (error) {
    return null;
  }
}

// Local YYYY-MM-DD of the Monday that opens ISO week `week` of `isoYear`,
// or null when that week does not exist (W53 only in 53-week years).
function periodNotesIsoWeekMonday(isoYear, week) {
  try {
    if (!Number.isInteger(isoYear) || !Number.isInteger(week) || week < 1 || week > 53) return null;
    const jan4 = new Date(isoYear, 0, 4);
    const monday = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
    const parts = periodNotesIsoWeekYear(monday);
    if (!parts || parts.isoYear !== isoYear || parts.week !== week) return null;
    return formatLocalDate(monday);
  } catch (error) {
    return null;
  }
}

// The period a vault path names (bob-cli docs/periods.md §1), with the date
// `bob periods ensure -d` needs to create it: `{ id, kind, date }` for
// `YYYY/YYYY-Www.md`, `YYYY/YYYY-Qn.md`, `YYYY.md`, and `all_time.md` (date
// null: today's chain already holds it). Null for any other path.
function periodNotesPeriodForPath(path) {
  try {
    const text = String(path || "").replace(/^\/+/, "");
    if (text === PERIOD_NOTES_ADOPTION_PATH) return { id: "all", kind: "all", date: null };
    let match = /^(\d{4})\/(\d{4})-W(\d{2})\.md$/.exec(text);
    if (match && match[1] === match[2]) {
      const date = periodNotesIsoWeekMonday(Number(match[2]), Number(match[3]));
      return date ? { id: `${match[2]}-W${match[3]}`, kind: "week", date } : null;
    }
    match = /^(\d{4})\/(\d{4})-Q([1-4])\.md$/.exec(text);
    if (match && match[1] === match[2]) {
      const date = periodNotesIsoWeekMonday(Number(match[2]), (Number(match[3]) - 1) * 13 + 1);
      return date ? { id: `${match[2]}-Q${match[3]}`, kind: "quarter", date } : null;
    }
    match = /^(\d{4})\.md$/.exec(text);
    if (match && Number(match[1]) >= 1970 && Number(match[1]) <= 2999) {
      const date = periodNotesIsoWeekMonday(Number(match[1]), 1);
      return date ? { id: match[1], kind: "year", date } : null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// True when a period note holds nothing bob must preserve: blank, or only a
// closed frontmatter block (the Templater stub a clicked dangling link
// leaves). Mirrors `periods::note::is_unfilled` in bob-cli.
function periodNotesIsUnfilled(contents) {
  const text = String(contents === undefined || contents === null ? "" : contents);
  if (!text.trim()) return true;
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== "---") return false;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") return lines.slice(index + 1).every((line) => !line.trim());
  }
  return false;
}

function periodNotesDecodeEnsure(stdout, stderr, exitCode) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined || stdout === null ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob periods ensure returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.schema_version !== 1) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob periods ensure returned an unexpected JSON shape.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === true) {
    return { ok: true, report: body };
  }
  if (body.ok === false) {
    const failure = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code:
        typeof failure.code === "string" && failure.code
          ? failure.code
          : "bob-error",
      message:
        typeof failure.message === "string" && failure.message
          ? failure.message
          : "bob periods ensure failed.",
      detail:
        typeof failure.hint === "string" && failure.hint
          ? failure.hint
          : statsFirstLine(stderr),
    };
  }
  return {
    ok: false,
    code: "bad-shape",
    message: "bob periods ensure returned an unexpected report.",
    detail: statsFirstLine(stderr),
  };
}

// Classify an ensure failure: "older-bob" (exit 2 or an unknown-subcommand
// message from a bob that predates `periods`), "lock-busy" (one retry), or
// "notice" (everything else). Ok results classify as null.
function periodNotesFailureKind(result) {
  try {
    const resolved = result && typeof result === "object" ? result : {};
    if (resolved.ok === true) return null;
    const code = typeof resolved.code === "string" ? resolved.code : "";
    const message = typeof resolved.message === "string" ? resolved.message : "";
    const detail = typeof resolved.detail === "string" ? resolved.detail : "";
    const text = `${code} ${message} ${detail}`;
    if (
      resolved.exitCode === 2 ||
      /unknown[\s_-]*subcommand|unrecognized[\s_-]*subcommand/i.test(text)
    ) {
      return "older-bob";
    }
    if (code === "lock_busy" || /lock[\s_-]*busy/i.test(text)) {
      return "lock-busy";
    }
    return "notice";
  } catch (error) {
    return "notice";
  }
}

function periodNotesNoticeText(message) {
  const text = typeof message === "string" && message ? message : "unknown error";
  return `Period notes could not be created — ${text}`;
}

function periodNotesNotAdoptedText() {
  return `Period notes are not set up yet — run \`${PERIOD_NOTES_MIGRATE_COMMAND}\` to create the week → quarter → year tree.`;
}

// The create trigger reuses the gcal hook's file test (today's canonical
// daily note) with its own once-per-path set, so one hook never suppresses
// the other: this predicate only answers, the caller's set deduplicates.
function periodNotesShouldSyncCreatedFile(enabled, file, app, now) {
  try {
    return gcalEventsShouldSyncCreatedFile(enabled, file, app, now) === true;
  } catch (error) {
    return false;
  }
}

class BobLedgerToolsPeriodNotesMixin {
  setupPeriodNotes() {
    if (this.periodNotesSetupDone === true) return;
    this.periodNotesSetupDone = true;
    if (typeof this.periodNotesOnCreateEnabled !== "boolean") {
      this.periodNotesOnCreateEnabled = true;
    }
    if (!this.periodNotesCreatedPaths) this.periodNotesCreatedPaths = new Set();
    if (!this.periodNotesNoticeDays) this.periodNotesNoticeDays = new Set();
    if (typeof this.periodNotesOldBobWarned !== "boolean") {
      this.periodNotesOldBobWarned = false;
    }
    if (typeof this.periodNotesLastDay !== "string") this.periodNotesLastDay = null;
    this.periodNotesRetryTimer = null;
    this.periodNotesMidnightWatched = false;
    try {
      this.addCommand({
        id: "open-this-weeks-note",
        name: "Open this week's note",
        callback: () => {
          void this.openThisWeeksNote();
        },
      });
    } catch (error) {
      // The command is best-effort on limited test hosts.
    }
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.onLayoutReady !== "function") return;
    workspace.onLayoutReady(() => {
      try {
        this.periodNotesRunOncePerDay("layout-ready");
      } catch (error) {
        // The daily ensure is best-effort.
      }
      try {
        this.periodNotesWatchMidnight();
      } catch (error) {
        // The midnight watcher is best-effort.
      }
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.on !== "function") return;
      try {
        this.registerEvent(
          vault.on("create", (file) => {
            void this.periodNotesHandleCreate(file);
          }),
        );
      } catch (error) {
        // The create trigger is best-effort on limited test hosts.
      }
    });
  }

  teardownPeriodNotes() {
    try {
      if (
        this.periodNotesRetryTimer !== null &&
        this.periodNotesRetryTimer !== undefined &&
        typeof clearTimeout === "function"
      ) {
        clearTimeout(this.periodNotesRetryTimer);
      }
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    this.periodNotesRetryTimer = null;
    this.periodNotesSetupDone = false;
  }

  periodNotesIsAdopted() {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") return false;
      return vault.getAbstractFileByPath(periodNotesAdoptionPath()) !== null &&
        vault.getAbstractFileByPath(periodNotesAdoptionPath()) !== undefined;
    } catch (error) {
      return false;
    }
  }

  // Create-trigger entry point. Returns true when an ensure was started (or,
  // for a period-note path, scheduled).
  periodNotesHandleCreate(file) {
    try {
      if (!periodNotesShouldSyncCreatedFile(this.periodNotesOnCreateEnabled, file, this.app)) {
        return this.periodNotesHandlePeriodCreate(file);
      }
      const key = file && typeof file.path === "string" ? file.path : "";
      if (!key) return false;
      if (!this.periodNotesCreatedPaths) this.periodNotesCreatedPaths = new Set();
      if (this.periodNotesCreatedPaths.has(key)) return false;
      this.periodNotesCreatedPaths.add(key);
      void this.periodNotesRunEnsure("daily-note-created");
      return true;
    } catch (error) {
      return false;
    }
  }

  // A period note that appears in Obsidian (a clicked dangling `W46 ›` link,
  // which Templater stubs with frontmatter): once Templater settles, ask bob
  // to fill it. bob's own scaffolds have a body and are skipped, so the
  // look-ahead notes ensure creates never cascade into more ensures.
  periodNotesHandlePeriodCreate(file) {
    try {
      if (this.periodNotesOnCreateEnabled === false) return false;
      const path = file && typeof file.path === "string" ? file.path : "";
      if (!periodNotesPeriodForPath(path) || !this.periodNotesIsAdopted()) return false;
      if (!this.periodNotesStubPaths) this.periodNotesStubPaths = new Set();
      if (this.periodNotesStubPaths.has(path)) return false;
      this.periodNotesStubPaths.add(path);
      const settleMs = Number.isFinite(this.periodNotesStubSettleMs)
        ? this.periodNotesStubSettleMs
        : PERIOD_NOTES_STUB_SETTLE_MS;
      setTimeout(() => {
        void this.periodNotesFillStub(path).finally(() => {
          this.periodNotesStubPaths.delete(path);
        });
      }, settleMs);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Fill one period-note stub through bob. Resolves true when ensure ran.
  async periodNotesFillStub(path) {
    try {
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      if (!file) return false;
      const contents = typeof vault.read === "function" ? await vault.read(file) : await vault.cachedRead(file);
      if (!periodNotesIsUnfilled(contents)) return false;
      const result = await this.periodNotesEnsureForPath(path, { waitMs: 0 });
      return Boolean(result && result.ok);
    } catch (error) {
      return false;
    }
  }

  // Create one period note through bob — `bob periods ensure -d <its first
  // day>` is create-only and fills stubs — then resolve the file once
  // Obsidian indexes it. Resolves `{ ok, file, code, message }`; never rejects.
  async periodNotesEnsureForPath(path, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const fail = (code, message) => ({ ok: false, file: null, code, message });
    try {
      const period = periodNotesPeriodForPath(path);
      if (!period) return fail("not-period", "Not a period note path.");
      if (!this.periodNotesIsAdopted()) return fail("not-adopted", periodNotesNotAdoptedText());
      const result = await this.periodNotesRunEnsure("open-period", { ...opts, date: period.date || undefined });
      if (!result || result.ok !== true) {
        return fail((result && result.code) || "failed", (result && result.message) || "bob periods ensure failed.");
      }
      const file = await this.periodNotesWaitForFile(path, opts.waitMs);
      return file ? { ok: true, file, code: null, message: "" } : fail("not-indexed", `${path} did not appear in the vault.`);
    } catch (error) {
      return fail("failed", error && error.message ? String(error.message) : "bob periods ensure failed.");
    }
  }

  async periodNotesWaitForFile(path, waitMs) {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
    const limit = Number.isFinite(waitMs) ? waitMs : PERIOD_NOTES_INDEX_WAIT_MS;
    for (let waited = 0; ; waited += 50) {
      const file = vault.getAbstractFileByPath(path) || null;
      if (file || waited >= limit) return file;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // `api.periodNotes` v1: sibling plugins (bob-navigation-hotkeys) open a
  // missing period note through bob instead of a Templater template.
  // Additive: the top-level api stays v3. Members never throw.
  periodNotesApi() {
    return Object.freeze({
      version: 1,
      periodForPath: (path) => periodNotesPeriodForPath(path),
      ensureNote: (path, options) => this.periodNotesEnsureForPath(path, options),
    });
  }

  // Once-per-local-day entry point shared by the layout-ready trigger and the
  // midnight ticker. Returns true when an ensure was started.
  periodNotesRunOncePerDay(reason, now) {
    try {
      const today = formatLocalDate(now === undefined ? new Date() : now);
      if (typeof this.periodNotesLastDay === "string" && this.periodNotesLastDay === today) {
        return false;
      }
      this.periodNotesLastDay = today;
      void this.periodNotesRunEnsure(reason === undefined ? "daily" : reason);
      return true;
    } catch (error) {
      return false;
    }
  }

  periodNotesWatchMidnight() {
    if (this.periodNotesMidnightWatched === true) return;
    this.periodNotesMidnightWatched = true;
    const tick = () => {
      try {
        this.periodNotesRunOncePerDay("midnight");
      } catch (error) {
        // The midnight ensure is best-effort.
      }
    };
    // Only a host that can register (and so clear on unload) the ticker gets
    // one, like every other Ledger Tools interval: an unregistered interval
    // would outlive the plugin and keep test hosts' processes alive.
    if (typeof this.registerInterval !== "function") {
      this.periodNotesMidnightWatched = false;
      return;
    }
    try {
      this.registerInterval(setInterval(tick, PERIOD_NOTES_MIDNIGHT_TICK_MS));
    } catch (error) {
      this.periodNotesMidnightWatched = false;
    }
  }

  periodNotesRunSpawn(args, decode, options) {
    try {
      return bobSpawnJson(args, decode, options);
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: "spawn-failed",
        message:
          error && error.message
            ? String(error.message)
            : "bob periods ensure failed to run.",
        detail: "",
        tried: [],
      });
    }
  }

  periodNotesSpawnEnsure(date) {
    return this.periodNotesRunSpawn(periodNotesEnsureArgs(date), periodNotesDecodeEnsure, {
      commandLabel: "bob periods ensure",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: PERIOD_NOTES_ENSURE_TIMEOUT_MS,
    });
  }

  periodNotesDelay(ms) {
    const wait = Math.max(0, Number.isFinite(ms) ? ms : 0);
    return new Promise((resolve) => {
      try {
        this.periodNotesRetryTimer = setTimeout(() => {
          this.periodNotesRetryTimer = null;
          resolve();
        }, wait);
      } catch (error) {
        resolve();
      }
    });
  }

  periodNotesWarnOldBob(result) {
    if (this.periodNotesOldBobWarned === true) return false;
    this.periodNotesOldBobWarned = true;
    try {
      console.warn(
        "bob periods ensure skipped (older bob without `periods`; update bob-cli):",
        result && result.message ? result.message : result,
      );
    } catch (error) {
      // Console warnings are best-effort.
    }
    return true;
  }

  // One Notice per local day for ensure failures that are neither an older
  // bob nor a first lock_busy. Returns true when a Notice was shown.
  periodNotesNotifyFailure(message, now) {
    try {
      const day = formatLocalDate(now === undefined ? new Date() : now);
      if (!this.periodNotesNoticeDays) this.periodNotesNoticeDays = new Set();
      if (this.periodNotesNoticeDays.has(day)) return false;
      this.periodNotesNoticeDays.add(day);
      new Notice(periodNotesNoticeText(message));
      return true;
    } catch (error) {
      return false;
    }
  }

  // Runs `bob periods ensure` unless the vault has not adopted period notes.
  // Never rejects. lock_busy gets one retry after 60 s (overridable in
  // tests via options.retryDelayMs); anything else failures Notice.
  async periodNotesRunEnsure(reason, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const retryDelayMs = Number.isFinite(opts.retryDelayMs)
      ? opts.retryDelayMs
      : PERIOD_NOTES_LOCK_RETRY_MS;
    const attempt = async (retried) => {
      if (!this.periodNotesIsAdopted()) {
        return { ok: false, code: "not-adopted", message: periodNotesNotAdoptedText(), detail: "" };
      }
      let result = null;
      try {
        result = await this.periodNotesSpawnEnsure(opts.date);
      } catch (error) {
        result = {
          ok: false,
          code: "spawn-failed",
          message: error && error.message ? String(error.message) : "bob periods ensure failed to run.",
          detail: "",
        };
      }
      if (!result || typeof result !== "object") {
        result = { ok: false, code: "bad-shape", message: "bob periods ensure returned no result.", detail: "" };
      }
      if (result.ok === true) return result;
      const kind = periodNotesFailureKind(result);
      if (kind === "older-bob") {
        this.periodNotesWarnOldBob(result);
        return result;
      }
      if (kind === "lock-busy" && retried !== true) {
        await this.periodNotesDelay(retryDelayMs);
        return attempt(true);
      }
      this.periodNotesNotifyFailure(result.message, opts.now);
      return result;
    };
    try {
      return await attempt(false);
    } catch (error) {
      const failure = {
        ok: false,
        code: "failed",
        message: error && error.message ? String(error.message) : "bob periods ensure failed.",
        detail: "",
      };
      this.periodNotesNotifyFailure(failure.message, opts.now);
      return failure;
    }
  }

  async periodNotesOpenFile(file) {
    try {
      return await openVaultFile(this.app, file);
    } catch (error) {
      return false;
    }
  }

  // "Open this week's note": honours the adoption gate, runs ensure when the
  // week's note is missing, then opens it. Resolves the opened file, or null.
  async openThisWeeksNote(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    try {
      if (!this.periodNotesIsAdopted()) {
        try {
          new Notice(periodNotesNotAdoptedText());
        } catch (error) {
          // Notices are best-effort on limited test hosts.
        }
        return null;
      }
      const path = typeof opts.path === "string" && opts.path
        ? opts.path
        : periodNotesWeekNotePath(opts.now === undefined ? new Date() : opts.now);
      if (!path) return null;
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
      let file = vault.getAbstractFileByPath(path) || null;
      if (!file) {
        await this.periodNotesRunEnsure("open-week", opts);
        try {
          file = vault.getAbstractFileByPath(path) || null;
        } catch (error) {
          file = null;
        }
      }
      if (!file) return null;
      const opened = await this.periodNotesOpenFile(file);
      return opened === true ? file : null;
    } catch (error) {
      return null;
    }
  }
}
