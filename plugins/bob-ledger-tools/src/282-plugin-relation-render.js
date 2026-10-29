class BobLedgerToolsRelationRenderMixin {
  setupRelationChips() {
    try {
      const extension = this.createRelationChipExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderRelationChipsIn(el, ctx), 50);
      }
      if (typeof this.register === "function") {
        this.register(() => this.relationCloseMentionCard(false));
      }
      // LC14: an entry typed in the editor before save refreshes the
      // target's chip row in the same session. The overlay updates the
      // index; this refresh rebuilds every chip decoration on it.
      try {
        if (!this.relationIndexRefreshSubscribed && typeof this.relationIndexApi === "function") {
          const api = this.relationIndexApi();
          if (api && typeof api.onChange === "function") {
            const self = this;
            api.onChange(() => {
              try {
                self.scheduleDependencyChipsRefresh();
              } catch (error) {
                // Refresh is best-effort.
              }
            });
            this.relationIndexRefreshSubscribed = true;
          }
        }
      } catch (error) {
        // Index refresh is best-effort.
      }
    } catch (error) {
      // Relation chips are read-only decoration and never block startup.
    }
  }

  async renderRelationChipsIn(el, ctx) {
    try {
      if (!this.dependencyChipsEnabled || !el || !ctx) {
        return;
      }
      const path = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!path) {
        return;
      }
      this.relationCloseMentionCardForSource(path);
      let items = [];
      try {
        if (typeof el.querySelectorAll === "function") {
          items = Array.from(el.querySelectorAll("li"));
        } else if (Array.isArray(el.children)) {
          items = el.children.slice();
        }
      } catch (error) {
        return;
      }
      const candidates = [];
      for (const li of items) {
        try {
          if (!li || li.nodeType !== 1 || (li.dataset && li.dataset.bobRelationProcessed === "1")) {
            continue;
          }
          if (this.dependencyExcludedAncestor(li, el)) {
            continue;
          }
          let ownText = "";
          try {
            ownText = dependencyReadingOwnText(li);
          } catch (error) {
            ownText = "";
          }
          // Cheap prefilter; the raw-line parse below is authoritative
          // (malformed and not-a-line rows never get chips, LC13).
          if (!/🪢|🔗|LINKS|LINKED FROM|BACKLINKS/.test(ownText)) {
            continue;
          }
          if (!dependencyReadingOwningTask(li, el)) {
            continue;
          }
          const anchors = [];
          const found = li.querySelectorAll ? li.querySelectorAll("a.internal-link") : [];
          for (const anchor of Array.from(found || [])) {
            if (dependencyReadingAnchorOwner(anchor, el) === li) {
              anchors.push(anchor);
            }
          }
          let section = null;
          try {
            if (typeof ctx.getSectionInfo === "function") {
              section = ctx.getSectionInfo(el) || null;
            }
          } catch (error) {
            section = null;
          }
          candidates.push({ li, anchors, rowIndex: items.indexOf(li), rowCount: items.length, section });
        } catch (error) {
          continue;
        }
      }
      if (candidates.length === 0) {
        return;
      }
      const sections = new Map();
      for (const candidate of candidates) {
        try {
          const section = candidate.section;
          const key = section && Number.isInteger(section.lineStart) && Number.isInteger(section.lineEnd)
            ? section.lineStart + ":" + section.lineEnd
            : "none";
          if (!sections.has(key)) {
            sections.set(key, await this.relationReadSectionLines(path, section));
          }
          const source = sections.get(key);
          if (!source) {
            continue;
          }
          const rowLine = relationReadingMappedLine(source.lines, source.low, source.high, candidate.rowIndex, candidate.rowCount);
          if (rowLine === null) {
            continue;
          }
          const rawLine = source.lines[rowLine];
          const parsed = parseTaskRelationLine(rawLine);
          if (!parsed || (parsed.verdict !== "accepted" && parsed.verdict !== "empty")) {
            continue;
          }
          const owner = relationOwnerTaskLine(source.lines, rowLine);
          if (!owner) {
            continue;
          }
          const originalModel = this.relationChipModelForLine({ path, text: rawLine, owner });
          if (!originalModel || originalModel.chips.length === 0) {
            continue;
          }
          const hostPaths = this.relationReadingTransclusionHostPaths(candidate.li, ctx, path);
          const filtered = this.relationSuppressEmbedEchoes(originalModel, hostPaths);
          const model = filtered.model;
          if (filtered.suppressed.length > 0) {
            this.relationRemoveReadingEchoAnchors(candidate.anchors, filtered.suppressed, path);
          }
          if (!model || model.chips.length === 0) {
            this.relationHideReadingEchoRow(candidate.li);
            continue;
          }
          const docNode = candidate.li.ownerDocument || (typeof document !== "undefined" ? document : null);
          if (!docNode) {
            continue;
          }
          this.relationDecorateReadingRow(candidate.li, candidate.anchors, model, docNode, path, rowLine, owner);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // One reading-view row never breaks the post-processor.
    }
  }

  async relationReadSectionLines(path, section) {
    try {
      if (!section || !Number.isInteger(section.lineStart) || !Number.isInteger(section.lineEnd)) {
        return null;
      }
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function" ? vault.getAbstractFileByPath(path) : null;
      if (!file || !vault || typeof vault.cachedRead !== "function") {
        return null;
      }
      const text = await vault.cachedRead(file);
      if (typeof text !== "string") {
        return null;
      }
      const lines = text.split("\n");
      return { lines, low: Math.max(0, section.lineStart), high: Math.min(lines.length - 1, section.lineEnd) };
    } catch (error) {
      return null;
    }
  }

  relationReadingTransclusionHostPaths(li, ctx, sourcePath) {
    try {
      let inTransclusion = false;
      const paths = [];
      if (ctx && typeof ctx.sourcePath === "string") paths.push(ctx.sourcePath);
      let node = li || null;
      let guard = 0;
      while (node && guard < 100) {
        guard += 1;
        const classes = node.classList;
        try {
          if (classes && typeof classes.contains === "function" && classes.contains("markdown-embed")) {
            inTransclusion = true;
          }
        } catch (error) {
          // Continue looking for the host wrapper.
        }
        for (const attribute of ["data-path", "data-source-path", "data-embed-path", "data-host-path"]) {
          try {
            const value = node.getAttribute && node.getAttribute(attribute);
            if (typeof value === "string" && value.trim()) paths.push(value.trim());
          } catch (error) {
            // Some DOM shims do not expose attributes.
          }
        }
        try {
          const dataset = node.dataset || {};
          for (const key of ["path", "sourcePath", "embedPath", "hostPath"]) {
            if (typeof dataset[key] === "string" && dataset[key].trim()) paths.push(dataset[key].trim());
          }
        } catch (error) {
          // Dataset is optional.
        }
        node = node.parentNode || null;
      }
      if (!inTransclusion) return [];
      if (sourcePath) paths.push(sourcePath);
      try {
        const workspace = this.app && this.app.workspace;
        const leaves = workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown") || []
          : [];
        for (const leaf of Array.from(leaves)) {
          const view = leaf && leaf.view ? leaf.view : null;
          const container = view && view.containerEl;
          const filePath = view && view.file && view.file.path;
          let containsRow = container === li;
          if (!containsRow && container) {
            if (typeof container.contains === "function") containsRow = container.contains(li);
            else if (typeof this.relationNodeContains === "function") containsRow = this.relationNodeContains(container, li);
          }
          if (containsRow && typeof filePath === "string" && filePath) paths.push(filePath);
        }
      } catch (error) {
        // The renderer context and embed ancestors remain the fallback.
      }
      const seen = new Set();
      return paths.filter((path) => {
        const key = this.relationNormalizeMentionPath(path);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (error) {
      return [];
    }
  }

  relationNormalizeMentionPath(path) {
    try {
      return String(path || "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\.md$/i, "");
    } catch (error) {
      return "";
    }
  }

  relationSuppressEmbedEchoes(model, hostPaths) {
    try {
      const hosts = new Set((Array.isArray(hostPaths) ? hostPaths : []).map((path) => this.relationNormalizeMentionPath(path)).filter(Boolean));
      const groups = relationChipGroups(model);
      if (!model || hosts.size === 0 || !groups.mentions.chips.length) return { model, suppressed: [] };
      const suppressed = groups.mentions.chips.filter((chip) => chip && chip.display === "embed" && hosts.has(this.relationNormalizeMentionPath(chip.path)));
      if (!suppressed.length) return { model, suppressed };
      const suppressedKeys = new Set(suppressed.map((chip) => String(chip.path || "") + "\u0000" + String(chip.blockId || "")));
      const mentionChips = groups.mentions.chips
        .filter((chip) => !suppressedKeys.has(String(chip && chip.path || "") + "\u0000" + String(chip && chip.blockId || "")))
        .map((chip) => ({ ...chip, collapsed: false, densityCollapsed: false }));
      const mentionGroup = relationApplyChipGroupRules(mentionChips, "mentions");
      const nextGroups = { relations: groups.relations, mentions: mentionGroup };
      const chips = [...groups.relations.chips, ...mentionGroup.chips];
      return {
        model: {
          ...model,
          chips,
          groups: nextGroups,
          liveCount: chips.filter((chip) => chip && chip.live).length,
          storedCount: chips.length,
        },
        suppressed,
      };
    } catch (error) {
      return { model, suppressed: [] };
    }
  }

  relationRemoveReadingEchoAnchors(anchors, suppressed, sourcePath) {
    try {
      const rows = Array.isArray(suppressed) ? suppressed : [];
      if (!rows.length) return;
      for (const anchor of Array.isArray(anchors) ? anchors : []) {
        try {
          const blockId = dependencyReadingBlockId(anchor);
          if (!blockId) continue;
          const raw = String((anchor.getAttribute && (anchor.getAttribute("data-href") || anchor.getAttribute("href"))) || "");
          const path = this.relationResolveLinkpath(raw, sourcePath);
          const match = rows.some((chip) => String(chip.blockId || "") === blockId && this.relationNormalizeMentionPath(chip.path) === this.relationNormalizeMentionPath(path));
          if (match) {
            if (typeof anchor.remove === "function") anchor.remove();
            else if (anchor.parentNode && typeof anchor.parentNode.removeChild === "function") anchor.parentNode.removeChild(anchor);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // A raw embed link is still legible if it cannot be hidden.
    }
  }

  relationHideReadingEchoRow(li) {
    try {
      if (!li) return;
      li.classList && li.classList.add("bob-relation-embed-echo-hidden");
      if (li.style) li.style.display = "none";
      if (li.dataset) li.dataset.bobRelationEmbedEchoHidden = "1";
      if (typeof li.setAttribute === "function") li.setAttribute("aria-hidden", "true");
    } catch (error) {
      // The row remains harmless if the DOM cannot hide it.
    }
  }

  relationDecorateReadingRow(li, anchors, model, doc, sourcePath, lineNumber, owner) {
    try {
      const interactive = Boolean(this.relationsNavApi());
      const label = relationReadingLabelElement(li);
      if (label) {
        try {
          label.style.display = "none";
        } catch (styleError) {
          // Attribute fallback for style-free DOMs.
        }
        try {
          label.setAttribute("data-bob-relation-hidden", "1");
        } catch (attrError) {
          // Best-effort.
        }
      }
      const groups = relationChipGroups(model);
      const rowClasses = ["bob-dep-row", "bob-relation-row"];
      if (model.direction === "from") rowClasses.push("is-incoming");
      if (model.labelled) rowClasses.push("is-labelled");
      for (const name of rowClasses) {
        try {
          li.classList.add(name);
        } catch (error) {
          // Best-effort.
        }
      }
      li.setAttribute("role", "group");
      li.setAttribute("aria-label", String(model.tooltip || model.label || "relations"));
      li.setAttribute("title", String(model.tooltip || ""));
      if (li.dataset) li.dataset.bobRelationProcessed = "1";
      const meta = { lineNumber, direction: model.direction, ownerBlockId: (owner && owner.blockId) || null };

      const available = anchors.slice();
      // Hide the source glyph, header words, label words, and raw
      // separators: every direct text child of an accepted row is
      // chrome the chips replace. Nested lists are elements, so child
      // tasks are untouched.
      for (const node of Array.from(li.childNodes || [])) {
        try {
          if (node.nodeType !== 3) continue;
          if (node.parentNode !== li) continue;
          const value = String(node.nodeValue || node.textContent || "");
          if (value.trim() === "" || /[🪢🔗]/.test(value)) {
            try {
              node.nodeValue = "";
            } catch (clearError) {
              // Best-effort.
            }
            try {
              node.textContent = "";
            } catch (clearError) {
              // Best-effort.
            }
          } else {
            // Label words (`follow-up of`) and `(labels)` duplicate
            // the pills; blank them too on accepted rows.
            try {
              node.nodeValue = "";
            } catch (clearError) {
              // Best-effort.
            }
            try {
              node.textContent = "";
            } catch (clearError) {
              // Best-effort.
            }
          }
        } catch (error) {
          continue;
        }
      }
      const appendGroup = (kind, group) => {
        const chips = Array.isArray(group && group.chips) ? group.chips : [];
        if (chips.length === 0) return null;
        const host = doc.createElement("span");
        host.setAttribute("class", kind === "mentions" ? "bob-relation-group bob-relation-mention-group" : "bob-relation-group bob-relation-link-group");
        const hiddenClosed = [];
        const hiddenMore = [];
        for (const chip of chips) {
          let anchor = null;
          const foundAt = available.findIndex((candidate) => {
            try {
              return dependencyReadingBlockId(candidate) === chip.blockId;
            } catch (error) {
              return false;
            }
          });
          if (foundAt >= 0) anchor = available.splice(foundAt, 1)[0];
          else if (chip.live && !chip.broken) anchor = this.relationCreateReadingAnchor(chip, doc, model, sourcePath);
          if (!anchor) continue;
          this.relationDecorateReadingAnchor(anchor, chip, doc, model, sourcePath);
          const entry = doc.createElement("span");
          entry.setAttribute("class", "bob-relation-entry" + (kind === "mentions" ? " is-mention" : ""));
          if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
          entry.appendChild(anchor);
          this.relationAppendReadingEntryContent(entry, anchor, chip, doc, model, sourcePath);
          host.appendChild(entry);
          if (chip.collapsed) { entry.style.display = "none"; hiddenClosed.push(entry); }
          if (chip.densityCollapsed) { entry.style.display = "none"; hiddenMore.push(entry); }
          if (interactive && chip.kind !== "mention" && chip.live && !chip.broken) {
            this.relationAttachReadingRemove(anchor, chip, doc, sourcePath, meta);
          }
        }
        if (group.collapsed && Number(group.collapsed.count) > 0) {
          this.relationAppendReadingGroupToggle(host, hiddenClosed, Number(group.collapsed.count), "closed", kind, doc);
        }
        if (group.more && Number(group.more.count) > 0) {
          this.relationAppendReadingGroupToggle(host, hiddenMore, Number(group.more.count), "more", kind, doc);
        }
        li.appendChild(host);
        return host;
      };
      const relationHost = appendGroup("relations", groups.relations);
      if (relationHost && groups.mentions.chips.length > 0) {
        const divider = doc.createElement("span");
        divider.setAttribute("class", "bob-relation-divider");
        divider.setAttribute("aria-hidden", "true");
        li.appendChild(divider);
      }
      appendGroup("mentions", groups.mentions);
      if (interactive && !(li.dataset && li.dataset.bobRelationAdd === "1")) {
        const self = this;
        relationAttachAddControl(li, doc, model, () => {
          try {
            self.relationOpenStage(sourcePath, meta);
          } catch (error) {
            // Best-effort.
          }
        });
        if (li.dataset) li.dataset.bobRelationAdd = "1";
      }
    } catch (error) {
      // The raw Markdown stays usable if a DOM implementation rejects a decoration.
    }
  }

  relationAppendReadingEntryContent(host, anchor, chip, doc, model, sourcePath) {
    try {
      if (!host || !anchor) return;
      if (chip.kind === "mention") {
        const self = this;
        host.insertBefore(relationCreateMentionPill(doc, chip, {
          onMention: (item, pill, event, reason) => self.relationOpenMentionCard(item, sourcePath, pill, event, reason),
          onMentionLeave: (pill) => self.relationMentionCardPointerLeave(pill),
          onMentionClose: (pill, event, restoreFocus) => self.relationCloseMentionCard(Boolean(restoreFocus), pill),
          onMentionNavigate: (pill, event, direction) => self.relationMentionCardNavigate(pill, direction),
        }), anchor);
        if (chip.quote) relationAppendMentionQuote(host, chip.quote, doc);
        return;
      }
      if (model.direction === "to" && !model.labelled) return;
      if (model.direction === "to") {
        if (chip.label) {
          const pill = doc.createElement("span");
          pill.setAttribute("class", "bob-relation-pill");
          pill.appendChild(doc.createTextNode(String(chip.label)));
          host.insertBefore(pill, anchor);
          const arrow = doc.createElement("span");
          arrow.setAttribute("class", "bob-relation-arrow");
          arrow.setAttribute("aria-hidden", "true");
          arrow.appendChild(doc.createTextNode("→"));
          host.insertBefore(arrow, anchor);
        }
      } else if (chip.inverse) {
        const pill = doc.createElement("span");
        pill.setAttribute("class", "bob-relation-pill");
        pill.appendChild(doc.createTextNode(String(chip.inverse)));
        host.insertBefore(pill, anchor);
      } else if (chip.label) {
        const sep = doc.createElement("span");
        sep.setAttribute("class", "bob-relation-sep");
        sep.setAttribute("aria-hidden", "true");
        sep.appendChild(doc.createTextNode("·"));
        host.appendChild(sep);
        const pill = doc.createElement("span");
        pill.setAttribute("class", "bob-relation-pill");
        pill.appendChild(doc.createTextNode(String(chip.label)));
        host.appendChild(pill);
        const arrow = doc.createElement("span");
        arrow.setAttribute("class", "bob-relation-arrow");
        arrow.setAttribute("aria-hidden", "true");
        arrow.appendChild(doc.createTextNode("→ this"));
        host.appendChild(arrow);
      }
      if (chip.alsoMentioned) relationAppendMixedMentionMarker(host, doc);
    } catch (error) {
      // Pill and arrow are best-effort.
    }
  }

  relationAppendReadingGroupToggle(host, hiddenEntries, count, toggleKind, groupKind, doc) {
    try {
      if (!host || count <= 0 || hiddenEntries.length === 0) return;
      const collapsed = doc.createElement("span");
      collapsed.setAttribute("class", "bob-dep-chip bob-relation-collapsed" + (toggleKind === "more" ? " bob-relation-more" : " is-done-collapsed"));
      collapsed.setAttribute("role", "button");
      collapsed.setAttribute("tabindex", "0");
      const noun = groupKind === "mentions" ? "mentions" : "relations";
      const label = toggleKind === "more" ? "+" + count + " more" : "✓×" + count;
      collapsed.setAttribute("aria-label", toggleKind === "more" ? "Show " + count + " more mentions" : "Show " + count + " closed " + noun);
      collapsed.setAttribute("title", toggleKind === "more" ? label : "✓×" + count + " closed " + noun);
      collapsed.appendChild(doc.createTextNode(label));
      const expand = () => {
        try {
          for (const entry of hiddenEntries) entry.style.display = "";
          if (typeof collapsed.remove === "function") collapsed.remove();
          else if (collapsed.parentNode && typeof collapsed.parentNode.removeChild === "function") {
            collapsed.parentNode.removeChild(collapsed);
          }
        } catch (error) {
          // An unexpanded row never breaks the chips.
        }
      };
      if (typeof collapsed.addEventListener === "function") {
        collapsed.addEventListener("click", expand);
        collapsed.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            if (typeof event.preventDefault === "function") event.preventDefault();
            expand();
          }
        });
      }
      host.appendChild(collapsed);
    } catch (error) {
      // An uncollapsed row never breaks the chips.
    }
  }

  relationOpenMention(chip, sourcePath, event, occurrenceOverride) {
    try {
      if (!chip || chip.kind !== "mention" || !chip.path || !Array.isArray(chip.occurrences) || chip.occurrences.length === 0) return false;
      const occurrence = occurrenceOverride && chip.occurrences.includes(occurrenceOverride)
        ? occurrenceOverride
        : chip.occurrences[0];
      if (!Number.isInteger(Number(occurrence.line)) || Number(occurrence.line) < 1) return false;
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.openLinkText !== "function") return false;
      const newLeaf = Boolean(event && (event.ctrlKey || event.metaKey));
      const openResult = workspace.openLinkText(String(chip.linktext || ""), String(sourcePath || ""), newLeaf);
      const jump = () => {
        try {
          let leaves = [];
          try {
            leaves = typeof workspace.getLeavesOfType === "function" ? workspace.getLeavesOfType("markdown") || [] : [];
          } catch (error) {
            leaves = [];
          }
          const targetPath = String(chip.path || "");
          const leaf = Array.from(leaves).reverse().find((candidate) => candidate && candidate.view && candidate.view.file && candidate.view.file.path === targetPath);
          const view = (leaf && leaf.view) || (typeof workspace.getActiveViewOfType === "function" ? workspace.getActiveViewOfType(MarkdownView) : null);
          if (!view || !view.editor || (view.file && view.file.path && view.file.path !== targetPath)) return;
          const line = Math.max(0, Number(occurrence.line) - 1);
          const ch = Math.max(0, Number(occurrence.ch) || 0);
          setEditorCursor(view.editor, line, ch);
          focusEditor(view.editor);
          this.relationFlashMentionLine(view.editor, line, ch);
        } catch (error) {
          // A failed reveal never blocks opening the task note.
        }
      };
      Promise.resolve(openResult).then(() => setTimeout(jump, 0), () => {});
      return true;
    } catch (error) {
      return false;
    }
  }

  relationFlashMentionLine(editor, line, ch) {
    try {
      const cm = getEditorViewFromEditor(editor);
      if (!cm || typeof cm.domAtPos !== "function") return false;
      const position = editorViewPositionFromLineCh(cm, line, ch);
      if (position === null) return false;
      const located = cm.domAtPos(position);
      let node = located && located.node ? located.node : null;
      while (node && node.nodeType === 3) node = node.parentElement || node.parentNode;
      while (node && node.classList && !node.classList.contains("cm-line")) node = node.parentElement || node.parentNode;
      if (!node || !node.classList || typeof node.classList.add !== "function") return false;
      node.classList.add("bob-mention-jump-highlight");
      const timer = setTimeout(() => {
        try { node.classList.remove("bob-mention-jump-highlight"); } catch (error) { /* best-effort */ }
      }, 1200);
      if (timer && typeof timer.unref === "function") timer.unref();
      return true;
    } catch (error) {
      return false;
    }
  }

  relationAttachReadingRemove(anchor, chip, doc, sourcePath, meta) {
    try {
      if (!anchor || (anchor.getAttribute && anchor.getAttribute("data-bob-relation-actions") === "1")) {
        return;
      }
      const self = this;
      relationAttachChipRemove(anchor, chip, doc, (item) => {
        try {
          self.relationRemoveLink(item, sourcePath, meta);
        } catch (error) {
          // Best-effort.
        }
      });
      try {
        anchor.setAttribute("data-bob-relation-actions", "1");
      } catch (error) {
        // Best-effort.
      }
    } catch (error) {
      // Leave the existing internal link navigable.
    }
  }

  relationDecorateReadingAnchor(anchor, chip, doc, model, sourcePath) {
    try {
      const classes = ["bob-dep-chip", "bob-relation-chip", "is-" + String(chip.state || "todo")];
      if (chip.kind === "mention") classes.push("is-mention");
      if (chip.stale) classes.push("is-stale");
      if (chip.broken) classes.push("is-broken");
      if (chip.archived) classes.push("is-archived");
      if (chip.hidden) classes.push("is-muted");
      anchor.classList.add(...classes);
      anchor.setAttribute("role", "link");
      anchor.setAttribute("aria-label", relationChipAriaLabel(chip));
      if (chip.tooltip) anchor.setAttribute("title", chip.tooltip);
      anchor.setAttribute("data-state", String(chip.state || "todo"));
      if (chip.collapsed) anchor.setAttribute("data-bob-collapsed-kind", "closed");
      if (chip.densityCollapsed) anchor.setAttribute("data-bob-collapsed-kind", "density");
      for (const child of Array.from(anchor.childNodes || [])) {
        if (child.nodeType === 1 && child.classList && child.classList.contains("bob-dep-chip-box")) {
          child.remove();
        }
      }
      while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
      this.relationAppendAnchorContent(anchor, chip, doc);
      if (chip.kind === "mention" && chip.live && Array.isArray(chip.occurrences) && chip.occurrences.length > 0 && anchor.getAttribute("data-bob-mention-jump") !== "1") {
        const self = this;
        anchor.setAttribute("data-bob-mention-jump", "1");
        const openMention = (event) => {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          self.relationOpenMention(chip, sourcePath, event);
        };
        if (typeof anchor.addEventListener === "function") {
          anchor.addEventListener("click", openMention);
          anchor.addEventListener("keydown", (event) => {
            if (event && (event.key === "Enter" || event.key === " ")) openMention(event);
          });
        }
      }
    } catch (error) {
      // Leave the existing internal link navigable.
    }
  }

  relationCreateReadingAnchor(chip, doc, model, sourcePath) {
    try {
      const anchor = doc.createElement("a");
      const target = String(chip.linktext || "").replace(/^#/, "");
      anchor.setAttribute("class", "internal-link");
      anchor.setAttribute("data-href", target);
      anchor.setAttribute("href", target.indexOf("#") === -1 ? "#" + target : target);
      anchor.setAttribute("aria-label", relationChipAriaLabel(chip));
      anchor.setAttribute("title", String(chip.tooltip || ""));
      this.relationDecorateReadingAnchor(anchor, chip, doc, model, sourcePath);
      return anchor;
    } catch (error) {
      return null;
    }
  }

  relationAppendAnchorContent(anchor, chip, doc) {
    try {
      const box = doc.createElement("span");
      box.setAttribute("class", "bob-dep-chip-box");
      box.setAttribute("data-task", String(chip.state || "todo"));
      box.setAttribute("aria-hidden", "true");
      box.appendChild(doc.createTextNode(String(chip.symbol || "○")));
      anchor.appendChild(box);
      const text = doc.createElement("span");
      text.setAttribute("class", "bob-dep-chip-text");
      text.appendChild(doc.createTextNode(String(chip.text || "")));
      anchor.appendChild(text);
      if (chip.noteLabel) {
        const note = doc.createElement("span");
        note.setAttribute("class", "bob-dep-chip-note");
        note.appendChild(doc.createTextNode(String(chip.noteLabel)));
        anchor.appendChild(note);
      }
    } catch (error) {
      // Content is best-effort.
    }
  }
}

function relationChipGroups(model) {
  const source = model && model.groups && typeof model.groups === "object" ? model.groups : null;
  if (source) {
    return {
      relations: source.relations || { chips: [], collapsed: null, more: null },
      mentions: source.mentions || { chips: [], collapsed: null, more: null },
    };
  }
  const chips = Array.isArray(model && model.chips) ? model.chips : [];
  return {
    relations: { chips: chips.filter((chip) => !chip || chip.kind !== "mention"), collapsed: model && model.collapsed || null, more: null },
    mentions: { chips: chips.filter((chip) => chip && chip.kind === "mention"), collapsed: null, more: null },
  };
}

function relationAttachMentionPillHandlers(pill, chip, options) {
  try {
    if (!pill || typeof pill.addEventListener !== "function") return;
    const opts = options && typeof options === "object" ? options : {};
    const open = (event, reason) => {
      try {
        if (typeof opts.onMention === "function") opts.onMention(chip, pill, event, reason);
      } catch (error) {
        // The read-only card is best-effort.
      }
    };
    pill.addEventListener("mouseenter", (event) => open(event, "hover"));
    pill.addEventListener("mouseleave", (event) => {
      try {
        if (typeof opts.onMentionLeave === "function") opts.onMentionLeave(pill, event);
      } catch (error) {
        // The pill remains usable if its card cannot close.
      }
    });
    pill.addEventListener("focus", (event) => open(event, "focus"));
    pill.addEventListener("click", (event) => {
      try {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      } catch (error) {
        // Opening the card is still useful without event suppression.
      }
      open(event, "click");
    });
    pill.addEventListener("keydown", (event) => {
      try {
        if (event && event.key === "Escape") {
          if (typeof opts.onMentionClose === "function") opts.onMentionClose(pill, event, true);
          return;
        }
        if (event && (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft")) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (typeof opts.onMentionNavigate === "function") {
            opts.onMentionNavigate(pill, event, event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1);
          }
          return;
        }
        if (event && (event.key === "Enter" || event.key === " ")) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          open(event, "keyboard");
        }
      } catch (error) {
        // The card is an optional affordance.
      }
    });
  } catch (error) {
    // A pill without handlers still communicates the mention.
  }
}

function relationCreateMentionPill(doc, chip, options) {
  const pill = doc.createElement("span");
  pill.setAttribute("class", "bob-relation-pill is-mention");
  pill.setAttribute("role", "button");
  pill.setAttribute("tabindex", "0");
  pill.setAttribute("aria-haspopup", "dialog");
  pill.setAttribute("aria-label", String(chip && chip.pillAriaLabel || "Why is this here?"));
  pill.appendChild(doc.createTextNode(String(chip && chip.mentionPill || "💬 mentioned in")));
  relationAttachMentionPillHandlers(pill, chip, options);
  return pill;
}

function relationAppendMentionQuote(host, marked, doc) {
  try {
    const value = String(marked || "");
    const open = value.indexOf("⟦");
    const close = open < 0 ? -1 : value.indexOf("⟧", open + 1);
    if (!host || open < 0 || close < 0) return null;
    const quote = doc.createElement("span");
    quote.setAttribute("class", "bob-mention-quote");
    quote.appendChild(doc.createTextNode("“" + value.slice(0, open)));
    const target = doc.createElement("span");
    target.setAttribute("class", "bob-mention-quote-target");
    target.appendChild(doc.createTextNode(value.slice(open + 1, close)));
    quote.appendChild(target);
    quote.appendChild(doc.createTextNode(value.slice(close + 1) + "”"));
    host.appendChild(quote);
    return quote;
  } catch (error) {
    return null;
  }
}

function relationAppendMixedMentionMarker(host, doc) {
  try {
    const marker = doc.createElement("span");
    marker.setAttribute("class", "bob-relation-mixed-marker");
    marker.setAttribute("title", "Also mentioned in its text");
    marker.setAttribute("aria-label", "Also mentioned in its text");
    marker.appendChild(doc.createTextNode("💬"));
    host.appendChild(marker);
    return marker;
  } catch (error) {
    return null;
  }
}

function relationReadingMappedLine(lines, low, high, rowIndex, rowCount) {
  try {
    const fenced = planFencedLines(lines, low, high);
    const items = [];
    for (let index = low; index <= high; index += 1) {
      if (!fenced.has(index) && dependencyChipHasMarker(lines[index])) {
        items.push(index);
      }
    }
    if (items.length !== rowCount || !Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= items.length) {
      return null;
    }
    const line = items[rowIndex];
    const parsed = parseTaskRelationLine(lines[line]);
    return parsed && (parsed.verdict === "accepted" || parsed.verdict === "empty") && relationOwnerTaskLine(lines, line) ? line : null;
  } catch (error) {
    return null;
  }
}

function relationReadingLabelElement(li) {
  try {
    const stack = [li];
    let guard = 0;
    while (stack.length > 0 && guard < 500) {
      guard += 1;
      const node = stack.pop();
      if (!node || node.nodeType !== 1) continue;
      if (node !== li) {
        const tag = String(node.tagName || node.nodeName || "").toUpperCase();
        if (tag === "UL" || tag === "OL" || tag === "LI") continue;
        if ((tag === "STRONG" || tag === "B") && /LINKS|LINKED FROM|BACKLINKS/.test(String(node.textContent || ""))) return node;
      }
      for (const child of Array.from(node.childNodes || []).reverse()) stack.push(child);
    }
    return null;
  } catch (error) {
    return null;
  }
}
