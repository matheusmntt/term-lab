import type { SavedNode } from "./layout";

export interface SavedTab {
  title: string;
  custom: boolean; // true se o usuário renomeou a aba
  layout: SavedNode;
  key?: string; // id estável da aba dentro do grupo (liga a aba salva à aba aberta)
  groupId?: string; // grupo ao qual a aba aberta pertence (só na sessão)
  groupName?: string;
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
  let groups: Group[];
  try {
    groups = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
  // grupos salvos antes da existência de `key` ganham chaves uma única vez
  let changed = false;
  for (const g of groups) {
    for (const t of g.tabs) if (!t.key) { t.key = crypto.randomUUID(); changed = true; }
  }
  if (changed) persist(groups);
  return groups;
}

function persist(groups: Group[]) {
  localStorage.setItem(KEY, JSON.stringify(groups));
}

/** Salva o grupo (substituindo um de mesmo nome, mantendo o `id`) e devolve o registro salvo. */
export function upsertGroup(group: Omit<Group, "id">): { groups: Group[]; saved: Group } {
  const groups = loadGroups();
  const i = groups.findIndex((g) => g.name.toLowerCase() === group.name.toLowerCase());
  const saved: Group = {
    id: i >= 0 ? groups[i].id : crypto.randomUUID(),
    ...group,
    tabs: group.tabs.map((t) => ({ ...t, key: t.key || crypto.randomUUID() })),
  };
  if (i >= 0) groups[i] = saved;
  else groups.push(saved);
  persist(groups);
  return { groups, saved };
}

/** Salva o grupo; se já existir um com o mesmo nome, substitui. */
export function saveGroup(group: Omit<Group, "id">): Group[] {
  return upsertGroup(group).groups;
}

/**
 * Acrescenta uma aba ao grupo salvo (ex.: aba arrastada para o grupo na sidebar).
 * Se o grupo já tiver uma aba com a mesma `key`, ela é atualizada em vez de duplicada.
 */
export function appendTabToGroup(id: string, tab: SavedTab): Group[] {
  const groups = loadGroups();
  const g = groups.find((g) => g.id === id);
  if (!g) return groups;
  const entry = { ...tab, key: tab.key || crypto.randomUUID() };
  const i = g.tabs.findIndex((t) => t.key === entry.key);
  if (i >= 0) g.tabs[i] = entry;
  else g.tabs.push(entry);
  persist(groups);
  return groups;
}

/** Abas salvas do grupo que não estão abertas (nenhuma aba aberta com a mesma `key`). */
export function missingGroupTabs(group: Group, openKeys: (string | undefined)[]): SavedTab[] {
  return group.tabs.filter((t) => !openKeys.includes(t.key));
}

/**
 * Reordena a lista colocando `item` logo após o último membro de `groupId`
 * (ou no fim, se o grupo não tiver membros ou `groupId` for indefinido).
 */
export function moveIntoGroup<T extends { groupId?: string }>(list: T[], item: T, groupId?: string): T[] {
  const rest = list.filter((t) => t !== item);
  let last = -1;
  if (groupId) rest.forEach((t, i) => { if (t.groupId === groupId) last = i; });
  if (last < 0) return [...rest, item];
  return [...rest.slice(0, last + 1), item, ...rest.slice(last + 1)];
}

export function deleteGroup(id: string): Group[] {
  const groups = loadGroups().filter((g) => g.id !== id);
  persist(groups);
  return groups;
}
