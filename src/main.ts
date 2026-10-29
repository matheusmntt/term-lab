import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { themes } from "./themes";
import {
  type Node, type Side, type SavedNode,
  leaves, without, insertBeside, swapLeaves, serialize, hydrate,
} from "./layout";
import { type Group, loadGroups, saveGroup, deleteGroup } from "./groups";

type Status = "idle" | "running" | "error";

interface Pane {
  id: number;
  tab: Tab;
  term: Terminal;
  fit: FitAddon;
  el: HTMLElement;
  host: HTMLElement;
  titleEl: HTMLElement;
  ro?: ResizeObserver;
  cwd: string;
  status: Status;
}
interface Tab {
  id: number;
  title: string;
  custom: boolean; // título definido manualmente pelo usuário
  root: Node<Pane> | null;
  view: HTMLElement;
  tabEl: HTMLElement;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabsEl = $("tabs");
const groupsEl = $("groups");
const panesEl = $("panes");
const titleEl = $("title");
const themeSel = $<HTMLSelectElement>("theme");

const tabs: Tab[] = [];
const ptys = new Map<number, Pane>();
let active: Tab | null = null;
let focused: Pane | null = null;
let nextId = 1;
let theme = themes[localStorage.getItem("theme") ?? "Catppuccin Mocha"] ?? themes["Catppuccin Mocha"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "/";

// ---------- Temas ----------
for (const name of Object.keys(themes)) themeSel.add(new Option(name, name));
themeSel.value = localStorage.getItem("theme") ?? "Catppuccin Mocha";
themeSel.onchange = () => {
  localStorage.setItem("theme", themeSel.value);
  theme = themes[themeSel.value];
  document.documentElement.style.setProperty("--bg", theme.background!);
  for (const p of ptys.values()) p.term.options.theme = theme;
};

// ---------- Eventos do backend ----------
listen<{ id: number; data: number[] }>("pty-output", (e) => {
  ptys.get(e.payload.id)?.term.write(new Uint8Array(e.payload.data));
});
listen<{ id: number }>("pty-exit", (e) => {
  const p = ptys.get(e.payload.id);
  if (p) closePane(p);
});

// ---------- Status (bolinha) ----------
function setStatus(p: Pane, s: Status) {
  p.status = s;
  p.el.dataset.status = s;
  refreshTab(p.tab);
}

function tabStatus(tab: Tab): Status {
  const ps = leaves(tab.root);
  if (ps.some((p) => p.status === "running")) return "running";
  if (ps.some((p) => p.status === "error")) return "error";
  return "idle";
}

/** Atualiza título automático, contador de painéis e cor da bolinha da aba. */
function refreshTab(tab: Tab) {
  const ps = leaves(tab.root);
  if (!tab.custom) tab.title = (ps[0] && ps[0].cwd && basename(ps[0].cwd)) || "shell";
  const t = tab.tabEl.querySelector(".t");
  if (t) t.textContent = tab.title;
  tab.tabEl.querySelector(".count")!.textContent = ps.length > 1 ? `${ps.length}` : "";
  tab.tabEl.dataset.status = tabStatus(tab);
  if (tab === active) titleEl.textContent = tab.title;
}

// ---------- Painéis ----------
const SVG_RIGHT = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M8 3v10"/></svg>`;
const SVG_DOWN = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 8h12"/></svg>`;

function createPane(tab: Tab, cwd = ""): Pane {
  const id = nextId++;
  const el = document.createElement("div");
  el.className = "pane";
  el.dataset.id = String(id);
  el.dataset.status = "idle";
  el.innerHTML = `
    <div class="pane-header">
      <span class="dot pdot"></span>
      <span class="pane-title">shell</span>
      <span class="pane-btns">
        <button class="icon-btn" data-a="right" title="Dividir ao lado">${SVG_RIGHT}</button>
        <button class="icon-btn" data-a="down" title="Dividir abaixo">${SVG_DOWN}</button>
        <button class="icon-btn" data-a="close" title="Fechar painel (⌘W)">✕</button>
      </span>
    </div>
    <div class="pane-body"></div>`;
  const host = el.querySelector(".pane-body") as HTMLElement;
  const titleSpan = el.querySelector(".pane-title") as HTMLElement;

  const term = new Terminal({
    fontFamily: "Menlo, 'JetBrains Mono', monospace",
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
    minimumContrastRatio: 4, // garante legibilidade de textos apagados (ex.: autosuggestions)
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new SearchAddon());

  const pane: Pane = { id, tab, term, fit, el, host, titleEl: titleSpan, cwd, status: "idle" };
  if (cwd) titleSpan.textContent = basename(cwd);
  ptys.set(id, pane);

  term.onData((data) => invoke("pty_write", { id, data }));
  term.onResize(({ cols, rows }) => invoke("pty_resize", { id, cols, rows }));

  // OSC 133: C = comando iniciou, D;<code> = terminou
  term.parser.registerOscHandler(133, (data) => {
    if (data === "C") setStatus(pane, "running");
    else if (data.startsWith("D")) {
      const code = parseInt(data.split(";")[1] ?? "0", 10);
      setStatus(pane, code === 0 || code === 130 ? "idle" : "error"); // 130 = Ctrl+C
    }
    return true;
  });
  // OSC 7: diretório atual
  term.parser.registerOscHandler(7, (data) => {
    try {
      pane.cwd = decodeURIComponent(new URL(data).pathname);
      titleSpan.textContent = basename(pane.cwd);
      refreshTab(pane.tab);
    } catch { /* ignora */ }
    return true;
  });

  el.addEventListener("mousedown", () => focus(pane));
  el.querySelector(".pane-btns")!.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("button")?.dataset.a;
    if (a === "right" || a === "down") split(a, pane);
    else if (a === "close") closePane(pane);
  });
  el.querySelector(".pane-header")!.addEventListener("pointerdown", (e) => startDrag(pane, e as PointerEvent));

  return pane;
}

/** Abre o xterm (o elemento já precisa estar no DOM) e inicia o shell. */
async function launch(p: Pane) {
  p.term.open(p.host);
  fitPane(p);
  p.ro = new ResizeObserver(() => fitPane(p));
  p.ro.observe(p.host);
  await invoke("pty_spawn", { id: p.id, cols: p.term.cols, rows: p.term.rows, cwd: p.cwd || null });
}

function fitPane(p: Pane) {
  if (p.host.clientWidth > 0 && p.host.clientHeight > 0) p.fit.fit();
}

function focus(p: Pane) {
  focused?.el.classList.remove("focus");
  focused = p;
  p.el.classList.add("focus");
  p.term.focus();
}

// ---------- Layout (render, divisores, drag & drop) ----------
function render(tab: Tab) {
  tab.view.replaceChildren();
  if (tab.root) tab.view.appendChild(renderNode(tab.root));
  refreshTab(tab);
  requestAnimationFrame(() => leaves(tab.root).forEach(fitPane));
}

function renderNode(n: Node<Pane>): HTMLElement {
  if (n.kind === "leaf") return n.pane.el;
  const el = document.createElement("div");
  el.className = `split ${n.dir}`;
  n.children.forEach((c, i) => {
    if (i > 0) el.appendChild(makeDivider(n, i, el));
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.flex = `${n.sizes[i]} 1 0`;
    cell.appendChild(renderNode(c));
    el.appendChild(cell);
  });
  return el;
}

function makeDivider(n: Extract<Node<Pane>, { kind: "split" }>, i: number, container: HTMLElement): HTMLElement {
  const d = document.createElement("div");
  d.className = "divider";
  d.onpointerdown = (e) => {
    e.preventDefault();
    d.setPointerCapture(e.pointerId);
    const cells = Array.from(container.children).filter((c) => c.classList.contains("cell")) as HTMLElement[];
    const a = cells[i - 1].getBoundingClientRect();
    const b = cells[i].getBoundingClientRect();
    const horiz = n.dir === "row";
    const start = horiz ? a.left : a.top;
    const total = horiz ? a.width + b.width : a.height + b.height;
    const pair = n.sizes[i - 1] + n.sizes[i];
    d.onpointermove = (ev) => {
      const f = Math.min(0.9, Math.max(0.1, ((horiz ? ev.clientX : ev.clientY) - start) / total));
      n.sizes[i - 1] = pair * f;
      n.sizes[i] = pair * (1 - f);
      cells[i - 1].style.flex = `${n.sizes[i - 1]} 1 0`;
      cells[i].style.flex = `${n.sizes[i]} 1 0`;
    };
    d.onpointerup = () => { d.onpointermove = null; d.onpointerup = null; };
  };
  return d;
}

/** Arrastar o cabeçalho de um painel para reorganizar: bordas = encaixar, centro = trocar. */
function startDrag(pane: Pane, e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  let drop: { target: Pane; side: Side | "center" } | null = null;
  const ghost = document.createElement("div");
  ghost.className = "drop-ghost";

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      dragging = true;
      document.body.classList.add("dragging");
      pane.el.classList.add("drag-src");
      document.body.appendChild(ghost);
    }
    drop = null;
    ghost.style.display = "none";
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".pane") as HTMLElement | null;
    const target = under && ptys.get(Number(under.dataset.id));
    if (!under || !target || target === pane || target.tab !== pane.tab) return;

    const r = under.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    const fy = (ev.clientY - r.top) / r.height;
    const m = Math.min(fx, 1 - fx, fy, 1 - fy);
    const side: Side | "center" = m > 0.28 ? "center" : m === fx ? "left" : m === 1 - fx ? "right" : m === fy ? "top" : "bottom";

    let { left, top, width, height } = r;
    if (side === "left") width /= 2;
    else if (side === "right") { left += width / 2; width /= 2; }
    else if (side === "top") height /= 2;
    else if (side === "bottom") { top += height / 2; height /= 2; }
    Object.assign(ghost.style, { display: "block", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    drop = { target, side };
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    ghost.remove();
    document.body.classList.remove("dragging");
    pane.el.classList.remove("drag-src");
    if (dragging && drop) movePane(pane, drop.target, drop.side);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function movePane(p: Pane, target: Pane, side: Side | "center") {
  const tab = p.tab;
  if (!tab.root) return;
  if (side === "center") swapLeaves(tab.root, p, target);
  else tab.root = insertBeside(without(tab.root, p)!, target, p, side);
  render(tab);
  focus(p);
}

async function split(dir: "right" | "down", target: Pane | null = focused) {
  if (!target) return;
  const tab = target.tab;
  const np = createPane(tab, target.cwd);
  tab.root = insertBeside(tab.root!, target, np, dir === "right" ? "right" : "bottom");
  render(tab);
  await launch(np);
  focus(np);
}

function destroyPane(p: Pane) {
  invoke("pty_kill", { id: p.id });
  ptys.delete(p.id);
  p.ro?.disconnect();
  p.term.dispose();
  p.el.remove();
  if (focused === p) focused = null;
}

function closePane(p: Pane) {
  const tab = p.tab;
  if (!tab.root) return;
  destroyPane(p);
  tab.root = without(tab.root, p);
  if (!tab.root) return closeTab(tab);
  render(tab);
  if (!focused) focus(leaves(tab.root)[0]);
}

// ---------- Abas ----------
interface NewTabOpts { cwd?: string; layout?: SavedNode; title?: string; custom?: boolean; dir?: string }

async function newTab(o: NewTabOpts = {}): Promise<Tab> {
  const view = document.createElement("div");
  view.className = "tabview";
  panesEl.appendChild(view);

  const tabEl = document.createElement("div");
  tabEl.className = "item";
  tabEl.dataset.status = "idle";
  tabEl.innerHTML = `<span class="dot"></span><span class="t">shell</span><span class="count"></span><span class="x" title="Fechar aba">✕</span>`;
  tabsEl.appendChild(tabEl);

  const tab: Tab = { id: nextId++, title: o.title ?? "shell", custom: !!o.custom, root: null, view, tabEl };
  tabs.push(tab);
  tabEl.onclick = () => select(tab);
  tabEl.ondblclick = () => startRename(tab);
  tabEl.querySelector(".x")!.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab); });

  select(tab);
  tab.root = o.layout
    ? hydrate(o.layout, (cwd) => createPane(tab, cwd || o.dir || ""))
    : { kind: "leaf", pane: createPane(tab, o.cwd) };
  render(tab);
  const ps = leaves(tab.root);
  for (const p of ps) await launch(p);
  if (tab === active) focus(ps[0]);
  return tab;
}

