// --- Daily-note Gmail sync (mail-link-marks) -------------------------------
// After today's daily note is created and the existing gcal sync has
// settled, Ledger Tools runs `bob gmail sync -q -f json -r 30` once per
// path through `bobSpawnJson`. Display-adjacent: it never writes the
// vault itself. Owned by bob-cli `docs/mail-link-marks.md`.

const GMAIL_EVENTS_SYNC_TIMEOUT_MS = 120000;

function gmailEventsSyncArgs() {
  return ["gmail", "sync", "-q", "-f", "json", "-r", "30"];
}

function gmailEventsShouldSyncCreatedFile(enabled, file, app, now = new Date()) {
  try {
    return enabled === true && isTodayDailyFile(app, file, { now });
  } catch (error) {
    return false;
  }
}

function gmailEventsDecodeSync(stdout, stderr) {
  let body;
  try {
    body = JSON.parse(String(stdout || ""));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob gmail sync returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.schema_version !== 1) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob gmail sync returned an unexpected JSON shape.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const error = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code: typeof error.kind === "string" ? error.kind : "bob-error",
      message: typeof error.message === "string" ? error.message : "bob gmail sync failed.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok !== true) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob gmail sync returned an unexpected report.",
      detail: statsFirstLine(stderr),
    };
  }
  return { ok: true, report: body };
}

// "notice" (exit 1), "info" (exit 2, unknown subcommand, everything else),
// or null when the spawn succeeded.
function gmailEventsFailureKind(result) {
  try {
    const resolved = result && typeof result === "object" ? result : {};
    if (resolved.ok === true) return null;
    const text = `${resolved.code || ""} ${resolved.message || ""} ${resolved.detail || ""}`;
    if (
      resolved.exitCode === 2 ||
      /unknown[\s_-]*subcommand|unrecognized[\s_-]*subcommand/i.test(text)
    ) {
      return "info";
    }
    if (resolved.exitCode === 1) return "notice";
    return "info";
  } catch (error) {
    return "info";
  }
}

