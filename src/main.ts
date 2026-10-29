import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { themes } from "./themes";

interface Pane { id: number; term: Terminal; fit: FitAddon; el: HTMLElement; }
interface Tab { id: number; title: string; panes: Pane[]; view: HTMLElement; tabEl: HTMLElement; }

const tabsEl = document.getElementById("tabs")!;
const panesEl = document.getElementById("panes")!;
const titleEl = document.getElementById("title")!;
const themeSel = document.getElementById("theme") as HTMLSelectElement;

const tabs: Tab[] = [];
const ptys = new Map<number, Pane>();
let active: Tab | null = null;
let focused: Pane | null = null;
let nextId = 1;
let theme = themes[localStorage.getItem("theme") ?? "Catppuccin Mocha"] ?? themes["Catppuccin Mocha"];

for (const name of Object.keys(themes)) themeSel.add(new Option(name, name));
themeSel.value = localStorage.getItem("theme") ?? "Catppuccin Mocha";
themeSel.onchange = () => {
  localStorage.setItem("theme", themeSel.value);
  theme = themes[themeSel.value];
  document.documentElement.style.setProperty("--bg", theme.background!);
  for (const p of ptys.values()) p.term.options.theme = theme;
};

listen<{ id: number; data: number[] }>("pty-output", (e) => {
  ptys.get(e.payload.id)?.term.write(new Uint8Array(e.payload.data));
});
listen<{ id: number }>("pty-exit", (e) => {
  const p = ptys.get(e.payload.id);
  if (p) closePane(p);
});

async function createPane(tab: Tab): Promise<Pane> {
  const id = nextId++;
  const el = document.createElement("div");
  el.className = "pane";
  tab.view.appendChild(el);

  const term = new Terminal({
    fontFamily: "Menlo, 'JetBrains Mono', monospace",
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new SearchAddon());
  term.open(el);
  fit.fit();

  const pane: Pane = { id, term, fit, el };
  ptys.set(id, pane);
  tab.panes.push(pane);
  updateCount(tab);

  term.onData((data) => invoke("pty_write", { id, data }));
  term.onResize(({ cols, rows }) => invoke("pty_resize", { id, cols, rows }));
  term.onTitleChange((t) => { if (tab.panes[0] === pane) setTitle(tab, t); });
  el.addEventListener("mousedown", () => focus(pane));

  await invoke("pty_spawn", { id, cols: term.cols, rows: term.rows });
  focus(pane);
  return pane;
}

function focus(p: Pane) {
  focused?.el.classList.remove("focus");
  focused = p;
  p.el.classList.add("focus");
  p.term.focus();
}

function setTitle(tab: Tab, title: string) {
  tab.title = title;
  tab.tabEl.querySelector(".t")!.textContent = title;
  if (tab === active) titleEl.textContent = title;
}

function updateCount(tab: Tab) {
  tab.tabEl.querySelector(".count")!.textContent = tab.panes.length > 1 ? `${tab.panes.length}` : "";
}

async function newTab() {
  const id = nextId++;
  const view = document.createElement("div");
  view.className = "tabview";
  panesEl.appendChild(view);

  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  tabEl.innerHTML = `<span class="dot"></span><span class="t">shell</span><span class="count"></span><span class="x">✕</span>`;
  tabsEl.appendChild(tabEl);

  const tab: Tab = { id, title: "shell", panes: [], view, tabEl };
  tabs.push(tab);
  tabEl.onclick = () => select(tab);
  tabEl.querySelector(".x")!.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab); });

  select(tab);
  await createPane(tab);
}

function select(tab: Tab) {
  active = tab;
  titleEl.textContent = tab.title;
  for (const t of tabs) {
    t.view.classList.toggle("active", t === tab);
    t.tabEl.classList.toggle("active", t === tab);
  }
  requestAnimationFrame(() => {
    tab.panes.forEach((p) => p.fit.fit());
    if (tab.panes[0]) focus(tab.panes.includes(focused!) ? focused! : tab.panes[0]);
  });
}

async function splitPane() {
  if (!active) return;
  const p = await createPane(active);
  active.panes.forEach((x) => x.fit.fit());
  focus(p);
}

function closePane(p: Pane) {
  const tab = tabs.find((t) => t.panes.includes(p));
  if (!tab) return;
  invoke("pty_kill", { id: p.id });
  ptys.delete(p.id);
  p.term.dispose();
  p.el.remove();
  tab.panes = tab.panes.filter((x) => x !== p);
  updateCount(tab);
  if (tab.panes.length === 0) closeTab(tab);
  else { tab.panes.forEach((x) => x.fit.fit()); focus(tab.panes[0]); }
}

function closeTab(tab: Tab) {
  for (const p of [...tab.panes]) {
    invoke("pty_kill", { id: p.id });
    ptys.delete(p.id);
    p.term.dispose();
  }
  tab.view.remove();
  tab.tabEl.remove();
  tabs.splice(tabs.indexOf(tab), 1);
  if (tabs.length === 0) newTab();
  else if (active === tab) select(tabs[tabs.length - 1]);
}

document.getElementById("new-tab")!.onclick = newTab;
document.getElementById("split")!.onclick = splitPane;
window.addEventListener("resize", () => active?.panes.forEach((p) => p.fit.fit()));
window.addEventListener("keydown", (e) => {
  if (!e.metaKey) return;
  if (e.key === "t") { e.preventDefault(); newTab(); }
  else if (e.key === "d") { e.preventDefault(); splitPane(); }
  else if (e.key === "w") { e.preventDefault(); if (focused) closePane(focused); }
});

document.documentElement.style.setProperty("--bg", theme.background!);
newTab();
