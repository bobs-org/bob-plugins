// Desktop minute trigger for the authoritative `bob snooze wake` writer.
// The cache only decides whether a spawn may be useful; only bob mutates rows.
const SNOOZE_WAKE_TIMEOUT_MS = 30000;

function snoozeWakeDecodeReport(stdout, stderr) {
  let report;
  try {
    report = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob snooze wake returned invalid JSON." };
  }
  const bad = () => ({ ok: false, code: "bad-shape", message: "bob snooze wake returned an unexpected report." });
  if (!report || typeof report !== "object" || Array.isArray(report) || report.schema_version !== 1) return bad();
  if (typeof report.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(report.date)) return bad();
  if (typeof report.now !== "string" || !Number.isFinite(Date.parse(report.now))) return bad();
  if (!["woke", "nothing_due", "deferred", "skipped"].includes(report.status)) return bad();
  if (!Array.isArray(report.woken) || !Array.isArray(report.dropped) || !Array.isArray(report.ignored) || !Array.isArray(report.pending)) return bad();
  if (!(report.next_wake_at === null || (typeof report.next_wake_at === "string" && Number.isFinite(Date.parse(report.next_wake_at))))) return bad();
  if (!report.plan || typeof report.plan !== "object" || Array.isArray(report.plan) || !Number.isInteger(report.plan.count) || report.plan.count < 0 || !Number.isInteger(report.plan.cap) || report.plan.cap < 0 || typeof report.plan.over !== "boolean") return bad();
  if (typeof report.daily_file !== "string" || !report.daily_file) return bad();
  if (!["none", "desktop", "mac_capture"].includes(report.notified)) return bad();
  if (!(report.wake_id === null || (typeof report.wake_id === "string" && report.wake_id.length > 0))) return bad();
  for (const row of report.woken) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.title !== "string" || typeof row.route !== "string" || typeof row.block_id !== "string" || typeof row.target !== "string" || !/^\d{4}$/.test(row.target) || typeof row.woke_at !== "string" || !/^\d{2}:\d{2}$/.test(row.woke_at) || !row.destination || typeof row.destination !== "object" || Array.isArray(row.destination) || !Number.isInteger(row.destination.line) || typeof row.destination.name !== "string" || typeof row.destination.created !== "boolean" || typeof row.over_cap !== "boolean") return bad();
  }
  for (const row of [...report.dropped, ...report.ignored]) {
    if (!row || typeof row !== "object" || Array.isArray(row) || !(row.route === null || typeof row.route === "string") || !(row.block_id === null || typeof row.block_id === "string") || !(row.target === null || (typeof row.target === "string" && /^\d{4}$/.test(row.target))) || typeof row.reason !== "string") return bad();
  }
  for (const row of report.pending) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.route !== "string" || typeof row.block_id !== "string" || !(row.target === null || (typeof row.target === "string" && /^\d{4}$/.test(row.target))) || !["asleep", "blocked"].includes(row.state)) return bad();
  }
  return { ok: true, report };
}

function snoozeWakeUnsupportedFailure(result) {
  const text = [result && result.message, result && result.detail].filter(Boolean).join(" ");
  return /(?:unrecognized|unknown) subcommand\s+['"`]?snooze['"`]?/i.test(text)
    || (/(?:unrecognized|unknown) subcommand\s+['"`]?wake['"`]?/i.test(text) && /snooze/i.test(text));
}

function snoozeWakeMinuteKey(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return "";
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
}

function snoozeWakeNoticeText(report) {
  if (!report || !Array.isArray(report.woken) || report.woken.length === 0) return "";
  if (report.woken.length > 1) return `⏰ ${report.woken.length} snoozed tasks are ready`;
  const row = report.woken[0];
  return `⏰ Ready now: ${row.title} · woke ${row.woke_at} · ${row.destination.name}`;
}

class BobLedgerToolsSnoozeWakerMixin {
  snoozeWakeNow() {
    return new Date();
  }

  snoozeWakeIsDesktop() {
    try {
      return Boolean(Platform && Platform.isDesktopApp);
    } catch (error) {
      return false;
    }
  }

  snoozeWakeSpawn(args = ["snooze", "wake", "-q", "-f", "json"]) {
    return bobSpawnJson(args, snoozeWakeDecodeReport, {
      commandLabel: "bob snooze wake",
      resolveBobPath: () => typeof this.apiStatsBobPath === "function" ? this.apiStatsBobPath() : { path: "bob", source: "path" },
      getVaultPath: () => typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: SNOOZE_WAKE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      firstLine: statsFirstLine,
    });
  }

  snoozeWakeNotice(report) {
    const message = snoozeWakeNoticeText(report);
    if (!message) return false;
    try {
      new Notice(message, 8000);
      return true;
    } catch (error) {
      return false;
    }
  }

  async snoozeWakeTick(now = new Date()) {
    const clock = now instanceof Date ? new Date(now.getTime()) : new Date();
    if (!this.snoozeWakeIsDesktop() || this.snoozeWakeDisabled || this.snoozeWakeInFlight || this.snoozeWakeUnloaded) return false;
    if (typeof this.isSnoozedCacheReady === "function" && !this.isSnoozedCacheReady(clock)) return false;
    const cache = this.snoozedCache;
    if (!cache || cache.date !== snoozedTodayTextFromClock(clock) || cache.nowMinutes !== snoozedNowMinutesFromClock(clock)) return false;
    const next = typeof cache.nextWakeAt === "string" ? Date.parse(cache.nextWakeAt) : NaN;
    if (!Number.isFinite(next) || next > clock.getTime()) return false;
    const minute = snoozeWakeMinuteKey(clock);
    if (!minute || minute === this.snoozeWakeLastAttemptMinute) return false;
    this.snoozeWakeLastAttemptMinute = minute;
    this.snoozeWakeInFlight = true;
    const generation = this.snoozeWakeGeneration || 0;
    const expectedDate = cache.date;
    try {
      const result = await this.snoozeWakeSpawn();
      if (generation !== (this.snoozeWakeGeneration || 0) || this.snoozeWakeUnloaded) return false;
      if (!result || result.ok !== true) {
        if (snoozeWakeUnsupportedFailure(result)) this.snoozeWakeDisabled = true;
        return false;
      }
      const report = result.report;
      if (!report || report.date !== expectedDate) return false;
      if (report.status !== "woke" || report.woken.length === 0) return true;
      const current = this.snoozeWakeNow();
      if (snoozedTodayTextFromClock(current) !== expectedDate) return false;
      await this.refreshSnoozedCacheFromDaily(current);
      if (generation !== (this.snoozeWakeGeneration || 0) || this.snoozeWakeUnloaded || snoozedTodayTextFromClock(this.snoozeWakeNow()) !== expectedDate) return false;
      if (report.notified === "none") this.snoozeWakeNotice(report);
      return true;
    } catch (error) {
      return false;
    } finally {
      this.snoozeWakeInFlight = false;
    }
  }

  disposeSnoozeWaker() {
    this.snoozeWakeUnloaded = true;
    this.snoozeWakeGeneration = (this.snoozeWakeGeneration || 0) + 1;
    this.snoozeWakeInFlight = false;
  }
}

