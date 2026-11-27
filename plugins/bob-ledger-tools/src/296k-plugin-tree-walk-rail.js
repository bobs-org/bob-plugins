// Tree walk rail adapter (bob-cli-ra rail): activation, re-validation,
// and the live-refresh mixin for the pure tree rail model (296j). No card
// mounts it yet; cards stay byte-identical. Synchronous providers never
// throw, never write, never spawn bob; activation re-resolves before
// running nav commands so jump history agrees with the keys.

function treeWalkRailFilePath(value) {
  try {
    if (typeof intentionCardFilePath === "function") return intentionCardFilePath(value);
  } catch (_) {}
  try {
    const text = value === null || value === undefined ? "" : String(value);
    const normalized = text.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
    if (!normalized) return "";
    return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
  } catch (_) {
    return "";
  }
}

function treeWalkRailText(value) {
  return value === null || value === undefined ? "" : String(value);
}

class BobLedgerToolsTreeWalkRailMixin {
  // Navigation Hotkeys' walkMode when it is v7 with links(), else null.
  treeWalkRailWalkMode() {
    try {
      const api = typeof this.dependencyNavApi === "function" ? this.dependencyNavApi() : null;
      const walkMode = api && api.walkMode && typeof api.walkMode === "object" ? api.walkMode : null;
      if (!walkMode || Number(walkMode.version) < 7 || typeof walkMode.links !== "function") return null;
      return walkMode;
    } catch (_) {
      return null;
    }
  }

  // { from, answer, provider } or null. The provider is always resolved
  // first with lazy:true (paint path never builds); an indexing answer
  // means no rail now and a repaint on warm. Then walkMode.links when it
  // is v7 or later, else the provider shaped like an answer.
  treeWalkRailAnswer(path, source) {
    try {
      const normalized = treeWalkRailFilePath(path);
      if (!normalized) return null;
      const content = typeof source === "string" ? source : treeWalkRailText(source);
      let provider = null;
      try {
        if (typeof this.navGroupsResolve === "function") {
          provider = this.navGroupsResolve({ path: normalized, content, lazy: true });
        }
      } catch (_) {
        provider = null;
      }
      if (provider && provider.ok === true && provider.none
        && provider.none.reason === "indexing") {
        try {
          if (typeof this.treeWalkRailScheduleWarmRefresh === "function") {
            this.treeWalkRailScheduleWarmRefresh(normalized);
          }
        } catch (_) {}
        return null;
      }
      if (provider && provider.ok !== true) provider = null;
      // A non-tree route (calendar, record, or null for non-members) has
      // no tree rail.
      if (provider && provider.route !== "tree") return null;
      const walkMode = this.treeWalkRailWalkMode();
      if (walkMode) {
        let answer = null;
        try {
          answer = walkMode.links({ path: normalized, content });
        } catch (_) {
          answer = null;
        }
        if (!answer || answer.ok !== true) return null;
        // Authored conflicts keep today's behavior elsewhere; the rail
        // paints the effective stops, so a conflicted role simply has no
        // arm (the keys explain).
        return { from: "walkMode", answer, provider };
      }
      if (!provider) return null;
      return {
        from: "navGroups",
        provider,
        answer: {
          ok: true,
          prev: provider.step?.prev || null,
          next: provider.step?.next || null,
          prevGroup: provider.prevGroup || null,
          nextGroup: provider.nextGroup || null,
          group: provider.group || null,
          groupConflicts: [],
        },
      };
    } catch (_) {
      return null;
    }
  }

  treeWalkRailModelFor(path, source) {
    try {
      const resolved = this.treeWalkRailAnswer(path, source);
      if (!resolved) return null;
      if (typeof treeWalkRailModel !== "function") return null;
      return treeWalkRailModel({ answer: resolved.answer, provider: resolved.provider });
    } catch (_) {
      return null;
    }
  }

