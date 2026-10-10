// Source-to-suggestion resolver for prompt block IDs
// (plan 202610/task_block_id_prefill.md). All entry points converge on
// `openBlockIdPrompt`; the modal calls `resolvePromptBlockIdSuggestion`
// so gestures share one naming path. Pure naming lives in
// 015-prompt-block-id-naming.js; this fragment only resolves *which* task
// text and *which* note content seed it, preferring live editor buffers.

function findOpenPromptTargetEditors(plugin, targetPath) {
  const editors = [];
  try {
    const workspace = plugin && plugin.app && plugin.app.workspace;
    if (!workspace || typeof workspace.getLeavesOfType !== "function") {
      return editors;
    }
    const leaves = workspace.getLeavesOfType("markdown") || [];
    for (const leaf of leaves) {
      const view = leaf && leaf.view;
      if (
        !view ||
        !view.file ||
        view.file.path !== targetPath ||
        !view.editor ||
        typeof view.editor.getValue !== "function"
      ) {
        continue;
      }
      try {
        editors.push({
          editor: view.editor,
          content: String(view.editor.getValue() || ""),
        });
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    return editors;
  }
  return editors;
}

// Authoritative target snapshot: same-note reads use the source editor;
// cross-note reads prefer an open target editor (unsaved wins over disk),
// otherwise the vault. Multiple disagreeing live buffers refuse instead of
// guessing. Returns `{ content, editor }` or `{ content: null, ambiguous }`.
async function readAuthoritativePromptTargetContent(plugin, source, targetFile) {
  if (
    targetFile &&
    targetFile.path === source.sourcePath &&
    source.editor &&
    typeof source.editor.getValue === "function"
  ) {
    try {
      return { content: String(source.editor.getValue() || ""), editor: source.editor };
    } catch (error) {
      return { content: null, editor: null, error: true };
    }
  }

  if (!targetFile) {
    return { content: null, editor: null, error: true };
  }

  const openEditors = findOpenPromptTargetEditors(plugin, targetFile.path);
  if (openEditors.length === 1) {
    return { content: openEditors[0].content, editor: openEditors[0].editor };
  }
  if (openEditors.length > 1) {
    const first = openEditors[0].content;
    const agrees = openEditors.every((entry) => entry.content === first);
    if (!agrees) {
      return { content: null, editor: null, ambiguous: true };
    }
    return { content: first, editor: openEditors[0].editor };
  }

  try {
    const content = await plugin.app.vault.read(targetFile);
    if (typeof content !== "string") {
      return { content: null, editor: null, error: true };
    }
    return { content, editor: null };
  } catch (error) {
    return { content: null, editor: null, error: true };
  }
}

function getDirectAddPromptRootLine(source) {
  try {
    if (!source || !source.editor || typeof source.editor.getValue !== "function") {
      return null;
    }
    const lines = String(source.editor.getValue() || "").split("\n");
    const start = source.rangeStartLine;
    const end = source.rangeEndLine;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end >= lines.length ||
      start > end
    ) {
      return null;
    }
    if (typeof source.expectedBlockText === "string") {
      const current = lineRangeText(lines, start, end);
      if (current !== source.expectedBlockText) {
        return null;
      }
    }
    const rootLine = lines[start];
    if (promptBlockIdExtractTaskBody(rootLine) === null) {
      return null;
    }
    return rootLine;
  } catch (error) {
    return null;
  }
}

// Resolve which suggestion (if any) seeds the modal. Returns
// `{ suggestion, notice }`; `suggestion` is null for blank (non-task,
// explicit rename handled by the caller, or unresolvable). `notice` uses the
// existing submit-path wording so failures look identical before/after Save.
async function resolvePromptBlockIdSuggestion(plugin, source) {
  try {
    if (!source) {
      return { suggestion: null, notice: null };
    }

    // Explicit renames win unchanged; the modal prefills oldId synchronously.
    if (source.prefillId && source.oldId) {
      return { suggestion: null, notice: null, explicit: true };
    }

    if (source.kind === "direct-add") {
      const rootLine = getDirectAddPromptRootLine(source);
      if (rootLine === null) {
        return { suggestion: null, notice: null };
      }
      let content = "";
      try {
        content = String(source.editor.getValue() || "");
      } catch (error) {
        return { suggestion: null, notice: "Block ID add blocked: active note could not be read" };
      }
      return {
        suggestion: suggestPromptBlockId(rootLine, content, { reservedIds: new Set() }),
        notice: null,
      };
    }

    if (source.kind === "link-task-complete") {
      const task = source.task;
      if (!task || typeof task.rawLine !== "string") {
        return { suggestion: null, notice: null };
      }
      const targetFile = plugin.resolveDestinationFile
        ? plugin.resolveDestinationFile(source)
        : null;
      if (!targetFile) {
        return {
          suggestion: null,
          notice: "Task link blocked: target note could not be resolved",
        };
      }
      const snapshot = await readAuthoritativePromptTargetContent(plugin, source, targetFile);
      if (snapshot.content === null) {
        if (snapshot.ambiguous) {
          return {
            suggestion: null,
            notice: `Task link blocked: ${targetFile.path} changed before update`,
          };
        }
        return {
          suggestion: null,
          notice: "Task link blocked: target note could not be resolved",
        };
      }
      const currentLine = contentLineAt(snapshot.content, task.line);
      if (currentLine === null || currentLine !== task.rawLine) {
        return {
          suggestion: null,
          notice: `Task link blocked: selected task changed in ${targetFile.path}`,
        };
      }
      return {
        suggestion: suggestPromptBlockId(task.rawLine, snapshot.content, {
          reservedIds: new Set(),
        }),
        notice: null,
      };
    }

    if (source.kind === "link-task-pomodoro") {
      const task = source.task;
      if (!task || typeof task.rawLine !== "string") {
        return { suggestion: null, notice: null };
      }
      if (!source.editor || typeof source.editor.getValue !== "function") {
        return { suggestion: null, notice: "Task link blocked: active note could not be read" };
      }
      const currentLine = source.editor.getLine(source.line);
      if (currentLine !== task.rawLine) {
        return {
          suggestion: null,
          notice: `Task link blocked: selected task changed in ${source.sourcePath}`,
        };
      }
      let content = "";
      try {
        content = String(source.editor.getValue() || "");
      } catch (error) {
        return { suggestion: null, notice: "Task link blocked: active note could not be read" };
      }
      return {
        suggestion: suggestPromptBlockId(task.rawLine, content, { reservedIds: new Set() }),
        notice: null,
      };
    }

    // Marker-triggered rename: oldId present without an explicit prefill flag.
    // Suggest only for uniquely resolved task blocks; never hide ambiguity by
    // globally removing duplicates (exclude exactly one occurrence).
    if (source.oldId && !source.prefillId) {
      const targetFile = plugin.resolveDestinationFile
        ? plugin.resolveDestinationFile(source)
        : null;
      if (!targetFile) {
        return {
          suggestion: null,
          notice: "Block ID rename blocked: target note could not be resolved",
        };
      }
      const snapshot = await readAuthoritativePromptTargetContent(plugin, source, targetFile);
      if (snapshot.content === null) {
        if (snapshot.ambiguous) {
          return {
            suggestion: null,
            notice: `Block ID rename blocked: ${targetFile.path} changed before rename`,
          };
        }
        return {
          suggestion: null,
          notice: "Block ID rename blocked: target note could not be resolved",
        };
      }
      const occurrences = promptBlockIdCountOccurrences(snapshot.content, source.oldId);
      if (occurrences !== 1) {
        return {
          suggestion: null,
          notice: `Block ID rename blocked: old ID was not found exactly once in ${targetFile.path}`,
        };
      }
      const lines = snapshot.content.split("\n");
      let targetLine = null;
      for (const line of lines) {
        if (promptBlockIdCountOccurrences(line, source.oldId) === 1) {
          // The line holds the unique token; confirm it is the token form
          // (not a coincidental substring) via the shared token matcher.
          if (blockTokenMatches(line, source.oldId).length === 1) {
            targetLine = line;
            break;
          }
        }
      }
      if (targetLine === null) {
        return {
          suggestion: null,
          notice: `Block ID rename blocked: old ID was not found exactly once in ${targetFile.path}`,
        };
      }
      if (promptBlockIdExtractTaskBody(targetLine) === null) {
        return { suggestion: null, notice: null };
      }
      return {
        suggestion: suggestPromptBlockId(targetLine, snapshot.content, {
          reservedIds: new Set(),
          excludeId: source.oldId,
        }),
        notice: null,
      };
    }

    return { suggestion: null, notice: null };
  } catch (error) {
    return { suggestion: null, notice: null };
  }
}
