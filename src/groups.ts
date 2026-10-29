import type { SavedNode } from "./layout";

export interface SavedTab {
  title: string;
  custom: boolean; // true se o usuário renomeou a aba
  layout: SavedNode;
}

/** Um grupo de abas (ex.: "App Olá" com backend + frontend) ligado a um diretório. */
export interface Group {
  id: string;
  name: string;
  dir: string;
  tabs: SavedTab[];
}

const KEY = "term-lab.groups";

export function loadGroups(): Group[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persist(groups: Group[]) {
  localStorage.setItem(KEY, JSON.stringify(groups));
}

/** Salva o grupo; se já existir um com o mesmo nome, substitui. */
export function saveGroup(group: Omit<Group, "id">): Group[] {
  const groups = loadGroups();
  const i = groups.findIndex((g) => g.name.toLowerCase() === group.name.toLowerCase());
  const entry: Group = { id: i >= 0 ? groups[i].id : crypto.randomUUID(), ...group };
  if (i >= 0) groups[i] = entry;
  else groups.push(entry);
  persist(groups);
  return groups;
}

export function deleteGroup(id: string): Group[] {
  const groups = loadGroups().filter((g) => g.id !== id);
  persist(groups);
  return groups;
}
