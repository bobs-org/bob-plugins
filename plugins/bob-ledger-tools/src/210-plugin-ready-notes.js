class BobLedgerToolsReadyNotesMixin {
  renderReadyNotesBlock(el, ctx) {
    if (!el) {
      return;
    }
    const sourcePath = ctx && ctx.sourcePath;
    if (!this.readyNotesViews) {
      this.readyNotesViews = new Set();
    }
    const view = { el, sourcePath };
    this.readyNotesViews.add(view);
    if (ctx && typeof ctx.addChild === "function") {
      let child = null;
      try {
        if (typeof MarkdownRenderChild === "function") {
          child = new MarkdownRenderChild(el);
          child.onunload = () => {
            if (this.readyNotesViews) {
              this.readyNotesViews.delete(view);
            }
          };
        }
      } catch (error) {
        child = null;
      }
      if (!child) {
        child = {
          unload: () => {
            if (this.readyNotesViews) {
              this.readyNotesViews.delete(view);
            }
          },
        };
      }
      try {
        ctx.addChild(child);
      } catch (error) {
        // Older hosts may reject the child; the Set is cleared on unload.
      }
    }
    this.paintReadyNotesBlock(el, sourcePath);
  }

  paintReadyNotesBlock(el, sourcePath) {
    try {
      if (!el || typeof el.empty !== "function") {
        return;
      }
      el.empty();
      let snapshot = null;
      try {
        snapshot = this.noteReadyEnsureSnapshot(new Date());
      } catch (error) {
        snapshot = null;
      }
      const container =
        typeof el.createDiv === "function"
          ? el.createDiv({ cls: "bob-ready-notes" })
          : el;
      if (container && typeof container.setAttribute === "function") {
        try {
          container.setAttribute("role", "status");
          container.setAttribute(
            "aria-label",
            noteReadyReadyNotesSummary(snapshot),
          );
        } catch (error) {
          // aria is best-effort only.
        }
      }
      const summaryText = noteReadyReadyNotesSummary(snapshot);
      if (typeof container.createDiv === "function") {
        const summary = container.createDiv({
          cls: "bob-ready-notes-summary",
          text: summaryText,
        });
        if (summary && typeof summary.setAttribute === "function") {
          try {
            summary.setAttribute("aria-label", summaryText);
          } catch (error) {
            // Best-effort only.
          }
        }
      }
      if (!snapshot || snapshot.available !== true) {
        return;
      }
      const notes = Array.isArray(snapshot.notes) ? snapshot.notes : [];
      const crowded = notes.filter(
        (entry) => entry && entry.state === "crowded",
      );
      const full = notes.filter(
        (entry) => entry && entry.state === "full",
      );
      const room = notes.filter(
        (entry) => entry && entry.state === "room",
      );
      const exempt = notes.filter(
        (entry) => entry && entry.state === "exempt",
      );
      const emptyCount = notes.filter(
        (entry) => entry && entry.state === "empty",
      ).length;
      const openNote = (path) => (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (
            workspace &&
            typeof workspace.openLinkText === "function"
          ) {
            const newLeaf = Boolean(
              event && (event.ctrlKey || event.metaKey),
            );
            workspace.openLinkText(path, sourcePath || "", newLeaf);
          }
        } catch (error) {
          // The row still shows the count without the navigation.
        }
      };
      const paintRow = (entry) => {
        let row = null;
        try {
          row =
            typeof container.createDiv === "function"
              ? container.createDiv({
                  cls:
                    "bob-ready-notes-row" +
                    (entry.state === "crowded"
                      ? " is-over"
                      : entry.state === "full"
                        ? " is-full"
                        : ""),
                })
              : null;
        } catch (error) {
          row = null;
        }
        if (!row) {
          return;
        }
        try {
          const nameLink =
            typeof row.createEl === "function"
              ? row.createEl("a", {
                  cls: "internal-link bob-ready-notes-name",
                  text: entry.name,
                  href: entry.path,
                })
              : null;
          if (nameLink) {
            if (typeof nameLink.setAttribute === "function") {
              nameLink.setAttribute(
                "title",
                `${entry.name} · ${entry.count}/${entry.cap}`,
              );
              nameLink.setAttribute(
                "aria-label",
                `Open ${entry.name}, ${entry.count} of ${entry.cap} ready`,
              );
            }
            if (typeof nameLink.addEventListener === "function") {
              nameLink.addEventListener("click", openNote(entry.path));
              nameLink.addEventListener("mouseover", (event) => {
                try {
                  const workspace = this.app && this.app.workspace;
                  if (
                    workspace &&
                    typeof workspace.trigger === "function"
                  ) {
                    workspace.trigger("hover-link", {
                      event,
                      source: "bob-plan",
                      hoverParent: row,
                      targetEl: nameLink,
                      linktext: entry.path,
                      sourcePath: sourcePath || "",
                    });
                  }
                } catch (error) {
                  // Hover preview is best-effort only.
                }
              });
            }
          }
        } catch (error) {
          // Name link is best-effort only.
        }
        try {
          if (typeof row.createSpan === "function") {
            row.createSpan({
              cls: "bob-ready-notes-fraction",
              text: `${entry.count}/${entry.cap}`,
            });
          } else if (typeof row.createEl === "function") {
            row.createEl("span", {
              cls: "bob-ready-notes-fraction",
              text: `${entry.count}/${entry.cap}`,
            });
          }
        } catch (error) {
          // Fraction is best-effort only.
        }
        try {
          const barModel = noteReadyBarModel(entry.count, entry.cap);
          const bar =
            typeof row.createDiv === "function"
              ? row.createDiv({ cls: "bob-ready-bar" })
              : null;
          if (bar) {
            if (typeof bar.setAttribute === "function") {
              bar.setAttribute(
                "aria-hidden",
                "true",
              );
            }
            for (let index = 0; index < barModel.total; index += 1) {
              try {
                const cell =
                  typeof bar.createSpan === "function"
                    ? bar.createSpan({
                        cls:
                          "bob-ready-cell" +
                          (index >= barModel.capAt ? " is-over" : "") +
                          (index === barModel.capAt - 1 ? " is-cap" : ""),
                      })
                    : typeof bar.createEl === "function"
                      ? bar.createEl("span", {
                          cls:
                            "bob-ready-cell" +
                            (index >= barModel.capAt ? " is-over" : "") +
                            (index === barModel.capAt - 1 ? " is-cap" : ""),
                        })
                      : null;
                if (cell && typeof cell.setAttribute === "function") {
                  cell.setAttribute("aria-hidden", "true");
                }
              } catch (error) {
                // One cell never breaks the row.
              }
            }
          }
        } catch (error) {
          // Bar is best-effort only.
        }
        try {
          if (
            entry.state === "crowded" &&
            typeof row.createSpan === "function"
          ) {
            const pill = row.createSpan({
              cls: "bob-ready-over-pill",
              text: `+${entry.over_by}`,
            });
            if (pill && typeof pill.setAttribute === "function") {
              pill.setAttribute(
                "aria-label",
                `${entry.over_by} over the cap`,
              );
            }
          } else if (
            entry.state === "crowded" &&
            typeof row.createEl === "function"
          ) {
            row.createEl("span", {
              cls: "bob-ready-over-pill",
              text: `+${entry.over_by}`,
            });
          }
        } catch (error) {
          // Pill is best-effort only.
        }
        try {
          const makeUp =
            entry.make_up && typeof entry.make_up === "object"
              ? entry.make_up
              : null;
          const meta =
            `${entry.kind}` +
            (entry.parent ? ` · ${entry.parent}` : "") +
            (makeUp && Number.isInteger(makeUp.new)
              ? ` · ${makeUp.new} new`
              : "") +
            (Number.isInteger(entry.recurring) && entry.recurring > 0
              ? ` · ↻ ${entry.recurring}`
              : "");
          if (typeof row.createSpan === "function") {
            row.createSpan({ cls: "bob-ready-notes-meta", text: meta });
          } else if (typeof row.createEl === "function") {
            row.createEl("span", {
              cls: "bob-ready-notes-meta",
              text: meta,
            });
          }
        } catch (error) {
          // Meta is best-effort only.
        }
      };
      for (const entry of crowded.concat(full)) {
        try {
          paintRow(entry);
        } catch (error) {
          // One row never breaks the block.
        }
      }
      if (room.length > 0 && typeof container.createDiv === "function") {
        try {
          const roomWrap = container.createDiv({
            cls: "bob-ready-notes-room",
          });
          for (const entry of room) {
            try {
              const pill =
                typeof roomWrap.createEl === "function"
                  ? roomWrap.createEl("a", {
                      cls: "internal-link bob-ready-room-pill",
                      text: `${entry.name} ${entry.count}`,
                      href: entry.path,
                    })
                  : null;
              if (pill) {
                if (typeof pill.setAttribute === "function") {
                  pill.setAttribute(
                    "title",
                    `${entry.name} · ${entry.count}/${entry.cap} · room`,
                  );
                  pill.setAttribute(
                    "aria-label",
                    `Open ${entry.name}, ${entry.count} of ${entry.cap} ready`,
                  );
                }
                if (typeof pill.addEventListener === "function") {
                  pill.addEventListener("click", openNote(entry.path));
                }
              }
            } catch (error) {
              // One pill never breaks the block.
            }
          }
        } catch (error) {
          // Room pills are best-effort only.
        }
      }
      if (exempt.length > 0 && typeof container.createDiv === "function") {
        try {
          const exemptWrap = container.createDiv({
            cls: "bob-ready-notes-exempt",
          });
          for (const entry of exempt) {
            try {
              if (typeof exemptWrap.createSpan === "function") {
                exemptWrap.createSpan({
                  cls: "bob-ready-exempt-pill",
                  text: `${entry.name} ${entry.count} · no cap`,
                });
              } else if (typeof exemptWrap.createEl === "function") {
                exemptWrap.createEl("span", {
                  cls: "bob-ready-exempt-pill",
                  text: `${entry.name} ${entry.count} · no cap`,
                });
              }
            } catch (error) {
              // One pill never breaks the block.
            }
          }
        } catch (error) {
          // Exempt pills are best-effort only.
        }
      }
      if (typeof container.createDiv === "function") {
        try {
          const totals = snapshot.totals || {};
          const recurring = Number.isInteger(totals.recurring)
            ? totals.recurring
            : 0;
          container.createDiv({
            cls: "bob-ready-notes-footer",
            text:
              `${emptyCount} empty · ↻ ${recurring} recurring · ` +
              "clear CROWDED by splitting, sequencing, deferring, or dropping work",
          });
        } catch (error) {
          // Footer is best-effort only.
        }
      }
    } catch (error) {
      // Block paint never throws.
    }
  }

  refreshReadyNotesBlocks() {
    if (!this.readyNotesViews || this.readyNotesViews.size === 0) {
      return false;
    }
    let refreshed = false;
    for (const view of Array.from(this.readyNotesViews)) {
      try {
        if (!view || !view.el) {
          this.readyNotesViews.delete(view);
          continue;
        }
        this.paintReadyNotesBlock(view.el, view.sourcePath);
        refreshed = true;
      } catch (error) {
        // One stale block never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleReadyNotesRefresh() {
    if (
      this.readyNotesRefreshTimer !== null &&
      this.readyNotesRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.readyNotesRefreshTimer = schedule(() => {
      this.readyNotesRefreshTimer = null;
      try {
        this.refreshReadyNotesBlocks();
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }


  // --- Crowded chip views (moved from BobLedgerToolsNoteReadyMixin) ---
  // Live `renderCrowdedChip` plus in-place refresh. All members are
  // synchronous, never throw, and follow the widget-Set pattern with
  // unload cleanup.

  paintCrowdedChipElement(host, model, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const safe =
        model && typeof model === "object"
          ? model
          : noteReadyCrowdedChipModel(null);
      const anchor = host.createEl("a", {
        cls:
          `bob-plan-chip bob-plan-crowded` +
          `${safe.over ? " bob-plan-over" : ""}` +
          `${safe.placeholder ? " bob-plan-unavailable" : ""}` +
          `${safe.calm ? " bob-plan-calm" : ""}`,
        title: safe.tooltip,
        href: "crowded",
      });
      const countModel = {
        count: safe.placeholder ? null : safe.crowded,
        cap: safe.placeholder ? null : safe.crowded,
        over: Boolean(safe.over),
        placeholder: Boolean(safe.placeholder),
        tooltip: safe.tooltip,
        aria: safe.aria,
      };
      setReadyAnchorContent(
        anchor,
        countModel,
        { kind: "crowded", label: NOTE_READY_CROWDED_LABEL },
      );
      // Value span shows the chip value (`4`, `0 ✓`, `–`): rewrite it
      // from the count/cap fraction the shared routine writes.
      try {
        const valueSpan = findReadySpan(anchor, READY_VALUE_CLS);
        if (valueSpan) {
          setReadySpanText(valueSpan, safe.valueText);
        }
      } catch (error) {
        // Value rewrite is best-effort only.
      }
      // `↗` arrow span with aria-hidden, appended once and preserved
      // across in-place refreshes.
      try {
        let arrow = null;
        if (typeof anchor.querySelector === "function") {
          arrow = anchor.querySelector(".bob-plan-crowded-arrow");
        }
        if (!arrow && Array.isArray(anchor.children)) {
          arrow = anchor.children.find(
            (child) =>
              child &&
              child.attrs &&
              child.attrs.class &&
              String(child.attrs.class).indexOf("bob-plan-crowded-arrow") !==
                -1,
          );
        }
        if (!arrow && typeof anchor.createSpan === "function") {
          arrow = anchor.createSpan({
            cls: "bob-plan-crowded-arrow",
            text: NOTE_READY_CROWDED_ARROW,
          });
        } else if (!arrow && typeof anchor.createEl === "function") {
          arrow = anchor.createEl("span", {
            cls: "bob-plan-crowded-arrow",
            text: NOTE_READY_CROWDED_ARROW,
          });
        }
        if (arrow && typeof arrow.setAttribute === "function") {
          arrow.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        // Arrow is best-effort only.
      }
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", safe.aria);
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
          if (
            workspace &&
            typeof workspace.openLinkText === "function"
          ) {
            const newLeaf = Boolean(
              event && (event.ctrlKey || event.metaKey),
            );
            workspace.openLinkText("crowded", sourcePath, newLeaf);
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
                linktext: "crowded",
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

  renderCrowdedChip(host, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const component = options.component || null;
      if (!this.crowdedWidgets) {
        this.crowdedWidgets = new Set();
      }
      if (component) {
        for (const widget of Array.from(this.crowdedWidgets)) {
          if (widget.component === component) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (
                widget.el &&
                typeof widget.el.remove === "function"
              ) {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.crowdedWidgets.delete(widget);
          }
        }
      }
      for (const widget of Array.from(this.crowdedWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            if (!host.contains || !host.contains(el)) {
              this.crowdedWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      let snapshot = null;
      try {
        snapshot = this.noteReadyEnsureSnapshot(new Date());
      } catch (error) {
        snapshot = null;
      }
      const model = noteReadyCrowdedChipModel(snapshot);
      const anchor = this.paintCrowdedChipElement(host, model, {
        sourcePath,
      });
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, sourcePath, component };
      this.crowdedWidgets.add(widget);
      if (component && typeof component.register === "function") {
        try {
          component.register(() => {
            this.crowdedWidgets.delete(widget);
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

  refreshCrowdedChips(now = new Date()) {
    if (!this.crowdedWidgets || this.crowdedWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    let snapshot = null;
    try {
      snapshot = this.noteReadyEnsureSnapshot(now);
    } catch (error) {
      snapshot = null;
    }
    const model = noteReadyCrowdedChipModel(snapshot);
    for (const widget of Array.from(this.crowdedWidgets)) {
      try {
        const el = widget.el;
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          if (!el || !el.isConnected) {
            this.crowdedWidgets.delete(widget);
          }
          continue;
        }
        const countModel = {
          count: model.placeholder ? null : model.crowded,
          cap: model.placeholder ? null : model.crowded,
          over: Boolean(model.over),
          placeholder: Boolean(model.placeholder),
          tooltip: model.tooltip,
          aria: model.aria,
        };
        // In-place refresh: keep the anchor (and its listeners) and
        // rewrite spans, title, aria, and state classes without
        // flicker. Never assigns `.text` on the live element.
        setReadyAnchorContent(el, countModel, {
          kind: "crowded",
          label: NOTE_READY_CROWDED_LABEL,
        });
        try {
          const valueSpan = findReadySpan(el, READY_VALUE_CLS);
          if (valueSpan) {
            setReadySpanText(valueSpan, model.valueText);
          }
        } catch (error) {
          // One stale widget never breaks the others.
        }
        try {
          if (el && typeof el.setAttribute === "function") {
            el.setAttribute("title", model.tooltip);
            el.setAttribute("aria-label", model.aria);
          }
        } catch (error) {
          // Best-effort label refresh only.
        }
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleCrowdedRefresh() {
    if (
      this.crowdedRefreshTimer !== null &&
      this.crowdedRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.crowdedRefreshTimer = schedule(() => {
      this.crowdedRefreshTimer = null;
      try {
        this.refreshCrowdedChips(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

}
