// --- Ledger frees marks: pure mark-core ----------------------------------
// A display-only echo of the BLOCKS last-blocker set, shown after an
// eligible Task Link in today's open Pomodoros. Counts and order come
// from the same Tasks memo and helpers as BLOCKS. Never writes and never
// throws; a cold or uncertain snapshot produces no mark.

const FREES_MARK_KEY = "🔑";

function freesMarkTaskId(task) {
  try {
    const value = task && task.id;
    return typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : null;
  } catch (error) {
    return null;
  }
}

function freesMarkTaskPath(task) {
  try {
    return String(planTaskPath(task) || "");
  } catch (error) {
    return "";
  }
}

function freesMarkTaskBlockId(task) {
  try {
    return String(planTaskBlockId(task) || "");
  } catch (error) {
    return "";
  }
}

function freesMarkTaskKey(task) {
  try {
    const path = freesMarkTaskPath(task);
    const blockId = freesMarkTaskBlockId(task);
    return path && blockId ? path + "\u0000" + blockId : "";
  } catch (error) {
    return "";
  }
}

function freesMarkTaskTitle(task) {
  try {
    const raw = planTaskDescription(task) || "";
    return dependencyCleanTaskText(raw) || ("^" + freesMarkTaskBlockId(task));
  } catch (error) {
    return "^" + freesMarkTaskBlockId(task);
  }
}

function freesMarkProjectName(task) {
  try {
    const path = freesMarkTaskPath(task);
    const name = path.split("/").pop() || "project";
    return name.replace(/\.md$/i, "");
  } catch (error) {
    return "project";
  }
}

function freesMarkTaskNote(task, dailyPath) {
  try {
    const path = freesMarkTaskPath(task);
    if (!path) {
      return "this note";
    }
    if (dailyPath) {
      try {
        if (sameVaultPath(path, dailyPath)) {
          return "this note";
        }
      } catch (error) {
        if (path === dailyPath) {
          return "this note";
        }
      }
    }
    return (path.split("/").pop() || path).replace(/\.md$/i, "");
  } catch (error) {
    return "this note";
  }
}

// `owner` is the linked task X, not a dependent. Its own `[id::]` is
// the BLOCKS reverse-index key. `freed` is sorted exactly as the
// owner's BLOCKS row sorts new canonical links. Invalid owners return
// null; a valid owner with no dependents returns a zero-count model.
function freesMarkCount(owner, memo, today) {
  try {
    const tasks = memo && Array.isArray(memo.tasks) ? memo.tasks : [];
    if (tasks.length === 0 || !owner || !blocksTaskIsOpen(owner)) {
      return null;
    }
    const ownerId = freesMarkTaskId(owner);
    if (!ownerId) {
      return null;
    }
    const ownerKey = freesMarkTaskKey(owner);
    const live = (blocksDependentsIndex(memo).get(ownerId) || []).filter(
      (dependent) => {
        if (dependent === owner) {
          return false;
        }
        const key = freesMarkTaskKey(dependent);
        return !ownerKey || !key || key !== ownerKey;
      },
    );
    const freed = [];
    for (const dependent of live) {
      try {
        const result = blocksLastBlocker(
          dependent,
          owner,
          memo,
          today || (memo && memo.dateText),
        );
        if (result && result.lastBlocker) {
          freed.push(dependent);
        }
      } catch (error) {
        // A malformed dependent is waiting, not a promise the mark can make.
      }
    }
    const sourcePath = freesMarkTaskPath(owner);
    const ordered = blocksSortLinks(
      freed.map((task) => ({
        task,
        linktext: blocksCanonicalLinktext(task, sourcePath),
      })),
    ).map((row) => row.task);
    return {
      count: ordered.length,
      waiting: Math.max(0, live.length - ordered.length),
      freed: ordered,
    };
  } catch (error) {
    return null;
  }
}

