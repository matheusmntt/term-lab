export type CursorStyle = "block" | "bar" | "underline";

export interface Preferences {
  fontFamily: string;
  fontSize: number;
  shell: string; // vazio = usa $SHELL do sistema
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  restoreSession: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  fontFamily: "Menlo, 'JetBrains Mono', monospace",
  fontSize: 13,
  shell: "",
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 5000,
  restoreSession: true,
});

const KEY = "term-lab.preferences";

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_PREFERENCES.fontSize;
  return Math.min(28, Math.max(10, Math.round(size)));
}

function clampScrollback(lines: number): number {
  if (!Number.isFinite(lines)) return DEFAULT_PREFERENCES.scrollback;
  return Math.min(50000, Math.max(500, Math.round(lines)));
}

export function sanitizePreferences(raw: Partial<Preferences> | null | undefined): Preferences {
  const r = raw ?? {};
  const cursorStyle: CursorStyle =
    r.cursorStyle === "bar" || r.cursorStyle === "underline" || r.cursorStyle === "block"
      ? r.cursorStyle
      : DEFAULT_PREFERENCES.cursorStyle;
  return {
    fontFamily: typeof r.fontFamily === "string" && r.fontFamily.trim()
      ? r.fontFamily.trim()
      : DEFAULT_PREFERENCES.fontFamily,
    fontSize: clampFontSize(typeof r.fontSize === "number" ? r.fontSize : Number(r.fontSize)),
    shell: typeof r.shell === "string" ? r.shell.trim() : DEFAULT_PREFERENCES.shell,
    cursorStyle,
    cursorBlink: typeof r.cursorBlink === "boolean" ? r.cursorBlink : DEFAULT_PREFERENCES.cursorBlink,
    scrollback: clampScrollback(typeof r.scrollback === "number" ? r.scrollback : Number(r.scrollback)),
    restoreSession: typeof r.restoreSession === "boolean" ? r.restoreSession : DEFAULT_PREFERENCES.restoreSession,
  };
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizePreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(next: Partial<Preferences>): Preferences {
  const merged = sanitizePreferences({ ...loadPreferences(), ...next });
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}
