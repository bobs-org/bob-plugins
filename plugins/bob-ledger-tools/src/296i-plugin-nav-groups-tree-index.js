// Lazy, generation-stamped tree-note index for api.navGroups v1
// (bob-cli-ra engine). Installed beside BobLedgerToolsNavGroupsMixin: one
// in-memory table (`path -> { kind, lane, parent, label }`), a ring map, and
// a tour map per kind (and lane, for projects). Vault create/delete/rename
// bumps the generation; a metadata changed event recomputes that file and
// bumps only when kind, lane, parent, or label changed. Warm-up runs off
// the paint path at layout ready plus idle time. Synchronous, never throws,
// never writes, never spawns bob.

class BobLedgerToolsNavGroupsTreeMixin {
  setupNavGroupsTree() {
    if (this.navGroupsTreeSetupDone === true) return;
    this.navGroupsTreeSetupDone = true;
    if (typeof this.navGroupsTreeGeneration !== "number") this.navGroupsTreeGeneration = 0;
    this.navGroupsTreeTables = null;
    this.navGroupsTreeListeners = new Set();
    this.navGroupsTreeWarmScheduled = false;
    const bump = () => {
      try {
        if (typeof this.navGroupsTreeBumpGeneration === "function") this.navGroupsTreeBumpGeneration();
      } catch (_) {}
    };
    const watch = () => {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.on !== "function" || typeof this.registerEvent !== "function") return;
      for (const event of ["create", "delete", "rename"]) {
        try {
          this.registerEvent(vault.on(event, () => bump()));
        } catch (_) {}
      }
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        try {
          this.registerEvent(metadataCache.on("changed", (file, _data, cache) => {
            try {
              if (typeof this.navGroupsTreeHandleChanged === "function") {
                this.navGroupsTreeHandleChanged(file, cache);
              }
            } catch (_) {}
          }));
        } catch (_) {}
      }
    };
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.onLayoutReady === "function") {
      try {
        workspace.onLayoutReady(() => {
          watch();
          try {
            if (typeof this.navGroupsTreeScheduleWarm === "function") this.navGroupsTreeScheduleWarm();
          } catch (_) {}
        });
      } catch (_) {
        watch();
      }
    } else {
      watch();
    }
  }

  teardownNavGroupsTree() {
    this.navGroupsTreeTables = null;
    this.navGroupsTreeWarmScheduled = false;
    this.navGroupsTreeSetupDone = false;
    try {
      if (this.navGroupsTreeListeners && typeof this.navGroupsTreeListeners.clear === "function") {
        this.navGroupsTreeListeners.clear();
      }
    } catch (_) {}
  }

  navGroupsTreeBumpGeneration() {
    try {
      if (typeof this.navGroupsTreeGeneration !== "number") this.navGroupsTreeGeneration = 0;
      this.navGroupsTreeGeneration += 1;
      const listeners = this.navGroupsTreeListeners;
      if (listeners && typeof listeners.forEach === "function") {
        listeners.forEach((listener) => {
          try {
            if (typeof listener === "function") listener(this.navGroupsTreeGeneration);
          } catch (_) {}
        });
      }
      return this.navGroupsTreeGeneration;
    } catch (_) {
      return 0;
    }
  }

  navGroupsTreeOnChange(listener) {
    try {
      if (typeof listener !== "function") return () => {};
      if (!this.navGroupsTreeListeners || typeof this.navGroupsTreeListeners.add !== "function") {
        this.navGroupsTreeListeners = new Set();
      }
      this.navGroupsTreeListeners.add(listener);
      return () => {
        try {
          this.navGroupsTreeListeners.delete(listener);
        } catch (_) {}
      };
    } catch (_) {
      return () => {};
    }
  }

  navGroupsTreeFileCache(file) {
    try {
      if (!file) return null;
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.getFileCache === "function") {
        const live = metadataCache.getFileCache(file);
        if (live != null) return live;
      }
      if (typeof propertyCardSettledFileCache === "function") {
        return propertyCardSettledFileCache(this.app, file);
      }
    } catch (_) {}
    return null;
  }

  navGroupsTreeResolveLink(target, fromPath) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
        const file = metadataCache.getFirstLinkpathDest(target, fromPath);
        if (file && typeof file.path === "string") return file.path;
      }
    } catch (_) {}
    return "";
  }

  navGroupsTreeTodayText() {
    try {
      if (typeof this.navGroupsTodayText === "function") return this.navGroupsTodayText() || "";
    } catch (_) {}
    return "";
  }

  navGroupsTreeBuildTables() {
    const empty = { nodes: new Map(), rings: new Map(), tours: new Map() };
    try {
      let files = [];
      try {
        if (typeof this.navGroupsMarkdownFiles === "function") files = this.navGroupsMarkdownFiles() || [];
      } catch (_) {
        files = [];
      }
      const today = this.navGroupsTreeTodayText();
      const kindMemo = new Map();
      const kindOfType = (fm) => navGroupsTreeMemoizedKindOfType(kindMemo, fm);
      const classifyMemo = new Map();
      const nodes = new Map();
      for (const file of files) {
        try {
          const raw = file && typeof file.path === "string" ? file.path : "";
          if (!raw) continue;
          const node = navGroupsTreeNodeFor(raw, this.navGroupsTreeFileCache(file), today, kindOfType);
          if (node && node.path && !nodes.has(node.path)) nodes.set(node.path, node);
        } catch (_) {}
      }
      const resolveLink = (target, fromPath) => this.navGroupsTreeResolveLink(target, fromPath);
      navGroupsTreeResolveParents(nodes, resolveLink, classifyMemo);
      const rings = navGroupsTreeBuildRings(nodes);
      return { nodes, rings, tours: navGroupsTreeBuildTours(nodes, rings) };
    } catch (_) {
      return empty;
    }
  }

  navGroupsTreeEnsureBuilt() {
    try {
      if (typeof this.navGroupsTreeGeneration !== "number") this.navGroupsTreeGeneration = 0;
      const current = this.navGroupsTreeTables;
      if (current && current.builtGeneration === this.navGroupsTreeGeneration) return current;
      const built = this.navGroupsTreeBuildTables();
      this.navGroupsTreeTables = {
        nodes: built.nodes,
        rings: built.rings,
        tours: built.tours,
        builtGeneration: this.navGroupsTreeGeneration,
      };
      return this.navGroupsTreeTables;
    } catch (_) {
      return { nodes: new Map(), rings: new Map(), tours: new Map(), builtGeneration: 0 };
    }
  }

  navGroupsTreeTablesFresh() {
    try {
      const tables = this.navGroupsTreeTables;
      return Boolean(tables) && tables.builtGeneration === this.navGroupsTreeGeneration;
    } catch (_) {
      return false;
    }
  }

  // Single-file paint-path answer when the index is cold or stale: kind
  // and lane come from this note's own cache, nothing is built, and a
  // non-member falls through to calendar (null).
  navGroupsTreeIndexingAnswer(request) {
    try {
      const path = navGroupsNormalizePath(request && request.path);
      if (!path) return null;
      let file = null;
      try {
        const vault = this.app && this.app.vault;
        if (vault && typeof vault.getAbstractFileByPath === "function") {
          file = vault.getAbstractFileByPath(path);
        }
      } catch (_) {
        file = null;
      }
      if (!file) return null;
      const cache = this.navGroupsTreeFileCache(file);
      const frontmatter = cache && cache.frontmatter && typeof cache.frontmatter === "object"
        ? cache.frontmatter
        : {};
      const kind = navGroupsTreeSpeciesFast(path, frontmatter, this.navGroupsTreeTodayText());
      if (!navGroupsTreeIsKind(kind)) return null;
      return navGroupsOk({
        route: "tree",
        kind,
        lane: kind === "project" ? navGroupsTreeLaneFromCache(cache) : null,
        step: null,
        stepNone: null,
        group: null,
        prevGroup: null,
        nextGroup: null,
        none: NAV_GROUPS_TREE_INDEXING,
      });
    } catch (_) {
      return null;
    }
  }

  navGroupsTreeResolve(request) {
    try {
      if (!request || typeof request.path !== "string" || !request.path.trim()) return null;
      if (typeof this.navGroupsTreeGeneration !== "number") this.navGroupsTreeGeneration = 0;
      if (this.navGroupsTreeTablesFresh()) {
        return navGroupsTreeAnswerFor(this.navGroupsTreeTables, request.path);
      }
      if (request.lazy === true) {
        try {
          if (typeof this.navGroupsTreeScheduleWarm === "function") this.navGroupsTreeScheduleWarm();
        } catch (_) {}
        return this.navGroupsTreeIndexingAnswer(request);
      }
      const tables = this.navGroupsTreeEnsureBuilt();
      return navGroupsTreeAnswerFor(tables, request.path);
    } catch (_) {
      return null;
    }
  }

  navGroupsTreeScheduleWarm() {
    try {
      if (this.navGroupsTreeWarmScheduled === true) return;
      this.navGroupsTreeWarmScheduled = true;
      const run = () => {
        this.navGroupsTreeWarmScheduled = false;
        try {
          if (!this.navGroupsTreeTablesFresh()) this.navGroupsTreeEnsureBuilt();
        } catch (_) {}
      };
      if (typeof requestIdleCallback === "function") {
        try {
          requestIdleCallback(run, { timeout: 2000 });
          return;
        } catch (_) {}
      }
      if (typeof requestAnimationFrame === "function") {
        try {
          requestAnimationFrame(run);
          return;
        } catch (_) {}
      }
      try {
        const timer = setTimeout(run, 1500);
        if (timer && typeof timer.unref === "function") timer.unref();
      } catch (_) {
        this.navGroupsTreeWarmScheduled = false;
      }
    } catch (_) {}
  }

  navGroupsTreeNodeSignature(node) {
    try {
      if (!node) return "";
      return [node.kind || "", node.lane || "", node.parentStatus || "", node.parentPath || "", node.label || ""].join("|");
    } catch (_) {
      return "";
    }
  }

  // Metadata changed: recompute this file's entry. Bump (and rebuild the
  // derived maps) only when kind, lane, parent, or label changed; an
  // irrelevant change leaves the generation alone.
  navGroupsTreeHandleChanged(file, cache) {
    try {
      const path = file && typeof file.path === "string" ? file.path : "";
      if (!path) return;
      const normalized = navGroupsNormalizePath(path);
      if (!normalized) return;
      let tables = this.navGroupsTreeTables;
      if (!tables) {
        this.navGroupsTreeBumpGeneration();
        return;
      }
      const today = this.navGroupsTreeTodayText();
      let fileCache = null;
      try {
        fileCache = cache != null ? cache : this.navGroupsTreeFileCache(file);
      } catch (_) {
        fileCache = null;
      }
      const next = navGroupsTreeNodeFor(normalized, fileCache, today);
      if (!next) return;
      const previous = tables.nodes.get(next.path);
      const previousSignature = previous ? this.navGroupsTreeNodeSignature(previous) : null;
      tables.nodes.set(next.path, next);
      navGroupsTreeResolveParents(
        tables.nodes,
        (target, fromPath) => this.navGroupsTreeResolveLink(target, fromPath),
        null,
      );
      const settled = tables.nodes.get(next.path);
      if (!settled) return;
      if (previousSignature !== null
        && this.navGroupsTreeNodeSignature(settled) === previousSignature) return;
      if (previousSignature === null && !navGroupsTreeIsKind(settled.kind)) return;
      tables.rings = navGroupsTreeBuildRings(tables.nodes);
      tables.tours = navGroupsTreeBuildTours(tables.nodes, tables.rings);
      this.navGroupsTreeBumpGeneration();
      tables.builtGeneration = this.navGroupsTreeGeneration;
    } catch (_) {}
  }
}
