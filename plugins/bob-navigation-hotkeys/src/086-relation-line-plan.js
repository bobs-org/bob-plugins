// LINKS / LINKED FROM planners. JS twin of bob-cli
// `src/native/task_relations/{format,plan}.rs`, pinned by docs/task-relations.md
// LW1–LW14, LK20, and the Rule 6 mirror table. Identity on the planner is
// canonical link text, matching Rust; the writer resolves path+id first.

function relationLineEnding(content) {
  return String(content || "").includes("\r\n") ? "\r\n" : "\n";
}

function relationLeadingWhitespace(line) {
  const match = /^[ \t]*/.exec(String(line || ""));
  return match ? match[0] : "";
}

function relationLinkRef(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    if (entry.link) return String(entry.link);
    return relationLinkText({
      note: entry.note || "",
      blockId: entry.blockId || "",
    });
  }
  return "";
}

function formatLinksLine(indent, entries) {
  const indentText = typeof indent === "string" ? indent : "";
  const body = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const link = relationLinkRef(entry);
      const label = entry && typeof entry === "object" ? entry.label : null;
      return label ? `${label} ${link}` : link;
    })
    .filter(Boolean)
    .join(TASK_RELATION_SEPARATOR);
  return `${indentText}- ${TASK_RELATION_EMOJI} **${TASK_LINKS_LABEL}:** ${body}`;
}

function sortLinkedFromEntries(entries) {
  const rows = (Array.isArray(entries) ? entries.slice() : []).map((entry) => {
    if (typeof entry === "string") return { link: entry, label: null };
    const link = relationLinkRef(entry);
    const label = entry && entry.label ? String(entry.label) : null;
    return { link, label };
  });
  rows.sort((left, right) => {
    const byLink = compareBlocksLinksByCodePoint(left.link, right.link);
    if (byLink !== 0) return byLink;
    const leftLabel = left.label || "";
    const rightLabel = right.label || "";
    return compareBlocksStringsByCodePoint(leftLabel, rightLabel);
  });
  return rows;
}

function formatLinkedFromLine(indent, entries) {
  const indentText = typeof indent === "string" ? indent : "";
  const body = sortLinkedFromEntries(entries)
    .map((entry) =>
      entry.label ? `${entry.link} (${entry.label})` : entry.link,
    )
    .filter((part) => part)
    .join(TASK_RELATION_SEPARATOR);
  return `${indentText}- ${TASK_RELATION_EMOJI} **${TASK_LINKED_FROM_LABEL}:** ${body}`;
}

function relationChildContexts(lines) {
  try {
    return getMarkdownLineContextsForLines(lines);
  } catch (_error) {
    return [];
  }
}

function findRelationChildren(lines, taskLine, parser) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(Number(taskLine));
  if (!Number.isFinite(parentIndex) || parentIndex < 0) {
    return Object.freeze([]);
  }
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);
  const contexts = relationChildContexts(sourceLines);
  const found = [];
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    if (findNearestParentListItem(sourceLines, index) !== parentIndex) continue;
    if (contexts[index] && contexts[index].inFence) continue;
    const parsed = parser(String(sourceLines[index] || ""), {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict !== "not-a-line") found.push(index);
  }
  return Object.freeze(found);
}

function findLinksChildren(lines, taskLine) {
  return findRelationChildren(lines, taskLine, parseLinksLine);
}

function findLinkedFromChildren(lines, taskLine) {
  return findRelationChildren(lines, taskLine, parseLinkedFromLine);
}

function isRelationSlotAnchor(lineText) {
  const text = String(lineText || "");
  return Boolean(
    parseCancelLogParentBullet(text) ||
      parseDependencyLine(text, { isDirectChildOfTask: true }).verdict !==
        "not-a-line" ||
      isTaskBlocksLine(text) ||
      isProjectSubprojectsLine(text),
  );
}

function relationSubtreeEnd(lines, lineIndex) {
  return findCurrentBulletChildBlock(lines, lineIndex).endLineExclusive;
}

