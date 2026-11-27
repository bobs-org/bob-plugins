// Cabinet catalog body renderer (bob-cli-qq absorption): a generic
// renderer that paints one stored callout region through MarkdownRenderer
// under the mount's Component, binds links and hover like the inline path,
// and caches the painted body by paintKey so card repaints re-attach the
// same nodes (keeping interior fold state, avoiding flicker). On a throw it
// releases the claim and shows the "Couldn't render" line, so the stored
// section returns in the same frame. Never throws.
const PROPERTY_CARD_CABINET_BODY_CACHE = new Map();
const PROPERTY_CARD_CABINET_BODY_CACHE_LIMIT = 40;

function propertyCardCabinetBodyCacheKey(path, paintKey) {
  return `${String(path)}\u0000${String(paintKey)}`;
}

function propertyCardCabinetBodyCacheGet(path, paintKey) {
  try {
    if (paintKey == null) return null;
    const node = PROPERTY_CARD_CABINET_BODY_CACHE.get(propertyCardCabinetBodyCacheKey(path, paintKey));
    return node || null;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetBodyCacheSet(path, paintKey, node) {
  try {
    if (paintKey == null || !node) return;
    PROPERTY_CARD_CABINET_BODY_CACHE.set(propertyCardCabinetBodyCacheKey(path, paintKey), node);
    while (PROPERTY_CARD_CABINET_BODY_CACHE.size > PROPERTY_CARD_CABINET_BODY_CACHE_LIMIT) {
      const oldest = PROPERTY_CARD_CABINET_BODY_CACHE.keys().next();
      if (oldest.done) break;
      PROPERTY_CARD_CABINET_BODY_CACHE.delete(oldest.value);
    }
  } catch (_) {}
}

function propertyCardCabinetBodyCacheDrop(path, paintKey) {
  try {
    if (paintKey == null) return;
    PROPERTY_CARD_CABINET_BODY_CACHE.delete(propertyCardCabinetBodyCacheKey(path, paintKey));
  } catch (_) {}
}

function propertyCardCabinetRenderFailureLine(doc, message) {
  try {
    const line = doc.createElement("div");
    line.setAttribute("class", "bob-cabinet-body-failure");
    line.appendChild(doc.createTextNode(String(message || "Couldn't render — showing the note's section")));
    return line;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetBindBodyLinks(container, path, plugin) {
  try {
    const links = container.querySelectorAll ? Array.from(container.querySelectorAll("a.internal-link")) : [];
    for (const link of links) {
      if (!link || link.__bobCabinetBound) continue;
      link.__bobCabinetBound = true;
      link.addEventListener("click", (event) => {
        try {
          if (event.defaultPrevented) return;
          const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
          const target = String(href).split("#")[0];
          if (!target) return;
          event.preventDefault();
          const app = plugin?.app;
          const open = app?.workspace?.openLinkText;
          if (typeof open === "function") {
            open.call(app.workspace, target, String(path || ""), event.ctrlKey || event.metaKey);
          }
        } catch (_) {}
      });
      link.addEventListener("mouseover", (event) => {
        try {
          const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
          if (!href) return;
          if (typeof propertyCardFootAdapterHoverLink === "function") {
            propertyCardFootAdapterHoverLink(plugin, event, link, href, path, undefined);
          } else {
            plugin?.app?.workspace?.trigger?.("hover-link", {
              event,
              source: "preview",
              hoverParent: link,
              targetEl: link,
              linktext: href,
              sourcePath: path,
            });
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
}

// Reading fast path (bob-cli-qq perf): Obsidian already rendered this exact
// stored region into the note, so a Reading body clones that callout rather
// than running MarkdownRenderer a second time on the open path. Only a
// connected callout of the expected kind that no painter has touched and
// that holds no embeds qualifies; anything else returns null and the caller
// renders as before.
function propertyCardCabinetCloneNativeCallout(native, kind) {
  try {
    if (!native || native.isConnected !== true || typeof native.cloneNode !== "function") return null;
    const callout = native.getAttribute?.("data-callout") ? native : native.querySelector?.("[data-callout]");
    if (!callout || !kind) return null;
    if (String(callout.getAttribute("data-callout") || "").toLowerCase() !== String(kind).toLowerCase()) return null;
    for (const attr of Array.from(callout.attributes || [])) {
      const name = String(attr?.name || "");
      if (name === "data-root-hue" || /^data-bob-.*-card$/.test(name)) return null;
    }
    if (callout.querySelector?.(".internal-embed, .markdown-embed, img, iframe, video, audio, canvas, .bob-cabinet-body-source")) return null;
    const copy = callout.cloneNode(true);
    copy.classList?.remove?.(PROPERTY_CARD_CABINET_ABSORBED_CLASS);
    copy.classList?.remove?.("node-insert-event");
    if (copy.getAttribute?.("id")) copy.removeAttribute("id");
    for (const node of Array.from(copy.querySelectorAll?.("[id]") || [])) node.removeAttribute("id");
    // Reading-only list chrome (bullets, fold indicators, source lines) is
    // not in a MarkdownRenderer render; drop it so the body paints the same.
    for (const node of Array.from(copy.querySelectorAll?.(".list-bullet, .list-collapse-indicator, .collapse-indicator") || [])) node.remove?.();
    for (const node of Array.from(copy.querySelectorAll?.("[data-line]") || [])) node.removeAttribute("data-line");
    for (const node of Array.from(copy.querySelectorAll?.(".has-list-bullet") || [])) node.classList?.remove?.("has-list-bullet");
    return copy;
  } catch (_) {
    return null;
  }
}

// The stored callout this Reading scope rendered for `plan`, or null.
function propertyCardCabinetReadingNativeCallout(scope, plan) {
  try {
    if (!scope || !plan) return null;
    return propertyCardCabinetAbsorbReadingTargets(scope, plan).callout || null;
  } catch (_) {
    return null;
  }
}

// Render one stored callout region into `container` and run the kind's
// painter over the rendered callout. Options: { plugin, doc, container,
// path, regionSource, component, paint, paintKey, cache=true,
// releaseClaim, repaintNative }. `paint(calloutEl)` is the kind's existing
// painter (areas/projects/notebooks/albums/records); it gets the same
// options the inline Live Preview path passes. `repaintNative` repaints the
// stored callout when the deferred inline paint was skipped and this body
// fails, so fail-open still shows today's painted catalog. In Reading,
// `nativeCallout` (with `calloutKind`) names the note's rendered stored
// callout to clone instead of rendering. Resolves to { reused, failed }.
async function propertyCardCabinetRenderCatalog(options = {}) {
  const { plugin, doc, container, path, paint, paintKey } = options;
  const useCache = options.cache !== false;
  try {
    if (!doc || !container) return { reused: false, failed: true };
    const regionSource = String(options.regionSource ?? "");
    if (regionSource.trim() === "") return { reused: false, failed: true };
    while (container.firstChild) container.removeChild(container.firstChild);

    if (useCache) {
      const cached = propertyCardCabinetBodyCacheGet(path, paintKey);
      if (cached) {
        try {
          // Re-attach only an orphaned body (its mount cleared it): interior
          // fold state survives and nothing repaints. A body still inside
          // another mount's container belongs to that mount, even while its
          // view is detached; moving it would leave that cabinet blank. A
          // refreshed report changes paintKey, so a cached body is never stale.
          if (!cached.isConnected && !cached.parentNode) {
            container.appendChild(cached);
            propertyCardCabinetBindBodyLinks(container, path, plugin);
            return { reused: true, failed: false };
          }
        } catch (_) {}
        propertyCardCabinetBodyCacheDrop(path, paintKey);
      }
    }

    const Renderer = (() => {
      try {
        if (typeof MarkdownRenderer !== "undefined" && MarkdownRenderer) return MarkdownRenderer;
      } catch (_) {}
      try {
        return plugin?.app?.MarkdownRenderer || null;
      } catch (_) {
        return null;
      }
    })();
    // The mount's Component arrives via options; without one the rendered
    // output still binds links and hover through the adapter below.
    const Component = options.component || null;

    const holder = doc.createElement("div");
    holder.setAttribute("class", "bob-cabinet-body-source");
    container.appendChild(holder);
    const cloned = options.nativeCallout
      ? propertyCardCabinetCloneNativeCallout(options.nativeCallout, options.calloutKind)
      : null;
    if (cloned) {
      holder.appendChild(cloned);
    } else if (Renderer && typeof Renderer.render === "function") {
      await Renderer.render(plugin?.app, regionSource, holder, String(path || ""), Component || undefined);
    } else {
      holder.appendChild(doc.createTextNode(regionSource));
    }

    const calloutEl = holder.querySelector ? (holder.querySelector("[data-callout]") || holder) : holder;
    if (typeof paint === "function") {
      try {
        await paint(calloutEl);
      } catch (_) {
        try {
          if (typeof options.releaseClaim === "function") options.releaseClaim();
        } catch (_) {}
        try {
          if (typeof options.repaintNative === "function") options.repaintNative();
        } catch (_) {}
        while (container.firstChild) container.removeChild(container.firstChild);
        const line = propertyCardCabinetRenderFailureLine(doc, "Couldn't render — showing the note's section");
        if (line) container.appendChild(line);
        return { reused: false, failed: true };
      }
    }
    propertyCardCabinetBindBodyLinks(container, path, plugin);
    if (useCache) propertyCardCabinetBodyCacheSet(path, paintKey, holder);
    return { reused: false, failed: false };
  } catch (error) {
    try {
      if (typeof options.releaseClaim === "function") options.releaseClaim();
    } catch (_) {}
    try {
      if (typeof options.repaintNative === "function") options.repaintNative();
    } catch (_) {}
    try {
      if (container) {
        while (container.firstChild) container.removeChild(container.firstChild);
        const line = propertyCardCabinetRenderFailureLine(doc, "Couldn't render — showing the note's section");
        if (line) container.appendChild(line);
      }
    } catch (_) {}
    return { reused: false, failed: true };
  }
}
