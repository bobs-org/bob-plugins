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
    return propertyCardFootAdapterExtra(path, spec);
  }

  proseNoteCardFootHandlers(path) {
    const filePath = proseNoteCardPath(path);
    return propertyCardFootAdapterHandlers(this, filePath, {
      pendingScroll: this.proseNoteCardFootPendingScroll,
      refresh: () => this.scheduleProseNoteCardRefresh(),
      hoverSource: "bob-prose-note-card",
      jumpYaml: (key, line) => { void this.homeCardJumpYaml?.(filePath, key, line); },
      jumpRecovery: () => { void this.homeCardJumpYaml?.(filePath, "", 1); },
      openPath: (target, event) => { void this.homeCardOpenPath?.(target, filePath, event); },
    });
  }

  proseNoteCardTrackFoot(container, path, card) {
    return propertyCardFootAdapterTrack(container, path, card, this.proseNoteCardFootTracked);
  }

  proseNoteCardAppendFoot(card, path, model, doc, footSpec, options = {}) {
    const key = proseNoteCardPath(path);
    if (!card || !key) return null;
    const spec = footSpec || this.proseNoteCardFootSpec(key, model);
    return propertyCardFootAdapterAppend(
      card,
      key,
      doc,
      spec && options.keyLive === true ? { ...spec, keyLive: true } : spec,
      this.proseNoteCardFootHandlers(key),
      this.proseNoteCardFootPendingScroll,
    );
  }
}