// Insert slot for a missing LINKS or LINKED FROM child (Rule 3 / LW7 / LW8).
function relationInsertSlot(lines, taskLine, kind) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(Number(taskLine));
  const parentIndent = relationLeadingWhitespace(
    String(sourceLines[parentIndex] || ""),
  );
  const fallbackIndent = `${parentIndent}\t`;
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);
  const children = [];
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    if (findNearestParentListItem(sourceLines, index) === parentIndex) {
      children.push(index);
    }
  }
  const childIndent = children.length
    ? relationLeadingWhitespace(String(sourceLines[children[0]] || ""))
    : fallbackIndent;

  if (kind === "linked-from") {
    const links = findLinksChildren(sourceLines, parentIndex);
    if (links.length > 0) {
      return Object.freeze({
        lineIndex: relationSubtreeEnd(sourceLines, links[0]),
        indent: childIndent,
      });
    }
  }

  let lastAnchor = null;
  for (const index of children) {
    if (isRelationSlotAnchor(String(sourceLines[index] || ""))) {
      lastAnchor = index;
    }
  }
  if (lastAnchor !== null) {
    return Object.freeze({
      lineIndex: relationSubtreeEnd(sourceLines, lastAnchor),
      indent: childIndent,
    });
  }
  if (children.length > 0) {
    return Object.freeze({ lineIndex: children[0], indent: childIndent });
  }
  return Object.freeze({
    lineIndex: parentIndex + 1,
    indent: childIndent,
  });
}

function relationInsertLine(lines, taskLine, kind) {
  return relationInsertSlot(lines, taskLine, kind).lineIndex;
}

function normalizeOptionalRelationLabel(label) {
  if (label === undefined || label === null || label === "") {
    return { ok: true, label: null };
  }
  // §19 MN15: 💬-first labels are reserved for text mentions.
  if (relationLabelIsReservedStart(String(label || ""))) {
    return { ok: false, reason: "reserved" };
  }
  const normalized = normalizeRelationLabel(label);
  if (!normalized) {
    const length = Array.from(
      String(label || "")
        .trim()
        .replace(/\s+/gu, " ")
        .replace(/:$/, "")
        .trim(),
    ).length;
    return {
      ok: false,
      reason: length > 40 ? "too-long" : "forbidden-character",
    };
  }
  return { ok: true, label: normalized };
}

function linksEditEntries(edit) {
  const add = [];
  for (const entry of Array.isArray(edit && edit.add) ? edit.add : []) {
    const link = relationLinkRef(entry);
    if (!link) continue;
    const normalized = normalizeOptionalRelationLabel(
      entry && typeof entry === "object" ? entry.label : null,
    );
    if (!normalized.ok) return { error: normalized.reason };
    add.push({ link, label: normalized.label });
  }
  const remove = new Set(
    (Array.isArray(edit && edit.remove) ? edit.remove : [])
      .map((entry) => relationLinkRef(entry))
      .filter(Boolean),
  );
  const relabel = new Map();
  const rawRelabel = edit && edit.relabel;
  const relabelPairs =
    rawRelabel instanceof Map
      ? [...rawRelabel]
      : rawRelabel && typeof rawRelabel === "object" && !Array.isArray(rawRelabel)
        ? Object.entries(rawRelabel)
        : Array.isArray(rawRelabel)
          ? rawRelabel.map((entry) => [
              relationLinkRef(entry),
              entry && entry.label,
            ])
          : [];
  for (const [identity, label] of relabelPairs) {
    const link = String(identity || "");
    if (!link) continue;
    const normalized = normalizeOptionalRelationLabel(label);
    if (!normalized.ok) return { error: normalized.reason };
    relabel.set(link, normalized.label);
  }
  return { add, remove, relabel };
}

function applyRelationLineMutations(lines, lineEnding, mutations) {
  const nextLines = lines.slice();
  const lineEdits = [];
  const sorted = mutations
    .slice()
    .sort((left, right) => right.index - left.index);
  for (const mutation of sorted) {
    if (mutation.kind === "remove") {
      nextLines.splice(mutation.index, 1);
      lineEdits.push({ deleteAt: mutation.index });
    } else if (mutation.kind === "replace") {
      nextLines[mutation.index] = mutation.text;
    } else if (mutation.kind === "insert") {
      nextLines.splice(mutation.index, 0, mutation.text);
      lineEdits.push({ insertAt: mutation.index });
    }
  }
  return {
    nextContent: nextLines.join(lineEnding),
    lineEdits: Object.freeze(lineEdits.reverse()),
  };
}

