// Árvore de layout dos painéis de uma aba (estilo tiling window manager).
// Funções puras e genéricas: não conhecem DOM nem xterm.

export type Side = "left" | "right" | "top" | "bottom";
export type Dir = "row" | "col";

export interface Leaf<P> { kind: "leaf"; pane: P }
export interface Split<P> { kind: "split"; dir: Dir; children: Node<P>[]; sizes: number[] }
export type Node<P> = Leaf<P> | Split<P>;

/** Versão serializável (usada pelos grupos salvos). */
export type SavedNode =
  | { kind: "leaf"; cwd: string }
  | { kind: "split"; dir: Dir; sizes: number[]; children: SavedNode[] };

export function leaves<P>(n: Node<P> | null): P[] {
  if (!n) return [];
  return n.kind === "leaf" ? [n.pane] : n.children.flatMap(leaves);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0) || 1;

/** Remove splits vazios/unários, funde splits aninhados de mesma direção e renormaliza tamanhos. */
export function normalize<P>(n: Node<P> | null): Node<P> | null {
  if (!n) return null;
  if (n.kind === "leaf") return n;

  const kids: Node<P>[] = [];
  const sizes: number[] = [];
  n.children.forEach((c, i) => {
    const nc = normalize(c);
    if (!nc) return;
    const s = n.sizes[i] ?? 1;
    if (nc.kind === "split" && nc.dir === n.dir) {
      const tot = sum(nc.sizes);
      nc.children.forEach((g, j) => { kids.push(g); sizes.push((s * nc.sizes[j]) / tot); });
    } else {
      kids.push(nc);
      sizes.push(s);
    }
  });

  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  const tot = sum(sizes);
  return { kind: "split", dir: n.dir, children: kids, sizes: sizes.map((s) => s / tot) };
}

/** Árvore sem o painel dado (null se ficou vazia). */
export function without<P>(n: Node<P>, pane: P): Node<P> | null {
  if (n.kind === "leaf") return n.pane === pane ? null : n;
  const children: Node<P>[] = [];
  const sizes: number[] = [];
  n.children.forEach((c, i) => {
    const r = without(c, pane);
    if (r) { children.push(r); sizes.push(n.sizes[i]); }
  });
  return normalize({ ...n, children, sizes });
}

/** Insere `np` ao lado de `target`, do lado indicado. */
export function insertBeside<P>(n: Node<P>, target: P, np: P, side: Side): Node<P> {
  const dir: Dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  if (n.kind === "leaf") {
    if (n.pane !== target) return n;
    const fresh: Leaf<P> = { kind: "leaf", pane: np };
    return { kind: "split", dir, children: before ? [fresh, n] : [n, fresh], sizes: [0.5, 0.5] };
  }
  return normalize({ ...n, children: n.children.map((c) => insertBeside(c, target, np, side)) })!;
}

/** Troca de lugar dois painéis (mutação in-place das folhas). */
export function swapLeaves<P>(n: Node<P>, a: P, b: P): void {
  if (n.kind === "leaf") {
    if (n.pane === a) n.pane = b;
    else if (n.pane === b) n.pane = a;
    return;
  }
  n.children.forEach((c) => swapLeaves(c, a, b));
}

export function serialize<P>(n: Node<P>, cwdOf: (p: P) => string): SavedNode {
  if (n.kind === "leaf") return { kind: "leaf", cwd: cwdOf(n.pane) };
  return { kind: "split", dir: n.dir, sizes: [...n.sizes], children: n.children.map((c) => serialize(c, cwdOf)) };
}

export function hydrate<P>(s: SavedNode, make: (cwd: string) => P): Node<P> {
  if (s.kind === "leaf") return { kind: "leaf", pane: make(s.cwd) };
  return { kind: "split", dir: s.dir, sizes: [...s.sizes], children: s.children.map((c) => hydrate(c, make)) };
}
