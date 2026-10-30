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
import {
  type CursorStyle, type Preferences,
  DEFAULT_PREFERENCES, clampFontSize, loadPreferences, savePreferences,
} from "./preferences";
import { clearSession, loadSession, saveSession } from "./session";
import { initUpdater } from "./updater";

type Status = "idle" | "running" | "error";

interface Pane {
  id: number;
  tab: Tab;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
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
const searchBar = $("search-bar");
const searchInput = $<HTMLInputElement>("search-input");

const tabs: Tab[] = [];
const ptys = new Map<number, Pane>();
let active: Tab | null = null;
let focused: Pane | null = null;
let nextId = 1;
let booting = true;
let prefs = loadPreferences();
let theme = themes[localStorage.getItem("theme") ?? "Catppuccin Mocha"] ?? themes["Catppuccin Mocha"];
let checkUpdatesHandler: (() => void) | null = null;

export function registerUpdateChecker(fn: () => void) {
  checkUpdatesHandler = fn;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "/";

// ---------- Persistência de sessão ----------
function persistSession() {
  if (booting) return;
  if (!prefs.restoreSession) {
    clearSession();
    return;
  }
  const openTabs = tabs.filter((t) => t.root !== null);
  saveSession({
    activeIndex: Math.max(0, active ? openTabs.indexOf(active) : 0),
    tabs: openTabs.map((t) => ({
      title: t.title,
      custom: t.custom,
      layout: serialize(t.root!, (p) => p.cwd),
    })),
  });
}

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
listen<string>("menu-action", (e) => runAction(e.payload));

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
    <div class="pane-body"><div class="term-host"></div></div>`;
  // O xterm é montado num elemento interno sem padding: o FitAddon mede a altura/largura
  // computada do elemento pai e, com `box-sizing: border-box`, ela incluiria o padding,
  // gerando linhas/colunas a mais que ficavam cortadas (ex.: rodapé do Claude Code).
  const host = el.querySelector(".term-host") as HTMLElement;
  const titleSpan = el.querySelector(".pane-title") as HTMLElement;

  const term = new Terminal({
    fontFamily: prefs.fontFamily,
    fontSize: prefs.fontSize,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
    scrollback: prefs.scrollback,
    allowProposedApi: true,
    minimumContrastRatio: 4, // garante legibilidade de textos apagados (ex.: autosuggestions)
    theme,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(search);

  const pane: Pane = { id, tab, term, fit, search, el, host, titleEl: titleSpan, cwd, status: "idle" };
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
      persistSession();
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
  await invoke("pty_spawn", {
    id: p.id,
    cols: p.term.cols,
    rows: p.term.rows,
    cwd: p.cwd || null,
    shell: prefs.shell || null,
  });
}

function fitPane(p: Pane) {
  if (p.host.clientWidth > 0 && p.host.clientHeight > 0) p.fit.fit();
}

function focus(p: Pane) {
  focused?.el.classList.remove("focus");
  focused = p;
  p.el.classList.add("focus");
  if (document.activeElement !== searchInput) p.term.focus();
}

// ---------- Busca (⌘F) ----------
function openSearch() {
  searchBar.hidden = false;
  const sel = focused?.term.getSelection();
  if (sel) searchInput.value = sel;
  searchInput.focus();
  searchInput.select();
  if (searchInput.value) focused?.search.findNext(searchInput.value);
}

function closeSearch() {
  if (searchBar.hidden) return;
  searchBar.hidden = true;
  for (const p of ptys.values()) p.search.clearDecorations();
  focused?.term.focus();
}

searchInput.addEventListener("input", () => {
  if (searchInput.value) focused?.search.findNext(searchInput.value, { incremental: true });
  else focused?.search.clearDecorations();
});
searchInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!searchInput.value) return;
    if (e.shiftKey) focused?.search.findPrevious(searchInput.value);
    else focused?.search.findNext(searchInput.value);
  }
});
$("search-prev").onclick = () => searchInput.value && focused?.search.findPrevious(searchInput.value);
$("search-next").onclick = () => searchInput.value && focused?.search.findNext(searchInput.value);
$("search-close").onclick = closeSearch;

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
    d.onpointerup = () => {
      d.onpointermove = null;
      d.onpointerup = null;
      persistSession();
    };
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
  persistSession();
}

async function split(dir: "right" | "down", target: Pane | null = focused) {
  if (!target) return;
  const tab = target.tab;
  const np = createPane(tab, target.cwd);
  tab.root = insertBeside(tab.root!, target, np, dir === "right" ? "right" : "bottom");
  render(tab);
  await launch(np);
  focus(np);
  persistSession();
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
  persistSession();
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
  persistSession();
  return tab;
}

function select(tab: Tab) {
  active = tab;
  titleEl.textContent = tab.title;
  for (const t of tabs) {
    t.view.classList.toggle("active", t === tab);
    t.tabEl.classList.toggle("active", t === tab);
  }
  persistSession();
  requestAnimationFrame(() => {
    const ps = leaves(tab.root);
    ps.forEach(fitPane);
    // não rouba o foco de um campo de texto ativo (ex.: renomear aba ou busca)
    if (ps.length && !(document.activeElement instanceof HTMLInputElement)) {
      focus(focused && ps.includes(focused) ? focused : ps[0]);
    }
  });
}

function closeTab(tab: Tab) {
  for (const p of leaves(tab.root)) destroyPane(p);
  tab.root = null;
  tab.view.remove();
  tab.tabEl.remove();
  tabs.splice(tabs.indexOf(tab), 1);
  if (tabs.length === 0) void newTab();
  else {
    if (active === tab) select(tabs[tabs.length - 1]);
    else persistSession();
  }
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
    persistSession();
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

// ---------- Preferências ----------
function applyPreferences(next: Preferences) {
  prefs = next;
  for (const p of ptys.values()) {
    p.term.options.fontFamily = prefs.fontFamily;
    p.term.options.fontSize = prefs.fontSize;
    p.term.options.cursorStyle = prefs.cursorStyle;
    p.term.options.cursorBlink = prefs.cursorBlink;
    p.term.options.scrollback = prefs.scrollback;
    fitPane(p);
  }
  persistSession();
}

function zoomFont(delta: number | "reset") {
  const fontSize = delta === "reset" ? DEFAULT_PREFERENCES.fontSize : clampFontSize(prefs.fontSize + delta);
  applyPreferences(savePreferences({ fontSize }));
}

function preferencesDialog() {
  const root = $("modal-root");
  const close = () => { root.replaceChildren(); focused?.term.focus(); };
  root.innerHTML = `
    <div class="overlay">
      <form class="modal">
        <h3>Preferências</h3>
        <label class="field">Fonte
          <input type="text" name="fontFamily" value="${esc(prefs.fontFamily)}" autocomplete="off" />
        </label>
        <div class="row-fields">
          <label class="field">Tamanho (px)
            <input type="number" name="fontSize" min="10" max="28" value="${prefs.fontSize}" />
          </label>
          <label class="field">Histórico (linhas)
            <input type="number" name="scrollback" min="500" max="50000" step="500" value="${prefs.scrollback}" />
          </label>
        </div>
        <div class="row-fields">
          <label class="field">Estilo do cursor
            <select name="cursorStyle">
              <option value="block" ${prefs.cursorStyle === "block" ? "selected" : ""}>Bloco</option>
              <option value="bar" ${prefs.cursorStyle === "bar" ? "selected" : ""}>Barra</option>
              <option value="underline" ${prefs.cursorStyle === "underline" ? "selected" : ""}>Sublinhado</option>
            </select>
          </label>
          <label class="field">Shell padrão
            <input type="text" name="shell" value="${esc(prefs.shell)}" placeholder="$SHELL do sistema" autocomplete="off" />
          </label>
        </div>
        <div class="hint">Suporta status e diretório em zsh, bash e fish. O shell vale para novos painéis.</div>
        <label class="check"><input type="checkbox" name="cursorBlink" ${prefs.cursorBlink ? "checked" : ""} /> Cursor piscante</label>
        <label class="check"><input type="checkbox" name="restoreSession" ${prefs.restoreSession ? "checked" : ""} /> Restaurar abas abertas ao reabrir o app</label>
        <div class="modal-actions">
          <button type="button" class="btn spacer" data-a="reset">Padrões</button>
          <button type="button" class="btn" data-a="cancel">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>
    </div>`;
  const form = root.querySelector("form")!;
  root.querySelector(".overlay")!.addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) close(); });
  root.querySelector('[data-a="cancel"]')!.addEventListener("click", close);
  root.querySelector('[data-a="reset"]')!.addEventListener("click", () => {
    applyPreferences(savePreferences({ ...DEFAULT_PREFERENCES }));
    close();
  });
  form.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const get = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    applyPreferences(
      savePreferences({
        fontFamily: get("fontFamily").value,
        fontSize: Number(get("fontSize").value),
        scrollback: Number(get("scrollback").value),
        cursorStyle: (form.elements.namedItem("cursorStyle") as HTMLSelectElement).value as CursorStyle,
        shell: get("shell").value,
        cursorBlink: get("cursorBlink").checked,
        restoreSession: get("restoreSession").checked,
      }),
    );
    close();
  });
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

// ---------- Ações de menu / atalhos ----------
let lastAction = "";
let lastActionAt = 0;

function runAction(action: string) {
  const now = performance.now();
  if (action === lastAction && now - lastActionAt < 60) return;
  lastAction = action;
  lastActionAt = now;

  switch (action) {
    case "new-tab": void newTab(); break;
    case "split-right": void split("right"); break;
    case "split-down": void split("down"); break;
    case "rename-tab": if (active) startRename(active); break;
    case "save-group": saveGroupDialog(); break;
    case "close-pane": if (focused) closePane(focused); break;
    case "find": openSearch(); break;
    case "clear": focused?.term.clear(); break;
    case "preferences": preferencesDialog(); break;
    case "zoom-in": zoomFont(1); break;
    case "zoom-out": zoomFont(-1); break;
    case "zoom-reset": zoomFont("reset"); break;
    case "check-updates": checkUpdatesHandler?.(); break;
  }
}

$("new-tab").onclick = () => runAction("new-tab");
$("save-group").onclick = () => runAction("save-group");
$("open-prefs").onclick = () => runAction("preferences");
$("find-btn").onclick = () => runAction("find");
$("split").onclick = () => runAction("split-right");
$("split-down").onclick = () => runAction("split-down");
titleEl.ondblclick = () => active && startRename(active);

window.addEventListener("keydown", (e) => {
  if (!e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === "t") { e.preventDefault(); runAction("new-tab"); }
  else if (k === "d") { e.preventDefault(); runAction(e.shiftKey ? "split-down" : "split-right"); }
  else if (k === "w") { e.preventDefault(); runAction("close-pane"); }
  else if (k === "f") { e.preventDefault(); runAction("find"); }
  else if (k === "k") { e.preventDefault(); runAction("clear"); }
  else if (k === ",") { e.preventDefault(); runAction("preferences"); }
  else if (k === "=" || k === "+") { e.preventDefault(); runAction("zoom-in"); }
  else if (k === "-") { e.preventDefault(); runAction("zoom-out"); }
  else if (k === "0") { e.preventDefault(); runAction("zoom-reset"); }
  else if (e.shiftKey && k === "r") { e.preventDefault(); runAction("rename-tab"); }
  else if (e.shiftKey && k === "s") { e.preventDefault(); runAction("save-group"); }
});

// ---------- Inicialização ----------
async function init() {
  document.documentElement.style.setProperty("--bg", theme.background!);
  renderGroups();
  const saved = prefs.restoreSession ? loadSession() : null;
  if (saved) {
    const restored: Tab[] = [];
    for (const st of saved.tabs) {
      restored.push(await newTab({ layout: st.layout, title: st.title, custom: st.custom }));
    }
    if (restored[saved.activeIndex]) select(restored[saved.activeIndex]);
  } else {
    await newTab();
  }
  booting = false;
  persistSession();
  initUpdater(registerUpdateChecker, () => focused?.term.focus());
}

void init();
