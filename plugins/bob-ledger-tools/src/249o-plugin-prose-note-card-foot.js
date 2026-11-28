// Prose Card shared foot adapter. Source reads are local vault reads only;
// the adapter never starts Bob or mutates a note.
const PROSE_NOTE_CARD_FOOT_KIND = "prose";

class BobLedgerToolsProseNoteCardFootMixin {
  proseNoteCardFootBind() {
    if (!(this.proseNoteCardSourceCache instanceof Map)) this.proseNoteCardSourceCache = new Map();
    if (!(this.proseNoteCardSourceFlights instanceof Map)) this.proseNoteCardSourceFlights = new Map();
    if (!(this.proseNoteCardFootTracked instanceof Set)) this.proseNoteCardFootTracked = new Set();
    if (!(this.proseNoteCardFootPendingScroll instanceof Set)) this.proseNoteCardFootPendingScroll = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "proseNoteCardFootPendingScroll",
      untoggleKey: "proseNoteCardFootUntoggle",
      unresolverKey: "proseNoteCardFootUnresolver",
      refresh: () => this.scheduleProseNoteCardRefresh(),
      livePath: (view) => this.proseNoteCardLivePath(view) || "",
    });
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function"
        && !this.proseNoteCardFootMetaBound) {
        this.proseNoteCardFootMetaBound = true;
        this.registerEvent(cache.on("changed", (file) => {
          const path = proseNoteCardPath(file?.path);
          if (!path) return;
          this.proseNoteCardSourceCache?.delete?.(path);
          this.proseNoteCardSourceFlights?.delete?.(path);
          this.scheduleProseNoteCardRefresh();
        }));
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function"
        && !this.proseNoteCardFootVaultBound) {
        this.proseNoteCardFootVaultBound = true;
        this.registerEvent(vault.on("rename", (file, oldPath) => {
          try { propertyCardFootRenamePath?.(oldPath, file?.path); } catch (_) {}
          const previous = proseNoteCardPath(oldPath);
          if (previous) {
            this.proseNoteCardSourceCache?.delete?.(previous);
            this.proseNoteCardSourceFlights?.delete?.(previous);
            this.proseNoteCardExpanded?.delete?.(previous);
          }
          this.scheduleProseNoteCardRefresh();
        }));
        this.registerEvent(vault.on("delete", (file) => {
          try { propertyCardFootReleasePath?.(file?.path); } catch (_) {}
          const path = proseNoteCardPath(file?.path);
          this.proseNoteCardSourceCache?.delete?.(path);
          this.proseNoteCardSourceFlights?.delete?.(path);
          this.proseNoteCardExpanded?.delete?.(path);
          this.scheduleProseNoteCardRefresh();
        }));
      }
    } catch (_) {}
  }

  proseNoteCardFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "proseNoteCardFootPendingScroll",
      untoggleKey: "proseNoteCardFootUntoggle",
      unresolverKey: "proseNoteCardFootUnresolver",
      tracked: this.proseNoteCardFootTracked,
      cache: this.proseNoteCardSourceCache,
      flights: this.proseNoteCardSourceFlights,
    });
    this.proseNoteCardFootMetaBound = false;
    this.proseNoteCardFootVaultBound = false;
  }

  proseNoteCardRememberSource(path, text) {
    if (!(this.proseNoteCardSourceCache instanceof Map)) this.proseNoteCardSourceCache = new Map();
    return propertyCardFootAdapterRememberSource(this.proseNoteCardSourceCache, path, text);
  }

  proseNoteCardEnsureSource(path) {
    if (!(this.proseNoteCardSourceCache instanceof Map)) this.proseNoteCardSourceCache = new Map();
    if (!(this.proseNoteCardSourceFlights instanceof Map)) this.proseNoteCardSourceFlights = new Map();
    return propertyCardFootAdapterEnsureSource(this, path, {
      cache: this.proseNoteCardSourceCache,
      flights: this.proseNoteCardSourceFlights,
      active: () => this.proseNoteCardActive !== false,
      refresh: () => this.scheduleProseNoteCardRefresh(),
    });
  }

  proseNoteCardFootSpec(path, model) {
    const filePath = proseNoteCardPath(path);
    const frontmatter = model?.frontmatter && typeof model.frontmatter === "object"
      ? model.frontmatter : propertyCardFootAdapterFrontmatter(this, filePath);
    return propertyCardFootAdapterSpec({
      path: filePath,
      kind: PROSE_NOTE_CARD_FOOT_KIND,
      sourceText: this.proseNoteCardSourceCache?.get?.(filePath),
      frontmatter,
      where: { title: "title", summary: "dek" },
    });
  }

  proseNoteCardFootExtra(path, model) {
    const spec = this.proseNoteCardFootSpec(path, model)
      || { path: proseNoteCardPath(path), inventory: propertyCardFootAdapterPendingInventory(), stamp: null };
    return propertyCardFootAdapterExtra(path, spec, "prose");
  }

  proseNoteCardFootHandlers(path) {
    const filePath = proseNoteCardPath(path);
    return propertyCardFootAdapterHandlers(this, filePath, {
      species: "prose",
      pendingScroll: this.proseNoteCardFootPendingScroll,
      refresh: () => this.scheduleProseNoteCardRefresh(),
      hoverSource: "bob-prose-note-card",
      jumpYaml: (key, line) => { void this.homeCardJumpYaml?.(filePath, key, line); },
      jumpRecovery: () => { void this.homeCardJumpYaml?.(filePath, "", 1); },
      openPath: (target, event) => { void this.homeCardOpenPath?.(target, filePath, event); },
    });
  }

  proseNoteCardTrackFoot(container, path, card) {
    return propertyCardFootAdapterTrack(container, path, card, this.proseNoteCardFootTracked, "prose");
  }

  proseNoteCardAppendFoot(card, path, model, doc, footSpec, options = {}) {
    const key = proseNoteCardPath(path);
    if (!card || !key) return null;
    const spec = footSpec || this.proseNoteCardFootSpec(key, model);
    const built = propertyCardFootAdapterAppend(
      card,
      key,
      doc,
      spec && options.keyLive === true ? { ...spec, keyLive: true } : spec,
      this.proseNoteCardFootHandlers(key),
      this.proseNoteCardFootPendingScroll,
      {
        plugin: this,
        species: "prose",
        view: options?.view || null,
        component: options?.component || this,
        source: options?.sourceText,
        frontmatter: options?.frontmatter || propertyCardFootAdapterFrontmatter(this, key),
        repaint: () => this.scheduleProseNoteCardRefresh?.(),
      },
    );
    if (!built?.element) return built;
    const findings = Array.isArray(options.snapshot?.findings) ? options.snapshot.findings : [];
    const count = options.snapshot ? findings.length : null;
    const lint = doc.createElement(count > 0 ? "button" : "span");
    lint.setAttribute("class", "bob-prose-note-card-lint-slot");
    lint.setAttribute("data-prose-lint", "true");
    lint.setAttribute("data-state", count === null
      ? options.proseApiAvailable === true ? "waiting" : "none"
      : count > 0 ? "ready" : "none");
    lint.setAttribute("aria-live", "polite");
    lint.setAttribute("aria-hidden", count > 0 ? "false" : "true");
    if (count > 0) {
      lint.setAttribute("type", "button");
      lint.setAttribute("aria-label", `${count} findings. Expand the Prose outline.`);
      lint.setAttribute("title", `${count} Bob finding${count === 1 ? "" : "s"} · click to expand Findings`);
      lint.appendChild(doc.createTextNode(`⚠ ${count}`));
      lint.addEventListener?.("click", (event) => {
        try { event?.preventDefault?.(); } catch (_) {}
        try { options.onToggleOutline?.(true); } catch (_) {}
      });
    }
    try { built.element.insertBefore(lint, built.drawer || null); } catch (_) { built.element.appendChild(lint); }
    return built;
  }
}
