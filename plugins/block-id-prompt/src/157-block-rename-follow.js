// Undo follows a block-ID rename (plan 202611/lost_task_guards.md,
// rename_atomic; decision undo_follows_rename = yes).
//
// Editor undo only reaches notes open in an editor, and each note keeps its
// own history, so undoing a rename in one note used to leave every other note
// pointing at an ID that no longer existed. After a successful rename the
// plugin keeps a session-scoped record (destination path, task line, old and
// new ID, and the exact link spans it rewrote in each note). While any
// recorded note stays open, a change in that note's form (every recorded
// span back on the old ID, or forward on the new one) is followed into the
// other recorded notes through the same safe write paths. A note whose
// recorded spans no longer match exactly is never touched; the notes whose
// links now dangle are named in a sticky Notice instead.
//
// Closed-note writes await vault I/O. Genuine editor undo/redo during that
// wait is queued and the trigger note is revalidated afterward so the vault
// converges on the latest user form. The plugin's own transactions are not
// treated as a new undo or redo.
//
// Forms: "new" is the renamed state, "old" the original one.

const BLOCK_RENAME_FOLLOW_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_RENAME_FOLLOW_DEBOUNCE_MS = 120;
const BLOCK_RENAME_FOLLOW_MAX_RECORDS = 8;
const BLOCK_RENAME_FOLLOW_MAX_CYCLES = 8;

function blockRenameCountOccurrences(text, needle) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }

  return count;
}

// The form one recorded note is in right now: "new" when only the renamed
// forms of its recorded spans are present, "old" when only the original
// forms are, null when mixed or gone (mid-edit, hand edited, deleted).
function blockRenameNoteForm(noteRecord, content, record) {
  const forms = [];

  if (noteRecord.token) {
    const oldTokens = blockTokenMatches(content, record.oldId).length;
    const newTokens = blockTokenMatches(content, record.newId).length;
    if (oldTokens === 1 && newTokens === 0) {
      forms.push("old");
    } else if (newTokens === 1 && oldTokens === 0) {
      forms.push("new");
    } else {
      return null;
    }
  }

  if (noteRecord.links.length > 0) {
    let oldLinks = 0;
    let newLinks = 0;
    for (const raw of new Set(noteRecord.links.map((link) => link.before))) {
      oldLinks += blockRenameCountOccurrences(content, raw);
    }
    for (const raw of new Set(noteRecord.links.map((link) => link.after))) {
      newLinks += blockRenameCountOccurrences(content, raw);
    }
    if (oldLinks > 0 && newLinks === 0) {
      forms.push("old");
    } else if (newLinks > 0 && oldLinks === 0) {
      forms.push("new");
    } else {
      return null;
    }
  }

  if (forms.length === 0 || forms.some((form) => form !== forms[0])) {
    return null;
  }

  return forms[0];
}

class BlockIdPromptRenameFollowMixin {
  blockRenameRecordList() {
    if (!Array.isArray(this.blockRenameRecords)) {
      this.blockRenameRecords = [];
    }

    return this.blockRenameRecords;
  }

  pruneBlockRenameRecords() {
    const now = this.now().getTime();
    this.blockRenameRecords = this.blockRenameRecordList().filter(
      (record) => record.expiresAt > now,
    );
    return this.blockRenameRecords;
  }

  // Called after every successful rename write. `targets` are the per-note
  // writes (planned before-image plus edits); the recorded spans are exactly
  // what the rename rewrote.
  recordBlockRename(plan, targets) {
    const meta = plan && plan.rename;
    if (!meta || meta.oldId === meta.newId) {
      return null;
    }

    const now = this.now().getTime();
    const record = {
      destinationPath: meta.destinationPath,
      taskLine: meta.taskLine,
      oldId: meta.oldId,
      newId: meta.newId,
      createdAt: now,
      expiresAt: now + BLOCK_RENAME_FOLLOW_WINDOW_MS,
      notes: targets.map((target) => ({
        path: target.path,
        token: target.edits.some((edit) => edit.kind === "block-id"),
        links: target.edits
          .filter((edit) => edit.kind !== "block-id")
          .map((edit) => ({
            before: target.content.slice(edit.start, edit.end),
            after: edit.replacement,
          })),
        observed: "new",
      })),
    };

    const records = this.pruneBlockRenameRecords().filter(
      (existing) =>
        existing.destinationPath !== record.destinationPath ||
        existing.oldId !== record.oldId ||
        existing.newId !== record.newId,
    );
    records.push(record);
    while (records.length > BLOCK_RENAME_FOLLOW_MAX_RECORDS) {
      records.shift();
    }
    this.blockRenameRecords = records;
    return record;
  }

