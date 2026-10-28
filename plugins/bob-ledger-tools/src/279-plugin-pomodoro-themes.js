// --- Pomodoro themes: api.themes v1 data path -------------------------
// Desktop fetch (`bob themes list -a -f json`, stale-while-revalidate,
// single flight), the journal writers (hide/unhide/color/rename), and
// the `BobLedgerToolsPomodoroThemesMixin` behind `api.themes`. Pure
// mirrors live in 279-plugin-pomodoro-theme-mirrors.js; this file only
// moves JSON. bob-cli owns every hue, ranking, and history value.

class BobLedgerToolsPomodoroThemesMixin {
  // History and writes need the desktop app, where bob can spawn. On
  // mobile the namespace stays readable: colors (hash, area, and
  // journal pins) still render through the vault journal fold.
  pomodoroThemesIsDesktop() {
    try {
      if (
        typeof Platform !== "undefined" &&
        Platform &&
        Platform.isDesktopApp === true
      ) {
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  apiThemesAvailable() {
    try {
      if (!this.pomodoroThemesIsDesktop()) {
        return { available: false, reason: "mobile" };
      }
      return { available: true, reason: "" };
    } catch (error) {
      return { available: false, reason: "unknown" };
    }
  }

  themesCacheStore() {
    if (!(this.pomodoroThemesCache instanceof Object)) {
      this.pomodoroThemesCache = null;
    }
    return this.pomodoroThemesCache;
  }

  apiThemesSnapshot() {
    try {
      const cached = this.themesCacheStore();
      if (cached && cached.report) {
        return cached.report;
      }
      return pomodoroThemesEmptyReport();
    } catch (error) {
      return pomodoroThemesEmptyReport();
    }
  }

  themesNotifyChanged(reason) {
    try {
      this.pomodoroThemesGeneration = (this.pomodoroThemesGeneration || 0) + 1;
      const listeners = this.pomodoroThemesListeners;
      if (listeners instanceof Set) {
        for (const listener of [...listeners]) {
          try {
            listener(this.apiThemesSnapshot(), reason);
          } catch (error) {
            // One bad listener never breaks the fan-out.
          }
        }
      }
    } catch (error) {
      // Notification is best-effort.
    }
    try {
      this.refreshPomodoroThemeChips();
    } catch (error) {
      // Chips refresh is best-effort.
    }
    try {
      this.schedulePomodoroThemesPlanRefresh(reason);
    } catch (error) {
      // Plan refresh is best-effort.
    }
  }

  // Subscribe to theme catalog changes; returns an unsubscribe
  // function. The callback receives `(report, reason)`.
  onThemesChange(callback) {
    try {
      if (typeof callback !== "function") {
        return () => {};
      }
      if (!(this.pomodoroThemesListeners instanceof Set)) {
        this.pomodoroThemesListeners = new Set();
      }
      this.pomodoroThemesListeners.add(callback);
      return () => {
        try {
          this.pomodoroThemesListeners.delete(callback);
        } catch (error) {
          // Unsubscribe is best-effort.
        }
      };
    } catch (error) {
      return () => {};
    }
  }

  themesSpawnFetch(options = {}) {
    try {
      if (!this.pomodoroThemesIsDesktop()) {
        return Promise.resolve({
          ok: false,
          code: "unavailable",
          message: "Theme history needs the desktop app.",
          detail: "",
          tried: [],
        });
      }
      return bobSpawnJson(
        ["themes", "list", "-a", "-f", "json"],
        pomodoroThemesDecodeReport,
        {
          ...options,
          commandLabel: "bob themes",
          resolveBobPath: () =>
            typeof this.apiStatsBobPath === "function"
              ? this.apiStatsBobPath()
              : { path: "bob", source: "path" },
          getVaultPath: () => this.statsVaultBasePath(),
          timeout: BOB_SPAWN_TIMEOUT_MS,
          maxBuffer: BOB_SPAWN_MAX_BUFFER,
          firstLine: statsFirstLine,
        },
      );
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: "failed",
        message:
          error && error.message ? String(error.message) : "bob themes failed.",
        detail: "",
      });
    }
  }

  // Fetch the cached `bob themes list -a -f json` report. Resolves
  // `{ report, stale, error }`: a cached report returns immediately as
  // stale while one background revalidation refreshes it; a miss spawns
  // bob. At most one spawn is in flight; concurrent callers share the
  // flight. Never rejects.
  apiThemesFetch() {
    try {
      if (!this.pomodoroThemesIsDesktop()) {
        return Promise.resolve({
          report: pomodoroThemesEmptyReport(),
          stale: false,
          error: {
            ok: false,
            code: "unavailable",
            message: "Theme history needs the desktop app.",
            detail: "",
          },
        });
      }
      const cached = this.themesCacheStore();
      if (this.pomodoroThemesFlight) {
        return this.pomodoroThemesFlight;
      }
      const run = async (hadCached) => {
        try {
          const result = await this.themesSpawnFetch();
          if (result && result.ok) {
            this.pomodoroThemesCache = {
              report: result.report,
              fetchedAt: Date.now(),
            };
            if (hadCached) {
              this.themesNotifyChanged("fetch");
            }
            return { report: result.report, stale: false, error: null };
          }
          if (hadCached && cached && cached.report) {
            return { report: cached.report, stale: true, error: result };
          }
          return { report: pomodoroThemesEmptyReport(), stale: false, error: result };
        } catch (error) {
          const failure = {
            ok: false,
            code: "failed",
            message:
              error && error.message
                ? String(error.message)
                : "bob themes failed.",
            detail: "",
          };
          if (hadCached && cached && cached.report) {
            return { report: cached.report, stale: true, error: failure };
          }
          return { report: pomodoroThemesEmptyReport(), stale: false, error: failure };
        }
      };
      const flight = run(Boolean(cached && cached.report)).finally(() => {
        if (this.pomodoroThemesFlight === flight) {
          this.pomodoroThemesFlight = null;
        }
      });
      this.pomodoroThemesFlight = flight;
      if (cached && cached.report) {
        return Promise.resolve({ report: cached.report, stale: true, error: null });
      }
      return flight;
    } catch (error) {
      return Promise.resolve({
        report: pomodoroThemesEmptyReport(),
        stale: false,
        error: {
          ok: false,
          code: "failed",
          message: "bob themes failed.",
          detail: "",
        },
      });
    }
  }

  schedulePomodoroThemesFetch(reason) {
    void reason;
    try {
      if (
        this.pomodoroThemesFetchTimer !== null &&
        this.pomodoroThemesFetchTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.pomodoroThemesFetchTimer = schedule(() => {
        this.pomodoroThemesFetchTimer = null;
        try {
          void this.apiThemesFetch();
        } catch (error) {
          // Fetch is best-effort.
        }
      }, POMODORO_THEMES_FETCH_DEBOUNCE_MS);
    } catch (error) {
      // Scheduling is best-effort.
    }
  }

  schedulePomodoroThemesPlanRefresh(reason) {
    void reason;
    try {
      if (typeof this.rerenderPlanBlocks === "function") {
        this.rerenderPlanBlocks();
      }
    } catch (error) {
      // Plan refresh is best-effort.
    }
  }

  // Normalized `plan.exempt` keys (PLAN by default). Never throws.
  pomodoroThemesExemptKeys() {
    try {
      const loaded = loadPlanCaps();
      const caps = loaded && loaded.caps ? loaded.caps : null;
      const exempt =
        caps && Array.isArray(caps.exempt) && caps.exempt.length > 0
          ? caps.exempt
          : ["PLAN"];
      return exempt.map((value) => pomodoroThemeNormalizeKey(value));
    } catch (error) {
      return ["plan"];
    }
  }

  // Top-level area stems (an area whose parent is `[[area]]`) to their
  // resolved hues: a frontmatter `color:` slot, else the stem hash. This
  // is the JS half of the PT5 area rule; the Rust half owns the report
  // hues on desktop. Rebuilt at most once per 60 s.
  pomodoroThemesAreasMap() {
    try {
      const nowMs = Date.now();
      const cached = this.pomodoroThemesAreasCache;
      if (
        cached &&
        cached.map &&
        Number.isFinite(cached.checkedAt) &&
        nowMs - cached.checkedAt < 60 * 1000
      ) {
        return cached.map;
      }
      const map = {};
      try {
        const app = this.app || {};
        const vault = app.vault;
        const metadataCache = app.metadataCache;
        const files =
          vault && typeof vault.getMarkdownFiles === "function"
            ? vault.getMarkdownFiles()
            : [];
        for (const file of Array.isArray(files) ? files : []) {
          try {
            const path = file && typeof file.path === "string" ? file.path : "";
            if (!path || path.includes("/")) {
              continue;
            }
            const frontmatter =
              metadataCache &&
              typeof metadataCache.getCache === "function"
                ? metadataCache.getCache(path) &&
                  metadataCache.getCache(path).frontmatter
                : null;
            if (!frontmatter || typeof frontmatter !== "object") {
              continue;
            }
            if (pomodoroHomeType(frontmatter) !== "area") {
              continue;
            }
            if (pomodoroHomeParentTarget(frontmatter.parent) !== "area") {
              continue;
            }
            const stem = pomodoroHomeStem(path);
            const key = pomodoroThemeNormalizeKey(stem);
            if (!key || Object.prototype.hasOwnProperty.call(map, key)) {
              continue;
            }
            const configured =
              typeof frontmatter.color === "string"
                ? frontmatter.color.trim().toLowerCase()
                : "";
            map[key] = POMODORO_HOME_SLOT_ORDER.includes(configured)
              ? configured
              : pomodoroThemeFallbackHue(key);
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        // A vault scan failure keeps the previous map.
        if (cached && cached.map) {
          return cached.map;
        }
      }
      this.pomodoroThemesAreasCache = { map, checkedAt: nowMs };
      return map;
    } catch (error) {
      return {};
    }
  }

  // Folded journal prefs (`{ key: { hidden, pin } }`), from the last
  // vault read. Never throws.
  pomodoroThemesJournalPrefs() {
    try {
      const folded = this.pomodoroThemesJournalFold;
      if (folded && folded.byKey && typeof folded.byKey === "object") {
        return folded.byKey;
      }
      return {};
    } catch (error) {
      return {};
    }
  }

  // Re-read `.bob/themes/*.jsonl` through the vault adapter (works on
  // mobile), refold, and notify. Never throws.
  async refreshPomodoroThemesJournal(reason) {
    void reason;
    try {
      const app = this.app || {};
      const adapter =
        app.vault && app.vault.adapter ? app.vault.adapter : null;
      if (!adapter || typeof adapter.list !== "function") {
        return this.pomodoroThemesJournalPrefs();
      }
      let listed = null;
      try {
        listed = await adapter.list(POMODORO_THEMES_JOURNAL_DIR);
      } catch (error) {
        listed = null;
      }
      const files =
        listed && Array.isArray(listed.files) ? listed.files : [];
      const events = [];
      let malformed = 0;
      const warnings = [];
      for (const name of files) {
        try {
          if (typeof name !== "string" || !name.endsWith(".jsonl")) {
            continue;
          }
          const base = name.split("/").pop();
          let text = null;
          try {
            text = await adapter.read(
              `${POMODORO_THEMES_JOURNAL_DIR}/${base}`,
            );
          } catch (error) {
            continue;
          }
          const lines = String(text === null ? "" : text).split("\n");
          lines.forEach((raw, index) => {
            try {
              if (!raw || !raw.trim()) {
                return;
              }
              const parsed = pomodoroThemeParseJournalLine(
                raw,
                base,
                index + 1,
              );
              if (!parsed) {
                malformed += 1;
                if (warnings.length < 8) {
                  warnings.push(`skipping malformed theme journal line ${base}:${index + 1}`);
                }
                return;
              }
              events.push(parsed);
            } catch (error) {
              malformed += 1;
            }
          });
        } catch (error) {
          continue;
        }
      }
      if (malformed > 8) {
        warnings.push(`skipped ${malformed} malformed theme journal lines`);
      }
      this.pomodoroThemesJournalFold = pomodoroThemeFoldEvents(events);
      this.pomodoroThemesJournalWarnings = warnings;
      this.pomodoroThemesAreasCache = null;
      this.themesNotifyChanged("journal");
      return this.pomodoroThemesJournalPrefs();
    } catch (error) {
      return this.pomodoroThemesJournalPrefs();
    }
  }

  schedulePomodoroThemesJournalRefresh(reason) {
    void reason;
    try {
      if (
        this.pomodoroThemesJournalTimer !== null &&
        this.pomodoroThemesJournalTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.pomodoroThemesJournalTimer = schedule(() => {
        this.pomodoroThemesJournalTimer = null;
        try {
          void this.refreshPomodoroThemesJournal("vault");
        } catch (error) {
          // Refresh is best-effort.
        }
      }, POMODORO_THEMES_FETCH_DEBOUNCE_MS);
    } catch (error) {
      // Scheduling is best-effort.
    }
  }

  refreshPomodoroThemesForVaultEvent(event, file, oldPath) {
    try {
      const paths = [];
      if (file && typeof file.path === "string" && file.path) {
        paths.push(file.path);
      }
      if (typeof oldPath === "string" && oldPath) {
        paths.push(oldPath);
      }
      const touched = paths.some((path) =>
        String(path || "").startsWith(`${POMODORO_THEMES_JOURNAL_DIR}/`),
      );
      if (!touched) {
        return false;
      }
      void event;
      this.schedulePomodoroThemesJournalRefresh("vault");
      this.schedulePomodoroThemesFetch("vault");
      return true;
    } catch (error) {
      return false;
    }
  }

  // Synchronous hue lookup for one theme key: the fetched report wins
  // (bob owns area resolution on desktop); otherwise the local fold
  // (pins), exempt list, and area map decide, with the name hash as the
  // fallback. Never throws; returns `{ hue, hue_source }` with a null
  // hue for exempt themes.
  pomodoroThemeHueFor(key, name) {
    try {
      const normalized = pomodoroThemeNormalizeKey(key);
      if (!normalized) {
        return { hue: null, hue_source: "hash" };
      }
      const report = this.apiThemesSnapshot();
      const entry = (report.themes || []).find(
        (theme) => theme && theme.key === normalized,
      );
      if (entry) {
        return {
          hue: entry.hue,
          hue_source: entry.hue_source || "hash",
        };
      }
      const prefs = this.pomodoroThemesJournalPrefs();
      const pref = prefs[normalized] || { hidden: false, pin: null };
      return pomodoroThemeResolveHue(normalized, {
        pin: pref.pin,
        exempt: this.pomodoroThemesExemptKeys(),
        areas: this.pomodoroThemesAreasMap(),
      });
    } catch (error) {
      return { hue: null, hue_source: "hash" };
    }
  }

  // Synchronous hidden lookup: the fetched report wins, else the
  // journal fold. Never throws.
  pomodoroThemeHiddenFor(key) {
    try {
      const normalized = pomodoroThemeNormalizeKey(key);
      if (!normalized) {
        return false;
      }
      const report = this.apiThemesSnapshot();
      const entry = (report.themes || []).find(
        (theme) => theme && theme.key === normalized,
      );
      if (entry) {
        return entry.hidden === true;
      }
      const prefs = this.pomodoroThemesJournalPrefs();
      return Boolean(prefs[normalized] && prefs[normalized].hidden);
    } catch (error) {
      return false;
    }
  }

  // Synchronous history rows for pickers: visible catalog themes ranked
  // per PT7 group B (exact/prefix) then D (substring), with components of
  // the caller's displayed Today rows excluded by the caller. Options:
  // `{ query, limit, exclusions }`. Never throws.
  pomodoroThemeHistoryRows(options = {}) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      const query = typeof opts.query === "string" ? opts.query : "";
      const limit = Number.isInteger(opts.limit) ? opts.limit : 12;
      const exclusions =
        opts.exclusions instanceof Set
          ? opts.exclusions
          : new Set(Array.isArray(opts.exclusions) ? opts.exclusions : []);
      const report = this.apiThemesSnapshot();
      const visible = (report.themes || []).filter(
        (theme) => theme && theme.hidden !== true,
      );
      const ranked = pomodoroThemeRankHistory(visible, query, exclusions);
      const capped =
        Number.isFinite(limit) && limit >= 0 ? ranked.slice(0, limit) : ranked;
      return capped.map((theme) => ({
        key: theme.key,
        name: theme.name,
        last_used: theme.last_used,
        days_used: theme.days_used,
        hue: theme.hue,
        hue_source: theme.hue_source,
        today: theme.today,
        themes: pomodoroThemePillModels(theme.name, (key) =>
          this.pomodoroThemeHueFor(key),
        ),
      }));
    } catch (error) {
      return [];
    }
  }

  // Synchronous near-duplicate heads-up for a create row. Never throws.
  pomodoroThemeSimilarTo(name) {
    try {
      const queryKey = pomodoroThemeNormalizeKey(name);
      if (queryKey.length < 3) {
        return [];
      }
      const report = this.apiThemesSnapshot();
      const keys = pomodoroThemeSimilarKeys(queryKey, report.themes || []);
      const byKey = new Map(
        (report.themes || [])
          .filter((theme) => theme && typeof theme.key === "string")
          .map((theme) => [theme.key, theme]),
      );
      return keys
        .map((key) => byKey.get(key))
        .filter(Boolean)
        .map((theme) => theme.name);
    } catch (error) {
      return [];
    }
  }

  themesWriteSpawn(args) {
    try {
      if (!this.pomodoroThemesIsDesktop()) {
        return Promise.resolve({
          ok: false,
          code: "unavailable",
          message: "Theme writes need the desktop app.",
          detail: "",
        });
      }
      return bobSpawnJson(
        [...args, "--via", POMODORO_THEMES_VIA, "-f", "json"],
        pomodoroThemesDecodeWrite,
        {
          commandLabel: "bob themes",
          resolveBobPath: () =>
            typeof this.apiStatsBobPath === "function"
              ? this.apiStatsBobPath()
              : { path: "bob", source: "path" },
          getVaultPath: () => this.statsVaultBasePath(),
          timeout: BOB_SPAWN_TIMEOUT_MS,
          maxBuffer: BOB_SPAWN_MAX_BUFFER,
          firstLine: statsFirstLine,
        },
      );
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: "failed",
        message:
          error && error.message ? String(error.message) : "bob themes failed.",
        detail: "",
      });
    }
  }

  async apiThemesWriteAftermath(result) {
    try {
      if (result && result.ok) {
        try {
          await this.refreshPomodoroThemesJournal("write");
        } catch (error) {
          // Journal refresh is best-effort.
        }
        try {
          await this.apiThemesFetch();
        } catch (error) {
          // Fetch refresh is best-effort.
        }
        this.themesNotifyChanged("write");
      }
    } catch (error) {
      // Aftermath is best-effort.
    }
    return result;
  }

  // Hide a theme from Recent rows (PT9). Resolves
  // `{ ok, code?, message? }` and never rejects.
  async apiThemesHide(name) {
    try {
      const display = String(name || "").trim();
      if (!display) {
        return { ok: false, code: "invalid_name", message: "Name a theme to hide." };
      }
      const result = await this.themesWriteSpawn(["themes", "hide", display]);
      return this.apiThemesWriteAftermath(result);
    } catch (error) {
      return { ok: false, code: "failed", message: "bob themes hide failed." };
    }
  }

  // Unhide a theme. Resolves `{ ok, code?, message? }`; never rejects.
  async apiThemesUnhide(name) {
    try {
      const display = String(name || "").trim();
      if (!display) {
        return { ok: false, code: "invalid_name", message: "Name a theme to unhide." };
      }
      const result = await this.themesWriteSpawn(["themes", "unhide", display]);
      return this.apiThemesWriteAftermath(result);
    } catch (error) {
      return { ok: false, code: "failed", message: "bob themes unhide failed." };
    }
  }

  // Pin a theme hue (`hue` is a slot name, or null/`auto` to unpin).
  // Resolves `{ ok, code?, message? }`; never rejects.
  async apiThemesColor(name, hue) {
    try {
      const display = String(name || "").trim();
      if (!display) {
        return { ok: false, code: "invalid_name", message: "Name a theme to color." };
      }
      const slot =
        hue === null || hue === undefined || String(hue).toLowerCase() === "auto"
          ? "auto"
          : String(hue).trim().toLowerCase();
      if (slot !== "auto" && !POMODORO_THEMES_HUE_SLOTS.includes(slot)) {
        return { ok: false, code: "invalid_hue", message: `Unknown hue ${String(hue)}.` };
      }
      const result = await this.themesWriteSpawn(["themes", "color", display, slot]);
      return this.apiThemesWriteAftermath(result);
    } catch (error) {
      return { ok: false, code: "failed", message: "bob themes color failed." };
    }
  }

  // Rename a theme (`options`: `{ merge?, dryRun? }`). Resolves the
  // writer result; never rejects.
  async apiThemesRename(from, to, options = {}) {
    try {
      const source = String(from || "").trim();
      const target = String(to || "").trim();
      if (!source || !target) {
        return { ok: false, code: "invalid_name", message: "Rename needs two names." };
      }
      const opts = options && typeof options === "object" ? options : {};
      const args = ["themes", "rename", source, target];
      if (opts.dryRun === true) {
        args.push("--dry-run");
      }
      if (opts.merge === true) {
        args.push("--merge");
      }
      const result = await this.themesWriteSpawn(args);
      if (!opts.dryRun) {
        return this.apiThemesWriteAftermath(result);
      }
      return result;
    } catch (error) {
      return { ok: false, code: "failed", message: "bob themes rename failed." };
    }
  }
}
