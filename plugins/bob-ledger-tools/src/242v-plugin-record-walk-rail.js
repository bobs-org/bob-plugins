// Slot cards live in the title slot, not in CodeMirror decorations. A
// viewport-only update must not rebuild them: BuildMounted + adoptTitle
// during measure is a main-thread loop that starves CDP. Doc edits, walk
// reveal, refresh effects, and path changes still rebuild.
function recordSheetSlotSkipsUpdate(update, plugin) {
  if (!update) return false;
  if (update.docChanged === true || update.selectionSet === true) return false;
  try {
    const effect = plugin && typeof plugin.recordPropertyCardHost === "function"
      ? plugin.recordPropertyCardHost().ensureRefreshEffect?.() : null;
    if (effect && (update.transactions || []).some((tx) =>
      (tx.effects || []).some((item) => typeof item?.is === "function" && item.is(effect)))) {
      return false;
    }
  } catch (_) {}
  return true;
}

function recordSheetSlotIsLive(view, path) {
  try {
    const adopted = propertyCardAdoptedEntry(view?.dom);
    if (!adopted || adopted.path !== path || adopted.mode !== "slot") return false;
    if (adopted.pending) return true;
    const mounted = typeof propertyCardTitleSlotMountedNode === "function"
      ? propertyCardTitleSlotMountedNode(view.dom) : null;
    return Boolean(mounted && mounted === adopted.node);
  } catch (_) {
    return false;
  }
}

// A still-mounted foot must stay toggleable: cached decoration returns must
// not skip mount tracking after a release (teardown, demoted card, transient
// model miss). True when no live mount needs healing; the rebuild path below
// re-tracks the adopted header.
function recordSheetFootMountsLive(path) {
  try {
    if (typeof propertyCardFootLiveMountsFor !== "function") return true;
    return propertyCardFootLiveMountsFor(path).length > 0;
  } catch (_) {
    return true;
  }
}

// Rail hosts share the sheet's source cache, decorations, refresh, and teardown.
class BobLedgerToolsRecordWalkRailMixin {
  recordWalkFor(path, sourceText) {
    if (!this.recordSheetDesktop()) return null;
    const source = typeof sourceText === "string" ? sourceText : this.recordSheetSourceCache?.get(path);
    const walk = recordWalkModel({
      path,
      sourceText: source,
      report: this.recordSheetState()?.report,
      frontmatter: this.recordSheetFrontmatter(path),
      metadataCache: typeof propertyCardSettledMetadataCache === "function"
        ? propertyCardSettledMetadataCache(this.app) : this.app?.metadataCache,
      vault: this.app?.vault,
    });
    recordWalkRequestSync(this, walk);
    this.recordWalkAttachGroupRail?.(path, source, walk);
    return walk;
  }

  recordWalkOptions(path, model) {
    const options = this.recordSheetOptions(path, model, "live-preview");
    options.handlers.walkOpen = (target, direction, event) => {
      void this.recordWalkOpen(target, direction, path, event);
    };
    options.handlers.groupOpen = (direction, arm, event) => {
      void this.recordWalkGroupOpen?.(direction, arm, path, event);
    };
    return options;
  }

  async recordWalkOpen(target, direction, sourcePath, event) {
    // This also guards modified clicks and the no-navigation-plugin fallback.
    const path = `${String(target).replace(/\.md$/i, "")}.md`;
    const exists = this.app?.vault?.getAbstractFileByPath?.(path);
    if (!exists || exists.extension !== "md") {
      new Notice(`Record walk is catching up — ${path} isn't there yet`);
      if (this.recordSheetState()?.report?.capabilities?.includes(RECORD_WALK_CAPABILITY)) {
        this.albumScheduleSync?.("record-walk-missing-target");
      }
      return false;
    }
    const modified = event?.ctrlKey || event?.metaKey || event?.shiftKey || event?.altKey || event?.button === 1;
    if (direction && !modified) {
      const commandId = `bob-navigation-hotkeys:open-${direction}-link`;
      const commands = this.app?.commands;
      const command = commands?.commands?.[commandId] || commands?.findCommand?.(commandId);
      const leaf = this.recordSheetMarkdownLeaf(sourcePath);
      // A click in an inactive pane must run the command against that pane.
      if (command && commands?.executeCommandById && leaf?.view?.file?.path === sourcePath) {
        this.app.workspace.setActiveLeaf?.(leaf, { focus: true });
        commands.executeCommandById(commandId);
        return true;
      }
    }
    await this.app?.workspace?.openLinkText?.(String(target).replace(/\.md$/i, ""), sourcePath, Boolean(modified));
    return true;
  }