  // EditorView update hook (called for every editor update; must stay cheap
  // and never throw). Only notes in a live record are ever looked at.
  // Plugin-own transactions are ignored so follow writes cannot retrigger
  // themselves; genuine edits during awaited closed-note I/O stay queued.
  noteBlockRenameUpdate(update) {
    try {
      if (!update || !update.docChanged || this.renameFollowApplying) {
        return;
      }

      const records = this.pruneBlockRenameRecords();
      if (records.length === 0) {
        return;
      }

      const path = this.blockRenamePathForView(update.view);
      if (!path || !records.some((record) => record.notes.some((note) => note.path === path))) {
        return;
      }

      this.queueBlockRenameFollow(path);
    } catch (error) {
      // An editor update must never fail because of rename bookkeeping.
    }
  }

  queueBlockRenameFollow(path) {
    if (!(this.renameFollowPending instanceof Set)) {
      this.renameFollowPending = new Set();
    }
    this.renameFollowPending.add(path);
    if (this.renameFollowRunning) {
      this.renameFollowRerun = true;
      return;
    }
    if (this.renameFollowTimer !== null && this.renameFollowTimer !== undefined) {
      window.clearTimeout(this.renameFollowTimer);
    }
    this.renameFollowTimer = window.setTimeout(() => {
      this.renameFollowTimer = null;
      void this.runBlockRenameFollow();
    }, BLOCK_RENAME_FOLLOW_DEBOUNCE_MS);
  }

  blockRenamePathForView(cmView) {
    const workspace = this.app && this.app.workspace;
    if (!cmView || !workspace || typeof workspace.getLeavesOfType !== "function") {
      return null;
    }

    for (const leaf of workspace.getLeavesOfType("markdown") || []) {
      const view = leaf && leaf.view;
      if (view && view.file && view.editor && view.editor.cm === cmView) {
        return view.file.path;
      }
    }

    return null;
  }

  clearBlockRenameFollow() {
    if (this.renameFollowTimer !== null && this.renameFollowTimer !== undefined) {
      window.clearTimeout(this.renameFollowTimer);
    }
    this.renameFollowTimer = null;
    this.renameFollowPending = new Set();
    this.blockRenameRecords = [];
  }

  async runBlockRenameFollow() {
    if (this.renameFollowRunning) {
      this.renameFollowRerun = true;
      return;
    }

    this.renameFollowRunning = true;
    try {
      let cycles = 0;
      do {
        this.renameFollowRerun = false;
        const paths = Array.from(this.renameFollowPending || []);
        this.renameFollowPending = new Set();
        for (const path of paths) {
          await this.evaluateBlockRenameFollow(path);
        }
        cycles += 1;
      } while (
        (this.renameFollowRerun || (this.renameFollowPending && this.renameFollowPending.size > 0)) &&
        cycles < BLOCK_RENAME_FOLLOW_MAX_CYCLES
      );
    } catch (error) {
      console.error("Block ID Prompt failed to follow a block ID rename", error);
    } finally {
      this.renameFollowRunning = false;
    }
  }

  // `path` changed in an open editor. Follow a form change in it into the
  // other notes of every live record that lists it.
  async evaluateBlockRenameFollow(path) {
    for (const record of this.pruneBlockRenameRecords().slice()) {
      const noteRecord = record.notes.find((note) => note.path === path);
      if (!noteRecord) {
        continue;
      }

      const open = findOpenPromptTargetEditors(this, path);
      if (open.length === 0 || open.some((entry) => entry.content !== open[0].content)) {
        continue;
      }

      const observed = blockRenameNoteForm(noteRecord, open[0].content, record);
      if (observed === null || observed === noteRecord.observed) {
        continue;
      }

      await this.followBlockRename(record, noteRecord, observed);
    }
  }

  liveBlockRenameForm(record, noteRecord) {
    const open = findOpenPromptTargetEditors(this, noteRecord.path);
    if (open.length === 0) {
      return null;
    }
    if (open.some((entry) => entry.content !== open[0].content)) {
      return null;
    }
    return blockRenameNoteForm(noteRecord, open[0].content, record);
  }

  async followBlockRename(record, triggerNote, targetForm) {
    const liveForm = this.liveBlockRenameForm(record, triggerNote);
    if (liveForm !== targetForm) {
      return;
    }

    triggerNote.observed = targetForm;

    const targets = [];
    const stuck = [];
    for (const noteRecord of record.notes) {
      if (noteRecord === triggerNote) {
        continue;
      }

      if (this.liveBlockRenameForm(record, triggerNote) !== targetForm) {
        this.queueBlockRenameFollow(triggerNote.path);
        return;
      }

      const prepared = await this.prepareBlockRenameFollowTarget(
        record,
        noteRecord,
        targetForm,
      );
      if (prepared.state === "already") {
        noteRecord.observed = targetForm;
      } else if (prepared.state === "ready") {
        targets.push({ noteRecord, target: prepared.target });
      } else {
        stuck.push(noteRecord);
      }
    }

    if (this.liveBlockRenameForm(record, triggerNote) !== targetForm) {
      this.queueBlockRenameFollow(triggerNote.path);
      return;
    }

    if (targets.length > 0) {
      const committed = await this.commitRenameWrites(
        targets.map((entry) => entry.target),
      );
      const after = this.liveBlockRenameForm(record, triggerNote);
      for (const entry of targets) {
        if (committed) {
          entry.noteRecord.observed = targetForm;
        } else {
          stuck.push(entry.noteRecord);
        }
      }
      if (after !== targetForm) {
        this.queueBlockRenameFollow(triggerNote.path);
        if (!committed) {
          this.noticeBlockRenameFollow(record, targetForm, targets);
        }
        return;
      }
    }

    this.noticeBlockRenameFollow(record, targetForm, targets);
  }

