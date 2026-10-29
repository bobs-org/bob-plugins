function insertParentPickerNodeAfter(parent, node, reference) {
  if (!parent || !node) {
    return;
  }
  if (typeof parent.insertBefore === "function" && reference) {
    parent.insertBefore(node, reference.nextSibling || null);
    return;
  }
  if (Array.isArray(parent.children) && reference) {
    const from = parent.children.indexOf(node);
    if (from !== -1) {
      parent.children.splice(from, 1);
    }
    const at = parent.children.indexOf(reference);
    parent.children.splice(at < 0 ? parent.children.length : at + 1, 0, node);
    node.parent = parent;
  }
}

function parentPickerFileForRow(record) {
  if (record && record.file) {
    return record.file;
  }
  return {
    path: record && record.path ? record.path : "",
    basename: record && record.basename ? record.basename : "",
  };
}

function appendParentBreadcrumbCrumb(parentEl, segment, extraClass) {
  if (!parentEl || !segment) {
    return;
  }
  const classes = ["bob-pnp-crumb"];
  if (segment.ellipsis) {
    classes.push("is-ellipsis");
  }
  if (segment.missing) {
    classes.push("is-missing");
  }
  if (extraClass) {
    classes.push(extraClass);
  }
  const crumb = parentEl.createSpan({ cls: classes.join(" ") });
  if (segment.missing) {
    const icon = crumb.createSpan({ cls: "bob-pnp-crumb-icon" });
    applyIcon(icon, "triangle-alert");
  }
  crumb.createSpan({
    cls: "bob-pnp-crumb-label",
    text: segment.basename || "",
  });
  if (segment.missing && !segment.ellipsis) {
    crumb.createSpan({
      cls: "bob-pnp-crumb-missing",
      text: " (not found)",
    });
  }
}

function appendParentBreadcrumbSep(parentEl) {
  parentEl.createSpan({ cls: "bob-pnp-crumb-sep", text: "›" });
}

function parentBreadcrumbLabel(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => (segment && segment.basename) || "")
    .filter(Boolean)
    .join(" › ");
}

class ParentNotePickerModal extends FilteredPickerModal {
  constructor(app, plugin, options = {}) {
    super(app, {
      items: [],
      title: "Change parent",
      headerIcon: "network",
      inputLabel: "Type a note name",
      placeholder: "Type a note name…",
      resultsLabel: "Parent notes",
      emptyText: "No note matches “” — the parent must be an existing note",
      footerHints: PARENT_PICKER_HINTS.slice(),
      renderItem: (record, rowEl, query) =>
        this.renderParentCandidateRow(record, rowEl, query),
      openItem: (record) =>
        plugin.commitParentChange({
          file: options.sourceFile,
          candidate: record,
          expected: options.expectedRaw,
        }),
    });
    this.plugin = plugin;
    this.sourceFile = options.sourceFile || null;
    this.index = options.index || buildParentPickerIndex([], {});
    this.field = options.field || readParentFrontmatterField("");
    this.expectedRaw = Object.prototype.hasOwnProperty.call(options, "expectedRaw")
      ? options.expectedRaw
      : this.field.raw;
    this.initialQuery = typeof options.initialQuery === "string" ? options.initialQuery : "";
    this.rankedTotal = 0;
    this.rankedExcludedOnly = false;
    this.previewEl = null;
    this.moreEl = null;
  }

  onOpen() {
    super.onOpen();
    this.modalEl.addClass("bob-pnp-modal");
    this.previewEl = this.contentEl.createDiv({
      cls: "bob-pnp-preview",
      attr: { "aria-live": "polite" },
    });
    insertParentPickerNodeAfter(this.contentEl, this.previewEl, this.searchEl);
    if (this.inputEl) {
      this.inputEl.value = this.initialQuery;
    }
    this.renderResults();
    const openingInput = this.inputEl;
    window.setTimeout(() => {
      if (
        this.pickerOpen &&
        this.inputEl === openingInput &&
        openingInput
      ) {
        if (typeof openingInput.focus === "function") {
          openingInput.focus();
        }
        if (typeof openingInput.select === "function") {
          openingInput.select();
        }
      }
    }, 0);
  }

  onClose() {
    if (this.plugin && this.plugin.activeParentNotePicker === this) {
      this.plugin.activeParentNotePicker = null;
    }
    super.onClose();
  }

  getFilteredItems() {
    const query = this.getRawQuery();
    const ranked = rankParentCandidates(this.index, query, {
      currentParentPath: this.index.currentParentPath,
      grandparentPath: this.index.grandparentPath,
    });
    this.rankedTotal = ranked.total;
    this.rankedExcludedOnly = ranked.excludedOnly === true;
    this.emptyText = parentEmptyStateText(query, this.rankedExcludedOnly);
    return ranked.items;
  }

