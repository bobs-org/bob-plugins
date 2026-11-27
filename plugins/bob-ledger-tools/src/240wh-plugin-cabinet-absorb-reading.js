// Cabinet Reading absorption (bob-cli-qq absorption): source-aware section
// tagging that hides a claimed catalog region in Reading view, modeled on
// the title ownership kit (240i). The recognized callout element and, when
// hideable, its H2 get the absorbed class (kit CSS hides them); section
// wrappers, cards, and embeds are never tagged. Re-scan on claim change;
// print and export are left untouched. Never throws.
const PROPERTY_CARD_CABINET_ABSORBED_CLASS = "bob-cabinet-absorbed";
const PROPERTY_CARD_CABINET_READING_SKIP = Object.freeze([
  "mod-header", "mod-frontmatter", "markdown-preview-pusher", "mod-footer",
]);

function propertyCardCabinetReadingElements(node) {
  try {
    return Array.from(node?.children || []).filter((child) => child && child.nodeType === 1);
  } catch (_) {
    return [];
  }
}

function propertyCardCabinetReadingDenied(node) {
  try {
    if (!node || typeof node.closest !== "function") return true;
    return Boolean(node.closest(".canvas-node, .canvas-node-content, .print, .markdown-embed"));
  } catch (_) {
    return true;
  }
}

function propertyCardCabinetReadingCalloutName(node) {
  try {
    if (!node || node.nodeType !== 1) return null;
    const direct = node.getAttribute?.("data-callout");
    if (typeof direct === "string" && direct !== "") return direct.toLowerCase();
    const tagged = node.querySelector?.("[data-callout]");
    if (tagged && tagged !== node && typeof tagged.getAttribute === "function") {
      const name = tagged.getAttribute("data-callout");
      if (typeof name === "string" && name !== "") return name.toLowerCase();
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Collect the Reading targets for one hide plan: the callout element and,
// when hideable, its H2. Sections are scanned source-aware like 240i: skip
// chrome sections, stop at cards and embeds, and never tag wrappers.
function propertyCardCabinetAbsorbReadingTargets(scope, plan) {
  const found = { callout: null, heading: null };
  try {
    if (!scope || !plan || plan.startLine == null) return found;
    const spec = propertyCardCabinetRegionSpec(plan.kind);
    if (!spec) return found;
    const sizer = propertyCardCabinetReadingElements(scope)
      .find((node) => node.classList?.contains("markdown-preview-sizer"));
    if (!sizer) return found;
    for (const section of propertyCardCabinetReadingElements(sizer)) {
      if (PROPERTY_CARD_CABINET_READING_SKIP.some((name) => section.classList?.contains(name))) continue;
      if (propertyCardCabinetReadingDenied(section)) continue;
      try {
        if (section.classList?.contains("bob-property-card") || section.querySelector?.(".bob-property-card")) continue;
      } catch (_) {
        continue;
      }
      for (const node of propertyCardCabinetReadingElements(section)) {
        if (propertyCardCabinetReadingDenied(node)) continue;
        try {
          if (node.classList?.contains("bob-property-card") || node.querySelector?.(".bob-property-card")) continue;
        } catch (_) {
          continue;
        }
        const tag = String(node.tagName || "").toUpperCase();
        if (plan.headingLine != null && tag === "H2" && !found.heading) {
          const text = String(node.textContent ?? "").trim();
          if (text === spec.heading || text.replace(/#+\s*$/, "").trim() === spec.heading) found.heading = node;
        }
        if (!found.callout) {
          const name = propertyCardCabinetReadingCalloutName(node);
          if (name === spec.callout) found.callout = node;
          else if (tag === "DIV" && node.classList?.contains("callout")) {
            const title = node.querySelector?.(".callout-title");
            const label = String(title?.textContent ?? "").trim().toLowerCase();
            if (label === spec.callout || label.startsWith(`${spec.callout} `)) found.callout = node;
          }
        }
        if (found.callout && (plan.headingLine == null || found.heading)) break;
      }
      if (found.callout && (plan.headingLine == null || found.heading)) break;
    }
    // Obsidian can split the final H2 and its callout across adjacent rendered
    // sections. The source plan already proves that this heading labels only
    // the catalog, so use the nearest matching rendered heading before the
    // claimed callout when the section-local scan could not pair them.
    if (plan.headingLine != null && found.callout && !found.heading) {
      const headings = Array.from(sizer.querySelectorAll?.("h2") || []).filter((node) => {
        if (propertyCardCabinetReadingDenied(node)) return false;
        if (node.closest?.(".bob-property-card, .markdown-embed, .internal-embed, .canvas-node")) return false;
        const text = String(node.textContent ?? "").trim();
        return text === spec.heading || text.replace(/#+\s*$/, "").trim() === spec.heading;
      });
      for (const heading of headings) {
        const following = heading.compareDocumentPosition?.(found.callout) || 0;
        if (following & 4) found.heading = heading;
      }
    }
    return found;
  } catch (_) {
    return found;
  }
}

function propertyCardCabinetAbsorbTagNode(node, on) {
  try {
    if (!node || !node.classList) return;
    if (on) node.classList.add(PROPERTY_CARD_CABINET_ABSORBED_CLASS);
    else node.classList.remove(PROPERTY_CARD_CABINET_ABSORBED_CLASS);
  } catch (_) {}
}

// Paint (or clear) the Reading absorption for one claim. Returns the tagged
// nodes so the caller can untag on claim change without a full re-scan.
function propertyCardCabinetAbsorbPaintReading(scope, plan, on = true) {
  try {
    const targets = propertyCardCabinetAbsorbReadingTargets(scope, plan);
    const tagged = [];
    if (targets.callout) {
      propertyCardCabinetAbsorbTagNode(targets.callout, on);
      if (on) tagged.push(targets.callout);
    }
    if (targets.heading) {
      propertyCardCabinetAbsorbTagNode(targets.heading, on);
      if (on) tagged.push(targets.heading);
    }
    return tagged;
  } catch (_) {
    return [];
  }
}

function propertyCardCabinetAbsorbUntagReading(nodes) {
  try {
    for (const node of nodes || []) propertyCardCabinetAbsorbTagNode(node, false);
  } catch (_) {}
}

// Re-scan every claim in `claims` ({ plan } entries) against `scope`,
// clearing stale tags first. Returns the newly tagged nodes.
function propertyCardCabinetAbsorbRescanReading(scope, claims, previous) {
  try {
    propertyCardCabinetAbsorbUntagReading(previous);
    const tagged = [];
    for (const claim of claims || []) {
      if (!claim || !claim.plan) continue;
      for (const node of propertyCardCabinetAbsorbPaintReading(scope, claim.plan, true)) tagged.push(node);
    }
    return tagged;
  } catch (_) {
    return [];
  }
}