  // Build the kit rail for a model. Handlers see the painted item or arm:
  // onNavigate(direction, item, event) for step items, onActivate for
  // group arms. Returns the kit rail, else null. Never throws.
  treeWalkRailBuild(doc, model, handlers = {}) {
    try {
      if (!model || typeof model !== "object") return null;
      if (typeof propertyCardBuildRail !== "function") return null;
      const onNavigate = handlers && typeof handlers.onNavigate === "function" ? handlers.onNavigate : null;
      const onActivate = handlers && typeof handlers.onActivate === "function" ? handlers.onActivate : null;
      const step = model.step && typeof model.step === "object" ? model.step : null;
      const groupModel = model.group && typeof model.group === "object" ? model.group : null;
      let group = null;
      if (groupModel && (groupModel.prev || groupModel.next || groupModel.center)) {
        group = {
          label: TREE_WALK_RAIL_GROUP_LABEL,
          prev: groupModel.prev || null,
          next: groupModel.next || null,
          center: groupModel.center || null,
        };
        if (onActivate) group.onActivate = onActivate;
      }
      if (!step?.prev && !step?.parent && !step?.next && !group) return null;
      const spec = {
        label: treeWalkRailText(model.label).trim() || TREE_WALK_RAIL_LABEL,
        prev: step?.prev || null,
        parent: step?.parent || null,
        next: step?.next || null,
        group,
      };
      if (onNavigate) spec.onNavigate = onNavigate;
      const built = propertyCardBuildRail(doc, spec);
      try {
        if (built && built.element && typeof built.element.classList?.add === "function") {
          built.element.classList.add("bob-link-walk-rail");
        } else if (built && built.element && typeof built.element.setAttribute === "function") {
          const prior = built.element.getAttribute("class") || "";
          if (!/(?:^|\s)bob-link-walk-rail(?:\s|$)/.test(prior)) {
            built.element.setAttribute("class", `${prior} bob-link-walk-rail`.trim());
          }
        }
      } catch (_) {}
      return built;
    } catch (_) {
      return null;
    }
  }

  treeWalkRailNotice(message) {
    const text = treeWalkRailText(message).trim();
    if (!text) return;
    try {
      if (typeof this.intentionCardNotice === "function") {
        this.intentionCardNotice(text);
        return;
      }
      const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
      if (typeof NoticeCtor === "function") new NoticeCtor(text);
    } catch (_) {}
  }

  treeWalkRailHasCommand(commandId) {
    try {
      const commands = this.app?.commands;
      const command = commands?.commands?.[commandId] || commands?.findCommand?.(commandId) || null;
      return Boolean(command && typeof commands?.executeCommandById === "function");
    } catch (_) {
      return false;
    }
  }

  treeWalkRailRunInLeaf(commandId, sourcePath, event) {
    try {
      if (typeof this.intentionCardRunInLeaf === "function") {
        return this.intentionCardRunInLeaf(commandId, sourcePath, event) === true;
      }
      if (!this.treeWalkRailHasCommand(commandId)) return false;
      const leaf = typeof this.intentionCardLeafForEvent === "function"
        ? this.intentionCardLeafForEvent(event, sourcePath)
        : null;
      if (!leaf || treeWalkRailFilePath(leaf.view?.file?.path) !== treeWalkRailFilePath(sourcePath)) return false;
      this.app.workspace.setActiveLeaf?.(leaf, { focus: true });
      this.app.commands.executeCommandById(commandId);
      return true;
    } catch (_) {
      return false;
    }
  }

