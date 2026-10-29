import { beforeEach, describe, expect, it } from "vitest";
import { deleteGroup, loadGroups, saveGroup } from "./groups";
import { DEFAULT_PREFERENCES, clampFontSize, loadPreferences, savePreferences } from "./preferences";
import { clearSession, loadSession, saveSession } from "./session";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
});

describe("preferences", () => {
  it("returns defaults when storage is empty or corrupted", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem("term-lab.preferences", "{invalid");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("persists and sanitizes custom preferences", () => {
    const saved = savePreferences({
      fontSize: 40,
      shell: "  /opt/homebrew/bin/fish  ",
      cursorStyle: "bar",
      cursorBlink: false,
      scrollback: 100,
    });
    expect(saved.fontSize).toBe(28);
    expect(saved.shell).toBe("/opt/homebrew/bin/fish");
    expect(saved.cursorStyle).toBe("bar");
    expect(saved.cursorBlink).toBe(false);
    expect(saved.scrollback).toBe(500);
    expect(loadPreferences()).toEqual(saved);
    expect(clampFontSize(5)).toBe(10);
  });
});

describe("groups", () => {
  it("saves, replaces case-insensitively and deletes groups", () => {
    const tab = { title: "web", custom: true, layout: { kind: "leaf" as const, cwd: "/app/web" } };
    const g1 = saveGroup({ name: "App Olá", dir: "/app", tabs: [tab] });
    expect(g1).toHaveLength(1);

    const g2 = saveGroup({ name: "app olá", dir: "/app2", tabs: [tab] });
    expect(g2).toHaveLength(1);
    expect(g2[0].id).toBe(g1[0].id);
    expect(g2[0].dir).toBe("/app2");

    expect(deleteGroup(g1[0].id)).toEqual([]);
    expect(loadGroups()).toEqual([]);
  });
});

describe("session", () => {
  it("persists open tabs and clamps activeIndex", () => {
    expect(loadSession()).toBeNull();
    saveSession({
      activeIndex: 99,
      tabs: [
        { title: "api", custom: true, layout: { kind: "leaf", cwd: "/proj/api" } },
        {
          title: "web",
          custom: false,
          layout: {
            kind: "split",
            dir: "row",
            sizes: [0.5, 0.5],
            children: [
              { kind: "leaf", cwd: "/proj/web" },
              { kind: "leaf", cwd: "/proj/docs" },
            ],
          },
        },
      ],
    });
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.activeIndex).toBe(1);
    expect(loaded!.tabs).toHaveLength(2);

    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("ignores malformed session data", () => {
    localStorage.setItem("term-lab.session", JSON.stringify({ tabs: [{ title: "x" }], activeIndex: 0 }));
    expect(loadSession()).toBeNull();
  });
});
