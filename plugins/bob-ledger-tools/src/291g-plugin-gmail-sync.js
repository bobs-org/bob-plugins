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

class BobLedgerToolsGmailSyncMixin {
  setupGmailSyncOnCreate() {
    if (typeof this.gmailSyncOnCreateEnabled !== "boolean") this.gmailSyncOnCreateEnabled = true;
    if (!this.gmailSyncNoticeDays) this.gmailSyncNoticeDays = new Set();
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
    const ready = await gcalEventsWaitForPomodoros(
      () => vault && typeof vault.read === "function"
        ? vault.read(file)
        : Promise.reject(new Error("Vault read unavailable")),
    );
    if (!ready) {
      console.warn("bob gmail sync skipped: today's note did not get a ## Pomodoros section within 15 seconds");
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
    if (result && result.ok) return true;
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
