// api.navGroups v1: derived calendar and record group stops. Synchronous,
// never throws, never writes, never spawns bob. The adopted ISO-year cache is a set of
// years that already have a YYYY/YYYY-Www.md week note; it invalidates on
// vault create, delete, and rename of those paths.

const NAV_GROUPS_API_VERSION = 1;

class BobLedgerToolsNavGroupsMixin {
  setupNavGroups() {
    if (this.navGroupsSetupDone === true) return;
    this.navGroupsSetupDone = true;
    try {
      if (typeof this.setupNavGroupsTree === "function") this.setupNavGroupsTree();
    } catch (_) {}
    this.navGroupsAdoptedYearsCache = null;
    const watch = () => {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.on !== "function" || typeof this.registerEvent !== "function") return;
      for (const event of ["create", "delete", "rename"]) {
        try {
          this.registerEvent(vault.on(event, (file, oldPath) => {
            this.navGroupsHandleVaultEvent(event, file, oldPath);
          }));
        } catch (_error) {
          // Vault listeners are best-effort on limited test hosts.
        }
      }
    };
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.onLayoutReady === "function") {
      try {
        workspace.onLayoutReady(watch);
      } catch (_error) {
        watch();
      }
    } else {
      watch();
    }
  }

  teardownNavGroups() {
    try {
      if (typeof this.treeWalkRailTeardown === "function") this.treeWalkRailTeardown();
    } catch (_) {}
    try {
      if (typeof this.teardownNavGroupsTree === "function") this.teardownNavGroupsTree();
    } catch (_) {}
    this.navGroupsAdoptedYearsCache = null;
    this.navGroupsSetupDone = false;
  }

  navGroupsTodayText() {
    try {
      if (typeof this.navGroupsTodayOverride === "string" && this.navGroupsTodayOverride) {
        return this.navGroupsTodayOverride;
      }
      if (typeof dayStripLocalToday === "function") return dayStripLocalToday(new Date());
      const now = new Date();
      if (!Number.isFinite(now.getTime())) return "";
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const date = String(now.getDate()).padStart(2, "0");
      return now.getFullYear() + "-" + month + "-" + date;
    } catch (_error) {
      return "";
    }
  }

  navGroupsVaultHas(path) {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") return false;
      const file = vault.getAbstractFileByPath(path);
      return file !== null && file !== undefined;
    } catch (_error) {
      return false;
    }
  }

  navGroupsMarkdownFiles() {
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.getMarkdownFiles === "function") {
        return vault.getMarkdownFiles() || [];
      }
      if (vault && typeof vault.getFiles === "function") {
        return (vault.getFiles() || []).filter((file) => file && /\.md$/i.test(file.path || ""));
      }
    } catch (_error) {}
    return [];
  }

  navGroupsAdoptedIsoYears(options) {
    const opts = options && typeof options === "object" ? options : {};
    const exceptPath = typeof opts.exceptPath === "string" ? opts.exceptPath : "";
    if (!exceptPath && this.navGroupsAdoptedYearsCache instanceof Set) {
      return this.navGroupsAdoptedYearsCache;
    }
    const years = navGroupsAdoptedIsoYearsFromFiles(this.navGroupsMarkdownFiles(), exceptPath);
    if (!exceptPath) this.navGroupsAdoptedYearsCache = years;
    return years;
  }

  navGroupsInvalidateAdoptedYears() {
    this.navGroupsAdoptedYearsCache = null;
  }

  navGroupsHandleVaultEvent(event, file, oldPath) {
    try {
      const path = file && typeof file.path === "string" ? file.path : "";
      const previous = typeof oldPath === "string" ? oldPath : "";
      if (navGroupsWeekNoteIsoYear(path) !== null || navGroupsWeekNoteIsoYear(previous) !== null) {
        this.navGroupsInvalidateAdoptedYears();
      }
    } catch (_error) {
      this.navGroupsInvalidateAdoptedYears();
    }
  }

  navGroupsPathIsPreAdoption(path) {
    try {
      const today = this.navGroupsTodayText();
      if (!today) return false;
      const years = this.navGroupsAdoptedIsoYears({ exceptPath: path });
      return navGroupsPathIsPreAdoptionWith(path, today, years) === true;
    } catch (_error) {
      return false;
    }
  }

  navGroupsPreAdoptionMessage(path) {
    try {
      return navGroupsPreAdoptionMessageForPath(path, this.navGroupsTodayText());
    } catch (_error) {
      return "That note is before Bob's period notes began — navigation never creates it";
    }
  }

  navGroupsResolve(request) {
    try {
      const invalid = navGroupsRequestError(request);
      if (invalid) return invalid;
      const record = navGroupsRecordResolve(this, request);
      if (record) return record;
      let tree = null;
      try {
        if (typeof this.navGroupsTreeResolve === "function") tree = this.navGroupsTreeResolve(request);
      } catch (_) {
        tree = null;
      }
      if (tree) return tree;
      const today = this.navGroupsTodayText();
      if (!today) return Object.freeze({ ok: false, reason: "unavailable" });
      return navGroupsCalendarResolve(request.path, {
        today,
        vaultHas: (path) => this.navGroupsVaultHas(path),
        adoptedYears: this.navGroupsAdoptedIsoYears(),
      });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "unavailable" });
    }
  }

  // Additive namespace: the top-level api stays v3. Members never throw.
  navGroupsApi() {
    return Object.freeze({
      version: NAV_GROUPS_API_VERSION,
      resolve: (request) => this.navGroupsResolve(request),
    });
  }
}
