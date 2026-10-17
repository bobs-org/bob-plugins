class BobLedgerToolsBlocksRenderMixin {
  setupBlocksChips() {
    try {
      const extension = this.createBlocksChipExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderBlocksChipsIn(el, ctx), 50);
      }
    } catch (error) {
      // BLOCKS chips are read-only decoration and never block plugin startup.
    }
  }

  async renderBlocksChipsIn(el, ctx) {
    try {
      if (!this.dependencyChipsEnabled || !el || !ctx) {
        return;
      }
      const path = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const memo = this.freshnessEnsureMemo();
      if (!path || !memo) {
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
          if (!li || li.nodeType !== 1 || li.dataset && li.dataset.bobBlocksProcessed === "1") {
            continue;
          }
          if (this.dependencyExcludedAncestor(li, el)) {
            continue;
          }
          const ownText = dependencyReadingOwnText(li);
          if (!/^\s*(?:🧱|🚧|⛓️|⛓)?\s*\*{0,2}(?:BLOCKS|BLOCKING)\b/.test(ownText)) {
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
        const section = candidate.section;
        const key = section && Number.isInteger(section.lineStart) && Number.isInteger(section.lineEnd)
          ? section.lineStart + ":" + section.lineEnd
          : "none";
        if (!sections.has(key)) {
          sections.set(key, await this.blocksReadSectionLines(path, section));
        }
        const source = sections.get(key);
        if (!source) {
          continue;
        }
        const rowLine = blocksReadingMappedLine(source.lines, source.low, source.high, candidate.rowIndex, candidate.rowCount);
        if (rowLine === null) {
          continue;
        }
        const parsed = parseBlocksLine(source.lines[rowLine]);
        if (!parsed || (parsed.verdict !== "accept" && parsed.verdict !== "empty")) {
          continue;
        }
        const ownerLine = blocksReadingOwnerLine(source.lines, rowLine);
        if (ownerLine === null) {
          continue;
        }
        const owner = (memo.tasks || []).find((task) => planTaskPath(task) === path && task.lineNumber === ownerLine) || null;
        if (!owner) {
          continue;
        }
        const model = this.blocksChipModelForLine({ path, text: source.lines[rowLine], owner });
        if (!model || model.chips.length === 0) {
          continue;
        }
        const docNode = candidate.li.ownerDocument || (typeof document !== "undefined" ? document : null);
        if (!docNode) {
          continue;
        }
        this.blocksDecorateReadingRow(candidate.li, candidate.anchors, model, docNode, path, rowLine);
      }
    } catch (error) {
      // One reading-view row never breaks the post-processor.
    }
  }

  async blocksReadSectionLines(path, section) {
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

  blocksDecorateReadingRow(li, anchors, model, doc, sourcePath, lineNumber) {
    try {
      const interactive = Boolean(this.blocksNavApi()) && !model.frozen;
      const label = blocksReadingLabelElement(li);
      if (label) {
        label.style.display = "none";
        label.setAttribute("data-bob-blocks-hidden", "1");
      }
      li.classList.add("bob-dep-row", "bob-blocks-row");
      if (model.frozen) li.classList.add("is-frozen");
      li.setAttribute("role", "group");
      li.setAttribute("aria-label", model.label + (model.summary ? ", " + model.summary : ""));
      li.setAttribute("title", blocksChipRowTooltip(model, interactive));
      if (li.dataset) li.dataset.bobBlocksProcessed = "1";

      const available = anchors.slice();
      for (const chip of model.chips) {
        let anchor = null;
        const foundAt = available.findIndex((candidate) => dependencyReadingBlockId(candidate) === chip.blockId);
        if (foundAt >= 0) {
          anchor = available.splice(foundAt, 1)[0];
          this.blocksDecorateReadingAnchor(anchor, chip, doc);
        } else if (chip.live) {
          anchor = this.blocksCreateReadingAnchor(chip, doc, sourcePath);
          if (anchor) {
            li.appendChild(anchor);
          }
        }
        if (interactive && chip.live && anchor) {
          this.blocksAttachReadingRemove(anchor, chip, doc, sourcePath, lineNumber);
        }
      }
      // Hide the source glyph, label punctuation, and raw separators after
      // the original link anchors have been matched in stored line order.
      for (const node of Array.from(li.childNodes || [])) {
        if (node.nodeType !== 3) continue;
        const value = String(node.nodeValue || node.textContent || "");
        if (/^[\s•·,🧱🚧⛓\uFE0F]*$/u.test(value)) {
          node.nodeValue = "";
          node.textContent = "";
        }
      }
      if (interactive && !(li.dataset && li.dataset.bobBlocksAdd === "1")) {
        const self = this;
        blocksAttachAddControl(li, doc, () => {
          try {
            self.blocksOpenStage(sourcePath, { lineNumber });
          } catch (error) {
            // Best-effort.
          }
        });
        if (li.dataset) li.dataset.bobBlocksAdd = "1";
      }
      if (model.summary) {
        const summary = doc.createElement("span");
        summary.setAttribute("class", "bob-dep-summary bob-blocks-summary");
        summary.textContent = model.summary;
        li.appendChild(summary);
      }
    } catch (error) {
      // The raw Markdown stays usable if a DOM implementation rejects a decoration.
    }
  }

  blocksAttachReadingRemove(anchor, chip, doc, sourcePath, lineNumber) {
    try {
      if (!anchor || (anchor.getAttribute && anchor.getAttribute("data-bob-blocks-actions") === "1")) {
        return;
      }
      const self = this;
      blocksAttachChipRemove(anchor, chip, doc, () => {
        try {
          self.blocksRemoveDependent(chip, sourcePath, { lineNumber });
        } catch (error) {
          // Best-effort.
        }
      });
      try {
        anchor.setAttribute("data-bob-blocks-actions", "1");
      } catch (error) {
        // Best-effort.
      }
    } catch (error) {
      // Leave the existing internal link navigable.
    }
  }

  blocksDecorateReadingAnchor(anchor, chip, doc) {
    try {
      const classes = ["bob-dep-chip", "bob-blocks-chip", "is-" + String(chip.state || "todo")];
      if (chip.stale) classes.push("is-stale");
      if (chip.hidden) classes.push("is-muted");
      if (chip.projectTask) classes.push("is-project");
      anchor.classList.add(...classes);
      anchor.setAttribute("role", "link");
      anchor.setAttribute("aria-label", String(chip.ariaLabel || chip.tooltip || chip.text || ""));
      if (chip.tooltip) anchor.setAttribute("title", chip.tooltip);
      anchor.setAttribute("data-state", String(chip.state || "todo"));
      for (const child of Array.from(anchor.childNodes || [])) {
        if (child.nodeType === 1 && child.classList && child.classList.contains("bob-dep-chip-box")) {
          child.remove();
        }
      }
      while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
      this.blocksAppendAnchorContent(anchor, chip, doc);
    } catch (error) {
      // Leave the existing internal link navigable.
    }
  }

  blocksCreateReadingAnchor(chip, doc, sourcePath) {
    try {
      const anchor = doc.createElement("a");
      const notePart = String(chip.linktext || "").replace(/#\^.*$/, "");
      const target = String(chip.linktext || "").replace(/^#/, "");
      anchor.setAttribute("class", "internal-link");
      anchor.setAttribute("data-href", target);
      anchor.setAttribute("href", target ? (target.indexOf("#") === -1 ? "#" + target : target) : "#");
      anchor.setAttribute("aria-label", String(chip.ariaLabel || chip.tooltip || chip.text || ""));
      anchor.setAttribute("title", String(chip.tooltip || ""));
      if (notePart && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("data-bob-source-path", String(sourcePath || ""));
      }
      this.blocksDecorateReadingAnchor(anchor, chip, doc);
      return anchor;
    } catch (error) {
      return null;
    }
  }

  blocksAppendAnchorContent(anchor, chip, doc) {
    const box = doc.createElement("span");
    box.setAttribute("class", "bob-dep-chip-box");
    box.setAttribute("aria-hidden", "true");
    box.textContent = String(chip.symbol || "○");
    anchor.appendChild(box);
    const text = doc.createElement("span");
    text.setAttribute("class", "bob-dep-chip-text");
    text.textContent = String(chip.text || "");
    anchor.appendChild(text);
    if (chip.noteLabel) {
      const note = doc.createElement("span");
      note.setAttribute("class", "bob-dep-chip-note");
      note.textContent = String(chip.noteLabel);
      anchor.appendChild(note);
    }
    if (chip.lastBlocker) {
      const key = doc.createElement("span");
      key.setAttribute("class", "bob-blocks-key");
      key.setAttribute("aria-label", "Last blocking reason");
      key.setAttribute("title", "This is the last reason keeping this task Blocked");
      key.textContent = "🔑";
      anchor.appendChild(key);
    }
  }
}

function blocksReadingMappedLine(lines, low, high, rowIndex, rowCount) {
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
    const parsed = parseBlocksLine(lines[line]);
    return parsed && (parsed.verdict === "accept" || parsed.verdict === "empty") && dependencyChipLineOwnedByTask(lines, line) ? line : null;
  } catch (error) {
    return null;
  }
}

function blocksReadingOwnerLine(lines, childIndex) {
  try {
    const child = String(lines[childIndex] || "");
    const childIndent = /^\s*/.exec(child)[0].replace(/\t/g, "    ").length;
    for (let index = childIndex - 1; index >= 0; index -= 1) {
      const line = String(lines[index] || "");
      if (!dependencyChipHasMarker(line)) continue;
      const indent = /^\s*/.exec(line)[0].replace(/\t/g, "    ").length;
      if (indent < childIndent) {
        return /#task(?![A-Za-z0-9_/-])/.test(line) ? index : null;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function blocksReadingLabelElement(li) {
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
        if ((tag === "STRONG" || tag === "B") && /^(?:BLOCKS|BLOCKING):?$/.test(String(node.textContent || "").trim())) return node;
      }
      for (const child of Array.from(node.childNodes || []).reverse()) stack.push(child);
    }
    return null;
  } catch (error) {
    return null;
  }
}