function select(tab: Tab) {
  active = tab;
  titleEl.textContent = tab.title;
  for (const t of tabs) {
    t.view.classList.toggle("active", t === tab);
    t.tabEl.classList.toggle("active", t === tab);
  }
  requestAnimationFrame(() => {
    const ps = leaves(tab.root);
    ps.forEach(fitPane);
    if (ps.length) focus(focused && ps.includes(focused) ? focused : ps[0]);
  });
}

function closeTab(tab: Tab) {
  for (const p of leaves(tab.root)) destroyPane(p);
  tab.root = null;
  tab.view.remove();
  tab.tabEl.remove();
  tabs.splice(tabs.indexOf(tab), 1);
  if (tabs.length === 0) newTab();
  else if (active === tab) select(tabs[tabs.length - 1]);
}

function startRename(tab: Tab) {
  const t = tab.tabEl.querySelector(".t") as HTMLElement | null;
  if (!t) return;
  const input = document.createElement("input");
  input.className = "rename";
  input.value = tab.title;
  t.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (commit) {
      if (v) { tab.title = v; tab.custom = true; } else tab.custom = false; // vazio = volta ao nome automático
    }
    input.replaceWith(t);
    refreshTab(tab);
    focused?.term.focus();
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  };
  input.onblur = () => finish(true);
  input.onclick = input.ondblclick = (e) => e.stopPropagation();
}

