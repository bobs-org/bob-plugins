// Plain-link/dependency tie twins (`docs/task-relations.md` §22). JS twins of
// bob-cli `src/native/task_relations/ties.rs`, pinned by the mirrored PT
// vectors in `scripts/plain-link-tie-vectors.cjs`: `dropPlainLinkEntries`
// (byte-exact plain-entry drop), `classifyPairTies` (pair classification),
// `planTieChange` (desired-state chord/↵ planner composing
// `planDependencyEdit`, `planLinksEdit`, and the drop helper), and the
// absorption planner/applier the dependency writers share
// (`applyDependencyEdit`, `applyBlocksEdit`, same-note marked batches).
//
// Identity on the planner is the resolved vault identity
// (`path\x00blockId`, via `blocksIdentity`); the writers resolve link-note
// text first (PT10). Labelled relations (including `[[#^a|alias]]` per LK5)
// never drop, whatever the predicate says. One predicate, one drop.
const TIE_PLAIN_TOKEN_RE = /(?:~~)?!?\[\[([^\]\n]*)\]\](?:~~)?/g;
const TIE_TARGET_RE = /^(?<note>[^#|\n]*?)#\^(?<blockId>[A-Za-z0-9-]+)$/u;
const TIE_TODO_STATUSES = new Set([" ", "/", "*", "?", "x"]);

// Rust `skip_one_separator` twin: trim leading whitespace, strip one
// `•`/`·`/`,`, trim again. Returns the remaining raw gap plus how many gap
// characters were consumed, so a label span starts at the right offset.
function tieSkipOneSeparator(gapText) {
  const gap = String(gapText || "");
  const leading = /^\s*/u.exec(gap)[0].length;
  let rest = gap.slice(leading);
  if (
    rest.startsWith("•") ||
    rest.startsWith("·") ||
    rest.startsWith(",")
  ) {
    rest = rest.slice(1);
  }
  const trailing = /^\s*/u.exec(rest)[0].length;
  rest = rest.slice(trailing);
  return Object.freeze({ raw: rest, consumed: gap.length - rest.length });
}

// Per-occurrence gap label, mirroring `parseLinksEntryLabel` (085) and the
// Rust label spans: the first entry's gap carries its label verbatim, later
// entries skip one separator first. An alias label counts as a label (LK5).
function tieGapLabel(gapText, isFirst, alias) {
  const gap = String(gapText || "");
  if (isFirst) {
    const trimmed = gap.trim();
    if (!trimmed) {
      if (!alias) {
        return null;
      }
      const fallback = normalizeRelationReaderLabel(alias);
      if (!fallback || relationLabelIsReservedStart(fallback)) {
        return null;
      }
      return fallback;
    }
    const label = normalizeRelationReaderLabel(trimmed);
    if (!label || relationLabelIsReservedStart(label)) {
      return null;
    }
    return label;
  }
  const { raw } = tieSkipOneSeparator(gap);
  const trimmed = raw.trim();
  if (!trimmed) {
    if (!alias) {
      return null;
    }
    const fallback = normalizeRelationReaderLabel(alias);
    if (!fallback || relationLabelIsReservedStart(fallback)) {
      return fallback === TASK_MENTION_LABEL ? fallback : null;
    }
    return fallback;
  }
  const label = normalizeRelationReaderLabel(trimmed);
  if (!label || relationLabelIsReservedStart(label)) {
    return null;
  }
  return label;
}

// Tokenize one LINKS line into per-occurrence spans. Gates on the plugin's
// local recogniser (`parseLinksLine`, 085): anything it refuses is
// malformed here too, so the twin never drops off a line Rust would skip.
function tieTokenizeLinksLine(lineText) {
  const text = String(lineText || "");
  let parsed = null;
  try {
    parsed = parseLinksLine(text, { isDirectChildOfTask: true });
  } catch (_error) {
    return Object.freeze({ ok: false, reason: "malformed" });
  }
  if (!parsed || parsed.verdict !== "accept") {
    return Object.freeze({
      ok: false,
      reason: parsed && parsed.verdict === "empty" ? "empty" : "malformed",
    });
  }
  const header = /^\s*(?:[-*+]|\d+[.)])[\s\S]*?\*\*(?:LINKS|LINKS TO):\*\*/u.exec(text);
  if (!header) {
    return Object.freeze({ ok: false, reason: "malformed" });
  }
  const bodyOffset = header[0].length;
  const body = text.slice(bodyOffset);
  const tokens = [];
  TIE_PLAIN_TOKEN_RE.lastIndex = 0;
  let token = null;
  while ((token = TIE_PLAIN_TOKEN_RE.exec(body)) !== null) {
    const pipe = token[1].indexOf("|");
    const targetText = pipe === -1 ? token[1] : token[1].slice(0, pipe);
    const alias = pipe === -1 ? "" : token[1].slice(pipe + 1);
    const match = TIE_TARGET_RE.exec(targetText);
    if (!match) {
      TIE_PLAIN_TOKEN_RE.lastIndex = 0;
      return Object.freeze({ ok: false, reason: "malformed" });
    }
    tokens.push({
      fullStart: bodyOffset + token.index,
      fullEnd: bodyOffset + token.index + token[0].length,
      target: match.groups.note || "",
      blockId: match.groups.blockId,
      alias,
    });
    if (token[0].length === 0) {
      break;
    }
  }
  TIE_PLAIN_TOKEN_RE.lastIndex = 0;
  if (tokens.length === 0) {
    return Object.freeze({ ok: false, reason: "empty" });
  }
  let previousEnd = bodyOffset;
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const gap = text.slice(previousEnd, current.fullStart);
    current.gap = gap;
    current.label = tieGapLabel(gap, index === 0, current.alias);
    if (current.alias) {
      const aliasLabel = normalizeRelationReaderLabel(current.alias);
      if (aliasLabel && !relationLabelIsReservedStart(aliasLabel)) {
        current.label = aliasLabel;
      }
    }
    previousEnd = current.fullEnd;
  }
  return Object.freeze({ ok: true, tokens: Object.freeze(tokens) });
}

