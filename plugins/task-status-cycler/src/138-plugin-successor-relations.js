// Managed-Done relation-index adapter for the successor planner. The index
// is discovery only: source and target text are read through the existing
// editor-first note reader before any relation can become an offer.

function successorRelationIndexFromApp(app) {
  try {
    const ledger = getSuccessorTaskLedgerApi(app);
    const index = ledger && ledger.relationIndex;
    if (
      !index || Number(index.version) < 2 ||
      typeof index.ready !== "function" ||
      typeof index.incoming !== "function" ||
      typeof index.outgoing !== "function"
    ) {
      return null;
    }
    return index;
  } catch (_error) {
    return null;
  }
}

function successorRelationConfiguredEdge(edge, labels) {
  if (!edge || typeof edge !== "object" || edge.kind !== "relation" || edge.struck === true) {
    return false;
  }
  const key = relationLabelKey(edge.label);
  return !!key && !!labels && Array.isArray(labels.keys) && labels.keys.includes(key);
}

function successorRelationEdgeKey(edge) {
  if (!edge) return "";
  const source = edge.source || {};
  const target = edge.target || {};
  return [
    relationIdentityKey(source.path, source.blockId, source.line),
    relationLabelKey(edge.label),
    relationIdentityKey(target.path, target.blockId, target.line),
  ].join("\0");
}