// ---------- Grupos ----------
function renderGroups() {
  groupsEl.replaceChildren();
  for (const g of loadGroups()) {
    const el = document.createElement("div");
    el.className = "item";
    el.title = `${g.dir}\nClique para abrir`;
    el.innerHTML = `<span class="glyph">▦</span><span class="body"><span class="t">${esc(g.name)}</span><span class="sub">${g.tabs.length} aba(s) · ${esc(basename(g.dir))}</span></span><span class="x" title="Excluir grupo">✕</span>`;
    el.onclick = () => openGroup(g);
    el.querySelector(".x")!.addEventListener("click", (e) => { e.stopPropagation(); deleteGroup(g.id); renderGroups(); });
    groupsEl.appendChild(el);
  }
}

async function openGroup(g: Group) {
  const created: Tab[] = [];
  for (const st of g.tabs) {
    created.push(await newTab({ layout: st.layout, title: st.title, custom: st.custom, dir: g.dir }));
  }
  if (created[0]) select(created[0]);
}

function saveGroupDialog() {
  const root = $("modal-root");
  const close = () => { root.replaceChildren(); focused?.term.focus(); };
  root.innerHTML = `
    <div class="overlay">
      <form class="modal">
        <h3>Salvar grupo</h3>
        <label class="field">Nome<input type="text" name="name" placeholder="App Olá" autocomplete="off" /></label>
        <label class="field">Diretório<input type="text" name="dir" value="${esc(focused?.cwd ?? "")}" autocomplete="off" /></label>
        <div class="hint">Usado para painéis que ainda não têm uma pasta própria.</div>
        <div class="field" style="color:var(--muted);font-size:12px">Abas incluídas</div>
        <div class="checks">
          ${tabs.map((t, i) => `<label class="check"><input type="checkbox" value="${i}" checked /> ${esc(t.title)}<span class="muted">${leaves(t.root).length} painel(is)</span></label>`).join("")}
        </div>
        <div class="error-msg"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-a="cancel">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>
    </div>`;
  const form = root.querySelector("form")!;
  const err = root.querySelector(".error-msg") as HTMLElement;
  (form.elements.namedItem("name") as HTMLInputElement).focus();

  root.querySelector(".overlay")!.addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) close(); });
  root.querySelector('[data-a="cancel"]')!.addEventListener("click", close);
  form.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const dir = (form.elements.namedItem("dir") as HTMLInputElement).value.trim();
    const chosen = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map((c) => tabs[Number(c.value)]);
    if (!name) return void (err.textContent = "Dê um nome ao grupo.");
    if (chosen.length === 0) return void (err.textContent = "Selecione ao menos uma aba.");
    saveGroup({
      name,
      dir,
      tabs: chosen.map((t) => ({
        title: t.title,
        custom: t.custom,
        layout: serialize(t.root!, (p) => p.cwd || dir),
      })),
    });
    renderGroups();
    close();
  });
}

// ---------- Atalhos e inicialização ----------
$("new-tab").onclick = () => newTab();
$("save-group").onclick = saveGroupDialog;
$("split").onclick = () => split("right");
$("split-down").onclick = () => split("down");
titleEl.ondblclick = () => active && startRename(active);

window.addEventListener("keydown", (e) => {
  if (!e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === "t") { e.preventDefault(); newTab(); }
  else if (k === "d") { e.preventDefault(); split(e.shiftKey ? "down" : "right"); }
  else if (k === "w") { e.preventDefault(); if (focused) closePane(focused); }
});

document.documentElement.style.setProperty("--bg", theme.background!);
renderGroups();
newTab();