  treeWalkRailOpenLink(target, sourcePath, event) {
    try {
      if (typeof this.intentionCardOpenLink === "function") {
        return this.intentionCardOpenLink(target, sourcePath, event);
      }
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const modified = typeof intentionCardLinkModified === "function" && intentionCardLinkModified(event);
        void workspace.openLinkText(treeWalkRailText(target), treeWalkRailText(sourcePath), modified ? "tab" : false);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async treeWalkRailPaneText(sourcePath, event) {
    try {
      if (typeof this.intentionCardPaneText === "function") {
        return await this.intentionCardPaneText(sourcePath, event);
      }
      const vault = this.app?.vault;
      const file = vault?.getAbstractFileByPath?.(treeWalkRailFilePath(sourcePath));
      if (file && typeof vault.cachedRead === "function") return await vault.cachedRead(file);
      if (file && typeof vault.read === "function") return await vault.read(file);
    } catch (_) {}
    return null;
  }

  // Step activation: ghosts stop with their reason; a modified click opens
  // a tab; otherwise the stop is re-validated against the pane's current
  // text (a changed stop repaints and refuses), then nav's step command
  // runs in the card's pane so jump history agrees with the keys.
  async treeWalkRailActivate(direction, item, sourcePath, event) {
    try {
      if (!item) return false;
      const state = item.state === "creatable" || item.state === "ghost" ? item.state : "exists";
      if (state === "ghost") {
        this.treeWalkRailNotice(item.ghostReason || "Note is not in the vault");
        return false;
      }
      const step = direction === "prev" || direction === "next";
      const modified = typeof intentionCardLinkModified === "function" && intentionCardLinkModified(event);
      if (modified) return this.treeWalkRailOpenLink(item.target, sourcePath, event);
      if (step) {
        const text = await this.treeWalkRailPaneText(sourcePath, event);
        if (typeof text === "string") {
          const latest = this.treeWalkRailAnswer(sourcePath, text);
          const stop = latest?.answer?.[direction] || null;
          const same = stop
            && treeWalkRailText(stop.target).trim() === treeWalkRailText(item.target).trim()
            && (stop.state || "exists") === state;
          if (!same) {
            try {
              this.treeWalkRailRefresh(sourcePath, text);
            } catch (_) {}
            this.treeWalkRailNotice(TREE_WALK_RAIL_CHANGED);
            return false;
          }
          if (latest?.from === "walkMode"
            && this.treeWalkRailRunInLeaf(`bob-navigation-hotkeys:open-${direction}-link`, sourcePath, event)) {
            return true;
          }
        } else if (this.treeWalkRailRunInLeaf(`bob-navigation-hotkeys:open-${direction}-link`, sourcePath, event)) {
          return true;
        }
        if (state === "exists") return this.treeWalkRailOpenLink(item.target, sourcePath, event);
        this.treeWalkRailNotice(`${treeWalkRailText(item.label).trim() || "That note"} isn't created yet`);
        return false;
      }
      return this.treeWalkRailOpenLink(item?.target, sourcePath, event);
    } catch (_) {
      return false;
    }
  }

  // Group activation mirrors the step path with the group commands.
  async treeWalkRailGroupActivate(direction, arm, sourcePath, event) {
    try {
      if ((direction !== "prev" && direction !== "next") || !arm) return false;
      const state = arm.state === "creatable" || arm.state === "ghost" ? arm.state : "exists";
      if (state === "ghost") {
        this.treeWalkRailNotice(arm.ghostReason || "Note is not in the vault");
        return false;
      }
      const modified = typeof intentionCardLinkModified === "function" && intentionCardLinkModified(event);
      if (modified && state === "exists") return this.treeWalkRailOpenLink(arm.target, sourcePath, event);
      const text = await this.treeWalkRailPaneText(sourcePath, event);
      const latest = typeof text === "string" ? this.treeWalkRailAnswer(sourcePath, text) : null;
      const key = direction === "prev" ? "prevGroup" : "nextGroup";
      const stop = latest?.answer?.[key] || null;
      const same = stop
        && treeWalkRailText(stop.target).trim() === treeWalkRailText(arm.target).trim()
        && (stop.state || "exists") === state;
      if (!same) {
        try {
          this.treeWalkRailRefresh(sourcePath, text);
        } catch (_) {}
        this.treeWalkRailNotice(TREE_WALK_RAIL_CHANGED);
        return false;
      }
      if (latest?.from === "walkMode"
        && this.treeWalkRailRunInLeaf(`bob-navigation-hotkeys:open-${direction}-group-link`, sourcePath, event)) {
        return true;
      }
      if (state === "exists") return this.treeWalkRailOpenLink(arm.target, sourcePath, event);
      this.treeWalkRailNotice(`${treeWalkRailText(arm.landingLabel || arm.groupLabel).trim() || "That note"} isn't created yet`);
      return false;
    } catch (_) {
      return false;
    }
  }

  treeWalkRailMountedMap() {
    if (!(this.treeWalkRailMounted instanceof Map)) this.treeWalkRailMounted = new Map();
    return this.treeWalkRailMounted;
  }

  // Mount a built rail's refresh record. card is the Property Card element,
  // path the note path, getSource a () => string reader for re-validation.
  // The caller docks the built element; refresh swaps it in place only when
  // the signature changes.
  treeWalkRailTrack(card, path, getSource) {
    try {
      if (!card || typeof card !== "object") return () => {};
      const key = treeWalkRailFilePath(path);
      if (!key) return () => {};
      const map = this.treeWalkRailMountedMap();
      const record = { card, path: key, getSource, signature: null };
      try {
        const source = typeof getSource === "function" ? getSource() : null;
        const model = this.treeWalkRailModelFor(key, typeof source === "string" ? source : "");
        record.signature = model ? model.signature : null;
      } catch (_) {}
      map.set(key, record);
      try {
        if (typeof this.treeWalkRailEnsureSubscription === "function") this.treeWalkRailEnsureSubscription();
      } catch (_) {}
      return () => {
        try {
          if (map.get(key) === record) map.delete(key);
        } catch (_) {}
      };
    } catch (_) {
      return () => {};
    }
  }

  treeWalkRailUntrack(path) {
    try {
      this.treeWalkRailMountedMap().delete(treeWalkRailFilePath(path));
    } catch (_) {}
  }

  treeWalkRailEnsureSubscription() {
    try {
      if (this.treeWalkRailSubscribed === true) return;
      if (typeof this.navGroupsTreeOnChange !== "function") return;
      this.treeWalkRailSubscribed = true;
      this.navGroupsTreeOnChange(() => {
        try {
          this.treeWalkRailRefreshAll();
        } catch (_) {}
      });
    } catch (_) {}
  }

  treeWalkRailScheduleWarmRefresh(path) {
    try {
      const key = treeWalkRailFilePath(path);
      if (!key) return;
      if (typeof this.treeWalkRailEnsureSubscription === "function") this.treeWalkRailEnsureSubscription();
      const run = () => {
        try {
          this.treeWalkRailRefresh(key);
        } catch (_) {}
      };
      if (typeof setTimeout === "function") {
        const timer = setTimeout(run, 1500);
        if (timer && typeof timer.unref === "function") timer.unref();
      }
    } catch (_) {}
  }

  // Re-resolve one mounted path and swap its rail in place through the
  // floor dock, only when the signature changes. Returns true when a swap
  // happened. Never throws, never writes the vault, never spawns bob.
  treeWalkRailRefresh(path, sourceOverride) {
    try {
      const key = treeWalkRailFilePath(path);
      if (!key) return false;
      const record = this.treeWalkRailMountedMap().get(key);
      if (!record || !record.card) return false;
      let source = typeof sourceOverride === "string" ? sourceOverride : null;
      if (source === null) {
        try {
          source = typeof record.getSource === "function" ? record.getSource() : "";
        } catch (_) {
          source = "";
        }
      }
      const model = this.treeWalkRailModelFor(key, typeof source === "string" ? source : "");
      const signature = model ? model.signature : null;
      if (signature === record.signature) return false;
      record.signature = signature;
      const floor = typeof propertyCardFloorOf === "function" ? propertyCardFloorOf(record.card) : null;
      if (!model) {
        // No rail now: release the floor so the card ends on its cabinets.
        try {
          if (floor && typeof propertyCardFloorRelease === "function") propertyCardFloorRelease(record.card);
        } catch (_) {}
        return true;
      }
      // Rebuild with the same activation wiring: re-validation reads the
      // live pane, so handlers stay stable across swaps.
      const card = record.card;
      const sourcePath = key;
      const plugin = this;
      const doc = card.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return false;
      const built = plugin.treeWalkRailBuild(doc, model, {
        onNavigate: (direction, item, event) => plugin.treeWalkRailActivate(direction, item, sourcePath, event),
        onActivate: (direction, arm, event) => plugin.treeWalkRailGroupActivate(direction, arm, sourcePath, event),
      });
      if (!built) {
        try {
          if (floor && typeof propertyCardFloorRelease === "function") propertyCardFloorRelease(record.card);
        } catch (_) {}
        return true;
      }
      try {
        if (typeof propertyCardFloorDock === "function") propertyCardFloorDock(card, built.element);
        else card.appendChild(built.element);
      } catch (_) {
        return false;
      }
      if (floor && floor !== built.element) {
        try {
          floor.remove?.();
        } catch (_) {}
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  treeWalkRailRefreshAll() {
    try {
      let swapped = 0;
      for (const key of Array.from(this.treeWalkRailMountedMap().keys())) {
        try {
          if (this.treeWalkRailRefresh(key) === true) swapped += 1;
        } catch (_) {}
      }
      return swapped;
    } catch (_) {
      return 0;
    }
  }
}
