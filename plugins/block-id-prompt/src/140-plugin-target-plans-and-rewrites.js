class BlockIdPromptTargetPlansAndRewritesMixin {
  sourceMarkerStillPresent(source, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    return true;
  }

  taskLineStillPresent(content, task, filePath) {
    const currentLine = contentLineAt(content, task && task.line);
    if (currentLine === null || currentLine !== task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${filePath}`);
      return false;
    }

    return true;
  }

  // Apply a planTargetTaskUpdate() plan as one guarded target-note write: for
  // the active source note, every discrete edit is applied to the live editor
  // (so unrelated document state is left untouched); for any other note, the
  // complete postimage is written in a single vault.modify call. Re-reads and
  // matches `expectedContent` first so a target that changed since the plan
  // was built is never silently overwritten.
  async applyTargetTaskPlan(file, source, plan, expectedContent, options = {}) {
    const noticePrefix = options.noticePrefix || "Task link stopped";
    const quiet = options.quiet === true;
    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      if (!quiet) {
        new Notice(`${noticePrefix}: ${file.path} could not be read`);
      }
      return false;
    }

    if (content !== expectedContent) {
      if (!quiet) {
        new Notice(`${noticePrefix}: ${file.path} changed before update`);
      }
      return false;
    }

    if (file.path === source.sourcePath) {
      if (!source.editor || typeof source.editor.replaceRange !== "function") {
        if (!quiet) {
          new Notice(`${noticePrefix}: active note could not be modified`);
        }
        return false;
      }

      this.suppressEditorScans();
      const sortedEdits = [...plan.edits].sort((left, right) => right.start - left.start);
      for (const edit of sortedEdits) {
        source.editor.replaceRange(
          edit.replacement,
          indexToEditorPosition(content, edit.start),
          indexToEditorPosition(content, edit.end),
        );
      }
      return true;
    }

    try {
      await this.app.vault.modify(file, plan.content);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify task note", error);
      if (!quiet) {
        new Notice(`${noticePrefix}: ${file.path} could not be modified`);
      }
      return false;
    }
  }

  // When a Schedule Log entry was inserted into the same note the Pomodoro
  // source link lives in, everything from that insertion point onward shifts
  // down by one line. Return a copy of `source` with its line corrected so
  // sourceMarkerStillPresent/completeTaskSourceLink keep locating the marker
  // by position rather than by fuzzy text search.
  adjustSourceForPlan(source, targetPath, plan) {
    if (
      !plan ||
      !plan.logEntryAdded ||
      targetPath !== source.sourcePath ||
      plan.logInsertLine > source.line
    ) {
      return source;
    }

    return { ...source, line: source.line + 1 };
  }

  directRenameSourceStillPresent(source) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      new Notice("Block ID rename blocked: selected block changed before rename");
      return false;
    }

    return true;
  }

  directAddSourceStillPresent(source) {
    if (!source.editor || typeof source.editor.getValue !== "function") {
      new Notice("Block ID add blocked: active note could not be read");
      return false;
    }

    const lines = source.editor.getValue().split("\n");
    if (
      source.rangeStartLine < 0 ||
      source.rangeEndLine >= lines.length ||
      source.line >= lines.length
    ) {
      new Notice("Block ID add blocked: selected block changed before add");
      return false;
    }

    const currentBlockText = lineRangeText(
      lines,
      source.rangeStartLine,
      source.rangeEndLine,
    );
    if (currentBlockText !== source.expectedBlockText) {
      new Notice("Block ID add blocked: selected block changed before add");
      return false;
    }

    return true;
  }

  async buildReferenceRewritePlan(source, destination, newId, options = {}) {
    const requireSourceMarker = options.requireSourceMarker !== false;
    const candidateFiles = await this.collectCandidateReferenceFiles(
      destination.file,
      source,
    );
    const filePlans = [];
    let editCount = 0;
    let unsupportedCount = 0;
    let sourceMarkerPlanned = false;
    let destinationContentAfterReferences = null;

    for (const file of candidateFiles) {
      const snapshot = await this.readFileSnapshot(file, source);
      if (snapshot === null) {
        new Notice(`Block ID rename blocked: ${file.path} could not be read`);
        return null;
      }

      const sourceMarkerStart =
        requireSourceMarker && file.path === source.sourcePath
          ? editorPositionToIndex(snapshot, {
              line: source.line,
              ch: source.startCh,
            })
          : null;
      const sourceMarkerEnd =
        sourceMarkerStart === null ? null : sourceMarkerStart + source.raw.length;
      const edits = [];

      for (const reference of collectWikiBlockReferences(snapshot)) {
        if (reference.oldId !== source.oldId) {
          continue;
        }

        const targetFile = this.resolveReferenceDestination(reference, file.path);
        if (!targetFile || targetFile.path !== destination.file.path) {
          continue;
        }

        if (snapshot.slice(reference.start, reference.end) !== reference.raw) {
          unsupportedCount += 1;
          continue;
        }

        const replacement = sourceReplacement(reference, newId);
        if (replacement !== reference.raw) {
          edits.push({
            start: reference.start,
            end: reference.end,
            replacement,
          });
          editCount += 1;
        }

        if (
          file.path === source.sourcePath &&
          reference.start === sourceMarkerStart &&
          reference.end === sourceMarkerEnd
        ) {
          sourceMarkerPlanned = true;
        }
      }

      for (const reference of collectMarkdownBlockReferences(snapshot)) {
        if (reference.oldId !== source.oldId) {
          continue;
        }

        const targetFile = this.resolveReferenceDestination(reference, file.path);
        if (targetFile && targetFile.path === destination.file.path) {
          unsupportedCount += 1;
        }
      }

      if (!validateNonOverlappingEdits(edits)) {
        new Notice("Block ID rename blocked: overlapping link edits were found");
        return null;
      }

      if (file.path === destination.file.path) {
        destinationContentAfterReferences = applyTextEdits(snapshot, edits);
      }

      if (edits.length > 0) {
        filePlans.push({
          file,
          content: snapshot,
          edits,
        });
      }
    }

    if (requireSourceMarker && !sourceMarkerPlanned) {
      new Notice("Block ID rename blocked: source marker link was not found");
      return null;
    }

    return {
      filePlans,
      editCount,
      unsupportedCount,
      destinationContentAfterReferences:
        destinationContentAfterReferences === null
          ? destination.content
          : destinationContentAfterReferences,
    };
  }

  replaceSourceLink(source, id, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    this.suppressEditorScans();
    source.editor.replaceRange(
      sourceReplacement(source, id),
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );

    return true;
  }

  completeTaskSourceLink(source, id, destinationPath) {
    if (
      !source.editor ||
      typeof source.editor.getValue !== "function" ||
      typeof source.editor.replaceRange !== "function"
    ) {
      new Notice("Block marker link changed before it could be rewritten");
      return null;
    }

    const snapshot = source.editor.getValue();
    const markerStart = editorPositionToIndex(snapshot, {
      line: source.line,
      ch: source.startCh,
    });
    const markerEnd = markerStart === null ? null : markerStart + source.raw.length;
    if (
      markerStart === null ||
      markerEnd === null ||
      snapshot.slice(markerStart, markerEnd) !== source.raw
    ) {
      new Notice("Block marker link changed before it could be rewritten");
      return null;
    }

    const replacement = sourceReplacement(source, id, CANONICAL_BLOCK_LINK_PREFIX);
    const cleanup = planFuturePomodoroLinkCleanup(snapshot, {
      sourceLine: source.line,
      sourcePath: source.sourcePath,
      targetPath: destinationPath,
      targetBlockId: id,
      resolveTarget: (reference) =>
        this.resolveReferenceDestination(reference, source.sourcePath),
    });
    const edits = [
      { start: markerStart, end: markerEnd, replacement },
      ...cleanup.edits,
    ];

    if (
      !validateNonOverlappingEdits(edits) ||
      source.editor.getValue() !== snapshot
    ) {
      new Notice("Block marker link changed before it could be rewritten");
      return null;
    }

    this.suppressEditorScans();
    const sorted = [...edits].sort((left, right) => right.start - left.start);
    for (const edit of sorted) {
      source.editor.replaceRange(
        edit.replacement,
        indexToEditorPosition(snapshot, edit.start),
        indexToEditorPosition(snapshot, edit.end),
      );
    }

    setEditorCursorIfPossible(source.editor, {
      line: source.line,
      ch: source.startCh + replacement.length,
    });

    return { removedCount: cleanup.removedCount };
  }

  futureLinkCleanupNoticeSuffix(removedCount) {
    if (!Number.isInteger(removedCount) || removedCount <= 0) {
      return "";
    }

    return ` · removed ${removedCount} future ${pluralize(
      removedCount,
      "link",
      "links",
    )}`;
  }

  revertTaskPickerMarker(source, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    this.suppressEditorScans();
    source.editor.replaceRange(
      taskPickerRevertReplacement(source),
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );
    setEditorCursorIfPossible(source.editor, {
      line: source.line,
      ch: taskPickerRevertCursorCh(source),
    });

    return true;
  }

}