function gmailEventsShowFailureNotice(state, now = new Date(), notice) {
  try {
    if (!state || typeof state !== "object") return false;
    if (!state.gmailSyncNoticeDays) state.gmailSyncNoticeDays = new Set();
    const day = formatLocalDate(now instanceof Date ? now : new Date());
    if (state.gmailSyncNoticeDays.has(day)) return false;
    state.gmailSyncNoticeDays.add(day);
    const text = "Gmail sync failed · run `bob gmail doctor`";
    try {
      if (typeof notice === "function") notice(text);
      else new Notice(text);
    } catch (error) {
      // Notice is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}

function gmailEventsRecentArchiveCount(report) {
  try {
    const recent = report && report.recent_archive;
    if (!recent || typeof recent !== "object" || Array.isArray(recent)) return null;
    if (typeof recent.since !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(recent.since) ||
        !Number.isFinite(Date.parse(recent.since))) return null;
    if (!Number.isInteger(recent.count) || recent.count < 0 || !Array.isArray(recent.items) || recent.items.length !== recent.count) return null;
    const threads = new Set();
    for (const item of recent.items) {
      if (!item || typeof item !== "object" || Array.isArray(item) ||
          typeof item.thread_id !== "string" || !item.thread_id || threads.has(item.thread_id) ||
          typeof item.note !== "string" || !item.note ||
          typeof item.archived_at !== "string" || !Number.isFinite(Date.parse(item.archived_at)) ||
          !Number.isInteger(item.message_count) || item.message_count < 1 ||
          !item.label || typeof item.label !== "object" || typeof item.label.name !== "string" || !item.label.name ||
          !["archived", "let_go", "restored"].includes(item.state)) return null;
      threads.add(item.thread_id);
    }
    return recent.count;
  } catch (error) {
    return null;
  }
}

function gmailEventsShowRecentArchiveNotice(state, report, file, now = new Date(), notice) {
  try {
    const count = gmailEventsRecentArchiveCount(report);
    const notePath = file && typeof file.path === "string" ? file.path : "";
    if (!count || !notePath || !(now instanceof Date) || Number.isNaN(now.getTime())) return false;
    if (!state || typeof state !== "object") return false;
    if (!(state.gmailArchiveNoticeKeys instanceof Set)) state.gmailArchiveNoticeKeys = new Set();
    const day = formatLocalDate(now);
    if (state.gmailArchiveNoticeDay !== day) {
      state.gmailArchiveNoticeKeys.clear();
      state.gmailArchiveNoticeDay = day;
    }
    if (state.gmailArchiveNoticeKeys.has(notePath)) return false;
    state.gmailArchiveNoticeKeys.add(notePath);
    const noun = count === 1 ? "thread" : "threads";
    const text = `⤓ Bob archived ${count} Gmail ${noun} since yesterday — tasks you closed.`;
    try {
      if (typeof notice === "function") notice(text);
      else new Notice(text);
    } catch (error) {
      // Notice delivery is best-effort after a completed sync.
    }
    return true;
  } catch (error) {
    return false;
  }
}

class BobLedgerToolsGmailSyncMixin {
  setupGmailSyncOnCreate() {
    if (typeof this.gmailSyncOnCreateEnabled !== "boolean") this.gmailSyncOnCreateEnabled = true;
    if (!this.gmailSyncNoticeDays) this.gmailSyncNoticeDays = new Set();
    if (!(this.gmailArchiveNoticeKeys instanceof Set)) this.gmailArchiveNoticeKeys = new Set();
    try {
      this.addCommand({
        id: "toggle-gmail-sync-on-create",
        name: "Toggle Gmail sync on daily-note creation",
        callback: () => this.toggleGmailSyncOnCreate(),
      });
    } catch (error) {
      // The session toggle is best-effort on limited test hosts.
    }
  }

  gmailSyncShouldRunCreatedFile(file) {
    return gmailEventsShouldSyncCreatedFile(this.gmailSyncOnCreateEnabled, file, this.app);
  }

  toggleGmailSyncOnCreate() {
    this.gmailSyncOnCreateEnabled = !this.gmailSyncOnCreateEnabled;
    try {
      new Notice(
        this.gmailSyncOnCreateEnabled
          ? "Gmail sync on daily-note creation on"
          : "Gmail sync on daily-note creation off",
      );
    } catch (error) {}
    return this.gmailSyncOnCreateEnabled;
  }

  // Shared create-listener body: gcal first (it waits for Pomodoros),
  // then Gmail. Each side re-checks its own session toggle.
  async syncCreatedDailyNote(file) {
    try {
      if (this.gcalSyncOnCreateEnabled && typeof this.gcalSyncCreatedDailyNote === "function") {
        await this.gcalSyncCreatedDailyNote(file);
      }
    } catch (error) {
      // Calendar sync failures never block Gmail.
    }
    try {
      if (this.gmailSyncOnCreateEnabled && typeof this.gmailSyncCreatedDailyNote === "function") {
        await this.gmailSyncCreatedDailyNote(file);
      }
    } catch (error) {
      // Gmail sync is best-effort.
    }
  }

  async gmailSyncCreatedDailyNote(file) {
    if (!this.gmailSyncOnCreateEnabled) return false;
    const vault = this.app && this.app.vault;
    const ready = await gcalEventsWaitForRenderedNote(
      () => vault && typeof vault.read === "function"
        ? vault.read(file)
        : Promise.reject(new Error("Vault read unavailable")),
    );
    if (!ready) {
      console.warn("bob gmail sync skipped: today's note never settled into a rendered note with ## Pomodoros within 60 seconds");
      return false;
    }
    if (!this.gmailSyncOnCreateEnabled) return false;
    const spawn = typeof this.bobSpawnJson === "function" ? this.bobSpawnJson.bind(this) : bobSpawnJson;
    const result = await spawn(gmailEventsSyncArgs(), gmailEventsDecodeSync, {
      commandLabel: "bob gmail sync",
      resolveBobPath: () => typeof this.apiStatsBobPath === "function"
        ? this.apiStatsBobPath()
        : { path: "bob", source: "path" },
      getVaultPath: () => typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: GMAIL_EVENTS_SYNC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    if (result && result.ok) {
      this.gmailArchiveLatestSyncReport = result.report;
      if (typeof this.mailArchiveScheduleReceiptRefresh === "function") {
        this.mailArchiveScheduleReceiptRefresh("sync");
      }
      gmailEventsShowRecentArchiveNotice(this, result.report, file);
      return true;
    }
    const kind = gmailEventsFailureKind(result);
    if (kind === "notice") {
      gmailEventsShowFailureNotice(this);
      return false;
    }
    const suffix = result && result.exitCode === 2 ? " (setup or unknown subcommand)" : "";
    console.info(`bob gmail sync skipped${suffix}: ${(result && (result.message || result.code)) || "failed"}`);
    return false;
  }

}
