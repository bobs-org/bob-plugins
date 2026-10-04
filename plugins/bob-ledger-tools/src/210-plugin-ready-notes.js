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

}
