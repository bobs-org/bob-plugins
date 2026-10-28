// --- Task theme defaults: frontmatter facts along residence chain -------
// Sibling of pomodoroHomeResolve for suggestion rules that need each note's
// parsed frontmatter. It reuses the existing Obsidian link, parent, type, and
// area-hue helpers and never flattens a theme list into a scalar.

function pomodoroHomeResolveTaskThemeFacts(
  target,
  dailyPath,
  metadataCache,
  vault,
) {
  try {
    const first = pomodoroHomeResolveFile(
      target,
      dailyPath,
      dailyPath,
      metadataCache,
      vault,
    );
    if (!first || typeof first.path !== "string") {
      return null;
    }
    const chain = [];
    const visited = new Set();
    let current = first;
    for (let depth = 0; current && depth < POMODORO_HOME_MAX_DEPTH; depth += 1) {
      const path = String(current.path || "");
      const key = path.toLowerCase();
      if (!path || visited.has(key)) {
        break;
      }
      visited.add(key);
      const { frontmatter } = pomodoroHomeReadFrontmatter(
        current,
        metadataCache,
        vault,
      );
      chain.push({ file: current, path, frontmatter, type: pomodoroHomeType(frontmatter) });
      const parentTarget = pomodoroHomeParentTarget(frontmatter.parent);
      if (!parentTarget || pomodoroHomePathEqual(parentTarget, path)) {
        break;
      }
      current = pomodoroHomeResolveFile(
        parentTarget,
        path,
        dailyPath,
        metadataCache,
        vault,
      );
    }
    const warnings = [];
    const home = pomodoroHomeResolve(
      target,
      dailyPath,
      metadataCache,
      vault,
      warnings,
      new Set(),
    );
    return { chain, home };
  } catch (error) {
    return null;
  }
}

function pomodoroThemeNoteDefault(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return { kind: "absent" };
  }
  const raw = frontmatter.theme;
  if (raw === undefined || raw === null) {
    return { kind: "absent" };
  }
  if (typeof raw !== "string") {
    return { kind: "invalid" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: "absent" };
  }
  if (trimmed.toLowerCase() === "off") {
    return { kind: "off" };
  }
  const name = pomodoroThemeCanonicalName(trimmed);
  return name ? { kind: "name", name } : { kind: "invalid" };
}
