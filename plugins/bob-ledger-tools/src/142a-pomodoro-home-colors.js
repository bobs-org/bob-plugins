// --- Pomodoro home colors: R8 nearest-note hue walk ------------------------
// Mirror of bob-cli `pomodoro_homes` R8. A home's hue is the nearest area or
// project `color:` slot (palette hue, or grey for a deliberate mute), else
// the top-level area stem hash. Root parents wear their own hue (R7).

// R8: an area's or project's `color:` slot. A palette slot or the grey mute
// (`grey`/`gray`), matched without case; absent or blank inherits (null);
// anything else, including lists and non-strings, is invalid and inherits.
function pomodoroHomeNoteColor(frontmatter) {
  const raw = frontmatter && typeof frontmatter === "object" ? frontmatter.color : undefined;
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== "string") {
    return { kind: "invalid" };
  }
  const value = raw.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (POMODORO_HOME_SLOT_ORDER.includes(value)) {
    return { kind: "hue", hue: value };
  }
  if (value === "grey" || value === "gray") {
    return { kind: "grey" };
  }
  return { kind: "invalid" };
}

// R8: the first valid `color:` slot on the area and project notes of
// `chain[from..]`, nearest first; else the top-level area stem hash
// (`fallback`). Grey is `hue: null` with `hue_source: "muted"`; no slot and
// no area is `hue: null` with no source.
function pomodoroHomeChainHue(chain, from, fallback) {
  for (let index = Math.max(0, from); index < chain.length; index += 1) {
    const item = chain[index];
    if (item.type !== "area" && item.type !== "project") {
      continue;
    }
    const color = pomodoroHomeNoteColor(item.frontmatter);
    if (color && color.kind === "hue") {
      return { hue: color.hue, hue_source: "color" };
    }
    if (color && color.kind === "grey") {
      return { hue: null, hue_source: "muted" };
    }
  }
  return fallback ? { hue: fallback, hue_source: "hash" } : { hue: null, hue_source: null };
}

// R8: every invalid `color:` on the walked area and project notes lints once
// per path, whichever note ends up deciding the hue.
function pomodoroHomeLintChainColors(chain, from, warnings, seen) {
  for (let index = Math.max(0, from); index < chain.length; index += 1) {
    const item = chain[index];
    if (item.type !== "area" && item.type !== "project") {
      continue;
    }
    const color = pomodoroHomeNoteColor(item.frontmatter);
    if (color && color.kind === "invalid") {
      pomodoroHomeWarning(
        warnings,
        seen,
        "area_color_invalid",
        item.path,
        `Invalid color on ${item.path}; the note inherits its color. Set color: to a palette slot or grey.`,
      );
    }
  }
}