  async prepareBlockRenameFollowTarget(record, noteRecord, targetForm) {
    const file = this.app.vault.getAbstractFileByPath(noteRecord.path);
    if (!(file instanceof TFile)) {
      return { state: "stuck" };
    }

    let snapshot = null;
    try {
      snapshot = await readAuthoritativePromptTargetContent(this, { sourcePath: "" }, file);
    } catch (error) {
      return { state: "stuck" };
    }
    if (!snapshot || snapshot.ambiguous || typeof snapshot.content !== "string") {
      return { state: "stuck" };
    }

    if (blockRenameNoteForm(noteRecord, snapshot.content, record) === targetForm) {
      return { state: "already" };
    }

    const edits = this.planRecordedBlockRename(record, noteRecord, snapshot.content, targetForm);
    if (!edits) {
      return { state: "stuck" };
    }

    return {
      state: "ready",
      target: {
        file,
        path: noteRecord.path,
        content: snapshot.content,
        edits,
        after: applyTextEdits(snapshot.content, edits),
        editor: snapshot.editor || null,
        isSource: false,
      },
    };
  }

  // Rewrite only the recorded spans, and only when the note still holds
  // exactly the recorded number of each one. Anything else is ambiguous
  // (a span was edited, copied, or removed since the rename) and returns null.
  planRecordedBlockRename(record, noteRecord, content, targetForm) {
    const toNew = targetForm === "new";
    const fromId = toNew ? record.oldId : record.newId;
    const toId = toNew ? record.newId : record.oldId;
    const wanted = new Map();
    for (const link of noteRecord.links) {
      const fromRaw = toNew ? link.before : link.after;
      const toRaw = toNew ? link.after : link.before;
      const entry = wanted.get(fromRaw) || { toRaw, expected: 0, found: 0 };
      entry.expected += 1;
      wanted.set(fromRaw, entry);
    }

    const edits = [];
    for (const reference of collectWikiBlockReferences(content)) {
      const entry = wanted.get(content.slice(reference.start, reference.end));
      if (!entry) {
        continue;
      }

      const target = this.resolveReferenceDestination(reference, noteRecord.path);
      if (!target || target.path !== record.destinationPath) {
        continue;
      }

      entry.found += 1;
      edits.push({
        start: reference.start,
        end: reference.end,
        replacement: entry.toRaw,
      });
    }

    for (const entry of wanted.values()) {
      if (entry.found !== entry.expected) {
        return null;
      }
    }

    if (noteRecord.token) {
      const matches = blockTokenMatches(content, fromId);
      if (matches.length !== 1 || blockTokenMatches(content, toId).length !== 0) {
        return null;
      }
      edits.push({
        start: matches[0].start,
        end: matches[0].end,
        replacement: `^${toId}`,
        kind: "block-id",
      });
    }

    return validateNonOverlappingEdits(edits) ? edits : null;
  }

  noticeBlockRenameFollow(record, targetForm, targets) {
    const undone = targetForm === "old";
    const rewritten = targets.filter((entry) => entry.noteRecord.observed === targetForm).length;

    const destinationNote = record.notes.find((note) => note.token);
    const destinationForm = destinationNote ? destinationNote.observed : targetForm;
    const dangling = record.notes.filter(
      (note) => note.links.length > 0 && note.observed !== destinationForm,
    );

    if (dangling.length === 0) {
      if (rewritten > 0) {
        new Notice(
          `${undone ? "Undid" : "Redid"} block ID rename in ${rewritten} ${pluralize(
            rewritten,
            "note",
            "notes",
          )}`,
        );
      }
      return;
    }

    const deadId = dangling[0].observed === "new" ? record.newId : record.oldId;
    const scope =
      rewritten > 0
        ? ` in ${rewritten} ${pluralize(rewritten, "note", "notes")}`
        : "";
    new Notice(
      `Block ID rename ${undone ? "undone" : "redone"}${scope}, but links in ${dangling
        .map((note) => note.path)
        .join(", ")} still point to ^${deadId}, which is gone from ${record.destinationPath}`,
      0,
    );
  }
}
