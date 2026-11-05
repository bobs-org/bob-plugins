function pomodoroCompletionThemesApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api = plugins && plugins["bob-ledger-tools"] &&
      plugins["bob-ledger-tools"].api;
    const themes = api && api.themes;
    return themes && themes.version >= 1 ? themes : null;
  } catch (_error) {
    return null;
  }
}

function pomodoroCompletionThemeKey(suggestion) {
  if (!suggestion || typeof suggestion !== "object") return null;
  const theme = suggestion.theme && typeof suggestion.theme === "object"
    ? suggestion.theme
    : suggestion;
  return typeof theme.key === "string" && theme.key.trim() ? theme.key.trim() : null;
}

function pomodoroCompletionThemeName(suggestion) {
  const theme = suggestion && suggestion.theme && typeof suggestion.theme === "object"
    ? suggestion.theme
    : suggestion;
  return theme && typeof theme.name === "string" && theme.name.trim()
    ? theme.name.trim()
    : null;
}

function pomodoroStruckTaskLinkTarget(lineText) {
  const stripped = stripPomodoroMarkersFromLine(lineText);
  const target = getPomodoroWorkLogTaskLinkTarget(stripped);
  if (!target || target.embedded === true) return null;
  const struck = getStrikethroughSpans(stripped).some((span) =>
    span.start === target.startIndex && span.end === target.endIndex
  );
  return struck ? target : null;
}

class TaskStatusCyclerPomodoroNamesMixin {
  // Resolve pre-close types, settle the closed headline, and keep the carried
  // continuation at an agreement fixed point before the editor write.
  async resolvePomodoroCloseNames(lines, section, pomodoroLine, context, bullets) {
    try {
      if (!isPomodoroTaskLine(lines, section, pomodoroLine)) return null;
      const parts = parsePomodoroEntryLineParts(lines[pomodoroLine]);
      const name = parts && typeof parts.name === "string" ? parts.name : "";
      if (!name) return null;

      const themes = pomodoroCompletionThemesApi(this.app);
      if (
        !themes ||
        typeof themes.effectiveTypeFor !== "function" ||
        typeof themes.settleClosed !== "function" ||
        typeof themes.agreeEntry !== "function" ||
        typeof themes.shed !== "function"
      ) return null;
      if (typeof themes.isMeetName === "function" && themes.isMeetName(name)) {
        return { closedName: name, continuationName: name, shed: [] };
      }

      const classified = bullets || classifyPomodoroSubBullets(
        lines,
        getSubBulletBlockRange(lines, pomodoroLine, section),
      );
      const groups = [
        { bullets: classified.copyableTaskLinkBullets, outcome: "in_progress" },
        { bullets: classified.moveOnlyTaskLinkBullets, outcome: "deferred" },
        { bullets: classified.transcludedTaskLinkBullets, outcome: "complete" },
        {
          bullets: (classified.noteBullets || [])
            .map((bullet) => {
              const target = pomodoroStruckTaskLinkTarget(bullet.lineText);
              return target ? { targets: [target] } : null;
            })
            .filter(Boolean),
          outcome: "complete",
        },
      ];
      const typeCache = new Map();
      const typedLinks = [];
      const carriedChildren = [];
      for (const group of groups) {
        for (const bullet of Array.isArray(group.bullets) ? group.bullets : []) {
          for (const target of Array.isArray(bullet.targets) ? bullet.targets : []) {
            const targetKey = `${String(target.pathPart || "")}#^${String(target.blockId || "")}`;
            let resolvedType = typeCache.get(targetKey);
            if (resolvedType === undefined) {
              resolvedType = null;
              try {
                const resolved = await this.resolveTranscludedBlockTarget(
                  target,
                  context,
                  { taskStatusPredicate: () => true },
                );
                if (resolved && resolved.file && Number.isInteger(resolved.line)) {
                  const suggestion = themes.effectiveTypeFor({
                    path: resolved.file.path,
                    line: resolved.line + 1,
                    text: resolved.sourceText,
                    asIfOpen: true,
                  });
                  const key = pomodoroCompletionThemeKey(suggestion);
                  const typeName = pomodoroCompletionThemeName(suggestion);
                  if (key && typeName) resolvedType = { key, name: typeName };
                }
              } catch (_error) {
                resolvedType = null;
              }
              typeCache.set(targetKey, resolvedType);
            }
            if (resolvedType) {
              typedLinks.push({ ...resolvedType, outcome: group.outcome });
              if (["in_progress", "deferred"].includes(group.outcome)) {
                carriedChildren.push({
                  kind: "live",
                  key: resolvedType.key,
                  name: resolvedType.name,
                });
              }
            } else if (["in_progress", "deferred"].includes(group.outcome)) {
              carriedChildren.push({ kind: "unknown" });
            }
          }
        }
      }

      const before = typedLinks.map((link) => link.key);
      const worked = typedLinks
        .filter((link) => ["in_progress", "parked", "complete"].includes(link.outcome))
        .map(({ key, name: typeName }) => ({ key, name: typeName }));
      const carried = typedLinks
        .filter((link) => ["in_progress", "deferred"].includes(link.outcome))
        .map((link) => link.key);
      const closedName = themes.settleClosed(name, worked);
      const shedName = themes.shed(name, before, carried);
      const continuation = themes.agreeEntry({
        name: shedName,
        open: true,
        children: carriedChildren,
      });
      const continuationName = continuation && typeof continuation.name === "string"
        ? continuation.name
        : shedName;
      const originalTypes = typeof themes.typeComponentsOf === "function"
        ? themes.typeComponentsOf(name).filter((item) => item && item.isType)
        : [];
      const remaining = new Set(
        typeof themes.typeComponentsOf === "function"
          ? themes.typeComponentsOf(continuationName)
            .filter((item) => item && item.isType)
            .map((item) => item.key)
          : [],
      );
      const shed = originalTypes
        .filter((item) => item.key && !remaining.has(item.key))
        .map((item) => item.name);
      return {
        closedName: typeof closedName === "string" ? closedName : name,
        continuationName: typeof continuationName === "string" ? continuationName : name,
        shed,
      };
    } catch (_error) {
      return null;
    }
  }
}