function successorRelationInputsNeedDependencySnapshot(options = {}, noteTexts = new Map()) {
  const candidates = Array.isArray(options.relationCandidates) ? options.relationCandidates : [];
  for (const edge of candidates) {
    const normalized = relationNormalizeEdge(edge);
    if (!normalized) continue;
    const source = relationLookupTask(
      normalized.source.path,
      normalized.source.blockId,
      normalized.source.line,
      noteTexts,
    );
    if (!source) continue;
    if ((Array.isArray(source.dependsOn) && source.dependsOn.length > 0) ||
        /\[dependsOn::/i.test(source.lineText || "")) {
      return true;
    }
    if (typeof project089Info === "function") {
      const project = project089Info(relationNoteText(noteTexts, normalized.source.path), normalized.source.path);
      if (project && (
        (Array.isArray(project.dependencyIds) && project.dependencyIds.length > 0) ||
        /\[dependsOn::/i.test(project.projectTask && project.projectTask.lineText || "")
      )) {
        return true;
      }
    }
  }
  return false;
}

function successorRelationResolveLinkPath(app, note, sourcePath, noteTexts) {
  const raw = String(note || "").split("|")[0].split("#")[0].trim();
  if (!raw) return sourcePath;
  try {
    const metadata = app && app.metadataCache;
    if (metadata && typeof metadata.getFirstLinkpathDest === "function") {
      const file = metadata.getFirstLinkpathDest(raw, sourcePath);
      if (file && file.path) return normalizeDependencyMarkdownPath(file.path);
    }
  } catch (_error) {
    // Fall through to the source-note resolver.
  }
  return relationResolveNotePath(raw, sourcePath, noteTexts);
}

function successorRelationSourceTaskMatches(task, edge) {
  const source = edge && edge.source ? edge.source : {};
  if (source.blockId) return String(task.blockId || "") === String(source.blockId);
  if (Number.isInteger(source.line)) {
    // relationIndex v2 lines follow the ledger-tools parser; tolerate its
    // one-based task-memo overlay while still requiring the indexed text.
    const lineMatches = task.line === source.line || task.line + 1 === source.line || task.line - 1 === source.line;
    if (lineMatches) return !source.text || String(task.lineText || "") === String(source.text);
  }
  return !!source.text && String(task.lineText || "") === String(source.text);
}

function successorRelationEdgeIsAuthored(app, edge, noteTexts) {
  try {
    const source = edge && edge.source ? edge.source : {};
    const path = normalizeDependencyMarkdownPath(source.path || "");
    const sourceText = relationNoteText(noteTexts, path);
    if (!path || !sourceText) return false;
    const tasks = parseTaskDependencyDocument(sourceText, path);
    const sourceTasks = tasks.filter((task) => successorRelationSourceTaskMatches(task, edge));
    if (sourceTasks.length !== 1) return false;
    const lines = sourceText.split(/\r?\n/);
    const task = sourceTasks[0];
    for (const child of relationDirectChildLines(lines, task.line)) {
      const match = RELATION_SUCCESSOR_LINKS_RE.exec(child.text);
      if (!match) continue;
      for (const parsed of relationParseLinksBody(match[2] || "")) {
        if (relationLabelKey(parsed.label) !== relationLabelKey(edge.label)) continue;
        if (String(parsed.blockId || "") !== String(edge.target && edge.target.blockId || "")) continue;
        const targetPath = successorRelationResolveLinkPath(app, parsed.note, path, noteTexts);
        if (
          targetPath &&
          normalizeDependencyMarkdownPath(targetPath) ===
            normalizeDependencyMarkdownPath(edge.target && edge.target.path || "")
        ) {
          return true;
        }
      }
    }
    return false;
  } catch (_error) {
    return false;
  }
}

function successorRelationNoticeTarget(row) {
  const relation = row && row.relation && typeof row.relation === "object" ? row.relation : {};
  const after = Array.isArray(relation.after) ? relation.after[0] : null;
  return after && typeof after === "object" ? after : {};
}

function successorRelationPickedNoticeRows(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.link || row.not_linked) continue;
    const relation = row.relation && typeof row.relation === "object" ? row.relation : {};
    const target = successorRelationNoticeTarget(row);
    const targetKey = relationIdentityKey(target.path || target.note_path, target.blockId || target.block_id);
    const label = String(relation.label || row.offer && row.offer.label || "");
    const key = `${relationLabelKey(relation.key || label)}\0${targetKey}`;
    if (!groups.has(key)) groups.set(key, { rows: [], relation, target });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map((group) => {
    const first = group.rows[0] || {};
    const relation = group.relation || {};
    const target = group.target || {};
    const text = String(target.text || first.offer && first.offer.afterText || "task");
    let notice = relationCopyLinkedNotice({
      count: group.rows.length,
      source: first.text,
      destination: first.link && first.link.entry_name || `line ${(first.link && first.link.line) || "?"}`,
      label: relation.label || first.offer && first.offer.label || "",
      target: text,
    });
    const after = Array.isArray(relation.after) ? relation.after : [];
    const suffix = after.length > 1
      ? relationCopySuffix(after.map((item) => item && item.text || "").filter(Boolean))
      : "";
    if (suffix) notice += ` · ${suffix}`;
    return notice;
  }).filter(Boolean);
}

function successorRelationHeldNoticeRows(rows) {
  const notices = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.display === false) continue;
    const relation = row.relation && typeof row.relation === "object" ? row.relation : {};
    const target = successorRelationNoticeTarget(row);
    const notice = relationCopyHeldNotice({
      source: row.text,
      label: relation.label || "",
      target: target.text || "task",
      reason: row.reason,
      waits_on: row.waits_on,
      other_target: (row.waits_for_text || row.waits_for || []).map((value) => String(value || "task")).join(", "),
      date: row.scheduled,
    }, row.reason);
    if (notice) notices.push(notice);
  }
  return notices;
}

function successorRelationNoticeText(model, baseNotice) {
  const source = model && typeof model === "object" ? model : {};
  const base = String(baseNotice || "");
  const relationRows = Array.isArray(source.relation_successors) ? source.relation_successors : [];
  const picked = successorRelationPickedNoticeRows(relationRows);
  const normalRows = [
    ...(Array.isArray(source.unblocked) ? source.unblocked : []),
    ...(Array.isArray(source.keep_moving) ? source.keep_moving : []),
  ];
  const unpickedRelations = relationRows.filter((row) => row && (!row.link || row.not_linked));
  const hasOther = normalRows.length > 0;

  if (picked.length > 0 && hasOther) {
    const normalPicked = normalRows.filter((row) => row && row.link && !row.not_linked).length;
    const totalPicked = normalPicked + relationRows.filter((row) => row && row.link && !row.not_linked).length;
    const totalRows = normalRows.length + relationRows.length;
    if (totalPicked > 0 && totalPicked < totalRows) {
      return `🔓 Pulled in ${totalPicked} of ${totalRows}`;
    }
    if (base) return `${base} · 🪢 ${relationRows.filter((row) => row && row.link && !row.not_linked).length} relation linked`;
    return picked.join("\n");
  }
  if (picked.length > 0) {
    if (source.failure && Number(source.failure.count) > 0 && base) return base;
    return picked.join("\n");
  }

  if (source.relation_check === "unavailable") {
    const uncertainty = relationCopyUncertainty({ labels: source.relation_labels || [] });
    return base ? `${base}\n${uncertainty}` : uncertainty;
  }
  if (base) {
    if (source.relation_picker_opened === true) return base;
    const held = successorRelationHeldNoticeRows(source.relation_held);
    return held.length ? `${base}\n${held.join("\n")}` : base;
  }
  if (source.relation_picker_opened === true) return "";
  return successorRelationHeldNoticeRows(source.relation_held).join("\n");
}

