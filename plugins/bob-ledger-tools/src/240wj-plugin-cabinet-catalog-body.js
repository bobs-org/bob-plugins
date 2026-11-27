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

// Render one stored callout region into `container` and run the kind's
// painter over the rendered callout. Options: { plugin, doc, container,
// path, regionSource, component, paint, paintKey, cache=true,
// releaseClaim }. `paint(calloutEl)` is the kind's existing painter
// (areas/projects/notebooks/albums/records); it gets the same options the
// inline Live Preview path passes. Resolves to { reused, failed }.
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
    if (Renderer && typeof Renderer.render === "function") {
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
      if (container) {
        while (container.firstChild) container.removeChild(container.firstChild);
        const line = propertyCardCabinetRenderFailureLine(doc, "Couldn't render — showing the note's section");
        if (line) container.appendChild(line);
      }
    } catch (_) {}
    return { reused: false, failed: true };
  }
}