  recordWalkRemoveReading(root, sourcePath) {
    for (const rail of Array.from(root?.querySelectorAll?.(`.${RECORD_WALK_RAIL_CLASS}`) || [])) {
      if (!this.recordSheetNodeBelongs(rail, root)) continue;
      if (sourcePath && rail.getAttribute("data-record-source") !== sourcePath) continue;
      rail.remove?.();
    }
    for (const paragraph of Array.from(root?.querySelectorAll?.(`.${RECORD_WALK_SOURCE_CLASS}`) || [])) {
      if (!this.recordSheetNodeBelongs(paragraph, root)) continue;
      if (sourcePath && paragraph.getAttribute("data-record-walk-source") !== sourcePath) continue;
      paragraph.classList.remove(RECORD_WALK_SOURCE_CLASS);
      paragraph.removeAttribute("data-record-walk-source");
    }
  }

  recordWalkPaintReading(root, path, sheet, extra = {}) {
    const walk = this.recordWalkFor(path);
    if (!recordWalkHasRail(walk)) return null;
    const paragraph = Array.from(root.querySelectorAll?.("p") || []).find((node) =>
      this.recordSheetNodeBelongs(node, root) && !notebookInsideCode(node)
      && !node.closest?.(`.${RECORD_SHEET_CLASS}`) && recordWalkReadingParagraphMatches(node, walk));
    if (!paragraph) return null;
    let rail = sheet?.querySelector?.(`.${RECORD_WALK_RAIL_CLASS}`) || null;
    if (!rail) {
      rail = recordWalkRailBuildEl(walk, this.recordWalkOptions(path, sheet ? { hue: sheet.getAttribute("data-root-hue") } : null), recordSheetDomDoc(root));
      if (!rail) return null;
      if (sheet) {
        sheet.classList.add("has-record-walk");
        sheet.appendChild(rail);
      } else paragraph.parentNode.insertBefore(rail, paragraph);
    }
    const kitOwned = extra.owned === true && paragraph.classList?.contains?.("bob-property-card-title-source");
    if (!kitOwned) {
      paragraph.classList.add(RECORD_WALK_SOURCE_CLASS);
      paragraph.setAttribute("data-record-walk-source", path);
    }
    return rail;
  }

