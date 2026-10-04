class BobLedgerToolsDependencyRenderMixin {
  renderDependencyChipsIn(el, ctx) {
    try {
      if (!this.dependencyChipsEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      const path = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const items = [];
      try {
        if (typeof el.querySelectorAll === "function") {
          const found = el.querySelectorAll("li");
          for (let i = 0; i < found.length; i += 1) {
            items.push(found[i]);
          }
        } else if (Array.isArray(el.children)) {
          for (const child of el.children) {
            items.push(child);
          }
        }
      } catch (error) {
        return;
      }
      const interactive = Boolean(this.dependencyNavApi());
      for (const li of items) {
        try {
          if (!li || li.nodeType !== 1) {
            continue;
          }
          if (li.dataset && li.dataset.bobDepProcessed === "1") {
            continue;
          }
          if (this.dependencyExcludedAncestor(li, el)) {
            continue;
          }
          // Only an li whose own leading text is the label (nested lists
          // excluded) — never the parent task row that merely contains one.
          let ownText = "";
          try {
            ownText = dependencyReadingOwnText(li);
          } catch (error) {
            ownText = "";
          }
          if (!/^\s*(?:\u26D3\uFE0F?|\uD83D\uDD17)?\s*\*{0,2}(?:DEPENDS ON|DEPENDENCIES)/.test(ownText)) {
            continue;
          }
          // Only anchors owned directly by this li — never a nested row's.
          const links = [];
          try {
            const anchors = li.querySelectorAll ? li.querySelectorAll("a.internal-link") : [];
            for (let i = 0; i < anchors.length; i += 1) {
              try {
                if (dependencyReadingAnchorOwner(anchors[i], el) === li) {
                  links.push(anchors[i]);
                }
              } catch (error) {
                continue;
              }
            }
          } catch (error) {
            continue;
          }
          if (links.length === 0) {
            continue;
          }
          // Owning-line rules, as in Live Preview
          // (`dependencyChipLineOwnedByTask`, contract DP16/DP19/DP20/
          // DP29/DP30): the row's parent list must hang directly off a
          // `#task` item (DP20 hangs off the Work Log entry instead, so
          // it never counts; a DP30 row owned by a task nested under a
          // Work Log entry counts), and its own text must parse as the
          // label shape (never chips on malformed, grandchild, Work Log,
          // or blockquoted rows). Blockquotes and code reach here through
          // `dependencyExcludedAncestor` above.
          if (!dependencyReadingOwningTask(li, el)) {
            continue;
          }
          if (!dependencyReadingRowShapeOk(li)) {
            continue;
          }
          const model = this.dependencyChipModelForDomLinks(links, path);
          if (!model) {
            continue;
          }
          const docNode = li.ownerDocument || (typeof document !== "undefined" ? document : null);
          if (!docNode) {
            continue;
          }
          li.classList.add("bob-dep-row");
          if (li.dataset) {
            li.dataset.bobDepProcessed = "1";
          }
          // Chips replace the row chrome: hide the rendered bold label.
          try {
            const labelEl = dependencyReadingLabelElement(li);
            if (labelEl) {
              try {
                labelEl.style.display = "none";
              } catch (styleError) {
                // Attribute fallback for style-free DOMs.
              }
              try {
                labelEl.setAttribute("data-bob-dep-hidden", "1");
              } catch (attrError) {
                // Best-effort.
              }
            }
          } catch (error) {
            // A visible label never breaks the row.
          }
          const readingActions = [];
          for (const anchor of links) {
            try {
              const chip = model.byAnchor && model.byAnchor.get(anchor);
              anchor.classList.add("bob-dep-chip");
              if (chip && chip.state) {
                anchor.classList.add("is-" + chip.state);
                anchor.setAttribute("data-state", chip.state);
              }
              anchor.setAttribute("role", "link");
              if (chip && chip.tooltip) {
                anchor.setAttribute("title", chip.tooltip);
                anchor.setAttribute("aria-label", chip.ariaLabel || chip.tooltip);
              }
              // Done strike-through wraps the original link text only.
              if (chip && chip.state === "done") {
                try {
                  const kids = Array.from(anchor.childNodes || []);
                  if (kids.length > 0) {
                    const wrap = docNode.createElement("span");
                    wrap.setAttribute("class", "bob-dep-chip-text");
                    try {
                      wrap.style.textDecoration = "line-through";
                    } catch (styleError) {
                      // Attribute fallback for style-free DOMs.
                    }
                    for (const kid of kids) {
                      try {
                        wrap.appendChild(kid);
                      } catch (moveError) {
                        // Best-effort.
                      }
                    }
                    try {
                      anchor.childNodes.length = 0;
                    } catch (clearError) {
                      // Live DOMs already moved the children.
                    }
                    anchor.appendChild(wrap);
                  }
                } catch (error) {
                  // Unstruck Done text never breaks the row.
                }
              }
              // Status-symbol box, as in Live Preview.
              try {
                const box = docNode.createElement("span");
                box.setAttribute("class", "bob-dep-chip-box");
                box.setAttribute("data-task", chip && chip.state ? chip.state : "todo");
                box.setAttribute("aria-hidden", "true");
                box.textContent = (chip && chip.symbol) || "○";
                const firstKids = Array.from(anchor.childNodes || []);
                if (typeof anchor.insertBefore === "function") {
                  anchor.insertBefore(box, firstKids.length > 0 ? firstKids[0] : null);
                } else {
                  anchor.appendChild(box);
                }
              } catch (error) {
                // The box is decorative.
              }
              if (chip && chip.noteLabel) {
                const note = docNode.createElement("span");
                note.setAttribute("class", "bob-dep-chip-note");
                note.textContent = chip.noteLabel;
                anchor.appendChild(note);
              }
              if (chip && chip.blockId) {
                readingActions.push({ anchor, chip });
              }
            } catch (error) {
              continue;
            }
          }
          // DC10: more than three Done targets collapse to one `✓×N` chip.
          try {
            const doneActions = [];
            for (const action of readingActions) {
              if (action.chip && action.chip.state === "done") {
                doneActions.push(action);
              }
            }
            if (doneActions.length > 3) {
              for (const action of doneActions) {
                try {
                  action.anchor.style.display = "none";
                } catch (styleError) {
                  // Attribute fallback for style-free DOMs.
                }
                try {
                  action.anchor.setAttribute("data-bob-dep-collapsed", "1");
                } catch (attrError) {
                  // Best-effort.
                }
              }
              for (let index = readingActions.length - 1; index >= 0; index -= 1) {
                if (readingActions[index].chip && readingActions[index].chip.state === "done") {
                  readingActions.splice(index, 1);
                }
              }
              const collapsed = docNode.createElement("span");
              collapsed.setAttribute("class", "bob-dep-chip is-done-collapsed");
              collapsed.setAttribute("role", "link");
              collapsed.setAttribute("aria-label", doneActions.length + " done dependencies");
              collapsed.setAttribute("title", "✓×" + doneActions.length + " done");
              collapsed.textContent = "✓×" + doneActions.length;
              try {
                if (typeof li.insertBefore === "function") {
                  li.insertBefore(collapsed, doneActions[0].anchor || null);
                } else {
                  li.appendChild(collapsed);
                }
              } catch (insertError) {
                try {
                  li.appendChild(collapsed);
                } catch (appendError) {
                  // Best-effort.
                }
              }
            }
          } catch (error) {
            // An uncollapsed row never breaks the chips.
          }
          // Hide the raw separators between chips and the leading emoji
          // text (blanking is idempotent across re-renders), as Live
          // Preview does; the label element is hidden above and outer
          // text stays untouched.
          try {
            const kids = Array.from(li.childNodes || []);
            const owned = new Set(links);
            let first = -1;
            let last = -1;
            for (let index = 0; index < kids.length; index += 1) {
              if (owned.has(kids[index])) {
                if (first === -1) {
                  first = index;
                }
                last = index;
              }
            }
            for (let index = 0; index >= 0 && index <= last; index += 1) {
              const node = kids[index];
              if (!node || node.nodeType !== 3) {
                continue;
              }
              const value = node.nodeValue !== undefined && node.nodeValue !== null ? node.nodeValue : node.textContent;
              if (/^[\s•·,⛓🔗\uFE0F]*$/u.test(String(value || ""))) {
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
            }
          } catch (error) {
            // Separator hiding is best-effort.
          }
          try {
            const summary = docNode.createElement("span");
            summary.setAttribute("class", "bob-dep-summary");
            summary.textContent = model.summary;
            li.appendChild(summary);
          } catch (error) {
            // Summary is best-effort.
          }
          // Actions carry the derived 0-based note line (contract §9) and
          // stay hidden when the line cannot be derived.
          // The 0-based line maps this row's index among the section's
          // rendered list items to the same index among the section's
          // list-item lines; without section info, or when the counts
          // disagree, the actions stay hidden.
          let readingSection = null;
          try {
            if (ctx && typeof ctx.getSectionInfo === "function") {
              readingSection = ctx.getSectionInfo(el) || null;
            }
          } catch (error) {
            readingSection = null;
          }
          if (interactive && readingActions.length > 0) {
            const self = this;
            const pending = readingActions.slice();
            const blockIds = pending.map((action) => String((action.chip && action.chip.blockId) || ""));
            const rowHint = { rowIndex: items.indexOf(li), rowCount: items.length };
            try {
              Promise.resolve()
                .then(() => self.dependencyReadingLineFor(path, blockIds, readingSection, rowHint))
                .then((line) => {
                  try {
                    if (!Number.isInteger(line)) {
                      return;
                    }
                    const ref = { path, line };
                    for (const action of pending) {
                      try {
                        if (action.anchor.getAttribute && action.anchor.getAttribute("data-bob-dep-actions") === "1") {
                          continue;
                        }
                        const remove = docNode.createElement("span");
                        remove.setAttribute("class", "bob-dep-chip-remove");
                        remove.setAttribute("role", "button");
                        remove.setAttribute("aria-label", "Remove dependency " + (action.chip.fullText || ""));
                        remove.textContent = "×";
                        const target = { path: action.chip.resolvedPath, blockId: action.chip.blockId };
                        if (typeof remove.addEventListener === "function") {
                          remove.addEventListener("click", (event) => {
                            try {
                              if (event) {
                                if (typeof event.stopPropagation === "function") {
                                  event.stopPropagation();
                                }
                                if (typeof event.preventDefault === "function") {
                                  event.preventDefault();
                                }
                              }
                              const api = self.dependencyNavApi();
                              if (api && typeof api.removeDependency === "function") {
                                Promise.resolve(api.removeDependency(ref, target)).then((result) => {
                                  if (result && result.ok === false && result.reason) {
                                    try {
                                      new Notice(String(result.reason));
                                    } catch (noticeError) {
                                      // Best-effort.
                                    }
                                  }
                                });
                              }
                            } catch (error) {
                              // Best-effort.
                            }
                          });
                        }
                        action.anchor.appendChild(remove);
                        try {
                          action.anchor.setAttribute("data-bob-dep-actions", "1");
                        } catch (attrError) {
                          // Best-effort.
                        }
                      } catch (error) {
                        continue;
                      }
                    }
                    try {
                      if (li.dataset && li.dataset.bobDepAdd === "1") {
                        return;
                      }
                      const add = docNode.createElement("span");
                      add.setAttribute("class", "bob-dep-add");
                      add.setAttribute("role", "button");
                      add.setAttribute("tabindex", "0");
                      add.setAttribute("aria-label", "Edit task dependencies");
                      add.textContent = "＋";
                      if (typeof add.addEventListener === "function") {
                        add.addEventListener("click", () => {
                          try {
                            const api = self.dependencyNavApi();
                            if (api && typeof api.openDependencyStage === "function") {
                              Promise.resolve(api.openDependencyStage(ref));
                            }
                          } catch (error) {
                            // Best-effort.
                          }
                        });
                      }
                      li.appendChild(add);
                      if (li.dataset) {
                        li.dataset.bobDepAdd = "1";
                      }
                    } catch (error) {
                      // The add button is best-effort.
                    }
                  } catch (error) {
                    // Async actions never break the row.
                  }
                });
            } catch (error) {
              // Async actions never break the row.
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Reading chips never throw.
    }
  }

  dependencyChipModelForDomLinks(anchors, sourcePath) {
    try {
      const source = String(sourcePath || "");
      const index = this.dependencyTasksIndex();
      const self = this;
      const chips = [];
      const byAnchor = new Map();
      for (const anchor of anchors) {
        try {
          let href = "";
          try {
            href = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
          } catch (error) {
            href = "";
          }
          href = String(href || "").split("#")[0] + "#" + String(href || "").split("#").slice(1).join("#");
          let linkpath = "";
          let blockId = "";
          try {
            const rawHref = String(anchor.getAttribute("data-href") || anchor.getAttribute("href") || "");
            const hashAt = rawHref.indexOf("#");
            if (hashAt === -1) {
              continue;
            }
            linkpath = decodeURIComponent(rawHref.slice(0, hashAt));
            const after = rawHref.slice(hashAt + 1);
            blockId = after.charAt(0) === "^" ? decodeURIComponent(after.slice(1)) : "";
            if (!blockId) {
              continue;
            }
            linkpath = linkpath.replace(/\.md$/i, "");
            if (linkpath === source.replace(/\.md$/i, "")) {
              linkpath = "";
            }
          } catch (error) {
            continue;
          }
          const resolved = self.dependencyResolveLink(linkpath, source);
          const key = String(resolved.path || "") + "\u0000" + String(blockId || "");
          let task = index.has(key) ? index.get(key) : null;
          let isNonTask = false;
          if (!task) {
            try {
              const metadataCache = self.app && self.app.metadataCache;
              if (metadataCache && typeof metadataCache.getCache === "function" && resolved.path) {
                const cache = metadataCache.getCache(resolved.path);
                const blocks = cache && cache.blocks ? cache.blocks : null;
                if (blocks && Object.prototype.hasOwnProperty.call(blocks, String(blockId || ""))) {
                  isNonTask = true;
                }
              }
            } catch (error) {
              isNonTask = false;
            }
          }
          let chip = null;
          if (!task && !isNonTask) {
            const noteLabel = linkpath ? "↗ " + linkpath.split("/").pop() : null;
            chip = { state: "broken", symbol: "⚠", text: "^" + blockId + " not found", fullText: "^" + blockId + " not found", noteLabel, linktext: (linkpath ? linkpath : "") + "#^" + blockId, blockId, resolvedPath: resolved.path, tooltip: "⚠ ^" + blockId + " not found", ariaLabel: "Broken dependency ^" + blockId };
          } else if (!task && isNonTask) {
            const noteLabel = linkpath ? "↗ " + linkpath.split("/").pop() : null;
            chip = { state: "not-task", symbol: "⚠", text: "not a task", fullText: "not a task", noteLabel, linktext: (linkpath ? linkpath : "") + "#^" + blockId, blockId, resolvedPath: resolved.path, tooltip: "⚠ not a task", ariaLabel: "Dependency is not a task" };
          } else {
            let symbol = "";
            try {
              symbol = planTaskStatusSymbol(task) || "";
            } catch (error) {
              symbol = "";
            }
            if (!symbol) {
              symbol = " ";
            }
            const state = dependencyStateFromSymbol(symbol, task);
            let rawText = "";
            try {
              rawText = planTaskDescription(task) || "";
            } catch (error) {
              rawText = "";
            }
            const fullText = dependencyCleanTaskText(rawText) || ("^" + blockId);
            let text = fullText.length > 40 ? fullText.slice(0, 40) + "…" : fullText;
            let taskPath = "";
            try {
              taskPath = planTaskPath(task) || "";
            } catch (error) {
              taskPath = "";
            }
            let noteLabel = null;
            if (linkpath) {
              noteLabel = "↗ " + linkpath.split("/").pop();
            }
            chip = { state, symbol: dependencySymbolForState(state), text, fullText, noteLabel, linktext: (linkpath ? linkpath : "") + "#^" + blockId, blockId, resolvedPath: taskPath || resolved.path, tooltip: fullText + " — " + (taskPath || source) + " · " + dependencyStatusName(state), ariaLabel: fullText };
          }
          chips.push(chip);
          byAnchor.set(anchor, chip);
        } catch (error) {
          continue;
        }
      }
      if (chips.length === 0) {
        return null;
      }
      let waiting = 0;
      for (const chip of chips) {
        if (chip.state === "todo" || chip.state === "next" || chip.state === "in-progress" || chip.state === "blocked") {
          waiting += 1;
        }
      }
      return { chips, byAnchor, summary: waiting > 0 ? "waiting on " + waiting : "✓ all clear" };
    } catch (error) {
      return null;
    }
  }

  dependencyOpenTarget(linktext, sourcePath, event) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const mod = Boolean(event && (event.ctrlKey || event.metaKey));
        workspace.openLinkText(String(linktext || ""), String(sourcePath || ""), mod);
      }
    } catch (error) {
      // Best-effort.
    }
  }

  // 0-based note line of the Depends-On row rendered in Reading view
  // (contract §9): the k-th list item in the rendered section element,
  // in document order, is the k-th list-item line in the section range
  // (skipping fenced lines). `rowHint` carries the row's index and the
  // rendered item count from the caller; when the counts disagree the
  // line cannot be derived and chip actions stay hidden. Without a hint
  // the row is the section's only owned, accepted Depends-On line whose
  // link block ids match in order, or null when it cannot be derived
  // uniquely (no match, or two tasks with identical lines). Never
  // throws.
  async dependencyReadingLineFor(path, blockIds, section, rowHint) {
    try {
      const want = (Array.isArray(blockIds) ? blockIds : []).map((id) => String(id || ""));
      if (!path || want.length === 0) {
        return null;
      }
      const lineStart = section && Number.isInteger(section.lineStart) ? section.lineStart : null;
      const lineEnd = section && Number.isInteger(section.lineEnd) ? section.lineEnd : null;
      if (lineStart === null || lineEnd === null) {
        return null;
      }
      let text = null;
      try {
        const vault = this.app && this.app.vault;
        const file = vault && typeof vault.getAbstractFileByPath === "function" ? vault.getAbstractFileByPath(path) : null;
        if (file && vault && typeof vault.cachedRead === "function") {
          text = await vault.cachedRead(file);
        }
      } catch (error) {
        return null;
      }
      if (typeof text !== "string" || !text) {
        return null;
      }
      const lines = text.split("\n");
      const low = Math.max(0, lineStart);
      const high = Math.min(lines.length - 1, lineEnd);
      const isWantedLine = (index) => {
        let parsed = null;
        try {
          parsed = parseDependencyLine(lines[index]);
        } catch (error) {
          return false;
        }
        if (!parsed || parsed.verdict !== "accept") {
          return false;
        }
        const have = (parsed.targets || []).map((target) => String(target.blockId || ""));
        if (have.length !== want.length || !have.every((id, at) => id === want[at])) {
          return false;
        }
        // Ownership, as in Live Preview: only a direct child of a
        // `#task` line counts, never a grandchild or a Work Log line
        // (contract DP19/DP20/DP30).
        let owned = true;
        try {
          owned = dependencyChipLineOwnedByTask(lines, index);
        } catch (error) {
          owned = false;
        }
        return owned;
      };
      const hinted = rowHint && Number.isInteger(rowHint.rowIndex) && Number.isInteger(rowHint.rowCount);
      if (hinted) {
        let fenced = null;
        try {
          fenced = planFencedLines(lines, low, high);
        } catch (error) {
          fenced = new Set();
        }
        const itemLines = [];
        for (let index = low; index <= high; index += 1) {
          if (fenced.has(index)) {
            continue;
          }
          if (!dependencyChipHasMarker(lines[index])) {
            continue;
          }
          itemLines.push(index);
        }
        // The rendered list and the section's list-item lines must agree:
        // an unusual list hides the actions rather than misfiring.
        if (rowHint.rowCount !== itemLines.length) {
          return null;
        }
        if (rowHint.rowIndex < 0 || rowHint.rowIndex >= itemLines.length) {
          return null;
        }
        const mapped = itemLines[rowHint.rowIndex];
        return isWantedLine(mapped) ? mapped : null;
      }
      const matches = [];
      for (let index = low; index <= high; index += 1) {
        if (isWantedLine(index)) {
          matches.push(index);
        }
      }
      // Two tasks with identical Depends-On lines share every block id:
      // the row cannot be told apart without row context, so actions
      // stay hidden.
      return matches.length === 1 ? matches[0] : null;
    } catch (error) {
      return null;
    }
  }

  // Native page preview for a chip: the chip element is the hover
  // target and its row is the hover parent, as the bob-plan chips do.
  dependencyHoverTarget(linktext, sourcePath, event, targetEl, hoverParent) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.trigger === "function") {
        workspace.trigger("hover-link", { event, source: "bob-dependency-chips", hoverParent: hoverParent || targetEl || null, targetEl: targetEl || null, linktext: String(linktext || ""), sourcePath: String(sourcePath || "") });
      }
    } catch (error) {
      // Best-effort.
    }
  }

  dependencyRemoveChip(chip, sourcePath, meta) {
    try {
      const api = this.dependencyNavApi();
      if (!api || typeof api.removeDependency !== "function") {
        return;
      }
      let targetPath = String(sourcePath || "");
      try {
        if (chip && chip.linktext && chip.linktext.indexOf("#") !== -1) {
          const linkpath = chip.linktext.split("#")[0];
          if (linkpath) {
            targetPath = this.dependencyResolveLink(linkpath, sourcePath).path;
          }
        }
      } catch (error) {
        // Keep the dependent path.
      }
      // api v1 ref.line is a 0-based line index (contract §9).
      const parentRef = { path: String(sourcePath || ""), line: meta && Number.isInteger(meta.lineNumber) ? meta.lineNumber : null };
      const target = { path: targetPath, blockId: chip ? chip.blockId : null };
      Promise.resolve(api.removeDependency(parentRef, target)).then((result) => {
        if (result && result.ok === false && result.reason) {
          try {
            new Notice(String(result.reason));
          } catch (noticeError) {
            // Best-effort.
          }
        }
      });
    } catch (error) {
      // Best-effort.
    }
  }

  dependencyOpenStage(sourcePath, meta) {
    try {
      const api = this.dependencyNavApi();
      if (!api || typeof api.openDependencyStage !== "function") {
        return;
      }
      // api v1 ref.line is a 0-based line index (contract §9).
      const ref = { path: String(sourcePath || ""), line: meta && Number.isInteger(meta.lineNumber) ? meta.lineNumber : null };
      Promise.resolve(api.openDependencyStage(ref));
    } catch (error) {
      // Best-effort.
    }
  }

  setupDependencyChips() {
    try {
      if (typeof this.dependencyChipsEnabled !== "boolean") {
        this.dependencyChipsEnabled = true;
      }
      try {
        if (typeof document !== "undefined" && document && document.body && document.body.classList && typeof document.body.classList.add === "function") {
          if (this.dependencyChipsEnabled) {
            document.body.classList.add("bob-dep-chips");
          } else {
            document.body.classList.remove("bob-dep-chips");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({ id: "toggle-dependency-chips", name: "Toggle dependency chips", callback: () => this.toggleDependencyChips() });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createDependencyChipExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview chips are best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor((el, ctx) => this.renderDependencyChipsIn(el, ctx), 50);
        }
      } catch (error) {
        // Rendered-view chips are best-effort.
      }
    } catch (error) {
      // Chips setup never throws.
    }
  }

  toggleDependencyChips() {
    try {
      this.dependencyChipsEnabled = !this.dependencyChipsEnabled;
      const enabled = this.dependencyChipsEnabled;
      try {
        if (typeof document !== "undefined" && document && document.body && document.body.classList) {
          if (enabled) {
            if (typeof document.body.classList.add === "function") {
              document.body.classList.add("bob-dep-chips");
            }
          } else if (typeof document.body.classList.remove === "function") {
            document.body.classList.remove("bob-dep-chips");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshDependencyChipEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // Tasks re-render is best-effort.
      }
      try {
        new Notice(enabled ? "Dependency chips on" : "Dependency chips off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.dependencyChipsEnabled;
    }
  }

  refreshDependencyChipEditors() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      const refresh = ensureDependencyChipsRefresh();
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor ? leaf.view.editor.cm : null;
          if (cm && typeof cm.dispatch === "function" && refresh) {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleDependencyChipsRefresh() {
    try {
      if (this.dependencyChipsTimer !== null && this.dependencyChipsTimer !== undefined) {
        return;
      }
      const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout : setTimeout;
      const self = this;
      this.dependencyChipsTimer = schedule(() => {
        self.dependencyChipsTimer = null;
        try {
          self.refreshDependencyChipEditors();
        } catch (error) {
          // Refresh is best-effort.
        }
      }, 150);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

}