  renderPickerSubtitle(subtitleEl) {
    if (!subtitleEl) {
      return true;
    }
    subtitleEl.empty();
    const noteName =
      (this.sourceFile && this.sourceFile.basename) ||
      parentNoteBasenameFromPath(this.index.sourcePath);
    const field = this.field || {};
    if (field.state === "list") {
      subtitleEl.createSpan({
        text: `Parent is a YAML list · ${noteName}`,
      });
      return true;
    }
    if (field.state === "duplicate") {
      const count = Number(field.count) || 2;
      subtitleEl.createSpan({
        text: `Duplicate parent: keys (${count}) · ${noteName}`,
      });
      return true;
    }
    if (field.state === "unclosed") {
      subtitleEl.createSpan({
        text: `Frontmatter is unclosed · ${noteName}`,
      });
      return true;
    }
    if (
      field.state === "no-frontmatter" ||
      field.state === "absent" ||
      !this.index.currentParentPath
    ) {
      if (field.state === "scalar" && field.target) {
        const crumbs = subtitleEl.createDiv({ cls: "bob-pnp-crumbs" });
        appendParentBreadcrumbCrumb(crumbs, {
          path: "",
          basename: parentNameLastSegment(field.target) || String(field.target),
          missing: true,
          ellipsis: false,
        });
        appendParentBreadcrumbSep(crumbs);
        appendParentBreadcrumbCrumb(
          crumbs,
          { path: this.index.sourcePath, basename: noteName, missing: false },
          "is-self",
        );
        return true;
      }
      subtitleEl.createSpan({
        text: `No parent yet · ${noteName}`,
      });
      return true;
    }
    const ancestry = buildParentAncestry(this.index, this.index.sourcePath);
    this.renderParentCrumbs(subtitleEl, ancestry, {
      selfPath: this.index.sourcePath,
    });
    return true;
  }

  renderParentCrumbs(hostEl, segments, options = {}) {
    const full = Array.isArray(segments) ? segments : [];
    const visible = collapseParentBreadcrumb(full);
    const crumbs = hostEl.createDiv({
      cls: "bob-pnp-crumbs",
      attr: {
        title: parentBreadcrumbLabel(full),
        "aria-label": parentBreadcrumbLabel(full),
      },
    });
    visible.forEach((segment, index) => {
      if (index > 0) {
        appendParentBreadcrumbSep(crumbs);
      }
      let extra = "";
      if (options.newParentPath && segment.path === options.newParentPath) {
        extra = "is-new-parent";
      }
      if (options.selfPath && segment.path === options.selfPath) {
        extra = extra ? `${extra} is-self` : "is-self";
      }
      appendParentBreadcrumbCrumb(crumbs, segment, extra);
    });
    return crumbs;
  }

  renderParentCandidateRow(record, rowEl, query) {
    renderTypedNotePickerRow(
      parentPickerFileForRow(record),
      record && record.noteInfo,
      rowEl,
      query,
    );
    const chips = rowEl.createDiv({ cls: "bob-pnp-chips" });
    if (record && record.path === this.index.currentParentPath) {
      chips.createSpan({ cls: "bob-pnp-chip is-current", text: "current" });
    }
    if (record && record.path === this.index.grandparentPath) {
      chips.createSpan({ cls: "bob-pnp-chip is-up", text: "up a level" });
    }
    if (record && Number.isFinite(record.recentRank)) {
      chips.createSpan({ cls: "bob-pnp-chip is-recent", text: "recent" });
    }
    const childCount = record && Number(record.childCount);
    if (childCount > 0) {
      rowEl.createDiv({
        cls: "bob-pnp-children",
        text: `${childCount} ${childCount === 1 ? "child" : "children"}`,
      });
    }
  }

  refreshPreviewStrip() {
    if (!this.previewEl) {
      return;
    }
    this.previewEl.empty();
    const selected = this.visibleItems[this.selectedIndex];
    if (!selected) {
      this.previewEl.style.display = "none";
      return;
    }
    this.previewEl.style.display = "";
    const isCurrent = selected.path === this.index.currentParentPath;
    this.previewEl.createDiv({
      cls: "bob-pnp-preview-label",
      text: isCurrent ? "STAYS UNDER" : "MOVES TO",
    });
    const selectedAncestry = buildParentAncestry(this.index, selected.path);
    const sourcePath = this.index.sourcePath;
    const sourceName =
      (this.sourceFile && this.sourceFile.basename) ||
      parentNoteBasenameFromPath(sourcePath);
    const chain = selectedAncestry.concat([
      {
        path: sourcePath,
        basename: sourceName,
        missing: false,
        ellipsis: false,
      },
    ]);
    this.renderParentCrumbs(this.previewEl, chain, {
      newParentPath: isCurrent ? null : selected.path,
      selfPath: sourcePath,
    });
  }

  refreshCappedCountLine() {
    if (this.moreEl && this.moreEl.parent) {
      this.moreEl.parent.children = this.moreEl.parent.children.filter(
        (child) => child !== this.moreEl,
      );
      this.moreEl.parent = null;
    }
    this.moreEl = null;
    if (!this.resultsEl) {
      return;
    }
    const shown = this.visibleItems.length;
    if (shown === 0 || this.rankedTotal <= shown) {
      return;
    }
    this.moreEl = this.resultsEl.createDiv({
      cls: "bob-pnp-more",
      text: `Showing ${shown} of ${this.rankedTotal} matches — keep typing to narrow`,
    });
  }

  renderResults() {
    super.renderResults();
    this.refreshCappedCountLine();
    this.refreshPreviewStrip();
  }
}
