import type { ITheme } from "@xterm/xterm";

export const themes: Record<string, ITheme> = {
  "Catppuccin Mocha": { background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", selectionBackground: "#45475a",
    black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de" },
  "Dracula": { background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f0", selectionBackground: "#44475a",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2" },
  "Tokyo Night": { background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", selectionBackground: "#33467c",
    black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6" },
};