function planLinksEdit(content, ownerLine, edit = {}) {
  const text = String(content || "");
  const lineEnding = relationLineEnding(text);
  const lines = text.split(/\r?\n/);
  const lineIndex = Math.floor(Number(ownerLine));
  if (
    !Number.isFinite(lineIndex) ||
    lineIndex < 0 ||
    lineIndex >= lines.length ||
    !isObsidianTaskAtLine(text, lineIndex)
  ) {
    return Object.freeze({
      ok: false,
      reason: "not-task",
      changed: false,
      nextContent: text,
      lineEdits: Object.freeze([]),
    });
  }

  const parsedEdit = linksEditEntries(edit);
  if (parsedEdit.error) {
    return Object.freeze({
      ok: false,
      reason: "invalid-label",
      labelReason: parsedEdit.error,
      changed: false,
      nextContent: text,
      lineEdits: Object.freeze([]),
    });
  }

  const children = findLinksChildren(lines, lineIndex);
  const parsed = children.map((index) =>
    parseLinksLine(lines[index], { isDirectChildOfTask: true }),
  );
  if (parsed.some((entry) => entry.verdict === "malformed")) {
    return Object.freeze({
      ok: false,
      reason: "malformed-links-line",
      changed: false,
      nextContent: text,
      lineEdits: Object.freeze([]),
      notice: "its LINKS line is malformed",
    });
  }

  const entries = [];
  const seen = new Set();
  for (const child of parsed) {
    if (child.verdict !== "accept") continue;
    for (const entry of child.entries) {
      const identity = relationLinkText(entry);
      if (seen.has(identity)) continue;
      seen.add(identity);
      entries.push({ link: identity, label: entry.label || null });
    }
  }
  const original = entries.map((entry) => ({ ...entry }));

  const nextEntries = entries.filter(
    (entry) => !parsedEdit.remove.has(entry.link),
  );
  for (const [identity, label] of parsedEdit.relabel) {
    const match = nextEntries.find((entry) => entry.link === identity);
    if (match) match.label = label;
  }

  const added = [];
  const relabeled = [];
  const unchanged = [];
  for (const row of parsedEdit.add) {
    const match = nextEntries.find((entry) => entry.link === row.link);
    if (match) {
      if (match.label === row.label) {
        unchanged.push(row.link);
      } else {
        match.label = row.label;
        relabeled.push(row.link);
      }
    } else {
      nextEntries.push({ link: row.link, label: row.label });
      added.push(row.link);
    }
  }
  for (const [identity, label] of parsedEdit.relabel) {
    if (
      original.some(
        (entry) => entry.link === identity && entry.label !== label,
      ) &&
      !relabeled.includes(identity)
    ) {
      relabeled.push(identity);
    }
  }
  const removed = original
    .filter(
      (entry) => !nextEntries.some((current) => current.link === entry.link),
    )
    .map((entry) => entry.link);
  const report = Object.freeze({
    added: Object.freeze(added),
    relabeled: Object.freeze(relabeled),
    unchanged: Object.freeze(unchanged),
    removed: Object.freeze(removed),
  });

  if (nextEntries.length === 0) {
    if (children.length === 0) {
      return Object.freeze({
        ok: true,
        reason: null,
        changed: false,
        nextContent: text,
        lineEdits: Object.freeze([]),
        report,
      });
    }
    const applied = applyRelationLineMutations(
      lines,
      lineEnding,
      children.map((index) => ({ kind: "remove", index })),
    );
    return Object.freeze({
      ok: true,
      reason: null,
      changed: true,
      nextContent: applied.nextContent,
      lineEdits: applied.lineEdits,
      report,
    });
  }

  if (children.length === 0) {
    const slot = relationInsertSlot(lines, lineIndex, "links");
    const applied = applyRelationLineMutations(lines, lineEnding, [
      {
        kind: "insert",
        index: slot.lineIndex,
        text: formatLinksLine(slot.indent, nextEntries),
      },
    ]);
    return Object.freeze({
      ok: true,
      reason: null,
      changed: true,
      nextContent: applied.nextContent,
      lineEdits: applied.lineEdits,
      report,
    });
  }

  const first = children[0];
  const formatted = formatLinksLine(
    relationLeadingWhitespace(lines[first]),
    nextEntries,
  );
  const extras = children.slice(1);
  if (extras.length === 0 && lines[first] === formatted) {
    return Object.freeze({
      ok: true,
      reason: null,
      changed: false,
      nextContent: text,
      lineEdits: Object.freeze([]),
      report,
    });
  }
  const mutations = [{ kind: "replace", index: first, text: formatted }];
  for (const index of extras) mutations.push({ kind: "remove", index });
  const applied = applyRelationLineMutations(lines, lineEnding, mutations);
  return Object.freeze({
    ok: true,
    reason: null,
    changed: true,
    nextContent: applied.nextContent,
    lineEdits: applied.lineEdits,
    report,
  });
}

