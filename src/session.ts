import type { SavedNode } from "./layout";
import type { SavedTab } from "./groups";

export interface SessionState {
  tabs: SavedTab[];
  activeIndex: number;
}

const KEY = "term-lab.session";

function isValidNode(n: unknown): n is SavedNode {
  if (!n || typeof n !== "object") return false;
  const node = n as Record<string, unknown>;
  if (node.kind === "leaf") return typeof node.cwd === "string";
  if (node.kind === "split") {
    return (
      (node.dir === "row" || node.dir === "col") &&
      Array.isArray(node.sizes) &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every(isValidNode)
    );
  }
  return false;
}

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs.filter(
      (t): t is SavedTab =>
        !!t && typeof t.title === "string" && typeof t.custom === "boolean" && isValidNode(t.layout),
    );
    if (tabs.length === 0) return null;
    const idx = typeof parsed.activeIndex === "number" ? parsed.activeIndex : 0;
    return {
      tabs,
      activeIndex: Math.min(tabs.length - 1, Math.max(0, idx)),
    };
  } catch {
    return null;
  }
}

export function saveSession(state: SessionState): void {
  if (state.tabs.length === 0) {
    clearSession();
    return;
  }
  localStorage.setItem(
    KEY,
    JSON.stringify({
      tabs: state.tabs,
      activeIndex: Math.min(state.tabs.length - 1, Math.max(0, state.activeIndex)),
    }),
  );
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
