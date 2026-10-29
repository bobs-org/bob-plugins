class BobLedgerToolsRelationMentionCardMixin {
  relationOpenMentionCard(chip, sourcePath, pill, event, reason) {
    try {
      if (!chip || chip.kind !== "mention" || !pill) return false;
      if (this.relationMentionCardRestoringFocus === pill) {
        this.relationMentionCardRestoringFocus = null;
        return false;
      }
      if (reason === "hover") {
        if (this.relationMentionCardState && this.relationMentionCardState.pill === pill) {
          this.relationMentionCardState.pointerOnPill = true;
          this.relationMentionCardClearCloseTimer();
          return true;
        }
        this.relationMentionCardCancelHover();
        const timer = setTimeout(() => {
          const pending = this.relationMentionCardHover;
          if (!pending || pending.pill !== pill) return;
          this.relationMentionCardHover = null;
          this.relationOpenMentionCardNow(chip, sourcePath, pill, event, "hover");
        }, 420);
        if (timer && typeof timer.unref === "function") timer.unref();
        this.relationMentionCardHover = { pill, timer };
        return true;
      }
      this.relationMentionCardCancelHover();
      return this.relationOpenMentionCardNow(chip, sourcePath, pill, event, reason || "click");
    } catch (error) {
      return false;
    }
  }

  relationOpenMentionCardNow(chip, sourcePath, pill, event, reason) {
    try {
      const doc = pill && pill.ownerDocument ? pill.ownerDocument : (typeof document !== "undefined" ? document : null);
      if (!doc || typeof doc.createElement !== "function") return false;
      const current = this.relationMentionCardState;
      if (current && current.pill === pill && current.card && current.card.parentNode) {
        current.pointerOnPill = reason === "hover" || current.pointerOnPill;
        current.focusWithin = reason === "focus" || reason === "keyboard" || current.focusWithin;
        this.relationMentionCardClearCloseTimer();
        return true;
      }
      this.relationCloseMentionCard(false);
      const id = "bob-mention-card-" + String((this.relationMentionCardSequence = (this.relationMentionCardSequence || 0) + 1));
      const built = this.relationCreateMentionCard(doc, chip, sourcePath, id);
      if (!built || !built.card) return false;
      const state = {
        id,
        pill,
        card: built.card,
        chip,
        sourcePath: String(sourcePath || ""),
        occurrenceButtons: built.occurrenceButtons,
        pointerOnPill: reason === "hover",
        pointerOnCard: false,
        focusWithin: reason === "focus" || reason === "keyboard" || (doc.activeElement === pill),
        closeTimer: null,
      };
      this.relationMentionCardState = state;
      try {
        pill.setAttribute("aria-expanded", "true");
        pill.setAttribute("aria-controls", id);
      } catch (error) {
        // The pill remains discoverable through aria-haspopup.
      }
      const card = built.card;
      card.addEventListener("mouseenter", () => {
        if (this.relationMentionCardState !== state) return;
        state.pointerOnCard = true;
        this.relationMentionCardClearCloseTimer();
      });
      card.addEventListener("mouseleave", () => {
        if (this.relationMentionCardState !== state) return;
        state.pointerOnCard = false;
        this.relationMentionCardScheduleClose();
      });
      card.addEventListener("focusin", () => {
        if (this.relationMentionCardState === state) state.focusWithin = true;
      });
      card.addEventListener("focusout", () => {
        setTimeout(() => {
          if (this.relationMentionCardState !== state) return;
          const active = doc.activeElement;
          state.focusWithin = active === pill || this.relationNodeContains(card, active);
          this.relationMentionCardScheduleClose();
        }, 0);
      });
      pill.addEventListener("focusout", () => {
        setTimeout(() => {
          if (this.relationMentionCardState !== state) return;
          const active = doc.activeElement;
          state.focusWithin = active === pill || this.relationNodeContains(card, active);
          this.relationMentionCardScheduleClose();
        }, 0);
      });
      card.addEventListener("keydown", (keyEvent) => {
        try {
          if (keyEvent && keyEvent.key === "Escape") {
            if (typeof keyEvent.preventDefault === "function") keyEvent.preventDefault();
            this.relationCloseMentionCard(true, pill);
            return;
          }
          if (keyEvent && ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(keyEvent.key) && state.occurrenceButtons.length) {
            if (typeof keyEvent.preventDefault === "function") keyEvent.preventDefault();
            const currentIndex = state.occurrenceButtons.indexOf(keyEvent.target);
            const forward = keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowRight";
            const nextIndex = currentIndex < 0
              ? (forward ? 0 : state.occurrenceButtons.length - 1)
              : (currentIndex + (forward ? 1 : -1) + state.occurrenceButtons.length) % state.occurrenceButtons.length;
            state.occurrenceButtons[nextIndex].focus();
          }
        } catch (error) {
          // Keep navigation within the card best-effort.
        }
      });
      const parent = doc.body || doc.documentElement || pill.parentNode;
      if (!parent || typeof parent.appendChild !== "function") return false;
      parent.appendChild(card);
      this.relationPositionMentionCard(card, pill);
      if (reason === "keyboard" && state.occurrenceButtons.length) state.occurrenceButtons[0].focus();
      return true;
    } catch (error) {
      return false;
    }
  }

  relationCreateMentionCard(doc, chip, sourcePath, id) {
    try {
      const card = doc.createElement("div");
      card.setAttribute("class", "bob-mention-card");
      card.setAttribute("id", id);
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "💬 Mentioned in another task's text · not a relation");
      card.setAttribute("tabindex", "-1");
      const header = doc.createElement("div");
      header.setAttribute("class", "bob-mention-card-header");
      header.appendChild(doc.createTextNode("💬 Mentioned in another task's text · not a relation"));
      card.appendChild(header);

      const source = doc.createElement("div");
      source.setAttribute("class", "bob-mention-card-source");
      const status = doc.createElement("span");
      status.setAttribute("class", "bob-mention-card-status");
      status.setAttribute("aria-hidden", "true");
      status.appendChild(doc.createTextNode(String(chip.symbol || "○")));
      source.appendChild(status);
      const title = doc.createElement("span");
      title.setAttribute("class", "bob-mention-card-title");
      title.appendChild(doc.createTextNode(String(chip.fullText || chip.text || "Task")));
      source.appendChild(title);
      if (chip.noteLabel) {
        const note = doc.createElement("span");
        note.setAttribute("class", "bob-mention-card-note");
        note.appendChild(doc.createTextNode(String(chip.noteLabel)));
        source.appendChild(note);
      }
      const count = Math.max(0, Number(chip.count) || 0);
      if (count >= 2) {
        const countLabel = doc.createElement("span");
        countLabel.setAttribute("class", "bob-mention-card-count");
        countLabel.appendChild(doc.createTextNode("mentioned " + count + "× in this task"));
        source.appendChild(countLabel);
      }
      card.appendChild(source);

      const occurrences = Array.isArray(chip.occurrences) ? chip.occurrences : [];
      const shown = occurrences.slice(0, 3);
      const occurrenceButtons = [];
      if (shown.length > 0) {
        const list = doc.createElement("div");
        list.setAttribute("class", "bob-mention-card-occurrences");
        shown.forEach((occurrence, index) => {
          const button = doc.createElement("button");
          button.setAttribute("type", "button");
          button.setAttribute("class", "bob-mention-card-occurrence");
          button.setAttribute("aria-label", this.relationMentionOccurrenceLabel(occurrence, chip.display));
          const excerpt = typeof occurrence.excerpt === "string" ? relationFitMentionQuote(occurrence.excerpt, 120) : null;
          if (excerpt) relationAppendMentionQuote(button, excerpt, doc);
          const location = doc.createElement("span");
          location.setAttribute("class", "bob-mention-card-location");
          location.appendChild(doc.createTextNode(this.relationMentionOccurrenceLabel(occurrence, chip.display)));
          button.appendChild(location);
          const activate = (activateEvent) => {
            try {
              if (activateEvent && typeof activateEvent.preventDefault === "function") activateEvent.preventDefault();
              this.relationCloseMentionCard(false);
              this.relationOpenMention(chip, sourcePath, activateEvent, occurrence);
            } catch (error) {
              // A failed jump leaves the source note unchanged.
            }
          };
          button.addEventListener("click", activate);
          button.addEventListener("keydown", (keyEvent) => {
            if (keyEvent && (keyEvent.key === "Enter" || keyEvent.key === " ")) {
              if (typeof keyEvent.preventDefault === "function") keyEvent.preventDefault();
              activate(keyEvent);
            }
          });
          list.appendChild(button);
          occurrenceButtons.push(button);
        });
        card.appendChild(list);
      } else {
        const stale = doc.createElement("div");
        stale.setAttribute("class", "bob-mention-card-stale");
        stale.appendChild(doc.createTextNode(String(chip.tooltip || "No longer mentioned here · refreshes on the next reconcile")));
        card.appendChild(stale);
      }
      const remainder = Math.max(0, count || occurrences.length) - shown.length;
      if (remainder > 0) {
        const more = doc.createElement("div");
        more.setAttribute("class", "bob-mention-card-more");
        more.appendChild(doc.createTextNode("+" + remainder + " more"));
        card.appendChild(more);
      }
      if (occurrences.length > 0) {
        const action = doc.createElement("button");
        action.setAttribute("type", "button");
        action.setAttribute("class", "bob-mention-card-open");
        action.appendChild(doc.createTextNode("↵ Open at the mention"));
        action.addEventListener("click", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") event.preventDefault();
            this.relationCloseMentionCard(false);
            this.relationOpenMention(chip, sourcePath, event, occurrences[0]);
          } catch (error) {
            // Best-effort navigation.
          }
        });
        card.appendChild(action);
      }
      const escape = doc.createElement("span");
      escape.setAttribute("class", "bob-mention-card-escape");
      escape.appendChild(doc.createTextNode("Esc to close"));
      card.appendChild(escape);
      return { card, occurrenceButtons };
    } catch (error) {
      return null;
    }
  }

  relationMentionOccurrenceLabel(occurrence, display) {
    try {
      if ((occurrence && occurrence.display) === "embed" || display === "embed") return "embedded as a sub-task";
      const labels = {
        title: "in its title",
        note: "in a note under it",
        cancel_log: "in its Cancel Log",
        schedule_log: "in its Schedule Log",
        work_log: "in its Work Log",
        rotten_log: "in its Rotten Log",
      };
      return labels[String(occurrence && occurrence.site || "")] || "in its text";
    } catch (error) {
      return "in its text";
    }
  }

  relationPositionMentionCard(card, pill) {
    try {
      if (!card || !pill || !card.style || typeof pill.getBoundingClientRect !== "function") return;
      const rect = pill.getBoundingClientRect();
      const view = (pill.ownerDocument && pill.ownerDocument.defaultView) || (typeof window !== "undefined" ? window : null);
      const width = Number(view && view.innerWidth) || 1024;
      const height = Number(view && view.innerHeight) || 768;
      const left = Math.max(8, Math.min(Number(rect.left) || 0, width - 440));
      const below = (Number(rect.bottom) || 0) + 8;
      const top = below + 260 <= height ? below : Math.max(8, (Number(rect.top) || 0) - 268);
      card.style.position = "fixed";
      card.style.left = left + "px";
      card.style.top = top + "px";
    } catch (error) {
      // Default flow placement is still usable.
    }
  }

  relationNodeContains(root, node) {
    try {
      if (!root || !node) return false;
      if (typeof root.contains === "function") return root.contains(node);
      let current = node;
      let guard = 0;
      while (current && guard < 100) {
        if (current === root) return true;
        current = current.parentNode || null;
        guard += 1;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  relationMentionCardCancelHover(pill) {
    try {
      const pending = this.relationMentionCardHover;
      if (!pending || (pill && pending.pill !== pill)) return;
      clearTimeout(pending.timer);
      this.relationMentionCardHover = null;
    } catch (error) {
      this.relationMentionCardHover = null;
    }
  }

  relationMentionCardPointerLeave(pill) {
    try {
      this.relationMentionCardCancelHover(pill);
      const state = this.relationMentionCardState;
      if (!state || state.pill !== pill) return;
      state.pointerOnPill = false;
      this.relationMentionCardScheduleClose();
    } catch (error) {
      // A failed dismissal never removes the mention row.
    }
  }

  relationMentionCardNavigate(pill, direction) {
    try {
      const state = this.relationMentionCardState;
      if (!state || state.pill !== pill || !state.occurrenceButtons.length) return false;
      const index = direction < 0 ? state.occurrenceButtons.length - 1 : 0;
      state.occurrenceButtons[index].focus();
      return true;
    } catch (error) {
      return false;
    }
  }

  relationMentionCardClearCloseTimer() {
    try {
      const state = this.relationMentionCardState;
      if (!state || !state.closeTimer) return;
      clearTimeout(state.closeTimer);
      state.closeTimer = null;
    } catch (error) {
      // A pending close is harmless if a runtime rejects timer clearing.
    }
  }

  relationMentionCardScheduleClose() {
    try {
      const state = this.relationMentionCardState;
      if (!state) return;
      this.relationMentionCardClearCloseTimer();
      const timer = setTimeout(() => {
        if (this.relationMentionCardState !== state) return;
        if (!state.pointerOnPill && !state.pointerOnCard && !state.focusWithin) this.relationCloseMentionCard(false);
      }, 220);
      if (timer && typeof timer.unref === "function") timer.unref();
      state.closeTimer = timer;
    } catch (error) {
      // Do not throw through a DOM event handler.
    }
  }

  relationCloseMentionCard(restoreFocus, expectedPill) {
    try {
      this.relationMentionCardCancelHover();
      const state = this.relationMentionCardState;
      if (!state || (expectedPill && state.pill !== expectedPill)) return false;
      this.relationMentionCardClearCloseTimer();
      this.relationMentionCardState = null;
      try {
        state.pill.removeAttribute("aria-expanded");
        state.pill.removeAttribute("aria-controls");
      } catch (error) {
        // It may already be detached during a render.
      }
      try {
        if (state.card && typeof state.card.remove === "function") state.card.remove();
        else if (state.card && state.card.parentNode && typeof state.card.parentNode.removeChild === "function") state.card.parentNode.removeChild(state.card);
      } catch (error) {
        // A detached card is already closed.
      }
      if (restoreFocus && state.pill && typeof state.pill.focus === "function") {
        this.relationMentionCardRestoringFocus = state.pill;
        state.pill.focus();
        setTimeout(() => {
          if (this.relationMentionCardRestoringFocus === state.pill) this.relationMentionCardRestoringFocus = null;
        }, 0);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  relationCloseMentionCardForSource(sourcePath) {
    try {
      const state = this.relationMentionCardState;
      if (state && state.sourcePath === String(sourcePath || "")) this.relationCloseMentionCard(false);
    } catch (error) {
      // A card never blocks its row from rendering.
    }
  }

}