// Return a link's unique Tasks-cache target. The existing glyph resolver
// supplies the path/block-id matching rules; this wrapper also refuses
// duplicate matches so uncertainty stays neutral.
function freesMarkLinkedTask(index, target, blockId, dailyPath) {
  try {
    const bucket =
      index && index.byBlock instanceof Map
        ? index.byBlock.get(String(blockId || ""))
        : null;
    if (!Array.isArray(bucket) || bucket.length === 0) {
      return null;
    }
    const matches = bucket.filter((task) => {
      try {
        if (!task || task.isTask === false) {
          return false;
        }
        if (
          task.status &&
          typeof task.status === "object" &&
          task.status.type === "NON_TASK"
        ) {
          return false;
        }
        return unblockedGlyphTargetMatches(
          freesMarkTaskPath(task),
          target,
          dailyPath,
        );
      } catch (error) {
        return false;
      }
    });
    const name = String(target || "");
    const withMd = /\.md$/i.test(name) ? name : name + ".md";
    const exact = name
      ? matches.filter((task) => {
          const path = freesMarkTaskPath(task);
          return path === name || path === withMd;
        })
      : [];
    const selected = exact.length > 0 ? exact : matches;
    if (selected.length !== 1) {
      return null;
    }
    const resolved = unblockedGlyphLinkedTask(
      index,
      target,
      blockId,
      dailyPath,
    );
    return resolved === selected[0] ? resolved : null;
  } catch (error) {
    return null;
  }
}

function freesMarkLinkEndCh(lineText) {
  try {
    const bullet = todayBulletBody(String(lineText || ""));
    if (!bullet) {
      return null;
    }
    const match = progressMarkMatchFromBody(bullet.body);
    if (!match || !match.token) {
      return null;
    }
    return bullet.bodyStart + match.prefix + match.token.end;
  } catch (error) {
    return null;
  }
}

// Internal candidate model includes eligible zero-count links so the
// Live Preview LRU can notice a later 0 → N change. Public
// `freesMarkLinks` filters these to visible marks only.
function freesMarkCandidateLinks(lines, memo, today, options) {
  try {
    const content = Array.isArray(lines)
      ? lines.map((line) => String(line || "")).join("\n")
      : typeof lines === "string"
        ? lines
        : "";
    if (!content || !memo || !Array.isArray(memo.tasks) || memo.tasks.length === 0) {
      return [];
    }
    const dailyPath =
      options && typeof options.dailyPath === "string"
        ? options.dailyPath
        : null;
    const links = progressMarkLinks(content);
    if (links.length === 0) {
      return [];
    }
    const index = unblockedGlyphIndex(memo.tasks);
    const rows = content.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    for (const link of links) {
      try {
        const linked = freesMarkLinkedTask(
          index,
          link.target,
          link.blockId,
          dailyPath,
        );
        if (!linked || !blocksTaskIsOpen(linked) || !freesMarkTaskId(linked)) {
          continue;
        }
        const count = freesMarkCount(linked, memo, today);
        if (!count) {
          continue;
        }
        const line = Number(link.line);
        const ch = Number.isInteger(line) ? freesMarkLinkEndCh(rows[line]) : null;
        if (!Number.isInteger(ch)) {
          continue;
        }
        out.push({
          line: link.line,
          ch,
          target: link.target,
          blockId: link.blockId,
          count: count.count,
          waiting: count.waiting,
          freed: count.freed,
          dailyPath,
          linktext:
            (String(link.target || "") ? String(link.target) : "") +
            "#^" +
            String(link.blockId || ""),
        });
      } catch (error) {
        continue;
      }
    }
    return out;
  } catch (error) {
    return [];
  }
}

function freesMarkLinks(lines, memo, today, options) {
  try {
    return freesMarkCandidateLinks(lines, memo, today, options).filter(
      (entry) => entry.count >= 1,
    );
  } catch (error) {
    return [];
  }
}

function freesMarkTooltip(model) {
  try {
    const safe = model && typeof model === "object" ? model : {};
    const freed = Array.isArray(safe.freed) ? safe.freed : [];
    const count = Number.isInteger(safe.count) ? safe.count : freed.length;
    const waiting = Number.isInteger(safe.waiting) ? safe.waiting : 0;
    const lines = [
      "Closing this frees " + count + " task" + (count === 1 ? "" : "s"),
    ];
    for (const task of freed.slice(0, 3)) {
      try {
        const blockId = freesMarkTaskBlockId(task);
        if (blockId === "prj") {
          lines.push("• 🧩 " + freesMarkProjectName(task) + " project");
          continue;
        }
        let title = freesMarkTaskTitle(task).trim();
        if (title.length > 48) {
          title = title.slice(0, 47) + "…";
        }
        const note = freesMarkTaskNote(task, safe.dailyPath);
        let row = "• " + title + " · " + note;
        if (blocksTagPresent(task, "hide")) {
          row += " · hidden";
        }
        lines.push(row);
      } catch (error) {
        continue;
      }
    }
    if (count > 3) {
      lines.push("+" + (count - 3) + " more");
    }
    if (waiting > 0) {
      lines.push("Also blocks " + waiting + " waiting on other work");
    }
    return lines.join("\n").replace(/::/g, ":");
  } catch (error) {
    return "Closing this frees 0 tasks";
  }
}

function buildFreesMarkElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model) {
      return null;
    }
    const count = Number(model.count);
    const blockId = String(model.blockId || "");
    if (!Number.isInteger(count) || count < 1 || blockId === "") {
      return null;
    }
    const host = doc.createElement("span");
    host.setAttribute(
      "class",
      "bob-frees-mark" + (model.tick ? " bob-frees-mark-tick" : ""),
    );
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", freesMarkTooltip(model));
    host.setAttribute("data-tooltip-position", "top");
    host.setAttribute("data-count", String(count));
    host.setAttribute("data-block-id", blockId);
    const key = doc.createElement("span");
    key.setAttribute("class", "bob-frees-mark-key");
    key.textContent = FREES_MARK_KEY;
    host.appendChild(key);
    if (typeof doc.createTextNode === "function") {
      host.appendChild(doc.createTextNode(String(count)));
    } else {
      const text = doc.createElement("span");
      text.textContent = String(count);
      host.appendChild(text);
    }
    return host;
  } catch (error) {
    return null;
  }
}

let FreesMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  FreesMarkWidget = class extends WidgetType {
    constructor(model, sourcePath, tick, workspace) {
      super();
      this.model = model && typeof model === "object" ? { ...model } : {};
      this.model.tick = Boolean(tick);
      this.sourcePath = String(sourcePath || "");
      this.linktext = String(this.model.linktext || "");
      this.tooltip = freesMarkTooltip(this.model);
      this.workspace = workspace || null;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof FreesMarkWidget &&
        other.model.blockId === this.model.blockId &&
        other.model.count === this.model.count &&
        other.tooltip === this.tooltip
      );
    }

    toDOM(view) {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildFreesMarkElement(doc, this.model);
      if (!dom || typeof dom.addEventListener !== "function") {
        return dom;
      }
      dom.addEventListener("mousedown", (event) => {
        try {
          if (event && typeof event.button === "number" && event.button !== 0) {
            return;
          }
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (event && (event.metaKey || event.ctrlKey)) {
            let sourcePath = this.sourcePath;
            if (!sourcePath && editorInfoField && view && view.state) {
              try {
                const info = view.state.field(editorInfoField);
                sourcePath = String(info && info.file && info.file.path || "");
              } catch (error) {
                sourcePath = "";
              }
            }
            const workspace = this.workspace || null;
            if (workspace && typeof workspace.openLinkText === "function") {
              workspace.openLinkText(this.linktext, sourcePath, "tab");
            }
            return;
          }
          const anchor =
            view && typeof view.posAtDOM === "function"
              ? view.posAtDOM(dom)
              : null;
          if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
            view.dispatch({ selection: { anchor } });
          }
          if (view && typeof view.focus === "function") {
            view.focus();
          }
        } catch (error) {
          // The mark is read-only; cursor placement and navigation are best-effort.
        }
      });
      if (this.model.tick) {
        try {
          const schedule =
            typeof window !== "undefined" && typeof window.setTimeout === "function"
              ? window.setTimeout.bind(window)
              : setTimeout;
          schedule(() => {
            try {
              if (dom.classList && typeof dom.classList.remove === "function") {
                dom.classList.remove("bob-frees-mark-tick");
              } else if (typeof dom.setAttribute === "function") {
                dom.setAttribute("class", "bob-frees-mark");
              }
            } catch (error) {
              // Tick cleanup is cosmetic.
            }
          }, 400);
        } catch (error) {
          // The CSS animation still runs if no timer host is available.
        }
      }
      return dom;
    }
  };
}
