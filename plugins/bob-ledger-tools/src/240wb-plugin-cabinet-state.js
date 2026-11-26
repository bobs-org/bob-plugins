// Session-only content-cabinet state, keyed by normalized path and kind.
// Existing fold registrations and the Properties foot remain their state
// owners; this map is only for content cabinets.
const propertyCardCabinetOpenStates = new Map();
const propertyCardCabinetStateListeners = new Set();
const propertyCardCabinetMounts = new Set();
let propertyCardCabinetStateOwner = null;

function propertyCardCabinetPath(value) {
  try {
    if (typeof propertyCardFootPath === "function") return propertyCardFootPath(value);
  } catch (_) {}
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
}

function propertyCardCabinetStateKey(path, kind) {
  const normalized = propertyCardCabinetPath(path);
  return normalized && Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, kind)
    ? `${normalized}\u0000${kind}`
    : "";
}

function propertyCardCabinetProblemSignature(problems) {
  return typeof problems === "string" ? problems : "";
}

function propertyCardCabinetIsOpen(path, kind, options = {}) {
  const spec = PROPERTY_CARD_CABINET_KINDS[kind];
  const key = propertyCardCabinetStateKey(path, kind);
  if (!spec || spec.role !== "content" || !key) return propertyCardCabinetDefaultOpen(kind, options);
  let choice = null;
  try {
    choice = typeof propertyCardFoldChoiceFromStored === "function"
      ? propertyCardFoldChoiceFromStored(propertyCardCabinetOpenStates.get(key))
      : null;
  } catch (_) {}
  const problems = propertyCardCabinetProblemSignature(options.problems);
  try {
    const restamped = typeof propertyCardFoldRestamp === "function"
      ? propertyCardFoldRestamp(choice, problems)
      : choice;
    if (restamped && restamped !== choice) {
      propertyCardCabinetOpenStates.set(key, restamped);
      choice = restamped;
    }
  } catch (_) {}
  try {
    if (typeof propertyCardFoldResolve === "function") {
      return propertyCardFoldResolve({
        choice,
        problems,
        foldDefault: propertyCardCabinetDefaultOpen(kind, options),
      }) === true;
    }
  } catch (_) {}
  return choice?.open === true || (!choice && propertyCardCabinetDefaultOpen(kind, options));
}

function propertyCardCabinetSetOpen(path, kind, open, options = {}) {
  const spec = PROPERTY_CARD_CABINET_KINDS[kind];
  const key = propertyCardCabinetStateKey(path, kind);
  if (!spec || spec.role !== "content" || !key) return false;
  const normalized = propertyCardCabinetPath(path);
  const next = open === true;
  const problems = propertyCardCabinetProblemSignature(options.problems);
  const previous = propertyCardCabinetOpenStates.get(key);
  const choice = typeof propertyCardFoldChoice === "function"
    ? propertyCardFoldChoice(next, problems)
    : { open: next, problems };
  if (previous?.open === choice.open && previous?.problems === choice.problems) return next;
  propertyCardCabinetOpenStates.set(key, choice);
  for (const listener of Array.from(propertyCardCabinetStateListeners)) {
    try { listener({ path: normalized, kind, open: next, previous: previous?.open === true }); } catch (_) {}
  }
  return next;
}

function propertyCardCabinetOnStateChange(listener) {
  if (typeof listener !== "function") return () => false;
  propertyCardCabinetStateListeners.add(listener);
  return () => propertyCardCabinetStateListeners.delete(listener);
}

function propertyCardCabinetRenamePath(oldPath, newPath) {
  const from = propertyCardCabinetPath(oldPath);
  const to = propertyCardCabinetPath(newPath);
  if (!from || !to || from === to) return false;
  const prefix = `${from}\u0000`;
  for (const [key, value] of Array.from(propertyCardCabinetOpenStates.entries())) {
    if (!key.startsWith(prefix)) continue;
    propertyCardCabinetOpenStates.set(`${to}${key.slice(from.length)}`, value);
    propertyCardCabinetOpenStates.delete(key);
  }
  for (const mount of propertyCardCabinetMounts) {
    if (mount.path === from) mount.path = to;
  }
  return true;
}

