// Successor picker API and mixin (`api.successors` v4,
// docs/task-dependencies.md §12.13/§12.22). Extracted from 206 with no
// behavior change so 206 stays at or below the 1000-line fragment cap.
// Shared scope with 206, 206a-206d, and 206e.
function createSuccessorPickerApi(plugin) {
  return Object.freeze({
    version: 5,
    pick(model) {
      try {
        if (!plugin || plugin.successorPickerUnavailable === true || typeof plugin.pickSuccessorOffers !== "function") {
          return Promise.resolve(null);
        }
        return Promise.resolve()
          .then(() => plugin.pickSuccessorOffers(model))
          .then((result) => {
            try {
              if (!result || !Array.isArray(result.picks)) {
                return null;
              }
              if (result.picks.length === 0 && !(Array.isArray(result.closes) && result.closes.length > 0) &&
                !(result.jump && typeof result.jump === "object" && typeof result.jump.key === "string" && result.jump.key)) {
                return null;
              }
              return result;
            } catch (_error) {
              return null;
            }
          })
          .catch(() => null);
      } catch (_error) {
        return Promise.resolve(null);
      }
    },
  });
}

class BobNavigationHotkeysSuccessorPickerMixin {
  successorPickerNow() {
    return Date.now();
  }

  beginReviewSuccessorGestureOwner(origin, kind = "capture") {
    try {
      if (!origin || !Number.isInteger(origin.seq) || !Number.isInteger(origin.epoch)) {
        return null;
      }
      const owner = {
        seq: origin.seq,
        epoch: origin.epoch,
        key: successorPickerText(origin.key),
        kind,
        held: false,
      };
      this.reviewSuccessorGestureOwner = owner;
      return owner;
    } catch (_error) {
      return null;
    }
  }

  holdReviewWalkForSuccessorPicker() {
    try {
      const owner = this.reviewSuccessorGestureOwner;
      const landing = this.reviewLanding;
      if (
        !owner ||
        owner.seq !== this.reviewGestureSeq ||
        owner.epoch !== this.reviewLandingEpoch ||
        (owner.key && (!landing || landing.key !== owner.key))
      ) {
        return null;
      }
      owner.held = true;
      this.reviewSuccessorWalkHold = owner;
      return owner;
    } catch (_error) {
      return null;
    }
  }

  isReviewSuccessorWalkHeld() {
    return Boolean(
      this.reviewSuccessorWalkHold &&
      this.reviewSuccessorWalkHold.held === true,
    );
  }

  releaseReviewSuccessorGestureOwner(originOrOwner) {
    try {
      if (!originOrOwner) return false;
      const owner = originOrOwner && originOrOwner.held !== undefined
        ? originOrOwner
        : this.reviewSuccessorGestureOwner;
      if (!owner) return false;
      if (
        originOrOwner && originOrOwner.seq !== undefined &&
        (owner.seq !== originOrOwner.seq || owner.epoch !== originOrOwner.epoch)
      ) {
        return false;
      }
      owner.held = false;
      if (this.reviewSuccessorWalkHold === owner) {
        this.reviewSuccessorWalkHold = null;
      }
      if (this.reviewSuccessorGestureOwner === owner) {
        this.reviewSuccessorGestureOwner = null;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  pickSuccessorOffers(model, options = {}) {
    try {
      if (
        this.successorPickerUnavailable === true ||
        this.activeSuccessorPicker ||
        !normalizeSuccessorPickerModel(model)
      ) {
        return Promise.resolve(null);
      }
      this.holdReviewWalkForSuccessorPicker();
      const retargetEnabled =
        !options || typeof options !== "object" || options.retarget !== false;
      return new Promise((resolve) => {
        let modal = null;
        let settled = false;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          if (this.activeSuccessorPicker === modal) {
            this.activeSuccessorPicker = null;
          }
          try {
            if (result && Array.isArray(result.picks)) {
              const normalized = normalizeSuccessorPickerModel(model);
              if (!normalized) {
                resolve(null);
                return;
              }
              const byKey = new Map();
              for (const group of normalized.groups) {
                for (const row of group.rows) {
                  if (row && typeof row.key === "string" && !byKey.has(row.key)) {
                    byKey.set(row.key, row);
                  }
                }
              }
              const allowed = new Set([...byKey].filter(([, row]) => row.selectable).map(([key]) => key));
              const picks = [];
              const pickedKeys = new Set();
              for (const pick of result.picks) {
                const key = pick && typeof pick.key === "string" ? pick.key : "";
                if (!allowed.has(key) || pickedKeys.has(key)) continue;
                pickedKeys.add(key);
                const item = { key };
                if (retargetEnabled) {
                  const destination = normalizeSuccessorDestinationOverride(pick && pick.destination);
                  if (destination) {
                    item.destination = destination;
                  }
                }
                picks.push(item);
              }
              const closes = normalizeSuccessorClosesForResult({ model: normalized }, result.closes);
              const kept = closes.filter((close) => !pickedKeys.has(close.key));
              let jump = null;
              try {
                const jumpKey = result.jump && typeof result.jump === "object" &&
                  typeof result.jump.key === "string" ? result.jump.key : "";
                if (jumpKey && allowed.has(jumpKey)) {
                  jump = { key: jumpKey };
                }
              } catch (_jumpError) {
                jump = null;
              }
              if (picks.length === 0 && kept.length === 0 && !jump) {
                resolve(null);
                return;
              }
              resolve({
                picks,
                ...(kept.length > 0 ? { closes: kept } : {}),
                ...(jump ? { jump } : {}),
              });
            } else {
              resolve(null);
            }
          } catch (_error) {
            resolve(null);
          }
        };
        try {
          modal = new SuccessorOfferPickerModal(
            this.app,
            model,
            settle,
            { now: () => this.successorPickerNow(), retarget: retargetEnabled },
          );
          this.activeSuccessorPicker = modal;
          modal.open();
          if (!modal.pickerOpen) settle(null);
        } catch (_error) {
          if (modal) {
            try {
              modal.settle(null);
            } catch (_settleError) {
              settle(null);
            }
          } else {
            settle(null);
          }
        }
      });
    } catch (_error) {
      return Promise.resolve(null);
    }
  }

  closeSuccessorPickerForUnload() {
    const modal = this.activeSuccessorPicker;
    if (modal) {
      try {
        modal.allowCloseWithoutArm = true;
        modal.close();
      } catch (_error) {
        try {
          modal.settle(null);
        } catch (_settleError) {
          this.activeSuccessorPicker = null;
        }
      }
    }
    this.activeSuccessorPicker = null;
    this.releaseReviewSuccessorGestureOwner(this.reviewSuccessorGestureOwner);
    this.reviewSuccessorWalkHold = null;
    this.reviewSuccessorGestureOwner = null;
  }
}