function tieLabelStartInGap(gapText, isFirst, label) {
  if (label === null || label === undefined) {
    return null;
  }
  const gap = String(gapText || "");
  if (isFirst) {
    return gap.length - gap.trimStart().length;
  }
  const { consumed, raw } = tieSkipOneSeparator(gap);
  return consumed + (raw.length - raw.trimStart().length);
}

// Byte-exact twin of the Rust `drop_plain_link_entries`: drop every plain
// (unlabelled) LINKS entry whose target the caller reports as
// dependency-tied. `isTied` answers one entry (`{target, blockId}`).
// Separator rule (PT2–PT4, PT9): a dropped non-first entry takes its
// preceding separator; a dropped first entry takes its following separator
// but keeps the next kept entry's gap label (`see ` in PT2). All other
// bytes — indent, header, CRLF, trailing spaces — are preserved
// (PT12–PT12c). A CRLF artifact rides on the raw line; Rust parses the
// trailing `\r` as separator residue, so the twin strips one trailing
// `\r` up front and restores it on a rewrite.
function dropPlainLinkEntries(lineText, isTied) {
  const text = String(lineText || "");
  const carriage = text.endsWith("\r") ? "\r" : "";
  const source = carriage ? text.slice(0, -1) : text;
  const tokenized = tieTokenizeLinksLine(source);
  if (!tokenized.ok) {
    return Object.freeze({
      outcome: tokenized.reason === "empty" ? "unchanged" : "malformed",
      removed: Object.freeze([]),
    });
  }
  const tokens = tokenized.tokens;
  const tied = tokens.map(
    (entry) =>
      (entry.label === null || entry.label === undefined) &&
      (typeof isTied === "function"
        ? isTied(
            Object.freeze({ target: entry.target, blockId: entry.blockId }),
          ) === true
        : false),
  );
  if (!tied.some(Boolean)) {
    return Object.freeze({ outcome: "unchanged", removed: Object.freeze([]) });
  }
  const removed = tokens
    .filter((entry, index) => tied[index])
    .map((entry) =>
      relationLinkText({ note: entry.target, blockId: entry.blockId }),
    );
  if (tied.every(Boolean)) {
    return Object.freeze({ outcome: "delete-line", removed: Object.freeze(removed) });
  }
  const cuts = [];
  let index = 0;
  while (index < tokens.length) {
    if (!tied[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < tokens.length && tied[end + 1]) {
      end += 1;
    }
    if (index === 0) {
      const next = end + 1;
      const gapStart = tokens[end].fullEnd;
      const gapEnd = tokens[next].fullStart;
      const start = tieLabelStartInGap(
        tokens[next].gap,
        false,
        tokens[next].label,
      );
      cuts.push([tokens[index].fullStart, start === null ? gapEnd : gapStart + start]);
    } else {
      cuts.push([tokens[index - 1].fullEnd, tokens[end].fullEnd]);
    }
    index = end + 1;
  }
  cuts.sort((left, right) => left[0] - right[0]);
  let out = "";
  let cursor = 0;
  for (const [start, finish] of cuts) {
    out += source.slice(cursor, start);
    cursor = finish;
  }
  out += source.slice(cursor);
  return Object.freeze({
    outcome: "rewritten",
    removed: Object.freeze(removed),
    line: out + carriage,
  });
}

// Twin of the Rust `PairTies::classify`: one pair's exclusive tie from
// already-resolved edge sets. Labelled relations never enter the verdict;
// callers pass only plain-link presence per side.
function classifyPairTies(facts = {}) {
  const ownerWaits = facts.ownerWaitsOnOther === true;
  const otherWaits = facts.otherWaitsOnOwner === true;
  const plainOut = facts.plainOut === true;
  const plainIn = facts.plainIn === true;
  const dependency = ownerWaits || otherWaits;
  let tie = "untied";
  if (ownerWaits && otherWaits) {
    tie = "depends_both";
  } else if (ownerWaits) {
    tie = "depends_out";
  } else if (otherWaits) {
    tie = "depends_in";
  } else if (plainOut && plainIn) {
    tie = "plain_both";
  } else if (plainOut) {
    tie = "plain_out";
  } else if (plainIn) {
    tie = "plain_in";
  }
  return Object.freeze({
    tie,
    dropOwnerPlain: dependency && plainOut,
    dropOtherPlain: dependency && plainIn,
  });
}

function tieNormalizeRef(ref) {
  const path = normalizeVaultRelativePath((ref && ref.path) || "");
  const blockId = normalizeBulletPropertyValue((ref && ref.blockId) || "");
  if (!path || !blockId) {
    return null;
  }
  return Object.freeze({ path, blockId });
}

function tieNotesMap(notes) {
  if (notes instanceof Map) {
    const map = new Map();
    for (const [path, content] of notes) {
      const normalized = normalizeVaultRelativePath(path);
      if (normalized) {
        map.set(normalized, String(content || ""));
      }
    }
    return map;
  }
  const map = new Map();
  if (notes && typeof notes === "object") {
    for (const path of Object.keys(notes)) {
      const normalized = normalizeVaultRelativePath(path);
      if (normalized) {
        map.set(normalized, String(notes[path] || ""));
      }
    }
  }
  return map;
}

function tieFindTaskLine(contents, path, blockId) {
  const text = contents.get(path);
  if (typeof text !== "string") {
    return Object.freeze({ line: null, lines: null, reason: "note-unavailable" });
  }
  const lines = text.split(/\r?\n/);
  let found = null;
  let duplicates = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (getTrailingBlockId(String(lines[index] || "")) === blockId) {
      duplicates += 1;
      if (found === null) {
        found = index;
      }
    }
  }
  if (found === null) {
    return Object.freeze({ line: null, lines, reason: "not-found" });
  }
  if (duplicates > 1) {
    return Object.freeze({ line: null, lines, reason: "duplicate-id" });
  }
  return Object.freeze({ line: found, lines, reason: null });
}

