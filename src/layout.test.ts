import { describe, expect, it } from "vitest";
import {
  type Node,
  hydrate,
  insertBeside,
  leaves,
  normalize,
  serialize,
  swapLeaves,
  without,
} from "./layout";

const leaf = (pane: string): Node<string> => ({ kind: "leaf", pane });

describe("layout tree", () => {
  it("collects leaves in visual order", () => {
    const tree: Node<string> = {
      kind: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        leaf("a"),
        { kind: "split", dir: "col", sizes: [0.5, 0.5], children: [leaf("b"), leaf("c")] },
      ],
    };
    expect(leaves(tree)).toEqual(["a", "b", "c"]);
    expect(leaves(null)).toEqual([]);
  });

  it("inserts beside target and merges splits of same direction", () => {
    let tree: Node<string> = leaf("a");
    tree = insertBeside(tree, "a", "b", "right");
    expect(tree.kind).toBe("split");
    if (tree.kind === "split") {
      expect(tree.dir).toBe("row");
      expect(leaves(tree)).toEqual(["a", "b"]);
      expect(tree.sizes).toEqual([0.5, 0.5]);
    }

    tree = insertBeside(tree, "b", "c", "left");
    expect(leaves(tree)).toEqual(["a", "c", "b"]);
    if (tree.kind === "split") {
      expect(tree.dir).toBe("row");
      expect(tree.children).toHaveLength(3);
      expect(tree.sizes[0]).toBeCloseTo(0.5);
      expect(tree.sizes[1]).toBeCloseTo(0.25);
      expect(tree.sizes[2]).toBeCloseTo(0.25);
    }
  });

  it("supports vertical splits inside horizontal splits", () => {
    let tree: Node<string> = leaf("a");
    tree = insertBeside(tree, "a", "b", "right");
    tree = insertBeside(tree, "b", "c", "top");
    expect(leaves(tree)).toEqual(["a", "c", "b"]);
    if (tree.kind === "split") {
      expect(tree.dir).toBe("row");
      expect(tree.children[1].kind).toBe("split");
    }
  });

  it("removes panes and collapses unary splits", () => {
    let tree: Node<string> = leaf("a");
    tree = insertBeside(tree, "a", "b", "right");
    tree = insertBeside(tree, "b", "c", "bottom");

    const afterRemoveB = without(tree, "b")!;
    expect(leaves(afterRemoveB)).toEqual(["a", "c"]);

    const afterRemoveC = without(afterRemoveB, "c")!;
    expect(afterRemoveC).toEqual(leaf("a"));
    expect(without(afterRemoveC, "a")).toBeNull();
  });

  it("swaps two leaves in place", () => {
    let tree: Node<string> = leaf("a");
    tree = insertBeside(tree, "a", "b", "right");
    tree = insertBeside(tree, "b", "c", "bottom");
    swapLeaves(tree, "a", "c");
    expect(leaves(tree)).toEqual(["c", "b", "a"]);
  });

  it("normalizes empty splits and renormalizes sizes", () => {
    const dirty: Node<string> = {
      kind: "split",
      dir: "row",
      sizes: [2, 6],
      children: [leaf("x"), { kind: "split", dir: "col", sizes: [], children: [] }],
    };
    expect(normalize(dirty)).toEqual(leaf("x"));
  });

  it("round-trips through serialize and hydrate", () => {
    const cwds: Record<string, string> = { a: "/proj/api", b: "/proj/web", c: "/proj/docs" };
    let tree: Node<string> = leaf("a");
    tree = insertBeside(tree, "a", "b", "right");
    tree = insertBeside(tree, "b", "c", "bottom");

    const saved = serialize(tree, (p) => cwds[p]);
    let idx = 0;
    const hydrated = hydrate(saved, (cwd) => `${++idx}:${cwd}`);
    expect(leaves(hydrated)).toEqual(["1:/proj/api", "2:/proj/web", "3:/proj/docs"]);
  });
});
