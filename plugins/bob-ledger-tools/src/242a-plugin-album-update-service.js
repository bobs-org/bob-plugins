// Album schema update service (mixin half). Preview runs the dry-run
// writer with no locks and no vault bytes; apply serializes across cards
// and against auto-sync, suppresses only the writer's own metadata echo,
// and refreshes through the existing generation-aware revalidation so an
// older in-flight list can never become the post-write report. Sync-only
// recovery runs `bob vault-sync` and never replays the mutation.
class BobLedgerToolsAlbumUpdateMixin {
  albumUpdateOwnPathsStore() {
    if (!(this.albumUpdateOwnPaths instanceof Set)) {
      this.albumUpdateOwnPaths = new Set();
    }
    return this.albumUpdateOwnPaths;
  }

  albumSpawnUpdate(stem, envelopeText, options = {}) {
    const opts = albumJsonObject(options) ? options : {};
    const dryRun = opts.dryRun === true;
    return bobSpawnJson(
      albumUpdateArgs(stem, { dryRun }),
      albumDecodeUpdateReport,
      {
        ...opts,
        stdin: typeof envelopeText === "string" ? envelopeText : "",
        commandLabel: dryRun ? "bob albums update -d" : "bob albums update",
        resolveBobPath: () =>
          typeof this.apiStatsBobPath === "function"
            ? this.apiStatsBobPath()
            : { path: "bob", source: "path" },
        getVaultPath: () =>
          typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
        timeout: ALBUM_UPDATE_TIMEOUT_MS,
        maxBuffer: ALBUM_UPDATE_MAX_BUFFER,
        firstLine: statsFirstLine,
      },
    );
  }

  apiAlbumUpdatePreview(stem, envelopeText, options = {}) {
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Album data has unloaded." });
    }
    return this.albumSpawnUpdate(stem, envelopeText, { ...options, dryRun: true });
  }

  apiAlbumUpdateApply(stem, envelopeText, options = {}) {
    const opts = albumJsonObject(options) ? options : {};
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Album data has unloaded." });
    }
    if (this.albumUpdateFlight) {
      return Promise.resolve({
        ok: false,
        code: "apply-busy",
        message: "Another schema apply is already running.",
        hint: "Wait for it to settle, then preview again.",
      });
    }
    const epoch = this.albumDataEpoch || 0;
    const ownPath = typeof opts.ownPath === "string" && opts.ownPath
      ? albumReportPath(opts.ownPath)
      : "";
    const waitForSync = this.albumSyncFlight && typeof this.albumSyncFlight.then === "function"
      ? this.albumSyncFlight.catch(() => null)
      : null;
    const run = async () => {
      if (waitForSync) {
        try {
          await waitForSync;
        } catch (error) {
          // A failed sync still serializes: the apply runs after it settles.
        }
      }
      if (this.albumDataActive === false || (this.albumDataEpoch || 0) !== epoch) {
        return { ok: false, code: "unloaded", message: "Album data has unloaded." };
      }
      if (this.albumUpdateFlight && this.albumUpdateFlight !== applyPromise) {
        return {
          ok: false,
          code: "apply-busy",
          message: "Another schema apply is already running.",
          hint: "Wait for it to settle, then preview again.",
        };
      }
      this.albumUpdateBusy = true;
      if (ownPath) {
        this.albumUpdateOwnPathsStore().add(ownPath);
      }
      let outcome;
      try {
        outcome = await this.albumSpawnUpdate(stem, envelopeText, { ...opts, dryRun: false });
      } catch (error) {
        outcome = {
          ok: false,
          code: "failed",
          message: error && error.message ? String(error.message) : "bob albums update failed.",
        };
      }
      const wrote = Boolean(
        outcome && outcome.ok && outcome.report && outcome.report.ok === true &&
        outcome.report.dry_run === false && outcome.report.changed === true,
      );
      const unknown = Boolean(outcome && !outcome.ok && (outcome.code === "timeout" || outcome.code === "failed"));
      const maybeWrote = wrote || unknown;
      if (this.albumDataActive === false || (this.albumDataEpoch || 0) !== epoch) {
        if (this.albumUpdateFlight === applyPromise) {
          this.albumUpdateFlight = null;
        }
        this.albumUpdateBusy = false;
        return { ...outcome, refreshed: this.albumReportState(), wrote, unknown };
      }
      this.albumUpdateBusy = false;
      if (this.albumUpdateFlight === applyPromise) {
        this.albumUpdateFlight = null;
      }
      let refreshed = this.albumReportState();
      try {
        // The pre-write list cannot satisfy the post-write display: wait it
        // out, then force one fresh report. Last-good data stays visible as
        // stale on refresh failure; editing stays disabled until it lands.
        refreshed = await this.albumRevalidateAfterSync();
      } catch (error) {
        // The last report remains visible as stale/unavailable on failure.
      }
      if (!maybeWrote && ownPath) {
        this.albumUpdateOwnPathsStore().delete(ownPath);
      } else if (maybeWrote && ownPath) {
        // The writer's own frontmatter echo has landed in the refreshed
        // report (or in the pending invalidations it absorbed); stop
        // suppressing so later external edits on the same note sync again.
        this.albumUpdateOwnPathsStore().delete(ownPath);
      }
      if (
        this.albumSyncTrailing === true &&
        this.albumDataActive !== false && (this.albumDataEpoch || 0) === epoch &&
        !this.albumSyncFlight && !this.albumSyncBusy && !this.albumUpdateFlight
      ) {
        // Only unrelated pending invalidations set the trailing flag; the
        // writer's own echo was suppressed above and never sets it.
        this.albumSyncTrailing = false;
        this.albumScheduleSync("trailing-change");
      }
      return { ...outcome, refreshed, wrote, unknown };
    };
    const applyPromise = Promise.resolve().then(run);
    this.albumUpdateFlight = applyPromise;
    void opts;
    return applyPromise;
  }

  apiAlbumVaultSyncRetry(options = {}) {
    if (this.albumDataActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Album data has unloaded." });
    }
    if (this.albumSyncFlight) {
      return this.albumSyncFlight.then((result) => ({ ...result, retried: false }));
    }
    return bobSpawnJson(
      albumVaultSyncArgs(),
      albumDecodeVaultSyncResult,
      {
        ...options,
        commandLabel: "bob vault-sync",
        resolveBobPath: () =>
          typeof this.apiStatsBobPath === "function"
            ? this.apiStatsBobPath()
            : { path: "bob", source: "path" },
        getVaultPath: () =>
          typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
        timeout: ALBUM_UPDATE_TIMEOUT_MS,
        maxBuffer: ALBUM_UPDATE_MAX_BUFFER,
        firstLine: statsFirstLine,
      },
    );
  }
}