function tieTaskStatus(lines, line) {
  if (!Array.isArray(lines) || !Number.isInteger(line) || line < 0 || line >= lines.length) {
    return null;
  }
  return getObsidianTaskCheckboxStatus(String(lines[line] || ""));
}

function tieDependsOnTargets(content, taskLine, ownerPath, resolveLinkpath) {
  const collection = collectDependencyNavigationBullets(content, taskLine);
  if (collection.reason) {
    return Object.freeze({ ok: false, reason: collection.reason, targets: null });
  }
  const targets = [];
  for (const target of collection.targets || []) {
    const targetPath = dependencyPathForLinkNote(
      target.note,
      ownerPath,
      resolveLinkpath,
    );
    if (!targetPath) {
      continue;
    }
    targets.push(
      Object.freeze({
        path: normalizeVaultRelativePath(targetPath),
        blockId: normalizeBulletPropertyValue(target.blockId),
      }),
    );
  }
  return Object.freeze({ ok: true, reason: null, targets: Object.freeze(targets) });
}

// Plain-link presence per side for one task, resolved to vault identities.
// Labelled entries never count (PT20); unresolvable entries are ignored
// (uncertain, left for reconcile); malformed LINKS lines are reported.
function tiePlainPresence(lines, taskLine, ownerPath, resolveLinkpath) {
  const children = findLinksChildren(lines, taskLine);
  const parsed = children.map((index) =>
    parseLinksLine(String(lines[index] || ""), { isDirectChildOfTask: true }),
  );
  if (parsed.some((entry) => entry && entry.verdict === "malformed")) {
    return Object.freeze({ ok: false, reason: "malformed-links-line", out: null });
  }
  const out = [];
  for (const entry of parsed) {
    if (!entry || entry.verdict !== "accept") {
      continue;
    }
    for (const link of entry.entries || []) {
      if (link.label) {
        continue;
      }
      const targetPath = dependencyPathForLinkNote(
        link.note,
        ownerPath,
        resolveLinkpath,
      );
      if (!targetPath) {
        continue;
      }
      out.push(
        Object.freeze({
          path: normalizeVaultRelativePath(targetPath),
          blockId: normalizeBulletPropertyValue(link.blockId),
        }),
      );
    }
  }
  return Object.freeze({ ok: true, reason: null, out: Object.freeze(out) });
}

