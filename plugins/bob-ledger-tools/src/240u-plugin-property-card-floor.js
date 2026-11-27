// Card floor (bob-cli-ra rail): the structural link-walk floor for every
// Property Card. The invariant is card identity → body → cabinet stack →
// link-walk rail, last. Enforce it structurally, not by call order:
// dock marks the rail and keeps it the card's last child, append inserts
// above the floor, and release removes it. Pure DOM, null instead of
// throwing, direct children only.

const PROPERTY_CARD_FLOOR_ATTR = "data-card-floor";
const PROPERTY_CARD_FLOOR_VALUE = "link-walk";

function propertyCardFloorOf(card) {
  try {
    if (!card || typeof card !== "object") return null;
    const children = card.children;
    if (!children || typeof children.length !== "number") return null;
    for (const child of Array.from(children)) {
      try {
        if (child && typeof child.getAttribute === "function"
          && child.getAttribute(PROPERTY_CARD_FLOOR_ATTR) === PROPERTY_CARD_FLOOR_VALUE) {
          return child;
        }
      } catch (_) {}
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Mark rail as the card's floor, replacing any existing direct-child floor,
// and append it as the card's last child. Returns the rail, else null.
function propertyCardFloorDock(card, rail) {
  try {
    if (!card || typeof card.appendChild !== "function") return null;
    if (!rail || typeof rail.setAttribute !== "function") return null;
    const existing = propertyCardFloorOf(card);
    if (existing && existing !== rail) {
      try {
        if (typeof card.removeChild === "function") card.removeChild(existing);
        else if (typeof existing.remove === "function") existing.remove();
      } catch (_) {
        return null;
      }
    }
    try {
      rail.setAttribute(PROPERTY_CARD_FLOOR_ATTR, PROPERTY_CARD_FLOOR_VALUE);
    } catch (_) {
      return null;
    }
    try {
      if (rail.parentNode === card) {
        card.appendChild(rail);
      } else {
        card.appendChild(rail);
      }
    } catch (_) {
      return null;
    }
    return rail;
  } catch (_) {
    return null;
  }
}

// Insert node above the direct-child floor when one exists, else append.
// Returns the node, else null. Never moves or touches the floor itself.
function propertyCardFloorAppend(card, node) {
  try {
    if (!card || typeof card.appendChild !== "function") return null;
    if (!node || typeof node !== "object") return null;
    const floor = propertyCardFloorOf(card);
    if (floor && floor !== node) {
      try {
        if (typeof card.insertBefore === "function") {
          card.insertBefore(node, floor);
          return node;
        }
      } catch (_) {
        return null;
      }
    }
    try {
      card.appendChild(node);
    } catch (_) {
      return null;
    }
    return node;
  } catch (_) {
    return null;
  }
}

// Remove the direct-child floor, if any. Returns the removed node, else null.
function propertyCardFloorRelease(card) {
  try {
    const floor = propertyCardFloorOf(card);
    if (!floor) return null;
    try {
      if (card && typeof card.removeChild === "function") {
        card.removeChild(floor);
        return floor;
      }
      if (typeof floor.remove === "function") {
        floor.remove();
        return floor;
      }
    } catch (_) {
      return null;
    }
    return null;
  } catch (_) {
    return null;
  }
}
