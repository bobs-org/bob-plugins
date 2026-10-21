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
          const model = this.relationChipModelForLine({ path, text: rawLine, owner });
          if (!model || model.chips.length === 0) {
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
      li.setAttribute("aria-label", String(model.label || "relations") + ", " + model.liveCount + " live");
      li.setAttribute("title", String(model.tooltip || ""));
      if (li.dataset) li.dataset.bobRelationProcessed = "1";
      const meta = { lineNumber, direction: model.direction, ownerBlockId: (owner && owner.blockId) || null };

      const available = anchors.slice();
      const closedAnchors = [];
      for (const chip of model.chips) {
        let anchor = null;
        const foundAt = available.findIndex((candidate) => {
          try {
            return dependencyReadingBlockId(candidate) === chip.blockId;
          } catch (error) {
            return false;
          }
        });
        if (foundAt >= 0) {
          anchor = available.splice(foundAt, 1)[0];
          this.relationDecorateReadingAnchor(anchor, chip, doc, model);
        } else if (chip.live && !chip.broken) {
          // LC7: a live edge missing from the stored text is appended
          // in canonical order; placement happens below.
          anchor = this.relationCreateReadingAnchor(chip, doc, model, sourcePath);
          if (!anchor) {
            continue;
          }
        } else {
          // Stale chips with no stored anchor, and live-but-broken
          // edges with none, name nothing to decorate.
          continue;
        }
        if (chip.collapsed) {
          closedAnchors.push(anchor);
        }
        if (model.labelled) {
          // Each labelled entry gets its own visual row with its pill
          // and arrow (LC10); processing in chip order keeps stored
          // order with live appends last (LC7).
          const entry = doc.createElement("span");
          entry.setAttribute("class", "bob-relation-entry");
          try {
            if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
          } catch (removeError) {
            // Fresh anchors have no parent yet.
          }
          entry.appendChild(anchor);
          this.relationAppendReadingEntryContent(entry, anchor, chip, doc, model);
          li.appendChild(entry);
        } else if (!anchor.parentNode) {
          // Unlabelled rows keep stored anchors in place; fresh live
          // appends go last (LC7).
          li.appendChild(anchor);
        }
        if (interactive && chip.live && !chip.broken && anchor) {
          this.relationAttachReadingRemove(anchor, chip, doc, sourcePath, meta);
        }
      }
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
      if (model.collapsed && Number(model.collapsed.count) > 0) {
        this.relationAppendReadingCollapsed(li, closedAnchors, model, doc);
      }
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

  relationAppendReadingEntryContent(host, anchor, chip, doc, model) {
    try {
      if (!host || !anchor) return;
      if (!model.labelled) return;
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
    } catch (error) {
      // Pill and arrow are best-effort.
    }
  }

  relationAppendReadingCollapsed(li, closedAnchors, model, doc) {
    try {
      const count = Number(model.collapsed.count) || 0;
      if (count <= 0 || closedAnchors.length === 0) return;
      for (const anchor of closedAnchors) {
        try {
          anchor.style.display = "none";
        } catch (styleError) {
          // Attribute fallback for style-free DOMs.
        }
        try {
          anchor.setAttribute("data-bob-relation-collapsed", "1");
        } catch (attrError) {
          // Best-effort.
        }
      }
      const collapsed = doc.createElement("span");
      collapsed.setAttribute("class", "bob-dep-chip is-done-collapsed bob-relation-collapsed");
      collapsed.setAttribute("role", "button");
      collapsed.setAttribute("tabindex", "0");
      collapsed.setAttribute("aria-label", "Show " + count + " closed relations");
      collapsed.setAttribute("title", "✓×" + count + " closed");
      collapsed.appendChild(doc.createTextNode("✓×" + count));
      const expand = () => {
        try {
          for (const anchor of closedAnchors) {
            try {
              anchor.style.display = "";
            } catch (styleError) {
              // Best-effort.
            }
            try {
              anchor.removeAttribute("data-bob-relation-collapsed");
            } catch (attrError) {
              // Best-effort.
            }
          }
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
      li.appendChild(collapsed);
    } catch (error) {
      // An uncollapsed row never breaks the chips.
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

  relationDecorateReadingAnchor(anchor, chip, doc, model) {
    try {
      const classes = ["bob-dep-chip", "bob-relation-chip", "is-" + String(chip.state || "todo")];
      if (chip.stale) classes.push("is-stale");
      if (chip.broken) classes.push("is-broken");
      if (chip.archived) classes.push("is-archived");
      if (chip.hidden) classes.push("is-muted");
      anchor.classList.add(...classes);
      anchor.setAttribute("role", "link");
      anchor.setAttribute("aria-label", relationChipAriaLabel(chip));
      if (chip.tooltip) anchor.setAttribute("title", chip.tooltip);
      anchor.setAttribute("data-state", String(chip.state || "todo"));
      for (const child of Array.from(anchor.childNodes || [])) {
        if (child.nodeType === 1 && child.classList && child.classList.contains("bob-dep-chip-box")) {
          child.remove();
        }
      }
      while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
      this.relationAppendAnchorContent(anchor, chip, doc);
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
      this.relationDecorateReadingAnchor(anchor, chip, doc, model);
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