function linkedFromDesiredAfterDelta(existing, resolve, add, remove) {
  const desired = new Map();
  const removals = new Set(
    (remove instanceof Set
      ? [...remove]
      : Array.isArray(remove)
        ? remove
        : []
    ).map((entry) => String(entry || "")).filter(Boolean),
  );
  for (const entry of Array.isArray(existing) ? existing : []) {
    let resolved = null;
    try {
      resolved = typeof resolve === "function" ? resolve(entry) : null;
    } catch (_error) {
      resolved = null;
    }
    let identity = null;
    let canonicalText = null;
    if (Array.isArray(resolved)) {
      identity = resolved[0];
      canonicalText = resolved[1];
    } else if (resolved && typeof resolved === "object") {
      identity = resolved.identity;
      canonicalText = resolved.link || resolved.canonicalText;
    }
    if (!identity || removals.has(String(identity))) continue;
    desired.set(String(identity), {
      link: String(canonicalText || relationLinkRef(entry)),
      label: entry && entry.label ? entry.label : null,
    });
  }
  const additions =
    add instanceof Map
      ? [...add].map(([identity, value]) => {
          if (Array.isArray(value)) {
            return { identity, link: value[0], label: value[1] };
          }
          return {
            identity,
            link: value && value.link,
            label: value && value.label,
          };
        })
      : Array.isArray(add)
        ? add
        : [];
  for (const entry of additions) {
    const identity = String((entry && entry.identity) || "");
    if (!identity || removals.has(identity)) continue;
    desired.set(identity, {
      link: String((entry && entry.link) || ""),
      label: entry && entry.label ? entry.label : null,
    });
  }
  return Object.freeze(
    sortLinkedFromEntries([...desired.values()]).map((entry) =>
      Object.freeze({ link: entry.link, label: entry.label }),
    ),
  );
}

