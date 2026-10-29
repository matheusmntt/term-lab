# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo, geradas automaticamente a partir de _Conventional Commits_.

## [0.2.1](https://github.com/matheusmntt/term-lab/compare/v0.2.0...v0.2.1) (2026-10-29)


### Bug Fixes

* **ci:** only export Apple signing env vars when secrets are configured ([4cbac26](https://github.com/matheusmntt/term-lab/commit/4cbac2621ce819a5cefbc21812f60e77a96aaa66))

## [0.2.0](https://github.com/matheusmntt/term-lab/compare/v0.1.0...v0.2.0) (2026-10-29)


### Features

* **branding:** add application icon set ([2189ae2](https://github.com/matheusmntt/term-lab/commit/2189ae21d1002b7fb0627c901b04e92f94bb6edf))
* **branding:** redesign app icon with SVG source ([168a9b3](https://github.com/matheusmntt/term-lab/commit/168a9b32b08a89975261e37ec4b4920a46e4625c))
* **groups:** persist named groups of tabs ([67a2b53](https://github.com/matheusmntt/term-lab/commit/67a2b53f7bdbca11687dd6a365edf26634e505ca))
* **layout:** add tree-based pane layout model ([9bcd022](https://github.com/matheusmntt/term-lab/commit/9bcd022041b66774c853526e7f769757410c42be))
* **macos:** show application icon in the Dock ([b5d533a](https://github.com/matheusmntt/term-lab/commit/b5d533a7bfaed7f87baa0db273860eec1f923aa7))
* **menu:** add native macOS application menu and shortcuts ([c95888d](https://github.com/matheusmntt/term-lab/commit/c95888d25569450fc871ceb363955d14e0f3380e))
* **pty:** add bash, fish and custom shell integration ([26182fa](https://github.com/matheusmntt/term-lab/commit/26182fa8af7732bb7b6d0a9c9f5907924e2a80b8))
* **pty:** manage shell sessions with portable-pty ([fc43b1d](https://github.com/matheusmntt/term-lab/commit/fc43b1db162f036acf9506e029a3257f4ba654bf))
* **pty:** start shells in a given directory and report command status ([71e3f44](https://github.com/matheusmntt/term-lab/commit/71e3f4466c942989a68990d069b3bad940643805))
* **state:** add terminal preferences and session persistence ([743741d](https://github.com/matheusmntt/term-lab/commit/743741db0046b99b03aa592e6c92859a4cdebf66))
* **themes:** add Catppuccin, Dracula and Tokyo Night themes ([a83b862](https://github.com/matheusmntt/term-lab/commit/a83b86286cd69b92d642d59b2fd1f31552134aed))
* **ui:** add terminal search, preferences dialog, zoom and session restore ([9981d88](https://github.com/matheusmntt/term-lab/commit/9981d88645cb14e1d4570cdd5e9c0f02a9da7f0c))
* **ui:** add tiling panes, status dots, tab renaming and saved groups ([c511598](https://github.com/matheusmntt/term-lab/commit/c511598395e2a0f340f0fbcc98b590ba1cd63c77))
* **ui:** add xterm.js terminal with sidebar sessions and split panes ([2a800c4](https://github.com/matheusmntt/term-lab/commit/2a800c415c731217d1fbab05bf9860b8d3dc8457))
* **ui:** use app icon in sidebar and as favicon ([a80af8e](https://github.com/matheusmntt/term-lab/commit/a80af8e161a1b6684c16482ac23fc871b3b60480))
* **updater:** integrate Tauri auto-updater and update dialog ([cc1ad5c](https://github.com/matheusmntt/term-lab/commit/cc1ad5c4f436d3fcec71a20815bfb6ee487dbf50))


### Bug Fixes

* **security:** enforce strict Content Security Policy ([43a87c2](https://github.com/matheusmntt/term-lab/commit/43a87c2b4f47d0ed0ddb5255ac6c493178540d72))
* **terminal:** enforce minimum contrast ratio ([da58ae5](https://github.com/matheusmntt/term-lab/commit/da58ae514fea00c23a04cf966b369ade645e5f79))
* **themes:** improve contrast of dim text and autosuggestions ([bb6e2e0](https://github.com/matheusmntt/term-lab/commit/bb6e2e0c5bd3078517c9983bda96de6b7556e6ee))
* **ui:** keep input focus while renaming a tab ([9dfec29](https://github.com/matheusmntt/term-lab/commit/9dfec2971d45c1755e8918223445a513a0a2f8ae))

## [0.1.0] - 2026-10-29

### Funcionalidades
- Terminal desktop em Tauri v2 + xterm.js com interface estilo OrbStack.
- Painéis em árvore (_tiling_) com divisão horizontal/vertical, redimensionamento e reorganização por _drag and drop_.
- Indicador de status em tempo real (ocioso, executando, erro) e rastreamento de diretório para `zsh`, `bash` e `fish`.
- Grupos de abas salvos por projeto e restauração automática da sessão.
- Busca no terminal (`⌘F`), diálogo de preferências (`⌘,`), menu nativo do macOS e atualizador integrado.
