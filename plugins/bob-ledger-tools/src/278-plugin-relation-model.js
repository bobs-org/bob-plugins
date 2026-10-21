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

  // Block model for one task's stored relation lines. `owner` is the
  // parent task `{ blockId, text, line }` (line 1-based, blockId possibly
  // null); `lines` are the task's stored relation lines
  // `[{ text, lineNumber }]` (0-based doc positions in Live Preview,
  // 0-based source indexes in Reading view). Live edges come from
  // `api.relationIndex`, never the stored mirror: one `related()` call
  // per task keeps plain, outgoing, and incoming on the same generation,
  // falling back to `outgoing()` / `incoming()` when `related` is
  // missing. Returns null when no stored line parses (LC13) or the task
  // has no relations at all.
  relationBlockModelForOwner({ path, owner, lines }) {
    try {
      const sourcePath = String(path || "");
      if (!sourcePath || !owner || !Array.isArray(lines) || !lines.length) return null;
      let linksText = null;
      let linkedFromText = null;
      for (const row of lines) {
        if (!row || typeof row.text !== "string") continue;
        const parsed = parseTaskRelationLine(row.text);
        if (!parsed || (parsed.verdict !== "accepted" && parsed.verdict !== "empty")) continue;
        if (parsed.kind === "links") {
          if (linksText === null) linksText = row.text;
        } else if (linkedFromText === null) {
          linkedFromText = row.text;
        }
      }
      if (linksText === null && linkedFromText === null) return null;
      let api = null;
      try {
        api = typeof this.relationIndexApi === "function" ? this.relationIndexApi() : null;
      } catch (error) {
        api = null;
      }
      const self = this;
      const lookup = (linkpath, blockId) => self.relationLookupTask(linkpath, blockId);
      const resolve = (linkpath) => self.relationResolveLinkpath(linkpath, sourcePath);
      let grouped = null;
      if (api && typeof api.related === "function") {
        try {
          const ownerKey = (owner && owner.blockId)
            || (owner && owner.text)
            || (owner && Number.isInteger(owner.line) ? owner.line : "");
          const related = api.related(sourcePath, ownerKey);
          if (related && typeof related === "object") {
            const enrich = (item) => {
              const other = item && item.other ? item.other : null;
              if (!other) return null;
              return {
                label: item.label || null,
                storedOn: item.storedOn || null,
                other: {
                  path: String(other.path || ""),
                  blockId: String(other.blockId || ""),
                  line: other.line === undefined ? null : other.line,
                  text: other.text === undefined ? null : other.text,
                  status: other.status === undefined ? null : other.status,
                  resolved: other.resolved !== false,
                  archived: Boolean(other.archived),
                  task: self.relationLookupTask(other.path, other.blockId),
                },
              };
            };
            grouped = {
              plain: (Array.isArray(related.plain) ? related.plain : []).map(enrich).filter(Boolean),
              outgoing: (Array.isArray(related.outgoing) ? related.outgoing : []).map(enrich).filter(Boolean),
              incoming: (Array.isArray(related.incoming) ? related.incoming : []).map(enrich).filter(Boolean),
            };
          }
        } catch (error) {
          grouped = null;
        }
      }
      if (!grouped) {
        // No `related()` (older ledger): same view from the per-direction
        // calls. The block model groups them identically.
        let outgoing = [];
        let incoming = [];
        try {
          if (api) {
            const rows = self.relationIndexOutgoingForOwner(api, sourcePath, owner);
            outgoing = (Array.isArray(rows) ? rows : []).map((edge) => ({
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
            const back = owner && owner.blockId && typeof api.incoming === "function"
              ? api.incoming(sourcePath, owner.blockId)
              : [];
            incoming = (Array.isArray(back) ? back : []).map((edge) => ({
              label: edge && edge.label,
              other: {
                path: edge && edge.source ? edge.source.path : "",
                blockId: edge && edge.source ? edge.source.blockId : "",
                resolved: true,
                task: edge && edge.source && edge.source.path
                  ? self.relationLookupTask(edge.source.path, edge.source.blockId)
                  : null,
                fallback: edge && edge.source ? edge.source : null,
              },
            }));
          }
        } catch (error) {
          outgoing = [];
          incoming = [];
        }
        // Index rows carry raw note text when the Tasks memo omits the
        // note (done/ archives); surface it when memo lookup misses.
        for (const row of [...outgoing, ...incoming]) {
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
        return relationBlockModelForTask({ sourcePath, owner, linksText, linkedFromText, outgoing, incoming, lookup, resolve });
      }
      return relationBlockModelForTask({ sourcePath, owner, linksText, linkedFromText, grouped, lookup, resolve });
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
      // First pass: collect every parsed relation line with its owner.
      const hits = [];
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
                if (owner) {
                  hits.push({ line, number, owner, parsed });
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
      // Second pass: one aggregated block per owner. The first relation
      // line carries the full block; the second carries the incoming
      // statements as a continuation with no heading (LC18 fallback: a
      // block replace decoration must come from a StateField, which the
      // refresh fan-out cannot drive yet). Selecting either line reveals
      // both raw lines.
      const groups = relationGroupOwnerLines(hits, (hit) => relationIdentity(path, (hit.owner && hit.owner.blockId) || ("line:" + String(hit.owner && hit.owner.line))));
      for (const group of groups.values()) {
        try {
          const ordered = group.slice().sort((a, b) => (a.number || 0) - (b.number || 0));
          const revealed = ordered.some((hit) => selections.some((selection) => selection && selection.from <= hit.line.to && selection.to >= hit.line.from));
          if (revealed) continue;
          const owner = ordered[0].owner;
          const model = this.relationBlockModelForOwner({
            path,
            owner,
            lines: ordered.map((hit) => ({ text: hit.line.text, lineNumber: hit.number === null ? null : hit.number - 1 })),
          });
          if (!model || model.chips.length === 0) continue;
          const interactive = Boolean(this.relationsNavApi());
          const parsedLines = ordered.filter((hit) => hit.parsed && (hit.parsed.verdict === "accepted" || hit.parsed.verdict === "empty"));
          const first = parsedLines[0];
          const second = model.hasContinuation ? parsedLines[1] : null;
          const place = (hit, mode) => {
            if (!hit) return;
            const inCode = tree ? freshnessMarkPosInCode(tree, hit.line.from) : false;
            if (inCode) return;
            const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(hit.line.text);
            const from = hit.line.from + (marker ? marker[0].length : 0);
            const lineNumber = hit.number === null ? null : hit.number - 1;
            builder.add(from, hit.line.to, Decoration.replace({
              widget: new RelationChipWidget(model, {
                plugin: this,
                sourcePath: path,
                lineNumber,
                interactive,
                mode,
                ownerBlockId: owner.blockId || null,
                ownerLine: Number.isInteger(owner.line) ? owner.line : null,
              }),
            }));
          };
          place(first, "full");
          place(second, "continuation");
        } catch (error) {
          // Ignore a single task and continue through the visible range.
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

  // v2-aware × handler. A plain chip unlinks the pair through v2
  // `unlink(this, other)`; a statement chip removes that statement through
  // v2 `removeStatement(source, target)`. With nav v1 only, both fall back
  // to v1 `removeLink` on the storing side (plain chips at the
  // non-storing end remove the peer's record; a both-sides plain removes
  // each writable record in turn). Without nav there are no controls.
  relationRemoveLink(chip, sourcePath, meta) {
    try {
      const api = this.relationsNavApi();
      if (!api) return;
      const info = meta && typeof meta === "object" ? meta : {};
      const act = chip && chip.relAction && typeof chip.relAction === "object" ? chip.relAction : null;
      const viewer = {
        path: String(sourcePath || ""),
        line: Number.isInteger(info.lineNumber) ? info.lineNumber : null,
        blockId: info.ownerBlockId || null,
      };
      const peerPath = act && act.peer ? String(act.peer.path || "") : String((chip && chip.path) || "");
      const peerId = act && act.peer ? act.peer.blockId || null : (chip && chip.blockId) || null;
      const peer = { path: peerPath, line: null, blockId: peerId };
      const report = (promise) => {
        Promise.resolve(promise).then((result) => {
          if (result && result.ok === false && result.reason) {
            try {
              new Notice(String(result.reason));
            } catch (noticeError) {
              // Success notices come from nav.
            }
          }
        });
      };
      if (act && act.kind === "plain" && typeof api.unlink === "function") {
        report(api.unlink(viewer, peer));
        return;
      }
      if (act && act.kind === "statement" && typeof api.removeStatement === "function") {
        const outgoing = chip.direction !== "from";
        report(api.removeStatement(outgoing ? viewer : peer, outgoing ? peer : viewer));
        return;
      }
      if (typeof api.removeLink !== "function") return;
      const storingPeerSide = act
        ? (act.kind === "plain" ? act.storedOn === "other" : chip.direction === "from")
        : chip && chip.direction === "from";
      if (act && act.kind === "plain" && act.storedOn === "both") {
        // v1 removes one record per call; unlink both writable records.
        report(api.removeLink(viewer, peer));
        report(api.removeLink(peer, viewer));
        return;
      }
      if (storingPeerSide) {
        // × at the non-storing end removes the edge from the other
        // task's LINKS line; the notice names the source note.
        report(api.removeLink(peer, viewer));
      } else {
        report(api.removeLink(viewer, peer));
      }
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
        direction: "to",
      };
      Promise.resolve(api.openStage(ref));
    } catch (error) {
      // Best-effort.
    }
  }
}


// Group relation-line hits by owner task, preserving document order
// within each group. Shared by the Live Preview decorations and the
// Reading view renderer (LC18).
function relationGroupOwnerLines(items, keyFn) {
  const groups = new Map();
  const keyFor = typeof keyFn === "function" ? keyFn : () => "";
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    let key = "";
    try {
      key = String(keyFor(item) || "");
    } catch (error) {
      key = "";
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
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
