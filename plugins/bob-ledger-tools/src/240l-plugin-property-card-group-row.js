// Property-card group row (bob-cli-oj group-rail): the quieter second rail
// row that jumps between groups (`« Q3 · W27   week 8 of 14 ▮▮■▯   2027-Q1 ·
// W01 »`), plus the missing-target states every rail surface shares. One
// visual rule: dashed with a `+` means "not created yet" (creatable); dotted,
// faint, and `· not in vault` means "won't be created from here" (ghost).
// Never error red, never Obsidian's unresolved-link look.
//
// The kit never decides activation. Step items and chips reach the rail's
// onNavigate, and group arms reach the row's onActivate, with the item and
// its resolved state; adopters run their own commands. Builders take an
// ownerDocument and a spec, return null instead of throwing, and write text
// only through text nodes.

const PROPERTY_CARD_TARGET_STATES = Object.freeze(["exists", "creatable", "ghost"]);
const PROPERTY_CARD_GROUP_DIRECTIONS = Object.freeze(["prev", "next"]);
const PROPERTY_CARD_GROUP_TICK_STATES = Object.freeze(["current", "exists", "missing"]);
// Larger groups show a continuous bar with a thumb instead of one tick each.
const PROPERTY_CARD_GROUP_TICK_LIMIT = 21;
const PROPERTY_CARD_GHOST_NOTE = "· not in vault";

// An explicit known state wins; the legacy `unresolved: true` means
// creatable; neither means exists.
function propertyCardTargetState(item) {
  const state = propertyCardKitText(item?.state).trim();
  if (PROPERTY_CARD_TARGET_STATES.includes(state)) return state;
  return item?.unresolved === true ? "creatable" : "exists";
}

// The item handed to onNavigate / onActivate always carries its state.
function propertyCardKitStatedItem(item, state) {
  return item?.state === state ? item : { ...item, state };
}

function propertyCardKitHidden(node) {
  node.setAttribute("aria-hidden", "true");
  return node;
}

// Enter and Space for controls without an href (ghosts), which browsers do
// not activate natively.
function propertyCardKitBindKeys(node, handler) {
  try {
    node.addEventListener?.("keydown", (event) => {
      const key = event?.key;
      if (key !== "Enter" && key !== " " && key !== "Spacebar") return;
      try { event?.preventDefault?.(); } catch (_) {}
      if (typeof handler === "function") {
        try { handler(event); } catch (_) {}
      }
    });
  } catch (_) {}
}

// Click and middle-click for every target; ghosts also take Enter and Space.
function propertyCardKitBindTarget(node, state, handler) {
  propertyCardKitBindLink(node, handler);
  if (state === "ghost") propertyCardKitBindKeys(node, handler);
}

// A ghost is never a link into the vault: no href, still focusable for its
// tooltip, announced as disabled.
function propertyCardKitGhostControl(node, role) {
  try {
    node.removeAttribute?.("href");
    node.removeAttribute?.("data-href");
  } catch (_) {}
  if (role) node.setAttribute("role", role);
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-disabled", "true");
}

