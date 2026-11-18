// Rail hosts share the sheet's source cache, decorations, refresh, and teardown.
class BobLedgerToolsRecordWalkRailMixin {
  recordWalkFor(path, sourceText) {
    if (!this.recordSheetDesktop()) return null;
    const walk = recordWalkModel({
      path,
      sourceText: typeof sourceText === "string" ? sourceText : this.recordSheetSourceCache?.get(path),
      report: this.recordSheetState()?.report,
      frontmatter: this.recordSheetFrontmatter(path),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
    });
    recordWalkRequestSync(this, walk);
    return walk;
  }

  recordWalkOptions(path, model) {
    const options = this.recordSheetOptions(path, model);
    options.handlers.walkOpen = (target, direction, event) => {
      void this.recordWalkOpen(target, direction, path, event);
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

  recordWalkPaintReading(root, path, sheet) {
    const walk = this.recordWalkFor(path);
    if (!recordWalkHasRail(walk)) return null;
    const paragraph = Array.from(root.querySelectorAll?.("p") || []).find((node) =>
      this.recordSheetNodeBelongs(node, root) && !notebookInsideCode(node)
      && !node.closest?.(`.${RECORD_SHEET_CLASS}`) && recordWalkReadingParagraphMatches(node, walk));
    if (!paragraph) return null;
    const rail = recordWalkRailBuildEl(walk, this.recordWalkOptions(path, sheet ? { hue: sheet.getAttribute("data-root-hue") } : null), recordSheetDomDoc(root));
    if (!rail) return null;
    if (sheet) {
      sheet.classList.add("has-record-walk");
      sheet.appendChild(rail);
    } else paragraph.parentNode.insertBefore(rail, paragraph);
    paragraph.classList.add(RECORD_WALK_SOURCE_CLASS);
    paragraph.setAttribute("data-record-walk-source", path);
    return rail;
  }

  buildRecordSheetDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const path = this.recordSheetLivePreview(view) ? this.recordSheetLivePath(view) : null;
      if (!path || !view?.state?.doc) {
        this.recordSheetSetEditorScope(view, false);
        this.recordSheetEditorCache?.delete?.(view);
        return Decoration.none;
      }
      const text = view.state.doc.toString();
      const model = this.recordSheetModelFor(path, text);
      const walk = model?.walk || this.recordWalkFor(path, text);
      this.recordSheetSetEditorScope(view, Boolean(model));
      this.recordSheetSetEditorHide(view, model?.hideEligible === true);
      if (!model && !recordWalkHasRail(walk)) {
        this.recordSheetEditorCache?.delete?.(view);
        this.recordSheetNotifyOwnership();
        return Decoration.none;
      }
      const line = recordWalkHasRail(walk) ? view.state.doc.line(walk.lineIndex + 1) : null;
      const reveal = line && recordWalkSelectionTouches(view.state, line);
      // A first-body walk line is the sheet anchor, even before a legacy H1.
      const beforeWalk = line ? text.slice(0, line.from).split(/\r?\n/) : [];
      const fmEnd = recordWalkFrontmatterClose(beforeWalk);
      const docks = line && fmEnd !== null && beforeWalk.slice(fmEnd + 1).every((value) => !value.trim());
      const at = docks ? line.from : this.recordSheetAnchor(view, text);
      const signature = JSON.stringify([recordSheetSignature(model), walk, Boolean(reveal), line?.from, line?.to]);
      const previous = this.recordSheetEditorCache?.get?.(view);
      if (previous?.path === path && previous.signature === signature && previous.anchor === at) return previous.decorations;
      const doc = recordSheetDomDoc(view.dom);
      const options = this.recordWalkOptions(path, model);
      const rows = [];
      const widgetFor = (element, kind) => new class extends WidgetType {
        constructor() { super(); this.path = path; this.signature = signature; this.kind = kind; }
        eq(other) { return other?.path === path && other.signature === signature && other.kind === kind; }
        toDOM() {
          element.setAttribute("data-cm-widget", "true");
          element.setAttribute("data-record-source", path);
          return element;
        }
      }();
      const sheet = model ? this.recordSheetBuildMounted(model, options, doc) : null;
      const rail = line && !reveal ? recordWalkRailBuildEl(walk, options, doc) : null;
      if (sheet && rail && docks) {
        // One inline replacement owns the pair. Two adjacent inline widgets
        // get CodeMirror cursor buffers between their block-shaped DOM nodes,
        // leaving a line-height gap that prevents the rail docking flush.
        const dock = recordSheetEl(doc, "div", "bob-record-walk-dock");
        sheet.classList.add("docks-record-walk");
        sheet.setAttribute("data-cm-widget", "true");
        dock.appendChild(sheet);
        dock.appendChild(rail);
        rows.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: widgetFor(dock, "dock") }) });
      } else {
        if (sheet) rows.push({ from: at, to: at, decoration: Decoration.widget({ widget: widgetFor(sheet, "sheet"), side: docks ? -1 : 1 }) });
        if (rail) rows.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: widgetFor(rail, "walk") }) });
      }
      const builder = new RangeSetBuilder();
      rows.sort((a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide);
      for (const row of rows) builder.add(row.from, row.to, row.decoration);
      const decorations = builder.finish();
      this.recordSheetEditorCache?.set?.(view, { path, signature, anchor: at, decorations, albumPath: model?.albumPath || walk?.albumPath });
      // The rail still refreshes when there is no cached album report/sheet.
      this.recordSheetEditors?.add(view);
      this.recordSheetNotifyOwnership();
      return decorations;
    } catch (_) {
      return Decoration?.none || null;
    }
  }
}
