import { beforeEach, describe, expect, it } from "vitest";
import {
  appendTabToGroup, deleteGroup, loadGroups, missingGroupTabs, moveIntoGroup, saveGroup, upsertGroup,
} from "./groups";
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

  it("upsertGroup returns the saved group keeping a stable id on replace", () => {
    const tab = { title: "api", custom: false, layout: { kind: "leaf" as const, cwd: "/app/api" } };
    const first = upsertGroup({ name: "Projeto", dir: "/app", tabs: [tab] });
    expect(first.saved.id).toBeTruthy();
    expect(first.groups).toHaveLength(1);

    const second = upsertGroup({ name: "PROJETO", dir: "/app", tabs: [tab, tab] });
    expect(second.saved.id).toBe(first.saved.id);
    expect(second.saved.tabs).toHaveLength(2);
    expect(loadGroups()).toHaveLength(1);
  });
});

type Item = { n: string; groupId?: string };

describe("drag tabs into groups", () => {
  it("moveIntoGroup places the item after the last member of the group", () => {
    const a: Item = { n: "a", groupId: "g" }, b: Item = { n: "b" }, c: Item = { n: "c", groupId: "g" }, d: Item = { n: "d" };
    const list = [a, b, c, d];
    expect(moveIntoGroup(list, d, "g").map((t) => t.n)).toEqual(["a", "b", "c", "d"]);
    expect(moveIntoGroup(list, b, "g").map((t) => t.n)).toEqual(["a", "c", "b", "d"]);
    expect(list.map((t) => t.n)).toEqual(["a", "b", "c", "d"]); // não altera a lista original
  });

  it("moveIntoGroup moves the item to the end when leaving a group or the group is empty", () => {
    const a: Item = { n: "a", groupId: "g" }, b: Item = { n: "b" };
    expect(moveIntoGroup([a, b], a).map((t) => t.n)).toEqual(["b", "a"]);
    expect(moveIntoGroup([a, b], b, "x").map((t) => t.n)).toEqual(["a", "b"]);
  });

  it("appendTabToGroup adds the tab keeping the id and ignores unknown ids", () => {
    const tab = { title: "api", custom: false, layout: { kind: "leaf" as const, cwd: "/app/api" } };
    const { saved } = upsertGroup({ name: "Projeto", dir: "/app", tabs: [tab] });
    const groups = appendTabToGroup(saved.id, { ...tab, title: "web" });
    expect(groups[0].id).toBe(saved.id);
    expect(loadGroups()[0].tabs.map((t) => t.title)).toEqual(["api", "web"]);
    expect(appendTabToGroup("nope", tab)).toEqual(loadGroups());
    expect(loadGroups()[0].tabs).toHaveLength(2);
  });
});

describe("group tab keys", () => {
  const leaf = (cwd: string) => ({ kind: "leaf" as const, cwd });

  it("assigns stable keys to legacy groups and keeps them across loads", () => {
    localStorage.setItem(
      "term-lab.groups",
      JSON.stringify([{ id: "g", name: "G", dir: "/", tabs: [{ title: "a", custom: false, layout: leaf("/a") }] }]),
    );
    const key = loadGroups()[0].tabs[0].key;
    expect(key).toBeTruthy();
    expect(loadGroups()[0].tabs[0].key).toBe(key);
  });

  it("appendTabToGroup does not duplicate a tab with the same key", () => {
    const { saved } = upsertGroup({ name: "G", dir: "/", tabs: [{ title: "a", custom: false, layout: leaf("/a") }] });
    appendTabToGroup(saved.id, { title: "b", custom: false, key: "kb", layout: leaf("/b") });
    appendTabToGroup(saved.id, { title: "b2", custom: false, key: "kb", layout: leaf("/b2") });
    expect(loadGroups()[0].tabs.map((t) => t.title)).toEqual(["a", "b2"]);
  });

  it("missingGroupTabs returns only saved tabs that are not open", () => {
    const { saved } = upsertGroup({
      name: "G",
      dir: "/",
      tabs: ["a", "b", "c"].map((n) => ({ title: n, custom: false, key: `k${n}`, layout: leaf(`/${n}`) })),
    });
    expect(missingGroupTabs(saved, ["kb"]).map((t) => t.title)).toEqual(["a", "c"]);
    expect(missingGroupTabs(saved, ["ka", "kb", "kc"])).toEqual([]);
    expect(missingGroupTabs(saved, [])).toHaveLength(3);
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

  it("preserves group links and collapsed groups", () => {
    saveSession({
      activeIndex: 0,
      collapsedGroups: ["g1"],
      tabs: [
        { title: "api", custom: false, layout: { kind: "leaf", cwd: "/p/api" }, groupId: "g1", groupName: "Projeto" },
        { title: "solo", custom: false, layout: { kind: "leaf", cwd: "/p" } },
      ],
    });
    const loaded = loadSession()!;
    expect(loaded.collapsedGroups).toEqual(["g1"]);
    expect(loaded.tabs[0].groupId).toBe("g1");
    expect(loaded.tabs[0].groupName).toBe("Projeto");
    expect(loaded.tabs[0].key).toBeUndefined();
    expect(loaded.tabs[1].groupId).toBeUndefined();
  });

  it("drops invalid group fields from stored sessions", () => {
    localStorage.setItem(
      "term-lab.session",
      JSON.stringify({
        activeIndex: 0,
        collapsedGroups: ["g1", 42, null],
        tabs: [{ title: "x", custom: false, layout: { kind: "leaf", cwd: "/" }, groupId: 7, groupName: "y" }],
      }),
    );
    const loaded = loadSession()!;
    expect(loaded.collapsedGroups).toEqual(["g1"]);
    expect(loaded.tabs[0]).toEqual({ title: "x", custom: false, layout: { kind: "leaf", cwd: "/" } });
  });

  it("ignores malformed session data", () => {
    localStorage.setItem("term-lab.session", JSON.stringify({ tabs: [{ title: "x" }], activeIndex: 0 }));
    expect(loadSession()).toBeNull();
  });
});
