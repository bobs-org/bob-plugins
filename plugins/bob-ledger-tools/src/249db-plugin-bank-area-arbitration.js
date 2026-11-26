// Pane-local Area/Bank arbitration for bank.md. The Area mount token binds
// every decision to one scope, path, DOM mount, and generation; bank refreshes
// can never infer ownership from a vault-wide flag or a surviving body card.
const propertyCardHomeBankAreaOwners = new WeakMap();
let propertyCardHomeBankAreaGeneration = 0;

function propertyCardHomeBankAreaRegister(plugin, scope, path, kind, mount) {
  try {
    const key = String(path || "").replace(/\\/g, "/");
    if (!plugin || key !== "bank.md" || kind !== "area" || !scope || !mount) return null;
    if (String(mount.getAttribute?.("data-home-source") || "").replace(/\\/g, "/") !== key) return null;
    const current = propertyCardHomeBankAreaOwners.get(scope);
    if (current && current.plugin === plugin && current.path === key && current.kind === kind && current.mount === mount) {
      return current.generation;
    }
    const entry = { plugin, scope, path: key, kind, mount, generation: ++propertyCardHomeBankAreaGeneration };
    propertyCardHomeBankAreaOwners.set(scope, entry);
    try { plugin.scheduleBankSetupRefresh?.(); } catch (_) {}
    return entry.generation;
  } catch (_) {
    return null;
  }
}

function propertyCardHomeBankAreaRelease(scope, path = "", mount = null, plugin = null) {
  try {
    const entry = scope ? propertyCardHomeBankAreaOwners.get(scope) : null;
    if (!entry) return false;
    const key = String(path || "").replace(/\\/g, "/");
    if (key && entry.path !== key) return false;
    if (mount && entry.mount !== mount) return false;
    if (plugin && entry.plugin !== plugin) return false;
    if (propertyCardHomeBankAreaOwners.get(scope) !== entry) return false;
    propertyCardHomeBankAreaOwners.delete(scope);
    try { entry.plugin.scheduleBankSetupRefresh?.(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardHomeBankAreaCurrent(scope, path) {
  try {
    const key = String(path || "").replace(/\\/g, "/");
    const entry = scope ? propertyCardHomeBankAreaOwners.get(scope) : null;
    if (!entry || key !== "bank.md" || entry.path !== key || entry.kind !== "area") return null;
    if (entry.plugin?.homeCardActive !== true || !entry.mount || entry.mount.isConnected === false) return null;
    if (typeof scope.contains === "function" && !scope.contains(entry.mount)) return null;
    if (String(entry.mount.getAttribute?.("data-home-source") || "").replace(/\\/g, "/") !== key) return null;
    if (propertyCardHomeBankAreaOwners.get(scope) !== entry) return null;
    return entry;
  } catch (_) {
    return null;
  }
}

function propertyCardHomeBankAreaFootReady(entry) {
  try {
    if (!entry || propertyCardHomeBankAreaCurrent(entry.scope, entry.path) !== entry) return false;
    const foot = entry.mount.querySelector?.(".bob-property-card-foot");
    if (!foot || foot.isConnected === false || !entry.scope.contains?.(foot)) return false;
    if (!foot.querySelector?.("button.bob-property-card-foot-disclosure")) return false;
    const mounted = propertyCardFootMountByNode?.get?.(foot);
    if (!mounted || mounted.path !== entry.path || propertyCardFootMounts?.get?.(mounted.id) !== mounted) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function bankSetupAreaArbitration(scope, path) {
  const owner = propertyCardHomeBankAreaCurrent(scope, path);
  return {
    owner,
    generation: owner ? owner.generation : 0,
    suppressBankFoot: Boolean(owner && propertyCardHomeBankAreaFootReady(owner)),
  };
}