  buildRecordSheetDecorations(view, update) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const live = this.recordSheetLivePreview(view);
      const path = live ? this.recordSheetLivePath(view) : null;
      if (!live || !view?.state?.doc) {
        this.recordSheetReleaseFrontmatter?.(view?.dom);
        this.recordSheetSetEditorScope(view, false);
        this.recordSheetReleaseAdoption?.(view?.dom);
        this.recordSheetEditorCache?.delete?.(view);
        return Decoration.none;
      }
      const previous = this.recordSheetEditorCache?.get?.(view);
      if (!path) {
        this.recordSheetReleaseFrontmatter?.(view?.dom);
        const adopted = propertyCardAdoptedEntry(view.dom);
        if (adopted && adopted.mode === "slot") return previous?.decorations || Decoration.none;
        this.recordSheetSetEditorScope(view, false);
        this.recordSheetReleaseAdoption?.(view?.dom);
        this.recordSheetEditorCache?.delete?.(view);
        return Decoration.none;
      }
      if (this._recordSheetDecorating) {
        const started = this._recordSheetDecorateStarted || 0;
        if (Date.now() - started < 250) return previous?.decorations || Decoration.none;
        this._recordSheetDecorating = false;
      }
      const remembered = typeof propertyCardAdoptRemembered === "function"
        && propertyCardAdoptRemembered(view.dom, path);
      // Viewport-only updates must not BuildMounted: that measure loop freezes
      // the renderer. A lost slot remounts at most once per 250ms so a
      // failed deferred mount can recover without a tight viewport retry.
      // Sticky insert-failed/unstable still rebuilds once so widgets can paint.
      if (previous?.path === path && recordSheetSlotSkipsUpdate(update, this)) {
        const slotLive = recordSheetSlotIsLive(view, path);
        // A live slot with no live mount lost its registration (teardown,
        // demotion, transient model miss): fall through to the rebuild below,
        // which re-tracks the adopted header.
        if ((slotLive || previous.slotted === false) && (!slotLive || recordSheetFootMountsLive(path))) {
          return previous.decorations;
        }
        if (!remembered) {
          const nowSkip = Date.now();
          if (nowSkip - (this._recordSheetLostRetry || 0) < 250) return previous.decorations;
          this._recordSheetLostRetry = nowSkip;
        }
      }
      const now = Date.now();
      if (!this._recordSheetDecorateStamp || now - this._recordSheetDecorateStamp.t > 1000) {
        this._recordSheetDecorateStamp = { t: now, n: 0 };
      }
      this._recordSheetDecorateStamp.n += 1;
      if (this._recordSheetDecorateStamp.n > 8 && previous?.path === path
        && !(remembered && previous.slotted)
        && !(recordSheetSlotIsLive(view, path) && !recordSheetFootMountsLive(path))) {
        return previous.decorations;
      }
      this._recordSheetDecorating = true;
      this._recordSheetDecorateStarted = Date.now();
      try {
      const text = view.state.doc.toString();
      const card = typeof this.recordSheetCardModelFor === "function"
        ? this.recordSheetCardModelFor(path, text) : null;
      const walk = card?.body?.walk || this.recordWalkFor(path, text);
      this.recordSheetSetEditorScope(view, Boolean(card));
      if (!card) {
        this.recordSheetReleaseFrontmatter?.(view?.dom, path);
        this.recordSheetReleaseAdoption?.(view?.dom, path);
      }
      if (!card && !recordWalkHasRail(walk)) {
        this.recordSheetEditorCache?.delete?.(view);
        this.recordSheetNotifyOwnership();
        return Decoration.none;
      }
      const line = recordWalkHasRail(walk) ? view.state.doc.line(walk.lineIndex + 1) : null;
      const reveal = line && recordWalkSelectionTouches(view.state, line);
      const beforeWalk = line ? text.slice(0, line.from).split(/\r?\n/) : [];
      const fmEnd = recordWalkFrontmatterClose(beforeWalk);
      const docks = line && fmEnd !== null && beforeWalk.slice(fmEnd + 1).every((value) => !value.trim());
      const at = docks ? line.from : this.recordSheetAnchor(view, text);
      const doc = recordSheetDomDoc(view.dom);
      const options = this.recordWalkOptions(path, card?.body);
      const albumPath = card?.identity?.albumPath || walk?.albumPath || "";
      const plugin = this;
      const widgetFor = (element, kind, signature) => new class extends WidgetType {
        constructor() { super(); this.path = path; this.signature = signature; this.kind = kind; }
        eq(other) { return other?.path === path && other.signature === signature && other.kind === kind; }
        toDOM() {
          element.setAttribute("data-cm-widget", "true");
          element.setAttribute("data-record-source", path);
          if (kind === "sheet" || kind === "dock") {
            propertyCardFrontmatterOwnMountedDeferred?.(plugin, {
              scope: view.dom, view, path, kind: "record", mount: element, sourceText: text,
              getSource: () => view?.state?.doc?.toString?.() || "",
              currentPath: () => plugin.recordSheetLivePath(view) || propertyCardLiveCurrentPath(view) || "",
              active: () => plugin.recordSheetActive === true,
              isCurrent: () => {
                const source = view?.state?.doc?.toString?.() || "";
                return Boolean(source && plugin.recordSheetCardModelFor(path, source));
              },
            });
          }
          return element;
        }
      }();
      const cacheAndFinish = (rows, signature, hideModel, slotted) => {
        const previous = this.recordSheetEditorCache?.get?.(view);
        if (previous?.path === path && previous.signature === signature && previous.anchor === at
          && previous.slotted === Boolean(slotted)) {
          return previous.decorations;
        }
        const builder = new RangeSetBuilder();
        rows.sort((a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide);
        for (const row of rows) builder.add(row.from, row.to, row.decoration);
        const decorations = rows.length ? builder.finish() : Decoration.none;
        this.recordSheetSetEditorHide(view, hideModel);
        this.recordSheetEditorCache?.set?.(view, {
          path, signature, anchor: at, decorations, albumPath, slotted: Boolean(slotted),
        });
        this.recordSheetEditors?.add(view);
        this.recordSheetNotifyOwnership();
        return decorations;
      };

      if (!card) {
        this.recordSheetReleaseFrontmatter?.(view?.dom, path);
        const signature = JSON.stringify(["rail-only", recordSheetWalkSignature(walk), Boolean(reveal), line?.from, line?.to]);
        const rows = [];
        if (line && !reveal) {
          const rail = recordWalkRailBuildEl(walk, options, doc);
          if (rail) rows.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: widgetFor(rail, "walk", signature) }) });
        }
        // No card, no foot: release the path's mounts so a demoted note
        // cannot toggle a stale drawer.
        try { this.recordSheetTrackFoot(view.dom, path, null); } catch (_) {}
        return cacheAndFinish(rows, signature, null, false);
      }

      const footExtra = this.recordSheetFootExtra(path, card);
      const cardSignature = recordSheetCardSignature(card, { ...options, walk, ...footExtra });
      const recognizer = recordSheetTitleRecognizer({
        path, title: card.title, walk, sourceText: text,
      });
      const kitRange = typeof propertyCardTitleSourceRange === "function"
        ? propertyCardTitleSourceRange(text, recognizer) : null;
      const kitCoversWalk = Boolean(kitRange && Number.isInteger(walk?.lineIndex)
        && walk.lineIndex >= kitRange.fromLine && walk.lineIndex <= kitRange.toLine);
      const includeRail = recordWalkHasRail(walk) && kitCoversWalk;
      const revealWalk = Boolean(reveal && !kitCoversWalk);
      const slotSignature = JSON.stringify([cardSignature, kitCoversWalk, line?.from ?? null, line?.to ?? null, revealWalk]);
      const adopted = propertyCardAdoptedEntry(view.dom);
      const slotted = Boolean(adopted && adopted.path === path && adopted.mode === "slot" && adopted.node);
      const cached = this.recordSheetEditorCache?.get?.(view);
      if (slotted && cached?.path === path && cached.signature === slotSignature && cached.anchor === at
        && recordSheetFootMountsLive(path)) {
        return cached.decorations;
      }
      let header = slotted ? adopted.node : null;
      if (!header || recordSheetNodeSignatures.get(header) !== cardSignature) {
        const fresh = this.recordSheetBuildMounted(card, options, doc, { walk, includeRail, footSpec: footExtra.footSpec });
        if (!fresh) {
          this.recordSheetReleaseFrontmatter?.(view?.dom, path);
          this.recordSheetReleaseAdoption?.(view?.dom, path);
          this.recordSheetEditorCache?.delete?.(view);
          this.recordSheetNotifyOwnership();
          return Decoration.none;
        }
        if (header) this.recordSheetPatchLive(view, adopted, fresh, cardSignature);
        else {
          header = fresh;
          recordSheetNodeSignatures.set(header, cardSignature);
        }
      }
      const adoption = propertyCardAdoptTitle(view.dom, header, {
        path,
        kind: "record",
        view,
        recognizer,
        currentPath: () => this.recordSheetLivePath(view) || propertyCardLiveCurrentPath(view) || path,
        onLost: () => {
          this.recordSheetEditorCache?.delete?.(view);
          this.scheduleRecordSheetRefresh();
        },
      });
      if (adoption.mode === "slot") {
        const rows = [];
        if (recordWalkHasRail(walk) && !kitCoversWalk && !reveal) {
          const rail = recordWalkRailBuildEl(walk, options, doc);
          if (rail) rows.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: widgetFor(rail, "walk", slotSignature) }) });
        }
        try { this.recordSheetTrackFoot(view.dom, path, header); } catch (_) {}
        this.recordSheetOwnMountedFrontmatter?.(
          view.dom, view, path, header, text, () => this.recordSheetLivePath(view) || propertyCardLiveCurrentPath(view) || "",
        );
        return cacheAndFinish(rows, slotSignature, card.body || null, true);
      }

      const signature = JSON.stringify([cardSignature, recordSheetWalkSignature(walk), Boolean(reveal), line?.from, line?.to]);
      const rows = [];
      const rail = line && !reveal ? recordWalkRailBuildEl(walk, options, doc) : null;
      try { this.recordSheetTrackFoot(view.dom, path, header); } catch (_) {}
      if (header && rail && docks) {
        const dock = recordSheetEl(doc, "div", "bob-record-walk-dock");
        header.classList.add("docks-record-walk");
        header.setAttribute("data-cm-widget", "true");
        dock.appendChild(header);
        dock.appendChild(rail);
        rows.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: widgetFor(dock, "dock", signature) }) });
      } else {
        if (header) rows.push({ from: at, to: at, decoration: Decoration.widget({ widget: widgetFor(header, "sheet", signature), side: docks ? -1 : 1 }) });
        if (rail) rows.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: widgetFor(rail, "walk", signature) }) });
      }
      return cacheAndFinish(rows, signature, card.body || null, false);
      } finally {
        this._recordSheetDecorating = false;
      }
    } catch (_) {
      this._recordSheetDecorating = false;
      this.recordSheetReleaseFrontmatter?.(view?.dom);
      return Decoration?.none || null;
    }
  }
}
