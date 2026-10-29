class BobLedgerToolsRelationModelMixin {
  // Feature-detect nav `api.relations` v1. The real namespace ships at
  // v0 (`removeLink` works, `openStage` settles unavailable) until
  // nav-linked-from raises it; chips stay navigation-only until then
  // (LC11). Tests exercise controls against a fake v1 api.
  relationsNavApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
      const api = nav ? nav.api : null;
      const relations = api && api.relations;
      if (relations && typeof relations === "object" && Number(relations.version) >= 1) {
        return relations;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  relationLookupTask(path, blockId) {
    try {
      const id = String(blockId || "").trim().replace(/^\^/u, "");
      if (!path || !id) return null;
      const index = this.dependencyTasksIndex();
      const task = index.get(String(path) + "\u0000" + id) || null;
      return task && task.isTask === false ? null : task;
    } catch (error) {
      return null;
    }
  }

  relationResolveLinkpath(linkpath, sourcePath) {
    try {
      const raw = String(linkpath || "").trim();
      if (!raw) return String(sourcePath || "");
      const resolved = this.dependencyResolveLink(raw, sourcePath);
      return String((resolved && resolved.path) || "");
    } catch (error) {
      return String(sourcePath || "");
    }
  }

  // Row model for one stored relation line. `owner` is the parent task
  // `{ blockId, text, line }` (line 1-based) or null. Live edges come
  // from `api.relationIndex`, never the stored mirror. Returns null for
  // malformed and not-a-line rows (LC13).
  relationChipModelForLine({ path, text, owner }) {
    try {
      const sourcePath = String(path || "");
      if (!sourcePath || typeof text !== "string") return null;
      const parsed = parseTaskRelationLine(text);
      if (!parsed || (parsed.verdict !== "accepted" && parsed.verdict !== "empty")) return null;
      const direction = parsed.kind === "links" ? "to" : "from";
      let api = null;
      try {
        api = typeof this.relationIndexApi === "function" ? this.relationIndexApi() : null;
      } catch (error) {
        api = null;
      }
      const self = this;
      const lookup = (linkpath, blockId) => self.relationLookupTask(linkpath, blockId);
      const resolve = (linkpath) => self.relationResolveLinkpath(linkpath, sourcePath);
      let live = [];
      try {
        if (api) {
          if (direction === "to") {
            const rows = self.relationIndexOutgoingForOwner(api, sourcePath, owner);
            live = rows.map((edge) => ({
              label: edge && edge.label,
              other: {
                path: edge && edge.target ? edge.target.path : "",
                blockId: edge && edge.target ? edge.target.blockId : "",
                resolved: edge && edge.target ? Boolean(edge.target.resolved) : false,
                task: edge && edge.target && edge.target.path
                  ? self.relationLookupTask(edge.target.path, edge.target.blockId)
                  : null,
                fallback: edge && edge.target ? edge.target : null,
              },
            }));
          } else {
            const hasLinkedFromV2 = typeof api.linkedFrom === "function";
            const rows = owner && owner.blockId
              ? (hasLinkedFromV2 ? api.linkedFrom(sourcePath, owner.blockId) : api.incoming(sourcePath, owner.blockId))
              : [];
            live = (Array.isArray(rows) ? rows : []).map((edge) => {
              const source = edge && edge.source ? edge.source : null;
              const other = source || {};
              return {
                kind: edge && edge.kind === "mention" ? "mention" : "relation",
                label: edge && edge.kind === "mention" ? "💬 mentions" : edge && edge.label,
                alsoMentioned: Boolean(edge && edge.alsoMentioned),
                display: edge && edge.display,
                count: edge && edge.count,
                occurrences: Array.isArray(edge && edge.occurrences) ? edge.occurrences : [],
                other: {
                  path: other.path || "",
                  blockId: other.blockId || "",
                  // linkedFrom() and incoming() expose only resolved sources.
                  resolved: true,
                  task: other.path
                    ? self.relationLookupTask(other.path, other.blockId)
                    : null,
                  fallback: source,
                },
              };
            });
          }
        }
      } catch (error) {
        live = [];
      }
      // Index rows carry raw note text when the Tasks memo omits the
      // note (done/ archives); surface it when memo lookup misses.
      for (const row of live) {
        try {
          if (row && row.other && !row.other.task && row.other.fallback) {
            const fallback = row.other.fallback;
            if (fallback && (fallback.text || fallback.status)) {
              row.other.task = { path: fallback.path, blockId: fallback.blockId, text: fallback.text, status: fallback.status };
            }
          }
        } catch (error) {
          continue;
        }
      }
      return relationChipModelForRow({ direction, lineText: text, sourcePath, live, lookup, resolve });
    } catch (error) {
      return null;
    }
  }

  relationIndexOutgoingForOwner(api, sourcePath, owner) {
    try {
      if (!api || typeof api.outgoing !== "function") return [];
      if (owner && owner.blockId) {
        const rows = api.outgoing(sourcePath, owner.blockId);
        if (Array.isArray(rows)) return rows;
      }
      if (owner && typeof owner.text === "string" && owner.text) {
        const rows = api.outgoing(sourcePath, owner.text);
        if (Array.isArray(rows) && rows.length > 0) return rows;
      }
      if (owner && Number.isInteger(owner.line)) {
        const rows = api.outgoing(sourcePath, owner.line);
        if (Array.isArray(rows)) return rows;
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  relationChipsAvailable() {
    try {
      return Boolean(ViewPlugin && Decoration && WidgetType && RangeSetBuilder && editorInfoField && editorLivePreviewField && RelationChipWidget);
    } catch (error) {
      return false;
    }
  }

  createRelationChipExtension() {
    try {
      if (!this.relationChipsAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function" || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const RelationPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildRelationChipDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.relationChipShouldRebuild(update)) {
              this.decorations = plugin.buildRelationChipDecorations(update.view);
            }
          } catch (error) {
            // Keep the previous decorations if a single refresh fails.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(RelationPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  relationChipShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      const refresh = ensureDependencyChipsRefresh();
      const transactions = update.transactions || [];
      for (const transaction of transactions) {
        const effects = transaction && transaction.effects;
        for (const effect of Array.isArray(effects) ? effects : (effects ? [effects] : [])) {
          if (effect === refresh || (refresh && effect && typeof effect.is === "function" && effect.is(refresh))) {
            return true;
          }
        }
      }
      if (editorLivePreviewField && update.startState && update.state) {
        try {
          if (update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) {
            return true;
          }
        } catch (error) {
          // A missing field is not a reason to force a rebuild.
        }
      }
      if (editorInfoField && update.startState && update.state) {
        try {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          if ((before && before.file && before.file.path) !== (after && after.file && after.file.path)) {
            return true;
          }
        } catch (error) {
          // A missing field is not a reason to force a rebuild.
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildRelationChipDecorations(view) {
    try {
      if (!this.dependencyChipsEnabled || !Decoration || !RangeSetBuilder || !RelationChipWidget || !editorInfoField || !editorLivePreviewField) {
        return Decoration.none;
      }
      const live = view.state.field(editorLivePreviewField);
      if (!live) {
        return Decoration.none;
      }
      const info = view.state.field(editorInfoField);
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!path) {
        return Decoration.none;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") {
        return Decoration.none;
      }
      const builder = new RangeSetBuilder();
      const ranges = Array.isArray(view.visibleRanges) ? view.visibleRanges : [];
      const selections = (view.state.selection && view.state.selection.ranges) || [];
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      let tree = null;
      try {
        tree = syntaxTree && typeof syntaxTree === "function" ? syntaxTree(view.state) : syntaxTree;
      } catch (error) {
        tree = null;
      }
      for (const range of ranges) {
        if (!range || typeof range.from !== "number") {
          continue;
        }
        let pos = Math.max(0, range.from);
        const end = Math.min(typeof range.to === "number" ? range.to : docLength, docLength);
        let guard = 0;
        while (pos <= end && guard < 10000) {
          guard += 1;
          let line = null;
          try {
            line = doc.lineAt(pos);
          } catch (error) {
            break;
          }
          if (!line || typeof line.text !== "string") {
            break;
          }
          try {
            // Cheap prefilter before the line parser (Rule 9 wiring).
            if (line.text.indexOf("🪢") !== -1 || line.text.indexOf("LINKS") !== -1 || line.text.indexOf("LINKED FROM") !== -1 || line.text.indexOf("BACKLINKS") !== -1) {
              const parsed = parseTaskRelationLine(line.text);
              if (parsed && (parsed.verdict === "accepted" || parsed.verdict === "empty")) {
                const number = typeof line.number === "number" ? line.number : null;
                const owner = number !== null ? relationOwnerTaskLineAtDoc(doc, number) : null;
                const revealed = selections.some((selection) => selection && selection.from <= line.to && selection.to >= line.from);
                const inCode = tree ? freshnessMarkPosInCode(tree, line.from) : false;
                if (owner && !revealed && !inCode) {
                  const model = this.relationChipModelForLine({ path, text: line.text, owner });
                  if (model && model.chips.length > 0) {
                    const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line.text);
                    const from = line.from + (marker ? marker[0].length : 0);
                    const lineNumber = number === null ? null : number - 1;
                    const interactive = Boolean(this.relationsNavApi());
                    builder.add(from, line.to, Decoration.replace({
                      widget: new RelationChipWidget(model, {
                        plugin: this,
                        sourcePath: path,
                        lineNumber,
                        interactive,
                        direction: model.direction,
                        ownerBlockId: owner.blockId || null,
                      }),
                    }));
                  }
                }
              }
            }
          } catch (error) {
            // Ignore a single row and continue through the visible range.
          }
          if (typeof line.to !== "number" || line.to >= end || line.to < pos) {
            break;
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    } catch (error) {
      try {
        return Decoration.none;
      } catch (inner) {
        return null;
      }
    }
  }

  relationRemoveLink(chip, sourcePath, meta) {
    try {
      const api = this.relationsNavApi();
      if (!api || typeof api.removeLink !== "function") return;
      const info = meta && typeof meta === "object" ? meta : {};
      let sourceRef = null;
      let targetRef = null;
      if (chip && chip.direction === "from") {
        // LINKED FROM × removes the edge from the other task's LINKS
        // line (decision `linked_from_remove = yes`); the notice names
        // the source note.
        sourceRef = { path: String(chip.path || ""), line: null, blockId: chip.blockId || null };
        targetRef = { path: String(sourcePath || ""), line: Number.isInteger(info.lineNumber) ? info.lineNumber : null, blockId: info.ownerBlockId || null };
      } else {
        sourceRef = { path: String(sourcePath || ""), line: Number.isInteger(info.lineNumber) ? info.lineNumber : null, blockId: info.ownerBlockId || null };
        targetRef = { path: chip ? String(chip.path || "") : "", blockId: chip ? chip.blockId || null : null };
      }
      Promise.resolve(api.removeLink(sourceRef, targetRef)).then((result) => {
        if (result && result.ok === false && result.reason) {
          try {
            new Notice(String(result.reason));
          } catch (noticeError) {
            // Success notices come from nav.
          }
        }
      });
    } catch (error) {
      // Best-effort.
    }
  }

  relationOpenStage(sourcePath, meta) {
    try {
      const api = this.relationsNavApi();
      if (!api || typeof api.openStage !== "function") return;
      const info = meta && typeof meta === "object" ? meta : {};
      const ref = {
        path: String(sourcePath || ""),
        line: Number.isInteger(info.lineNumber) ? info.lineNumber : null,
        direction: info.direction === "from" ? "from" : "to",
      };
      Promise.resolve(api.openStage(ref));
    } catch (error) {
      // Best-effort.
    }
  }
}

// Nearest list-item parent line for a relation row: only a direct child
// of a `#task` line counts (docs/task-relations.md §3.5). Returns
// `{ text, blockId, line }` (line 1-based) or null.
function relationOwnerTaskLineAtDoc(doc, lineNumber) {
  try {
    if (!doc || typeof doc.line !== "function" || !Number.isInteger(lineNumber)) return null;
    const child = doc.line(lineNumber);
    const childIndent = /^\s*/.exec(child.text)[0].replace(/\t/g, "    ").length;
    for (let current = lineNumber - 1; current >= 1; current -= 1) {
      const line = doc.line(current);
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line.text)) continue;
      const indent = /^\s*/.exec(line.text)[0].replace(/\t/g, "    ").length;
      if (indent < childIndent) {
        // Sources are checkbox `#task` lines, as the live index requires.
        if (!dependencyChipIsTaskLine(line.text)) return null;
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line.text);
        const blockId = match && RELATION_BLOCK_ID_RE.test(match[1]) ? match[1] : null;
        return { text: line.text, blockId, line: current };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Raw-lines twin for the Reading view. `lines` is the note split on
// `\n`; `childIndex` is 0-based.
function relationOwnerTaskLine(lines, childIndex) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(childIndex)) return null;
    const child = String(lines[childIndex] || "");
    const childIndent = /^\s*/.exec(child)[0].replace(/\t/g, "    ").length;
    for (let index = childIndex - 1; index >= 0; index -= 1) {
      const line = String(lines[index] || "");
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) continue;
      const indent = /^\s*/.exec(line)[0].replace(/\t/g, "    ").length;
      if (indent < childIndent) {
        // Sources are checkbox `#task` lines, as the live index requires.
        if (!dependencyChipIsTaskLine(line)) return null;
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
        const blockId = match && RELATION_BLOCK_ID_RE.test(match[1]) ? match[1] : null;
        return { text: line, blockId, line: index + 1 };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}