function propertyCardCabinetReleasePath(path) {
  const normalized = propertyCardCabinetPath(path);
  if (!normalized) return false;
  const prefix = `${normalized}\u0000`;
  for (const key of Array.from(propertyCardCabinetOpenStates.keys())) {
    if (key.startsWith(prefix)) propertyCardCabinetOpenStates.delete(key);
  }
  for (const mount of Array.from(propertyCardCabinetMounts)) {
    if (mount.path === normalized) propertyCardCabinetMountUnregister(mount);
  }
  return true;
}

function propertyCardCabinetRegisterMount(plugin, view, path, stack, repaint) {
  const normalized = propertyCardCabinetPath(path);
  if (!plugin || !view || !normalized || !stack) return () => false;
  const entry = { plugin, view, path: normalized, stack, repaint: typeof repaint === "function" ? repaint : null };
  propertyCardCabinetMounts.add(entry);
  let live = true;
  return () => {
    if (!live) return false;
    live = false;
    return propertyCardCabinetMounts.delete(entry);
  };
}

function propertyCardCabinetMountUnregister(entry) {
  return propertyCardCabinetMounts.delete(entry);
}

function propertyCardCabinetRequestRepaint(view, path, kind) {
  const normalized = propertyCardCabinetPath(path);
  if (!view || !normalized) return false;
  let requested = false;
  for (const mount of propertyCardCabinetMounts) {
    if (mount.view !== view || mount.path !== normalized || mount.stack?.isConnected === false) continue;
    try {
      if (mount.repaint) {
        if (mount.repaint({ path: normalized, kind }) === false) continue;
      }
      else if (typeof mount.stack.dispatchEvent === "function") {
        const win = mount.stack.ownerDocument?.defaultView;
        const EventCtor = win?.CustomEvent || globalThis.CustomEvent;
        let event = null;
        if (typeof EventCtor === "function") event = new EventCtor("bob-cabinet-repaint", { detail: { path: normalized, kind } });
        else if (typeof Event === "function") {
          event = new Event("bob-cabinet-repaint");
          Object.defineProperty(event, "detail", { value: { path: normalized, kind } });
        }
        if (event) mount.stack.dispatchEvent(event);
        else continue;
      } else {
        continue;
      }
      requested = true;
    } catch (_) {}
  }
  return requested;
}

function propertyCardCabinetMountsReleasePlugin(plugin) {
  let count = 0;
  for (const mount of Array.from(propertyCardCabinetMounts)) {
    if (mount.plugin === plugin && propertyCardCabinetMountUnregister(mount)) count += 1;
  }
  return count;
}

function propertyCardCabinetStateBind(plugin) {
  if (!plugin || plugin.propertyCardCabinetStateVaultBound === true) return false;
  const vault = plugin.app?.vault;
  if (!vault || typeof vault.on !== "function" || typeof plugin.registerEvent !== "function") return false;
  try {
    plugin.propertyCardCabinetStateVaultBound = true;
    propertyCardCabinetStateOwner = plugin;
    plugin.registerEvent(vault.on("rename", (file, oldPath) => propertyCardCabinetRenamePath(oldPath, file?.path)));
    plugin.registerEvent(vault.on("delete", (file) => propertyCardCabinetReleasePath(file?.path)));
    return true;
  } catch (_) {
    plugin.propertyCardCabinetStateVaultBound = false;
    return false;
  }
}

function propertyCardCabinetStateReleasePlugin(plugin) {
  if (propertyCardCabinetStateOwner && propertyCardCabinetStateOwner !== plugin) return false;
  propertyCardCabinetOpenStates.clear();
  propertyCardCabinetStateListeners.clear();
  propertyCardCabinetMounts.clear();
  propertyCardCabinetStateOwner = null;
  try { plugin.propertyCardCabinetStateVaultBound = false; } catch (_) {}
  return true;
}

function propertyCardCabinetStateResetForTests() {
  propertyCardCabinetOpenStates.clear();
  propertyCardCabinetStateListeners.clear();
  propertyCardCabinetMounts.clear();
  propertyCardCabinetStateOwner = null;
}
