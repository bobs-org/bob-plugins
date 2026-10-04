class BobLedgerToolsDashboardMixin {
  // --- Dashboard collections (api.dashboardCollections v1) -----------
  // Synchronous, never-throwing `snapshot()` plus lifecycle-owned
  // `renderChip(host, { kind, sourcePath, component })` for `projects`
  // and `references`. Counts come from one shared vault/metadata pass
  // per snapshot (never per badge, never note bodies, never the Tasks
  // plugin or Dataview's excluded-folder index). Base definitions load
  // asynchronously outside the snapshot; a changed contract fails
  // closed to unavailable instead of a stale number. Documented
  // together: to support a future filter change, extend the predicate
  // (`dashboardCollectionIsProjectMember` /
  // `dashboardCollectionIsReferenceMember`) and its contract validator
  // (`dashboardCollectionValidateProjectsBase` /
  // `dashboardCollectionValidateRefsBase`) together.

  dashboardCollectionsResolver() {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function"
      ) {
        return null;
      }
      return (target, sourcePath) => {
        try {
          return metadataCache.getFirstLinkpathDest(
            String(target || ""),
            String(sourcePath || ""),
          );
        } catch (error) {
          return null;
        }
      };
    } catch (error) {
      return null;
    }
  }

  dashboardCollectionsCountOnce() {
    try {
      const vault = this.app && this.app.vault;
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !vault ||
        typeof vault.getMarkdownFiles !== "function" ||
        !metadataCache ||
        typeof metadataCache.getFileCache !== "function"
      ) {
        return { projects: 0, references: 0, incomplete: true, reason: "vault unavailable" };
      }
      const files = vault.getMarkdownFiles();
      if (!Array.isArray(files)) {
        return { projects: 0, references: 0, incomplete: true, reason: "vault unavailable" };
      }
      const resolver = this.dashboardCollectionsResolver();
      if (!resolver) {
        return { projects: 0, references: 0, incomplete: true, reason: "metadata unavailable" };
      }
      let projects = 0;
      let references = 0;
      let incomplete = false;
      const seen = new Set();
      for (const file of files) {
        try {
          const path =
            file && typeof file.path === "string" ? file.path : "";
          if (!path || seen.has(path)) {
            continue;
          }
          seen.add(path);
          let cache = null;
          try {
            cache = metadataCache.getFileCache(file);
          } catch (error) {
            cache = null;
          }
          if (!cache) {
            incomplete = true;
            continue;
          }
          const frontmatter =
            cache.frontmatter &&
            typeof cache.frontmatter === "object" &&
            !Array.isArray(cache.frontmatter)
              ? cache.frontmatter
              : {};
          const note = { path, frontmatter };
          try {
            if (dashboardCollectionIsProjectMember(note, resolver)) {
              projects += 1;
            }
          } catch (error) {
            // One bad note never breaks the pass.
          }
          try {
            if (dashboardCollectionIsReferenceMember(note)) {
              references += 1;
            }
          } catch (error) {
            // One bad note never breaks the pass.
          }
        } catch (error) {
          // One bad file never breaks the pass.
        }
      }
      return { projects, references, incomplete, reason: incomplete ? "metadata pending" : null };
    } catch (error) {
      return { projects: 0, references: 0, incomplete: true, reason: "snapshot failed" };
    }
  }

  dashboardCollectionsSnapshot() {
    try {
      const base = this.dashboardCollectionsBase;
      if (!base || !base.projects || !base.references) {
        return {
          projects: dashboardCollectionEntryFor("projects", null, false, "base definitions loading"),
          references: dashboardCollectionEntryFor("references", null, false, "base definitions loading"),
        };
      }
      if (base.projects.ok !== true) {
        return {
          projects: dashboardCollectionEntryFor(
            "projects",
            null,
            false,
            base.projects.reason || "projects.base changed",
          ),
          references: base.references.ok === true
            ? this.dashboardCollectionsSnapshotOne("references", base)
            : dashboardCollectionEntryFor(
                "references",
                null,
                false,
                base.references.reason || "refs.base changed",
              ),
        };
      }
      if (base.references.ok !== true) {
        return {
          projects: this.dashboardCollectionsSnapshotOne("projects", base),
          references: dashboardCollectionEntryFor(
            "references",
            null,
            false,
            base.references.reason || "refs.base changed",
          ),
        };
      }
      let counted = null;
      try {
        counted = this.dashboardCollectionsCountOnce();
      } catch (error) {
        counted = null;
      }
      if (!counted || counted.incomplete === true) {
        const reason =
          (counted && counted.reason) || "metadata pending";
        return {
          projects: dashboardCollectionEntryFor("projects", null, false, reason),
          references: dashboardCollectionEntryFor("references", null, false, reason),
        };
      }
      return {
        projects: dashboardCollectionEntryFor("projects", counted.projects, true, null),
        references: dashboardCollectionEntryFor("references", counted.references, true, null),
      };
    } catch (error) {
      return {
        projects: dashboardCollectionEntryFor("projects", null, false, "unavailable"),
        references: dashboardCollectionEntryFor("references", null, false, "unavailable"),
      };
    }
  }

  dashboardCollectionsSnapshotOne(kind, base) {
    try {
      const normalized = kind === "references" ? "references" : "projects";
      const contract = base ? base[normalized] : null;
      if (!contract || contract.ok !== true) {
        return dashboardCollectionEntryFor(
          normalized,
          null,
          false,
          (contract && contract.reason) || "base definition changed",
        );
      }
      let counted = null;
      try {
        counted = this.dashboardCollectionsCountOnce();
      } catch (error) {
        counted = null;
      }
      if (!counted || counted.incomplete === true) {
        return dashboardCollectionEntryFor(
          normalized,
          null,
          false,
          (counted && counted.reason) || "metadata pending",
        );
      }
      const count = normalized === "projects" ? counted.projects : counted.references;
      return dashboardCollectionEntryFor(normalized, count, true, null);
    } catch (error) {
      const normalized = kind === "references" ? "references" : "projects";
      return dashboardCollectionEntryFor(normalized, null, false, "unavailable");
    }
  }

  async dashboardCollectionsEnsureBaseContracts() {
    let token = null;
    try {
      this.dashboardCollectionsBaseToken = (this.dashboardCollectionsBaseToken || 0) + 1;
      token = this.dashboardCollectionsBaseToken;
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") {
        this.dashboardCollectionsBase = {
          projects: { ok: false, reason: "vault unavailable" },
          references: { ok: false, reason: "vault unavailable" },
        };
        try {
          this.scheduleDashboardCollectionsRefresh();
        } catch (error) {
          // Best-effort refresh only.
        }
        return;
      }
      const readOne = async (name) => {
        try {
          const file = vault.getAbstractFileByPath(name);
          if (!file) {
            return null;
          }
          if (typeof vault.cachedRead === "function") {
            return await vault.cachedRead(file);
          }
          if (typeof vault.read === "function") {
            return await vault.read(file);
          }
          return null;
        } catch (error) {
          return null;
        }
      };
      const [projectsText, refsText] = await Promise.all([
        readOne("projects.base"),
        readOne("refs.base"),
      ]);
      if (token !== this.dashboardCollectionsBaseToken) {
        return;
      }
      const yamlParser = parseYaml;
      const parseOne = (text) => {
        try {
          if (typeof text !== "string" || typeof yamlParser !== "function") {
            return null;
          }
          return yamlParser(text);
        } catch (error) {
          return null;
        }
      };
      const projectsParsed = parseOne(projectsText);
      const refsParsed = parseOne(refsText);
      const projects =
        projectsText === null || projectsParsed === null
          ? { ok: false, reason: "projects.base is unreadable" }
          : dashboardCollectionValidateProjectsBase(projectsParsed);
      const references =
        refsText === null || refsParsed === null
          ? { ok: false, reason: "refs.base is unreadable" }
          : dashboardCollectionValidateRefsBase(refsParsed);
      const key = JSON.stringify([projectsText, refsText]);
      const previousKey = this.dashboardCollectionsBaseKey || null;
      this.dashboardCollectionsBase = { projects, references };
      this.dashboardCollectionsBaseKey = key;
      if (key !== previousKey) {
        try {
          this.scheduleDashboardCollectionsRefresh();
        } catch (error) {
          // Best-effort refresh only.
        }
      }
    } catch (error) {
      try {
        if (token === null || token === this.dashboardCollectionsBaseToken) {
          this.dashboardCollectionsBase = {
            projects: { ok: false, reason: "base definitions unavailable" },
            references: { ok: false, reason: "base definitions unavailable" },
          };
        }
      } catch (inner) {
        // Best-effort state only.
      }
    }
  }

  paintDashboardCollectionElement(host, kind, entry, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const normalized = kind === "references" ? "references" : "projects";
      const model = dashboardCollectionChipModel(normalized, entry);
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const anchor = host.createEl("a", {
        cls:
          `bob-plan-chip bob-plan-${normalized}` +
          `${model.placeholder ? " bob-plan-unavailable" : ""}`,
        title: model.tooltip,
        href: model.destination,
      });
      setReadyAnchorContent(
        anchor,
        {
          count: null,
          cap: null,
          over: false,
          placeholder: model.placeholder,
          tooltip: model.tooltip,
          aria: model.aria,
        },
        { kind: "ready", label: model.label },
      );
      try {
        const valueSpan = findReadySpan(anchor, READY_VALUE_CLS);
        if (valueSpan) {
          setReadySpanText(valueSpan, model.valueText);
        }
      } catch (error) {
        // Value rewrite is best-effort only.
      }
      try {
        let arrow = null;
        if (typeof anchor.querySelector === "function") {
          arrow = anchor.querySelector(`.bob-plan-${normalized}-arrow`);
        }
        if (!arrow && typeof anchor.createEl === "function") {
          arrow = anchor.createEl("span", {
            cls: `bob-plan-crowded-arrow bob-plan-${normalized}-arrow`,
            text: DASHBOARD_COLLECTION_ARROW,
          });
        }
        if (arrow && typeof arrow.setAttribute === "function") {
          arrow.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        // Arrow is best-effort only.
      }
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", model.aria);
        anchor.setAttribute("role", "link");
        try {
          if (!anchor.hasAttribute("tabindex")) {
            anchor.setAttribute("tabindex", "0");
          }
        } catch (error) {
          // tabindex is best-effort only.
        }
      }
      const open = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (workspace && typeof workspace.openLinkText === "function") {
            const newLeaf = Boolean(event && (event.ctrlKey || event.metaKey));
            workspace.openLinkText(model.destination, sourcePath, newLeaf);
          }
        } catch (error) {
          // The chip still shows the count without the navigation.
        }
      };
      if (anchor && typeof anchor.addEventListener === "function") {
        anchor.addEventListener("click", open);
        anchor.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            open(event);
          }
        });
        anchor.addEventListener("mouseover", (event) => {
          try {
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.trigger === "function") {
              workspace.trigger("hover-link", {
                event,
                source: "bob-plan",
                hoverParent: host,
                targetEl: anchor,
                linktext: model.destination,
                sourcePath,
              });
            }
          } catch (error) {
            // Hover preview is best-effort only.
          }
        });
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  dashboardCollectionsRenderChip(host, options = {}) {
    try {
      const kind = options.kind === "references" ? "references" : options.kind === "projects" ? "projects" : null;
      if (!kind) {
        return null;
      }
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const component = options.component || null;
      if (!this.dashboardCollectionWidgets) {
        this.dashboardCollectionWidgets = new Set();
      }
      if (component) {
        for (const widget of Array.from(this.dashboardCollectionWidgets)) {
          if (widget.component === component && widget.kind === kind) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (widget.el && typeof widget.el.remove === "function") {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.dashboardCollectionWidgets.delete(widget);
          }
        }
      }
      for (const widget of Array.from(this.dashboardCollectionWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            if (!host.contains || !host.contains(el)) {
              this.dashboardCollectionWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      let snapshot = null;
      try {
        snapshot = this.dashboardCollectionsSnapshot();
      } catch (error) {
        snapshot = null;
      }
      const entry =
        snapshot && snapshot[kind]
          ? snapshot[kind]
          : dashboardCollectionEntryFor(kind, null, false, "unavailable");
      const anchor = this.paintDashboardCollectionElement(host, kind, entry, {
        sourcePath,
      });
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, kind, sourcePath, component };
      this.dashboardCollectionWidgets.add(widget);
      if (component && typeof component.register === "function") {
        try {
          component.register(() => {
            this.dashboardCollectionWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  refreshDashboardCollectionChips(now = new Date()) {
    if (!this.dashboardCollectionWidgets || this.dashboardCollectionWidgets.size === 0) {
      return false;
    }
    let snapshot = null;
    try {
      snapshot = this.dashboardCollectionsSnapshot();
    } catch (error) {
      return false;
    }
    let refreshed = false;
    for (const widget of Array.from(this.dashboardCollectionWidgets)) {
      try {
        const el = widget.el;
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          if (!el || !el.isConnected) {
            this.dashboardCollectionWidgets.delete(widget);
          }
          continue;
        }
        const entry =
          snapshot && snapshot[widget.kind]
            ? snapshot[widget.kind]
            : dashboardCollectionEntryFor(widget.kind, null, false, "unavailable");
        const model = dashboardCollectionChipModel(widget.kind, entry);
        try {
          if (el && typeof el.setAttribute === "function") {
            el.setAttribute("title", model.tooltip);
            el.setAttribute("aria-label", model.aria);
            el.setAttribute(
              "class",
              `bob-plan-chip bob-plan-${widget.kind}${model.placeholder ? " bob-plan-unavailable" : ""}`,
            );
          }
        } catch (error) {
          // Best-effort label refresh only.
        }
        try {
          const valueSpan = findReadySpan(el, READY_VALUE_CLS);
          if (valueSpan) {
            setReadySpanText(valueSpan, model.valueText);
          }
        } catch (error) {
          // One stale widget never breaks the others.
        }
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleDashboardCollectionsRefresh() {
    if (
      this.dashboardCollectionsRefreshTimer !== null &&
      this.dashboardCollectionsRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.dashboardCollectionsRefreshTimer = schedule(() => {
      this.dashboardCollectionsRefreshTimer = null;
      try {
        this.refreshDashboardCollectionChips(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

  refreshDashboardCollectionsForFileEvent(file, oldPath) {
    try {
      const path =
        file && typeof file.path === "string"
          ? file.path
          : typeof oldPath === "string"
            ? oldPath
            : "";
      if (!path) {
        return false;
      }
      if (/(^|\/)(projects\.base|refs\.base)(\.md)?$/.test(path) || path === "projects.base" || path === "refs.base") {
        try {
          void this.dashboardCollectionsEnsureBaseContracts();
        } catch (error) {
          // Best-effort reload only.
        }
        return true;
      }
      this.scheduleDashboardCollectionsRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

}