function planLinkedFromLine(content, ownerLine, desiredEntries) {
  const text = String(content || "");
  const lineEnding = relationLineEnding(text);
  const lines = text.split(/\r?\n/);
  const lineIndex = Math.floor(Number(ownerLine));
  if (
    !Number.isFinite(lineIndex) ||
    lineIndex < 0 ||
    lineIndex >= lines.length ||
    !isObsidianTaskAtLine(text, lineIndex)
  ) {
    return Object.freeze({
      ok: false,
      reason: "not-task",
      kind: "malformed",
      changed: false,
      nextContent: text,
      lineEdits: Object.freeze([]),
    });
  }

  const children = findLinkedFromChildren(lines, lineIndex);
  const parsed = children.map((index) =>
    parseLinkedFromLine(lines[index], { isDirectChildOfTask: true }),
  );
  if (parsed.some((entry) => entry.verdict === "malformed")) {
    return Object.freeze({
      ok: false,
      reason: "malformed-linked-from-line",
      kind: "malformed",
      changed: false,
      nextContent: text,
      lineEdits: Object.freeze([]),
    });
  }

  const desired = sortLinkedFromEntries(
    Array.isArray(desiredEntries) ? desiredEntries : [],
  ).filter((entry) => entry.link);
  const desiredKey = (entry) => `${entry.link}\u0000${entry.label || ""}`;
  const desiredSet = new Set(desired.map(desiredKey));

  const existingLines = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = parsed[index];
    const entries =
      child.verdict === "accept"
        ? child.entries.map((entry) => ({
            link: relationLinkText(entry),
            label: entry.label || null,
          }))
        : [];
    existingLines.push({
      lineIndex: children[index],
      entries,
      canonical: child.canonical === true,
    });
  }

  const currentSet = new Set();
  for (const row of existingLines) {
    for (const entry of row.entries) currentSet.add(desiredKey(entry));
  }
  const added = desired
    .filter((entry) => !currentSet.has(desiredKey(entry)))
    .map((entry) => entry.link);
  const removed = [...currentSet]
    .filter((key) => !desiredSet.has(key))
    .map((key) => key.split("\u0000")[0]);

  const finish = (kind, mutations) => {
    if (!mutations || mutations.length === 0) {
      return Object.freeze({
        ok: true,
        reason: null,
        kind: "noop",
        changed: false,
        nextContent: text,
        lineEdits: Object.freeze([]),
        added: Object.freeze(added),
        removed: Object.freeze(removed),
      });
    }
    const applied = applyRelationLineMutations(lines, lineEnding, mutations);
    return Object.freeze({
      ok: true,
      reason: null,
      kind,
      changed: applied.nextContent !== text,
      nextContent: applied.nextContent,
      lineEdits: applied.lineEdits,
      added: Object.freeze(added),
      removed: Object.freeze(removed),
    });
  };

  if (desired.length === 0) {
    if (existingLines.length === 0) return finish("noop", []);
    return finish(
      existingLines.length > 1 ? "deduplicated" : "removed",
      existingLines.map((row) => ({ kind: "remove", index: row.lineIndex })),
    );
  }

  if (existingLines.length === 0) {
    const slot = relationInsertSlot(lines, lineIndex, "linked-from");
    return finish("inserted", [
      {
        kind: "insert",
        index: slot.lineIndex,
        text: formatLinkedFromLine(slot.indent, desired),
      },
    ]);
  }

  const first = existingLines[0];
  const firstSet = new Set(first.entries.map(desiredKey));
  const exactEntries =
    firstSet.size === desiredSet.size &&
    [...desiredSet].every((key) => firstSet.has(key)) &&
    first.entries.length === desired.length;
  const hasDuplicates =
    existingLines.length > 1 || first.entries.length !== firstSet.size;
  const canonicalLine = formatLinkedFromLine(
    relationLeadingWhitespace(lines[first.lineIndex]),
    desired,
  );
  if (hasDuplicates) {
    return finish("deduplicated", [
      { kind: "replace", index: first.lineIndex, text: canonicalLine },
      ...existingLines.slice(1).map((row) => ({
        kind: "remove",
        index: row.lineIndex,
      })),
    ]);
  }
  if (!exactEntries) {
    return finish("rewritten", [
      { kind: "replace", index: first.lineIndex, text: canonicalLine },
    ]);
  }
  if (!first.canonical) {
    return finish("canonicalized", [
      { kind: "replace", index: first.lineIndex, text: canonicalLine },
    ]);
  }
  return finish("noop", []);
}

function quoteRelationNoticeName(name) {
  return `\u201c${truncateBlocksNoticeName(name)}\u201d`;
}

function relationNoticeNameFromLine(lineText) {
  return blocksDependentDescription(lineText);
}

function relationPathIsWritable(path, previousDailyPath) {
  const normalized = normalizeVaultRelativePath(path);
  return Boolean(
    normalized &&
      !/^done\//i.test(normalized) &&
      normalized !== normalizeVaultRelativePath(previousDailyPath || ""),
  );
}

function relationLinksRows(ownerPath, lineText, resolveLinkpath, vaultFiles) {
  const parsed = parseLinksLine(lineText, { isDirectChildOfTask: true });
  return (parsed.entries || []).map((entry) => {
    const targetPath = dependencyPathForLinkNote(
      entry.note,
      ownerPath,
      resolveLinkpath,
    );
    const identity = blocksIdentity(targetPath, entry.blockId);
    const link = targetPath
      ? canonicalDependencyLink(
          { path: targetPath, blockId: entry.blockId },
          ownerPath,
          vaultFiles,
        ).text
      : relationLinkText(entry);
    return Object.freeze({
      note: entry.note,
      blockId: entry.blockId,
      identity,
      link: relationLinkText(entry),
      canonicalLink: link,
      label: entry.label || null,
    });
  });
}

