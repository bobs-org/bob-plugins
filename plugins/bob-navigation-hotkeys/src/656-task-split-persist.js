// Guarded task-split persistence and the `api.taskSplit` v1 namespace.
// Extracted from `653-plugin-task-split.js` so the ordinary split gesture
// and the requirement-carry API share one write path: the destination note
// first, then any other changed note, then the source stub, with preimage
// guards on every write, rollback of applied writes, and recovery copies
// when a created note cannot be safely removed. The API itself never
// navigates and never shows its own Undo notice; callers own those.

class BobNavigationHotkeysTaskSplitPersistMixin {
  // Persist every postimage of a task-split plan. `context` carries the
  // source path, its open editor (when any), and the plan-time `before`
  // contents keyed by path. Returns `{ok: true, written, restores}` or a
  // typed `{ok: false, code, message, failedPaths?}` refusal. `restores`
  // holds exact before/after snapshots plus `created` flags for every
  // changed file, so a later Undo can restore the whole batch.
  async persistTaskSplitPostimages(plan, context) {
    const vault = this.app && this.app.vault;
    if (!vault) {
      return {
        ok: false,
        code: "split_unavailable",
        message: "Vault content updates are unavailable",
      };
    }
    const input = context && typeof context === "object" ? context : {};
    const sourcePath = String(input.sourcePath || "");
    const settleToday = String(
      input.today || formatProjectTaskCreatedDate(new Date()),
    );
    const session = {
      sourcePath,
      editor: input.sourceEditor || null,
      settleNav: true,
      settleToday,
      dailyPath: input.dailyPath,
    };
    const before =
      input.before && typeof input.before === "object" ? input.before : {};
    const postimages = (plan && plan.files) || {};
    const ordered = Object.keys(postimages).sort((left, right) => {
      const rank = (entry) =>
        entry === plan.cursor.path && entry !== sourcePath
          ? 0
          : entry === sourcePath
            ? 2
            : 1;
      return rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0);
    });
    const stagedChanges = new Map();
    for (const entry of ordered) {
      const hasPreimage = Object.prototype.hasOwnProperty.call(before, entry);
      stagedChanges.set(entry, Object.freeze({
        before: hasPreimage ? String(before[entry]) : "",
        after: String(postimages[entry]),
      }));
    }
    const settledChanges = prepareNavSettledChangeMap(
      this,
      stagedChanges,
      { today: settleToday, dailyPath: input.dailyPath },
    );
    // Upfront: a changed path that already exists must be a Markdown note.
    // No write has happened yet, so this refusal leaves nothing behind.
    for (const entry of ordered) {
      const file =
        typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(entry)
          : null;
      if (file && !this.isMarkdownFile(file)) {
        return {
          ok: false,
          code: "split_destination_not_markdown",
          message: `Split destination is not a Markdown note: ${entry}`,
        };
      }
      const hasPreimage = Object.prototype.hasOwnProperty.call(before, entry);
      if ((file && !hasPreimage) || (!file && hasPreimage)) {
        return {
          ok: false,
          code: "split_write_failed",
          message: "Split destination changed; nothing was written",
        };
      }
    }
    const written = [];
    try {
      for (const entry of ordered) {
        const change = settledChanges.get(entry);
        const hadPreimage = Object.prototype.hasOwnProperty.call(
          before,
          entry,
        );
        const file =
          typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(entry)
            : null;
        if (file && !this.isMarkdownFile(file)) {
          throw new Error(
            `Split destination is not a Markdown note: ${entry}`,
          );
        }
        if (file) {
          if (!hadPreimage) {
            throw new Error("Split destination changed; nothing was written");
          }
          written.push(
            await this.writeTaskMoveChange(
              entry,
              change,
              file,
              session,
            ),
          );
        } else {
          if (hadPreimage) {
            throw new Error("Split destination changed; nothing was written");
          }
          if (typeof vault.create !== "function") {
            throw new Error("Vault content updates are unavailable");
          }
          const created = await vault.create(entry, change.after);
          written.push({
            path: entry,
            file: created,
            editor: null,
            change: { before: "", after: change.after },
            created: true,
            settleOutcome: null,
          });
        }
      }

      const finalContents = new Map();
      const lineMaps = {};
      for (const entry of ordered) {
        const staged = settledChanges.get(entry);
        const record = written.find((item) => item.path === entry);
        finalContents.set(entry, record ? record.change.after : staged.after);
        lineMaps[entry] = record && record.settleOutcome &&
          record.settleOutcome.lineMap
          ? record.settleOutcome.lineMap
          : staged.lineMap;
      }
      const plannedTasks = Array.isArray(plan && plan.tasks) ? plan.tasks : [];
      const stagedAnchors = plannedTasks.map((task) => {
        const path = String(task && task.path || "");
        const line = Math.floor(Number(task && task.line));
        const stagedLines = splitMarkdownContent(String(postimages[path] || "")).lines;
        const text = line > 0 ? String(stagedLines[line - 1] || "") : "";
        const blockId = task && typeof task.block_id === "string"
          ? task.block_id
          : navTaskSettleLineBlockId(text);
        return { path, line, blockId, text };
      });
      if (stagedAnchors.length === 0 && plan && plan.cursor) {
        const path = String(plan.cursor.path || "");
        const line = Math.floor(Number(plan.cursor.line));
        const stagedLines = splitMarkdownContent(String(postimages[path] || "")).lines;
        const text = line > 0 ? String(stagedLines[line - 1] || "") : "";
        stagedAnchors.push({
          path,
          line,
          blockId: navTaskSettleLineBlockId(text),
          text,
        });
      }
      const anchors = stagedAnchors.map((anchor) =>
        navResolveSettledTaskAnchor(
          String(finalContents.get(anchor.path) || ""),
          anchor,
        ),
      );
      if (anchors.some((anchor) => !anchor)) {
        throw new Error("Split task anchor could not be resolved after settling");
      }
      const cursorPlanTask = plannedTasks.find((task) =>
        task && plan && plan.cursor &&
          task.path === plan.cursor.path && task.line === plan.cursor.line,
      );
      const cursorPlanIndex = cursorPlanTask
        ? plannedTasks.indexOf(cursorPlanTask)
        : -1;
      const cursorAnchor = anchors[cursorPlanIndex] || anchors[0] || null;
      const moveMap = input.moveMap && typeof input.moveMap === "object"
        ? {
            ...input.moveMap,
            moves: (Array.isArray(input.moveMap.moves) ? input.moveMap.moves : [])
              .map((move) => ({
                ...move,
                to: navMapSettledOneBasedLine(
                  lineMaps[String(input.moveMap.destinationPath || "")],
                  move.to,
                ),
              })),
          }
        : null;
      const tasks = plannedTasks.map((task, index) => ({
        ...task,
        path: anchors[index].path,
        line: anchors[index].line,
        block_id: anchors[index].blockId,
        text: anchors[index].text,
      }));
      const records = new Map(written.map((entry) => [entry.path, entry]));
      const restores = ordered.map((entry) => {
        const record = records.get(entry);
        return {
          path: entry,
          before: record
            ? String(record.change.before)
            : stagedChanges.get(entry).before,
          after: record
            ? String(record.change.after)
            : String(finalContents.get(entry) || ""),
          created: record ? record.created === true : false,
        };
      });
      return {
        ok: true,
        written,
        restores,
        anchor: cursorAnchor,
        anchors: Object.freeze(anchors),
        tasks: Object.freeze(tasks),
        moveMap,
        lineMaps: Object.freeze(lineMaps),
      };
    } catch (error) {
      const partial = error && error.taskMoveAppliedEntry;
      if (
        partial &&
        partial.path &&
        !written.some((entry) => entry.path === partial.path)
      ) {
        written.push(partial);
      }
      const failedPaths = await this.rollbackTaskMoveChanges(
        written.filter((entry) => !entry.created),
      );
      for (const entry of written.filter((entry) => entry.created)) {
        if (failedPaths.length > 0) {
          // Keep the destination copy if any source postimage could not be
          // restored. A duplicate is recoverable; deleting it could lose work.
          failedPaths.push(entry.path);
          continue;
        }
        try {
          const current = String(
            (await vault.cachedRead(entry.file)) || "",
          );
          if (current !== entry.change.after) {
            failedPaths.push(entry.path);
            continue;
          }
          await vault.delete(entry.file);
        } catch (ignoredError) {
          failedPaths.push(entry.path);
        }
      }
      if (failedPaths.length > 0) {
        const paths = [...new Set(failedPaths)];
        return {
          ok: false,
          code: "split_partial_write",
          message: `Split wrote partially — review: ${paths.join(", ")}`,
          failedPaths: paths,
        };
      }
      return {
        ok: false,
        code: "split_write_failed",
        message:
          (error && error.message) || "Split failed to apply",
      };
    }
  }

  // `api.taskSplit` v1 implementation: carry the requirement at the 1-based
  // `line` of `notePath` into its own task. `expectedLine` is the digest of
  // the req line the caller saw; `expectedOwnerPreimage` is the exact
  // owner-block text the caller saw. Both refuse as `split_stale_ref` when
  // the note moved underneath the caller. Missing targets and unavailable
  // writers are typed refusals, never writes. Returns `{ok: true, task,
  // moveMap, restores, notice, cursor}` or `{ok: false, code, message,
  // failedPaths?}`. `task` is `{path, line, blockId, text}` with 1-based
  // `line`; `moveMap` is `{sourcePath, destinationPath, moves}` with 1-based
  // line moves; `restores` carries exact before/after snapshots and
  // `created` flags for every changed file. The result never navigates and
  // never shows an Undo notice: the standalone command owns its
  // notice/navigation, and the close card owns the batch receipt.
  async taskSplitCarryReq(request) {
    const input = request && typeof request === "object" ? request : {};
    const notePath = String(input.notePath || "");
    const line = Math.floor(Number(input.line || 0));
    if (!notePath || !Number.isInteger(line) || line < 1) {
      return {
        ok: false,
        code: "split_stale_ref",
        message: "stale requirement reference; list candidates and try again",
      };
    }
    // Editor-first live text: the open editor is fresher than the vault.
    let sourceEditor = null;
    let source = null;
    try {
      sourceEditor =
        typeof this.getOpenMarkdownEditorForPath === "function"
          ? this.getOpenMarkdownEditorForPath(notePath)
          : null;
      if (sourceEditor && typeof sourceEditor.getValue === "function") {
        source = String(sourceEditor.getValue() || "");
      }
    } catch (_error) {
      sourceEditor = null;
    }
    const vault = this.app && this.app.vault;
    if (source === null) {
      try {
        const sourceFile =
          vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(notePath)
            : null;
        if (!sourceFile) {
          return {
            ok: false,
            code: "split_owner_missing",
            message: `${notePath} does not exist in the vault`,
          };
        }
        if (
          typeof this.isMarkdownFile === "function" &&
          !this.isMarkdownFile(sourceFile)
        ) {
          return {
            ok: false,
            code: "split_destination_not_markdown",
            message: `Split destination is not a Markdown note: ${notePath}`,
          };
        }
        source = String((await vault.cachedRead(sourceFile)) || "");
      } catch (_error) {
        return {
          ok: false,
          code: "split_unavailable",
          message: "Vault content updates are unavailable",
        };
      }
    }
    const today = formatProjectTaskCreatedDate(new Date());
    const settings = {
      linked_from_mentions: loadRelationsLinkedFromMentionsEnabled(),
      linked_from_lines: loadRelationsLinkedFromLinesEnabled(),
      inbox_route: INBOX_NOTE_PATH,
    };
    // Destination pre-read for placement: a daily-note owner carries into
    // its root note (or the inbox), so that note must be in the plan's
    // files map. A missing destination is created at persist time.
    const files = { [notePath]: source };
    try {
      const probeLines = taskSplitLines(source);
      const probeStripped = probeLines.map((entry) =>
        taskSplitStripEnding(entry),
      );
      const probeFrontmatter = taskSplitFrontmatterEnd(probeStripped);
      const probeFenced = taskSplitFencedLines(
        probeStripped,
        probeFrontmatter === -1 ? 0 : probeFrontmatter + 1,
      );
      const node =
        taskReqForest(source).find(
          (entry) => entry.lineIndex === line - 1,
        ) || null;
      if (node) {
        const resolved = taskSplitResolveOwner(
          probeLines,
          probeStripped,
          probeFenced,
          notePath,
          {
            ownerLine: node.ownerIndex + 1,
            selection: { kind: "cursor", line: node.ownerIndex + 1 },
          },
        );
        if (!resolved.error) {
          const placement = taskSplitChoosePlacement(
            notePath,
            probeLines,
            resolved.owner,
            INBOX_NOTE_PATH,
          );
          if (placement.path !== notePath) {
            const candidates = [placement.path];
            const withExt = taskSplitPathWithMd(placement.path);
            if (!candidates.includes(withExt)) {
              candidates.push(withExt);
            }
            for (const candidate of candidates) {
              if (Object.prototype.hasOwnProperty.call(files, candidate)) {
                break;
              }
              let editor = null;
              try {
                editor =
                  typeof this.getOpenMarkdownEditorForPath === "function"
                    ? this.getOpenMarkdownEditorForPath(candidate)
                    : null;
                if (editor && typeof editor.getValue === "function") {
                  files[candidate] = String(editor.getValue() || "");
                  break;
                }
              } catch (_editorError) {
                editor = null;
              }
              const file =
                vault && typeof vault.getAbstractFileByPath === "function"
                  ? vault.getAbstractFileByPath(candidate)
                  : null;
              if (file) {
                files[candidate] = String(
                  (await vault.cachedRead(file)) || "",
                );
                break;
              }
            }
          }
        }
      }
    } catch (_error) {
      // The pure planner reports the failure with its typed refusal.
    }
    const planned = taskSplitPlanCarryReq(files, {
      notePath,
      line,
      expectedLine: input.expectedLine,
      expectedOwnerPreimage: input.expectedOwnerPreimage,
      today,
      settings,
    });
    if (!planned.ok) {
      return planned;
    }
    const persisted = await this.persistTaskSplitPostimages(planned.plan, {
      sourcePath: notePath,
      sourceEditor,
      before: files,
      today,
      moveMap: planned.moveMap,
    });
    if (!persisted.ok) {
      return persisted;
    }
    return {
      ok: true,
      task: persisted.anchor
        ? {
            ...planned.task,
            path: persisted.anchor.path,
            line: persisted.anchor.line,
            blockId: persisted.anchor.blockId,
          }
        : planned.task,
      moveMap: persisted.moveMap || planned.moveMap,
      restores: persisted.restores,
      notice: planned.plan.notice,
      cursor: persisted.anchor
        ? { path: persisted.anchor.path, line: persisted.anchor.line }
        : planned.plan.cursor,
    };
  }
}

// `api.taskSplit` v1 (`docs/develop/plugin-apis.md`): one guarded
// requirement carry. Never throws; a missing plugin answers `unavailable`.
function createTaskSplitApi(plugin) {
  return Object.freeze({
    version: 1,
    carryReq(request) {
      try {
        if (
          !plugin ||
          typeof plugin.taskSplitCarryReq !== "function"
        ) {
          return Promise.resolve({
            ok: false,
            code: "split_unavailable",
            message: "Task split is unavailable",
          });
        }
        return Promise.resolve()
          .then(() => plugin.taskSplitCarryReq(request || {}))
          .catch(() => ({
            ok: false,
            code: "split_unavailable",
            message: "Task split is unavailable",
          }));
      } catch (_error) {
        return Promise.resolve({
          ok: false,
          code: "split_unavailable",
          message: "Task split is unavailable",
        });
      }
    },
  });
}