function tieIdentityOf(ref) {
  return blocksIdentity(ref.path, ref.blockId);
}

function tieHasIdentity(list, ref) {
  const wanted = tieIdentityOf(ref);
  return (Array.isArray(list) ? list : []).some(
    (entry) => tieIdentityOf(entry) === wanted,
  );
}

// Desired-state tie planner (`docs/task-relations.md` key grammar). `to` is
// `owner-waits` (⌃B), `other-waits` (⌃⇧B), `plain-out` (⌃L), or `plain-in`
// (⌃⇧L). Chords are desired-state commands, never toggles: pressing one
// when the pair already holds that tie is a `noop`. Returns one of:
// - `{kind: "noop", notice}` — the pair already holds the tie;
// - `{kind: "refuse", reason, notice}` — guarded (cycles, eligibility);
// - `{kind: "change", ...}` — the dependency delta (one entry per
//   dependent: `{dependent, add, remove}`, each with its `planDependencyEdit`
//   preview), the LINKS deltas per note (drops plus an optional add, with
//   the `planLinksEdit` preview), the LINKED FROM courtesy drops, the ids
//   needed, and whether every edit is same-note.
function planTieChange(args = {}) {
  const owner = tieNormalizeRef(args.owner);
  const other = tieNormalizeRef(args.other);
  const to = String(args.to || "");
  const notes = tieNotesMap(args.notes);
  const resolve = args.resolve && typeof args.resolve === "object" ? args.resolve : {};
  const resolveLinkpath =
    typeof resolve.linkpath === "function" ? resolve.linkpath : null;
  const vaultFiles = Array.isArray(resolve.vaultFiles) && resolve.vaultFiles.length > 0
    ? resolve.vaultFiles
    : [...notes.keys()];
  const isArchived =
    typeof resolve.isArchived === "function"
      ? resolve.isArchived
      : (path) => isDoneArchivePath(path);
  const today = args.today instanceof Date ? args.today : resolve.today instanceof Date ? resolve.today : new Date();
  const refuse = (reason, notice) =>
    Object.freeze({ kind: "refuse", to, reason, notice: notice || null });
  if (!owner || !other) {
    return refuse("invalid-ref", "That task could not be located");
  }
  if (
    to !== "owner-waits" &&
    to !== "other-waits" &&
    to !== "plain-out" &&
    to !== "plain-in"
  ) {
    return refuse("invalid-target", "That tie change is not supported");
  }
  const ownerFound = tieFindTaskLine(notes, owner.path, owner.blockId);
  const otherFound = tieFindTaskLine(notes, other.path, other.blockId);
  if (ownerFound.reason) {
    return refuse(ownerFound.reason, `The owner task could not be located (^${owner.blockId})`);
  }
  if (otherFound.reason) {
    return refuse(otherFound.reason, `The other task could not be located (^${other.blockId})`);
  }
  const ownerKey = dependencyStageRowKey(owner.path, owner.blockId);
  const otherKey = dependencyStageRowKey(other.path, other.blockId);
  if (ownerKey && otherKey && ownerKey === otherKey) {
    return refuse("this-task", "A task cannot tie to itself");
  }
  const ownerContent = notes.get(owner.path);
  const otherContent = notes.get(other.path);
  if (taskDependsOnLineIsMalformed(ownerContent, ownerFound.line)) {
    return refuse("malformed-depends-on", "Its Depends-On line is malformed");
  }
  if (taskDependsOnLineIsMalformed(otherContent, otherFound.line)) {
    return refuse("malformed-depends-on", "Its Depends-On line is malformed");
  }
  const ownerDeps = tieDependsOnTargets(ownerContent, ownerFound.line, owner.path, resolveLinkpath);
  const otherDeps = tieDependsOnTargets(otherContent, otherFound.line, other.path, resolveLinkpath);
  if (!ownerDeps.ok || !otherDeps.ok) {
    return refuse("malformed-depends-on", "A Depends-On line is malformed");
  }
  const ownerWaits = tieHasIdentity(ownerDeps.targets, other);
  const otherWaits = tieHasIdentity(otherDeps.targets, owner);
  const ownerPlain = tiePlainPresence(ownerFound.lines, ownerFound.line, owner.path, resolveLinkpath);
  const otherPlain = tiePlainPresence(otherFound.lines, otherFound.line, other.path, resolveLinkpath);
  const ownerStatus = tieTaskStatus(ownerFound.lines, ownerFound.line);
  const otherStatus = tieTaskStatus(otherFound.lines, otherFound.line);
  const ownerIdentity = blocksIdentity(owner.path, owner.blockId);
  const otherIdentity = blocksIdentity(other.path, other.blockId);
  const pair = classifyPairTies({
    ownerWaitsOnOther: ownerWaits,
    otherWaitsOnOwner: otherWaits,
    plainOut: ownerPlain.ok && ownerPlain.out.some((entry) => tieIdentityOf(entry) === otherIdentity),
    plainIn: otherPlain.ok && otherPlain.out.some((entry) => tieIdentityOf(entry) === ownerIdentity),
  });
  const idsNeeded = Object.freeze([owner, other]);
  const sameNote = owner.path === other.path;
  const ownerName = quoteRelationNoticeName(
    cleanTaskDisplayText(String(ownerFound.lines[ownerFound.line] || "")) || "that task",
  );
  const otherName = quoteRelationNoticeName(
    cleanTaskDisplayText(String(otherFound.lines[otherFound.line] || "")) || "that task",
  );

  const wantsDependency = to === "owner-waits" || to === "other-waits";
  if (wantsDependency) {
    const dependent = to === "owner-waits" ? owner : other;
    const prerequisite = to === "owner-waits" ? other : owner;
    const alreadyHolds =
      (to === "owner-waits" && pair.tie === "depends_out") ||
      (to === "other-waits" && pair.tie === "depends_in");
    if (alreadyHolds && pair.tie !== "depends_both") {
      return Object.freeze({
        kind: "noop",
        to,
        tie: pair.tie,
        notice: to === "owner-waits" ? "Already waits on it" : "Already waited on",
      });
    }
    const prerequisiteStatus = to === "owner-waits" ? otherStatus : ownerStatus;
    const prerequisiteLines = to === "owner-waits" ? otherFound.lines : ownerFound.lines;
    const prerequisiteLine = to === "owner-waits" ? otherFound.line : ownerFound.line;
    const prerequisiteRef = prerequisite;
    if (prerequisiteStatus !== null && !TIE_TODO_STATUSES.has(prerequisiteStatus)) {
      return refuse(
        "target-closed",
        `${prerequisiteRef === other ? otherName : ownerName} is closed · it cannot become a prerequisite`,
      );
    }
    try {
      if (isArchived(prerequisiteRef.path)) {
        return refuse(
          "target-archived",
          `${prerequisiteRef === other ? otherName : ownerName} is archived · it cannot become a prerequisite`,
        );
      }
    } catch (_error) {
      return refuse("target-archived", "The target note is not writable");
    }
    try {
      const scopeFlags = navNoteScopeFlags(prerequisiteRef.path);
      if (
        scopeFlags &&
        scopeFlags.isDailyNote === true &&
        relationStageEventTaskSpan(String(prerequisiteLines[prerequisiteLine] || "")) !== null
      ) {
        return refuse(
          "event-task",
          `${prerequisiteRef === other ? otherName : ownerName} is an Event Task · it cannot become a prerequisite`,
        );
      }
    } catch (_error) {
      // Event-task detection is best-effort; a helper failure never blocks.
    }
    const dependentFound = to === "owner-waits" ? ownerFound : otherFound;
    const dependentStatus = to === "owner-waits" ? ownerStatus : otherStatus;
    if (dependentStatus !== null && !OPEN_OBSIDIAN_TASK_STATUSES.has(dependentStatus)) {
      return refuse(
        "owner-closed",
        `${dependent === owner ? ownerName : otherName} is closed · its dependencies cannot change`,
      );
    }
    try {
      if (
        dependentFound &&
        isProjectPrjDependencyParent(
          notes.get(dependent.path),
          dependent.path,
          dependentFound.line,
        ) &&
        sameNote
      ) {
        return refuse("inside-project", "A project cannot wait on its own note");
      }
    } catch (_error) {
      // ^prj detection is best-effort.
    }
    // Trial-graph cycle check, excluding the reversed edge (key grammar).
    try {
      const trialNotes = [...notes].map(([path, content]) => ({ path, content }));
      const index = indexDependencyStageNotes(trialNotes);
      const edges = collectDependencyStageEdges(trialNotes, index);
      const trial = new Map();
      for (const [from, targets] of edges) {
        trial.set(from, targets.slice());
      }
      const dependentKey = to === "owner-waits" ? ownerKey : otherKey;
      const prerequisiteKey = to === "owner-waits" ? otherKey : ownerKey;
      if (dependentKey && prerequisiteKey) {
        const reversing =
          (to === "owner-waits" && pair.tie === "depends_in") ||
          (to === "other-waits" && pair.tie === "depends_out") ||
          pair.tie === "depends_both";
        if (reversing) {
          const current = trial.get(prerequisiteKey) || [];
          trial.set(
            prerequisiteKey,
            current.filter((key) => key !== dependentKey),
          );
        }
        const current = trial.get(dependentKey) || [];
        if (!current.includes(prerequisiteKey)) {
          trial.set(dependentKey, [...current, prerequisiteKey]);
        }
        const cycle = findDependencyStageCycle(trial, dependentKey, prerequisiteKey);
        if (cycle) {
          return refuse(
            "would-create-cycle",
            `⛓ Could not update dependencies (would create a cycle: ${cycle.length - 1} back-link${cycle.length - 1 === 1 ? "" : "s"})`,
          );
        }
      }
    } catch (_error) {
      // Cycle detection is best-effort off the loaded notes.
    }
    const reversing =
      (to === "owner-waits" && (pair.tie === "depends_in" || pair.tie === "depends_both")) ||
      (to === "other-waits" && (pair.tie === "depends_out" || pair.tie === "depends_both"));
    const dependency = [];
    const planFor = (dependentRef, add, remove) => {
      const content = notes.get(dependentRef.path);
      const located = tieFindTaskLine(notes, dependentRef.path, dependentRef.blockId);
      if (located.reason) {
        return null;
      }
      try {
        const planned = planDependencyEdit({
          content,
          parentLine: located.line,
          parentPath: dependentRef.path,
          add,
          remove,
          files: notes,
          vaultFiles,
          resolveLinkpath,
          blocksLinesEnabled: false,
        });
        return planned && planned.ok ? planned : null;
      } catch (_error) {
        return null;
      }
    };
    const edits = [];
    if (to === "owner-waits") {
      edits.push({
        dependent: owner,
        add: [other],
        remove: reversing ? [] : [],
      });
      if (reversing) {
        edits.push({ dependent: other, add: [], remove: [owner] });
      }
    } else {
      edits.push({
        dependent: other,
        add: [owner],
        remove: [],
      });
      if (reversing) {
        edits.push({ dependent: owner, add: [], remove: [other] });
      }
    }
    const dependencyPlans = [];
    for (const edit of edits) {
      const preview = planFor(edit.dependent, edit.add, edit.remove);
      if (!preview) {
        return refuse("plan-failed", "The dependency edit could not be planned");
      }
      dependencyPlans.push(
        Object.freeze({
          dependent: edit.dependent,
          add: Object.freeze(edit.add.slice()),
          remove: Object.freeze(edit.remove.slice()),
          previewChanged: preview.changed === true,
          nextContent: preview.nextContent,
        }),
      );
    }
    const links = tieAbsorptionLinkDeltas({
      pairs: [{ owner, other }],
      notes,
      resolveLinkpath,
    });
    const absorbedDrops = links.deltas.reduce(
      (count, delta) => count + delta.drops.length,
      0,
    );
    const noticeBase =
      to === "owner-waits"
        ? `⛓ Now waits on ${otherName}`
        : `🧱 ${otherName} now waits on this`;
    return Object.freeze({
      kind: "change",
      to,
      tieBefore: pair.tie,
      tieAfter: to === "owner-waits" ? "depends_out" : "depends_in",
      sameNote,
      reversing,
      dependency: Object.freeze(
        edits.map((edit) => Object.freeze({
          dependent: edit.dependent,
          add: Object.freeze(edit.add.slice()),
          remove: Object.freeze(edit.remove.slice()),
        })),
      ),
      dependencyPlans: Object.freeze(dependencyPlans),
      links: links.deltas,
      mirrors: links.mirrors,
      idsNeeded,
      notice: reversing
        ? `⇄ Reversed · ${noticeBase}`
        : absorbedDrops > 0
          ? `${noticeBase} · replaced the 🪢 link`
          : noticeBase,
    });
  }

  // Plain-link chords (⌃L / ⌃⇧L): release any dependency between the pair,
  // else ensure the plain edge. A labelled owner→other entry already
  // satisfies the chord; an existing reverse plain or labelled entry is a
  // no-op.
  const outIsOwnerSide = to === "plain-out";
  const dependencyTies = pair.tie === "depends_out" || pair.tie === "depends_in" || pair.tie === "depends_both";
  const ownerLinks = outIsOwnerSide ? ownerPlain : otherPlain;
  const reverseLinks = outIsOwnerSide ? otherPlain : ownerPlain;
  const ownerTaskLines = outIsOwnerSide ? ownerFound.lines : otherFound.lines;
  const ownerTaskLine = outIsOwnerSide ? ownerFound.line : otherFound.line;
  const ownerTaskPath = outIsOwnerSide ? owner.path : other.path;
  const ownerTaskRef = outIsOwnerSide ? owner : other;
  const counterpartRef = outIsOwnerSide ? other : owner;
  const counterpartIdentity = outIsOwnerSide ? otherIdentity : ownerIdentity;
  const reverseIdentity = outIsOwnerSide ? ownerIdentity : otherIdentity;
  const ownerSideHasPlain =
    ownerLinks.ok &&
    ownerLinks.out.some((entry) => tieIdentityOf(entry) === counterpartIdentity);
  const reverseHasPlain =
    reverseLinks.ok &&
    reverseLinks.out.some((entry) => tieIdentityOf(entry) === reverseIdentity);
  const ownerSideHasLabelled = tieHasLabelledEntry(
    ownerTaskLines,
    ownerTaskLine,
    ownerTaskPath,
    counterpartRef,
    resolveLinkpath,
  );
  const reverseHasLabelled = tieHasLabelledEntry(
    outIsOwnerSide ? otherFound.lines : ownerFound.lines,
    outIsOwnerSide ? otherFound.line : ownerFound.line,
    outIsOwnerSide ? other.path : owner.path,
    outIsOwnerSide ? owner : other,
    resolveLinkpath,
  );
  if (!dependencyTies && (ownerSideHasPlain || ownerSideHasLabelled)) {
    return Object.freeze({
      kind: "noop",
      to,
      tie: pair.tie,
      notice: outIsOwnerSide ? "Already links to it" : "Already links here",
    });
  }
  if (!dependencyTies && (reverseHasPlain || reverseHasLabelled)) {
    return Object.freeze({
      kind: "noop",
      to,
      tie: pair.tie,
      notice: outIsOwnerSide ? "Already linked from it" : "Already linked to it",
    });
  }
  if (ownerLinks.reason === "malformed-links-line") {
    return refuse("malformed-links-line", "Its LINKS line is malformed");
  }
  const releaseEdits = [];
  if (pair.tie === "depends_out") {
    releaseEdits.push({ dependent: owner, add: [], remove: [other] });
  } else if (pair.tie === "depends_in") {
    releaseEdits.push({ dependent: other, add: [], remove: [owner] });
  } else if (pair.tie === "depends_both") {
    releaseEdits.push({ dependent: owner, add: [], remove: [other] });
    releaseEdits.push({ dependent: other, add: [], remove: [owner] });
  }
  const needsPlainAdd = !ownerSideHasPlain && !ownerSideHasLabelled;
  let linksAddPreview = null;
  if (needsPlainAdd) {
    const targetNote =
      ownerTaskPath === counterpartRef.path
        ? ""
        : String(counterpartRef.path.split("/").pop() || "").replace(/\.md$/i, "");
    try {
      const attempted = planLinksEdit(notes.get(ownerTaskPath), ownerTaskLine, {
        add: [
          {
            link: relationLinkText({ note: targetNote, blockId: counterpartRef.blockId }),
            label: null,
          },
        ],
      });
      linksAddPreview = attempted && attempted.ok ? attempted : null;
    } catch (_error) {
      linksAddPreview = null;
    }
    if (!linksAddPreview) {
      return refuse("plan-failed", "The plain link could not be planned");
    }
  }
  // A release keeps every plain entry (the surviving plain link is the
  // release target) and every mirror, so there is nothing to absorb.
  const links = tieAbsorptionLinkDeltas({ pairs: [], notes, resolveLinkpath });
  const released = dependencyTies
    ? (outIsOwnerSide
      ? `🪢 Now links to ${otherName} · no longer waits on it`
      : `🪢 Now links here from ${ownerName} · no longer waits on it`)
    : (outIsOwnerSide ? `🪢 Now links to ${otherName}` : `🪢 Now links here from ${ownerName}`);
  return Object.freeze({
    kind: "change",
    to,
    tieBefore: pair.tie,
    tieAfter: outIsOwnerSide ? "plain_out" : "plain_in",
    sameNote,
    reversing: false,
    dependency: Object.freeze(
      releaseEdits.map((edit) => Object.freeze({
        dependent: edit.dependent,
        add: Object.freeze([]),
        remove: Object.freeze(edit.remove.slice()),
      })),
    ),
    dependencyPlans: Object.freeze([]),
    links: links.deltas,
    mirrors: links.mirrors,
    plainAdd: needsPlainAdd
      ? Object.freeze({
        path: ownerTaskPath,
        link: relationLinkText({
          note: ownerTaskPath === counterpartRef.path
            ? ""
            : String(counterpartRef.path.split("/").pop() || "").replace(/\.md$/i, ""),
          blockId: counterpartRef.blockId,
        }),
        previewChanged: linksAddPreview ? linksAddPreview.changed === true : false,
      })
      : null,
    idsNeeded,
    notice: released,
  });
}

// Whether the task's LINKS lines hold a labelled entry for the counterpart
// (a labelled entry satisfies a plain-link chord and is never absorbed).
function tieHasLabelledEntry(lines, taskLine, ownerPath, counterpart, resolveLinkpath) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(taskLine)) {
      return false;
    }
    const children = findLinksChildren(lines, taskLine);
    for (const index of children) {
      const parsed = parseLinksLine(String(lines[index] || ""), { isDirectChildOfTask: true });
      if (!parsed || parsed.verdict !== "accept") {
        continue;
      }
      for (const entry of parsed.entries || []) {
        if (!entry.label) {
          continue;
        }
        const targetPath = dependencyPathForLinkNote(entry.note, ownerPath, resolveLinkpath);
        if (
          normalizeVaultRelativePath(targetPath) === counterpart.path &&
          normalizeBulletPropertyValue(entry.blockId) === counterpart.blockId
        ) {
          return true;
        }
      }
    }
  } catch (_error) {
    return false;
  }
  return false;
}