function relationLinkedFromRows(ownerPath, lineText, resolveLinkpath, vaultFiles) {
  const parsed = parseLinkedFromLine(lineText, { isDirectChildOfTask: true });
  return (parsed.entries || []).map((entry) => {
    const targetPath = dependencyPathForLinkNote(
      entry.note,
      ownerPath,
      resolveLinkpath,
    );
    const identity = blocksIdentity(targetPath, entry.blockId);
    const link = targetPath
      ? canonicalDependencyLink(
          { path: targetPath, blockId: entry.blockId },
          ownerPath,
          vaultFiles,
        ).text
      : relationLinkText(entry);
    return Object.freeze({
      note: entry.note,
      blockId: entry.blockId,
      identity,
      link,
      storedLink: relationLinkText(entry),
      label: entry.label || null,
    });
  });
}

function storedRelationLinkForTarget(existingRows, target, ownerPath, vaultFiles) {
  const identity = blocksIdentity(target.path, target.blockId);
  const existing = (Array.isArray(existingRows) ? existingRows : []).find(
    (row) => row.identity === identity,
  );
  if (existing && existing.link) return existing.link;
  return canonicalDependencyLink(
    { path: target.path, blockId: target.blockId },
    ownerPath,
    vaultFiles,
  ).text;
}

function withLinkedFromFollowUpNotice(notice, failedPaths) {
  const failed = Array.isArray(failedPaths)
    ? failedPaths.length > 0
    : Boolean(
        failedPaths &&
          Array.isArray(failedPaths.failed) &&
          failedPaths.failed.length > 0,
      );
  if (!failed || !notice) return notice;
  return `${notice} · 🪢 LINKED FROM not updated`;
}

function withArchivedRelationNotice(notice, archived) {
  if (!archived || !notice) return notice;
  return `${notice} \u00b7 archived: shown live only`;
}

function buildRelationEditNotice(details = {}) {
  const added = Array.isArray(details.added) ? details.added : [];
  const removed = Array.isArray(details.removed) ? details.removed : [];
  const relabeled = Array.isArray(details.relabeled) ? details.relabeled : [];
  const direction = details.direction === "from" ? "from" : "to";
  const parts = [];
  const nameOf = (row) =>
    quoteRelationNoticeName(row && (row.description || row.name || row.blockId || "task"));
  const labelOf = (row) => (row && row.label ? ` \u00b7 ${row.label}` : "");
  if (added.length === 1 && removed.length === 0 && relabeled.length === 0) {
    parts.push(
      direction === "from"
        ? `🪢 ${nameOf(added[0])} now links here${labelOf(added[0])}`
        : `🪢 Linked to ${nameOf(added[0])}${labelOf(added[0])}`,
    );
  } else if (removed.length === 1 && added.length === 0 && relabeled.length === 0) {
    parts.push(`🪢 Unlinked ${nameOf(removed[0])}`);
  } else if (relabeled.length === 1 && added.length === 0 && removed.length === 0) {
    parts.push(
      `🪢 Relabeled ${nameOf(relabeled[0])}${labelOf(relabeled[0])}`,
    );
  } else if (added.length + removed.length + relabeled.length > 0) {
    const chunks = [];
    if (added.length > 0) {
      chunks.push(`Linked ${formatCountLabel(added.length, "task")}`);
    }
    if (removed.length > 0) {
      chunks.push(`${removed.length} unlinked`);
    }
    if (relabeled.length > 0) {
      chunks.push(`${relabeled.length} relabeled`);
    }
    parts.push(`🪢 ${chunks.join(" · ")}`);
  } else {
    parts.push("🪢 No relation changes");
  }
  let notice = parts.join("");
  notice = withArchivedRelationNotice(notice, details.archived);
  notice = withLinkedFromFollowUpNotice(notice, details.mirrorFailed);
  return notice;
}