// Mark a step-row item or chip with its state and return the trailing spans
// (`+` for creatable; `· not in vault` for ghost items, never chips). exists
// changes nothing, so legacy specs keep their DOM. is-unresolved stays on as
// a compatibility marker; the group-row CSS block drops its underline. An
// optional item.tooltip becomes the title; a ghost falls back to its reason.
function propertyCardKitStateMarks(doc, node, item, state, chip) {
  const tooltip = propertyCardKitText(item?.tooltip).trim();
  if (tooltip) node.setAttribute("title", tooltip);
  if (state === "exists") return [];
  node.setAttribute("data-state", state);
  propertyCardKitAddClass(node, `is-${state}`);
  propertyCardKitAddClass(node, "is-unresolved");
  if (state === "creatable") return [propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-rail-plus", "+"))];
  propertyCardKitGhostControl(node, chip ? "" : "link");
  const reason = propertyCardKitText(item?.ghostReason).trim();
  if (!tooltip && reason) node.setAttribute("title", reason);
  return chip ? [] : [propertyCardKitSpan(doc, "bob-property-card-rail-note", PROPERTY_CARD_GHOST_NOTE)];
}

function propertyCardGroupArmOk(arm) {
  if (!arm || typeof arm !== "object") return false;
  if (!propertyCardKitText(arm.groupLabel).trim()) return false;
  return propertyCardTargetState(arm) === "ghost" || Boolean(propertyCardKitText(arm.target).trim());
}

// a.bob-property-card-group-arm[data-group][data-state]. Reading order: the
// prev arm reads `« Q3 · W27`, the next arm `2027-Q1 · W01 »`; the `«`/`»`
// glyph, separator, `+`, and `↺` are aria-hidden.
function propertyCardGroupArm(doc, direction, arm, onActivate) {
  const state = propertyCardTargetState(arm);
  const stated = propertyCardKitStatedItem(arm, state);
  const link = propertyCardKitEl(doc, "a", "bob-property-card-group-arm");
  link.setAttribute("data-group", direction);
  link.setAttribute("data-state", state);
  if (state === "ghost") propertyCardKitGhostControl(link, "link");
  else {
    const target = propertyCardKitText(arm.target).trim();
    link.setAttribute("data-href", target);
    link.setAttribute("href", target);
  }
  const tooltip = propertyCardKitText(arm.tooltip).trim()
    || (state === "ghost" ? propertyCardKitText(arm.ghostReason).trim() : "");
  if (tooltip) link.setAttribute("title", tooltip);
  const ariaLabel = propertyCardKitText(arm.ariaLabel).trim();
  if (ariaLabel) link.setAttribute("aria-label", ariaLabel);

  const groupLabel = propertyCardKitText(arm.groupLabel).trim();
  const parts = [
    propertyCardKitSpan(doc, "bob-property-card-group-label", groupLabel),
    propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-label-narrow",
      propertyCardKitText(arm.shortLabel).trim() || groupLabel)),
  ];
  const landing = propertyCardKitText(arm.landingLabel).trim();
  if (landing) {
    parts.push(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-sep", "·")));
    parts.push(propertyCardKitSpan(doc, "bob-property-card-group-landing", landing));
  }
  if (state === "creatable") parts.push(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-plus", "+")));
  if (state === "ghost") parts.push(propertyCardKitSpan(doc, "bob-property-card-group-note", PROPERTY_CARD_GHOST_NOTE));
  const glyph = propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-glyph", direction === "prev" ? "«" : "»"));
  const ordered = direction === "prev" ? [glyph, ...parts] : [...parts, glyph];
  if (arm.wraps === true) ordered.push(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-wrap", "↺")));
  for (const node of ordered) link.appendChild(node);
  propertyCardKitBindTarget(link, state, (event) => {
    if (typeof onActivate === "function") onActivate(direction, stated, event);
  });
  return link;
}

function propertyCardGroupTickState(member) {
  const state = propertyCardKitText(member?.state).trim();
  return PROPERTY_CARD_GROUP_TICK_STATES.includes(state) ? state : "exists";
}

// span.bob-property-card-group-track[aria-hidden]: one tick per member, or a
// continuous bar with a thumb when the group is larger than 21 or members
// are absent. Null when neither form has the numbers it needs.
function propertyCardGroupTrack(doc, center) {
  const size = Number(center.size);
  const position = Number(center.position);
  const members = Array.isArray(center.members)
    ? center.members.filter((member) => member && typeof member === "object")
    : [];
  const tooLarge = Number.isFinite(size) && size > PROPERTY_CARD_GROUP_TICK_LIMIT;
  const track = propertyCardKitHidden(propertyCardKitEl(doc, "span", "bob-property-card-group-track"));
  if (members.length && members.length <= PROPERTY_CARD_GROUP_TICK_LIMIT && !tooLarge) {
    track.setAttribute("data-track", "ticks");
    for (const member of members) {
      const tick = propertyCardKitEl(doc, "span", "bob-property-card-group-tick");
      tick.setAttribute("data-state", propertyCardGroupTickState(member));
      const label = propertyCardKitText(member.label).trim();
      if (label) tick.setAttribute("title", label);
      track.appendChild(tick);
    }
    return track;
  }
  if (!Number.isInteger(size) || !Number.isInteger(position) || size < 1 || position < 1 || position > size) return null;
  track.setAttribute("data-track", "bar");
  const thumb = propertyCardKitEl(doc, "span", "bob-property-card-group-thumb");
  const left = Math.round((10000 * (position - 0.5)) / size) / 100;
  thumb.setAttribute("style", `left: ${left}%`);
  track.appendChild(thumb);
  return track;
}

// div.bob-property-card-group-center: optional group name, the position
// (wide and narrow spans plus a visually hidden label that carries the
// meaning), and the track. Null without position text.
function propertyCardGroupCenter(doc, center) {
  const text = propertyCardKitText(center?.text).trim();
  if (!text) return null;
  const element = propertyCardKitEl(doc, "div", "bob-property-card-group-center");
  const tooltip = propertyCardKitText(center.tooltip).trim();
  if (tooltip) element.setAttribute("title", tooltip);
  const name = propertyCardKitText(center.name).trim();
  if (name) {
    element.appendChild(propertyCardKitSpan(doc, "bob-property-card-group-name", name));
    element.appendChild(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-name-sep", "·")));
  }
  const position = propertyCardKitEl(doc, "span", "bob-property-card-group-position");
  position.appendChild(propertyCardKitSpan(doc, "bob-property-card-group-position-label",
    propertyCardKitText(center.ariaLabel).trim() || text));
  position.appendChild(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-position-wide", text)));
  position.appendChild(propertyCardKitHidden(propertyCardKitSpan(doc, "bob-property-card-group-position-narrow",
    propertyCardKitText(center.shortText).trim() || text)));
  element.appendChild(position);
  const track = propertyCardGroupTrack(doc, center);
  if (track) element.appendChild(track);
  return { element, track };
}

// { element, arms: { prev, next }, center, track } or null when there is no
// arm and no center. spec: { label?, prev?, next?, center?, onActivate? }
// where an arm is { groupLabel, landingLabel?, shortLabel?, target, state,
// ghostReason?, wraps?, tooltip?, ariaLabel? } and center is { name?, text,
// shortText?, ariaLabel?, tooltip?, position, size, members? }. Missing
// cells keep their grid column with an empty gap span.
function propertyCardBuildGroupRow(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const options = spec && typeof spec === "object" ? spec : {};
    const present = PROPERTY_CARD_GROUP_DIRECTIONS.filter((direction) => propertyCardGroupArmOk(options[direction]));
    const center = options.center && typeof options.center === "object"
      ? propertyCardGroupCenter(doc, options.center)
      : null;
    if (!present.length && !center) return null;
    const element = propertyCardKitEl(doc, "div", "bob-property-card-group-row");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", propertyCardKitText(options.label).trim() || "Group navigation");
    const gap = (cell) => {
      const node = propertyCardKitEl(doc, "span", "bob-property-card-group-gap");
      node.setAttribute("data-group", cell);
      return node;
    };
    const arms = { prev: null, next: null };
    for (const cell of ["prev", "center", "next"]) {
      if (cell === "center") {
        element.appendChild(center ? center.element : gap(cell));
      } else if (present.includes(cell)) {
        arms[cell] = propertyCardGroupArm(doc, cell, options[cell], options.onActivate);
        element.appendChild(arms[cell]);
      } else {
        element.appendChild(gap(cell));
      }
    }
    return { element, arms, center: center?.element || null, track: center?.track || null };
  } catch (_) {
    return null;
  }
}