class TaskStatusCyclerRelationSuccessorRuntimeMixin {
  prepareSuccessorRelationRuntime(active, cancelledClose, pickerApi) {
    const configOptions = active && active.relationConfig && typeof active.relationConfig === "object"
      ? active.relationConfig
      : {};
    let linkUnblocked = true;
    try {
      linkUnblocked = loadLinkUnblocked(configOptions) !== false;
    } catch (_error) {
      linkUnblocked = true;
    }
    if (cancelledClose) linkUnblocked = false;
    let labels = emptyRelationLabelList();
    if (!cancelledClose) {
      try {
        const config = loadRelationSuccessorLabels(configOptions);
        labels = config && config.successor ? config.successor : labels;
      } catch (_error) {
        labels = emptyRelationLabelList();
      }
    }
    const enabled = !cancelledClose && linkUnblocked &&
      Array.isArray(labels.keys) && labels.keys.length > 0 &&
      !!pickerApi && Number(pickerApi.version) >= 3;
    return {
      enabled,
      linkUnblocked,
      labels,
      index: enabled ? successorRelationIndexFromApp(this.app) : null,
    };
  }

  preflightSuccessorRelationIndex(identities, runtime) {
    if (!runtime || runtime.enabled !== true) return { state: "disabled", candidates: [] };
    const index = runtime.index;
    if (!index) return { state: "unavailable", candidates: [] };
    try {
      if (index.ready() !== true) return { state: "unavailable", candidates: [] };
      const generation = Number(index.generation);
      if (!Number.isFinite(generation)) return { state: "unavailable", candidates: [] };
      const wanted = new Set(runtime.labels.keys.map((key) => relationLabelKey(key)));
      const candidates = [];
      const seen = new Set();
      for (const identity of Array.isArray(identities) ? identities : []) {
        if (!identity || !identity.path || !identity.blockId) continue;
        const rows = index.incoming(String(identity.path), String(identity.blockId));
        if (!Array.isArray(rows)) return { state: "unavailable", candidates: [] };
        for (const raw of rows) {
          const edge = relationNormalizeEdge(raw);
          if (!edge || !successorRelationConfiguredEdge(raw, runtime.labels) || !edge.resolved) continue;
          const targetKey = relationIdentityKey(edge.target.path, edge.target.blockId, edge.target.line);
          const identityKey = relationIdentityKey(identity.path, identity.blockId);
          if (targetKey !== identityKey || !wanted.has(edge.key)) continue;
          const key = successorRelationEdgeKey(edge);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ edge: raw, normalized: edge, identity });
        }
      }
      if (Number(index.generation) !== generation) return { state: "unavailable", candidates: [] };
      return { state: candidates.length > 0 ? "candidates" : "empty", candidates, generation };
    } catch (_error) {
      return { state: "unavailable", candidates: [] };
    }
  }

  async readSuccessorRelationInputs(options = {}) {
    const runtime = options.runtime || {};
    const preflight = options.preflight || {};
    const active = options.active || {};
    const cache = options.cache instanceof Map ? options.cache : new Map();
    const noteTexts = new Map();
    const supplied = options.noteTexts;
    if (supplied instanceof Map) {
      for (const [path, text] of supplied) if (typeof text === "string") noteTexts.set(String(path), text);
    } else if (supplied && typeof supplied === "object") {
      for (const [path, text] of Object.entries(supplied)) if (typeof text === "string") noteTexts.set(path, text);
    }
    const unavailable = (extra = {}) => ({
      options: {
        relationSuccessorLabels: runtime.labels,
        navSuccessorsVersion: 3,
        relationIndexReady: false,
      },
      noteTexts,
      readPaths: new Set(),
      unavailable: true,
      ...extra,
    });
    if (!runtime.enabled) return { options: {}, noteTexts, readPaths: new Set(), unavailable: false };
    if (preflight.state === "unavailable") return unavailable();
    if (preflight.state !== "candidates" || !runtime.index) {
      return { options: {}, noteTexts, readPaths: new Set(), unavailable: false };
    }

    const index = runtime.index;
    const readPaths = new Set();
    const exists = (path) => {
      try {
        const vault = this.app && this.app.vault;
        if (vault && typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath(path)) return true;
        return !!(vault && typeof vault.getMarkdownFiles === "function" &&
          vault.getMarkdownFiles().some((file) => file && String(file.path) === String(path)));
      } catch (_error) {
        return false;
      }
    };
    const read = async (path) => {
      const normalized = normalizeDependencyMarkdownPath(path || "");
      if (!normalized) return null;
      readPaths.add(normalized);
      if (typeof noteTexts.get(normalized) === "string") return noteTexts.get(normalized);
      const text = await this.readSuccessorNoteText(normalized, active, cache);
      if (typeof text === "string") {
        noteTexts.set(normalized, text);
        return text;
      }
      return null;
    };

    try {
      const eventTargets = new Map();
      for (const entry of preflight.candidates) {
        const identity = entry.identity;
        const key = relationIdentityKey(identity.path, identity.blockId);
        if (!eventTargets.has(key)) eventTargets.set(key, identity);
      }
      for (const identity of eventTargets.values()) await read(identity.path);
      for (const entry of preflight.candidates) await read(entry.normalized.source.path);

      const unreadableSource = preflight.candidates.some((entry) =>
        typeof noteTexts.get(entry.normalized.source.path) !== "string" && exists(entry.normalized.source.path),
      );
      const unreadableTarget = [...eventTargets.values()].some((identity) =>
        typeof noteTexts.get(normalizeDependencyMarkdownPath(identity.path)) !== "string" && exists(identity.path),
      );
      if (unreadableSource || unreadableTarget) return unavailable({ noteTexts, readPaths });

      const anchors = computeSuccessorAnchors(
        options.identities || [],
        options.baselineDay || [],
        { closingEntry: options.closingEntry, dailyPath: options.dailyPath || "" },
      );
      const anchorByKey = new Map();
      for (let indexOfIdentity = 0; indexOfIdentity < (options.identities || []).length; indexOfIdentity += 1) {
        const identity = options.identities[indexOfIdentity];
        anchorByKey.set(relationIdentityKey(identity.path, identity.blockId), anchors[indexOfIdentity]);
      }
      const eventsByKey = new Map();
      for (const [key, identity] of eventTargets) {
        const targetPath = normalizeDependencyMarkdownPath(identity.path);
        const targetTask = relationLookupTask(targetPath, identity.blockId, null, noteTexts);
        if (!targetTask || !["x", "X"].includes(String(targetTask.status || ""))) continue;
        eventsByKey.set(key, {
          event: "done",
          target: {
            path: targetPath,
            blockId: String(identity.blockId),
            line: targetTask.line,
            text: String(targetTask.lineText || identity.text || ""),
            status: String(targetTask.status),
          },
          anchor: anchorByKey.get(key) || null,
        });
      }
      if (eventsByKey.size === 0) return { options: {}, noteTexts, readPaths, unavailable: false };

      const incoming = [];
      for (const entry of preflight.candidates) {
        const original = entry.normalized;
        const targetKey = relationIdentityKey(original.target.path, original.target.blockId, original.target.line);
        if (!eventsByKey.has(targetKey)) continue;
        if (!successorRelationEdgeIsAuthored(this.app, original, noteTexts)) continue;
        const event = eventsByKey.get(targetKey);
        incoming.push({
          ...entry.edge,
          source: { ...(entry.edge.source || {}) },
          target: {
            ...(entry.edge.target || {}),
            path: event.target.path,
            blockId: event.target.blockId,
            line: event.target.line,
            text: event.target.text,
            status: event.target.status,
            resolved: true,
          },
          resolved: true,
        });
      }
      if (incoming.length === 0) return { options: {}, noteTexts, readPaths, unavailable: false };

      const outgoingBySource = new Map();
      for (const edge of incoming) {
        const source = edge.source || {};
        const key = relationIdentityKey(source.path, source.blockId, source.line);
        if (outgoingBySource.has(key)) continue;
        const sourceRef = source.blockId || source.line;
        if (sourceRef == null || sourceRef === "") continue;
        const rows = index.outgoing(String(source.path), sourceRef);
        if (!Array.isArray(rows)) return unavailable({ noteTexts, readPaths });
        outgoingBySource.set(key, rows);
      }

      const outgoing = [];
      const outgoingTargets = new Map();
      for (const [sourceKey, rows] of outgoingBySource) {
        for (const raw of rows) {
          const edge = relationNormalizeEdge(raw);
          if (!edge || !successorRelationConfiguredEdge(raw, runtime.labels)) continue;
          const actualSourceKey = relationIdentityKey(edge.source.path, edge.source.blockId, edge.source.line);
          if (actualSourceKey !== sourceKey || !successorRelationEdgeIsAuthored(this.app, edge, noteTexts)) continue;
          outgoing.push(raw);
          if (edge.resolved && edge.target.path && edge.target.blockId) {
            outgoingTargets.set(relationIdentityKey(edge.target.path, edge.target.blockId), edge.target);
          }
        }
      }
      for (const target of outgoingTargets.values()) await read(target.path);
      for (let indexOfEdge = 0; indexOfEdge < outgoing.length; indexOfEdge += 1) {
        const raw = outgoing[indexOfEdge];
        const edge = relationNormalizeEdge(raw);
        if (!edge || !edge.target.path || !edge.target.blockId) continue;
        const targetText = noteTexts.get(edge.target.path);
        if (typeof targetText !== "string") {
          if (exists(edge.target.path)) {
            outgoing[indexOfEdge] = {
              ...raw,
              target: { ...(raw.target || {}), status: "", text: null, unreadable: true, resolved: true },
              resolved: true,
            };
          } else {
            outgoing[indexOfEdge] = {
              ...raw,
              target: { ...(raw.target || {}), resolved: false },
              resolved: false,
            };
          }
          continue;
        }
        const currentTarget = relationLookupTask(edge.target.path, edge.target.blockId, null, noteTexts);
        if (!currentTarget) {
          outgoing[indexOfEdge] = {
            ...raw,
            target: { ...(raw.target || {}), resolved: false },
            resolved: false,
          };
          continue;
        }
        outgoing[indexOfEdge] = {
          ...raw,
          target: {
            ...(raw.target || {}),
            path: edge.target.path,
            blockId: edge.target.blockId,
            line: currentTarget.line,
            text: currentTarget.lineText,
            status: currentTarget.status,
            resolved: true,
          },
          resolved: true,
        };
      }

      if (Number(index.generation) !== Number(preflight.generation)) return unavailable({ noteTexts, readPaths });
      const events = [...eventsByKey.values()].filter((event) => incoming.some((edge) =>
        relationIdentityKey(edge.target.path, edge.target.blockId, edge.target.line) ===
          relationIdentityKey(event.target.path, event.target.blockId, event.target.line),
      ));
      const relationOptions = {
        relationEvents: events,
        relationCandidates: incoming,
        relationOutgoing: outgoing,
        relationSuccessorLabels: runtime.labels,
        relationIndexReady: true,
        navSuccessorsVersion: 3,
      };
      return { options: relationOptions, noteTexts, readPaths, unavailable: false };
    } catch (_error) {
      return unavailable({ noteTexts, readPaths });
    }
  }
}
