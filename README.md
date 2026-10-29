<p align="center">
  <img src="app-icon.png" width="128" alt="Term Lab" />
</p>

<h1 align="center">Term Lab</h1>

<p align="center">
  Um terminal desktop para macOS que centraliza suas sessões em uma interface limpa, no estilo OrbStack:<br/>
  sidebar de sessões, painéis reorganizáveis, status em tempo real e grupos de abas salvos por projeto.
</p>

![Visão geral do Term Lab](docs/screenshots/overview.png)

> Os prints são gerados a partir da interface real, com saídas de shell simuladas (`npm run screenshots`).

## Instalação (Homebrew)

```bash
brew tap matheusmntt/term-lab https://github.com/matheusmntt/term-lab.git
brew install --cask matheusmntt/term-lab/term-lab
```

> Caso a release ainda não esteja assinada com certificado Apple Developer ID, adicione `--no-quarantine` na instalação:
> `brew install --cask --no-quarantine matheusmntt/term-lab/term-lab`

## Funcionalidades

- **Sessões na sidebar** — cada aba é uma sessão de terminal; clique para alternar, `+` para criar.
- **Persistência automática de sessão** — ao fechar e reabrir o app, suas abas, layouts de painéis e diretórios são restaurados automaticamente (configurável nas preferências).
- **Painéis estilo tiling** — divida ao lado ou abaixo, **arraste o cabeçalho** de um painel para reorganizar (soltar na borda encaixa, no centro troca de lugar) e redimensione pelos divisores.
- **Renomear abas** — duplo clique no nome da aba (ou no título do topo). Nome vazio volta ao nome automático (pasta atual).
- **Status em tempo real (`zsh`, `bash` e `fish`)** — a bolinha mostra o que está acontecendo:

  | Cor | Significado |
  | --- | --- |
  | 🟢 verde | ocioso / último comando concluído com sucesso |
  | 🟡 amarelo (pulsando) | há um comando em execução (ex.: `docker build`, `npm run dev`) |
  | 🔴 vermelho | o último comando terminou com erro (exit code ≠ 0) |

  Na aba, a cor resume todos os painéis: amarelo se algum estiver rodando, senão vermelho se algum falhou. `Ctrl+C` não conta como erro.
- **Grupos** — salve um conjunto de abas com nome e diretório (ex.: **App Olá** com os terminais de backend e frontend) e reabra tudo com um clique, com layout e pastas preservados.
- **Busca integrada (`⌘F`)** — barra flutuante de busca incremental no buffer do terminal em foco.
- **Preferências (`⌘,`)** — customize família e tamanho da fonte, shell padrão, estilo/piscar do cursor, linhas de histórico e restauração de sessão.
- **Menu nativo do macOS e atualizador automático** — suporte completo a atalhos do sistema (Copiar, Colar, Sobre, Preferências) e verificação/instalação de novas versões via `tauri-plugin-updater`.
- **Temas** — Catppuccin Mocha, Dracula e Tokyo Night, com contraste ajustado para textos apagados e _autosuggestions_.

<details>
<summary>Mais prints</summary>

![Salvando um grupo](docs/screenshots/save-group.png)
![Tema Tokyo Night](docs/screenshots/tokyo-night.png)

</details>

## Atalhos

| Atalho | Ação |
| --- | --- |
| `⌘T` | Nova aba |
| `⌘D` | Dividir painel ao lado |
| `⌘⇧D` | Dividir painel abaixo |
| `⌘W` | Fechar painel em foco |
| `⌘F` | Buscar no terminal |
| `⌘K` | Limpar terminal em foco |
| `⌘,` | Abrir preferências |
| `⌘=` / `⌘-` / `⌘0` | Aumentar, diminuir ou restaurar tamanho da fonte |
| `⌘⇧R` ou duplo clique | Renomear aba |
| `⌘⇧S` | Salvar grupo de abas |

## Desenvolvimento

Requisitos: macOS, [Node.js](https://nodejs.org/) 20+ e [Rust](https://rustup.rs/) (toolchain estável).

```bash
npm install
npm test            # testes unitários (Vitest)
npm run tauri dev   # abre o app em modo desenvolvimento
```

Gerar pacote local sem assinatura de updater:

```bash
npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

### Docker

O Docker serve para instalar dependências e validar/compilar **para Linux** sem poluir a máquina:

```bash
docker compose run --rm check   # tsc + vitest + cargo check
docker compose run --rm build   # tauri build (Linux)
docker compose up dev           # Vite em http://localhost:1420
```

## Releases, Updater e Homebrew

O repositório automatiza versionamento, build universal (`universal-apple-darwin`), publicação do `latest.json` do updater e atualização do `Casks/term-lab.rb`:

1. **Versionamento e CHANGELOG**: o workflow [release-please.yml](.github/workflows/release-please.yml) lê os _Conventional Commits_ na `main` e abre um PR alinhando a versão em `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` e `Casks/term-lab.rb`, além de atualizar o [CHANGELOG.md](CHANGELOG.md). Para alterar a versão localmente: `npm run version:bump -- 0.2.0`.
2. **Build universal e Cask**: ao fazer merge do PR de release (ou publicar uma tag `v*`), o workflow [release.yml](.github/workflows/release.yml) gera o `.dmg` universal (Apple Silicon + Intel), publica os artefatos no GitHub Releases e atualiza automaticamente o `sha256` e a versão em [Casks/term-lab.rb](Casks/term-lab.rb).
3. **Chave do Auto-Updater**: antes da primeira release pública, gere seu par de chaves:
   ```bash
   npx tauri signer generate -w ~/.tauri/term-lab.key
   ```
   Coloque o conteúdo de `~/.tauri/term-lab.key.pub` em `plugins.updater.pubkey` no `src-tauri/tauri.conf.json`, e cadastre `TAURI_SIGNING_PRIVATE_KEY` (conteúdo de `~/.tauri/term-lab.key`) e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` nos _Actions Secrets_ do GitHub.
4. **Assinatura e notarização Apple (opcional)**: configure os secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` e `APPLE_TEAM_ID` no GitHub para que o `release.yml` assine e notarize o `.app`/`.dmg` automaticamente.

## Como o status funciona

Ao iniciar um shell **zsh**, **bash** ou **fish**, o backend em [shells.rs](src-tauri/src/shells.rs) preserva seus dotfiles e injeta hooks (`preexec`/`precmd` no zsh, `DEBUG`/`PROMPT_COMMAND` no bash e `fish_preexec`/`fish_prompt` no fish) que emitem:

| Sequência | Uso |
| --- | --- |
| `OSC 133;C` | um comando começou a executar |
| `OSC 133;D;<código>` | o comando terminou, com seu exit code |
| `OSC 7` | diretório atual (usado no título da aba, sessão e grupos) |

## Estrutura

```
src/
  main.ts          interface: abas, painéis, busca, status e grupos
  layout.ts        árvore de layout dos painéis (funções puras)
  groups.ts        persistência dos grupos (localStorage)
  preferences.ts   preferências do terminal
  session.ts       persistência das abas abertas
  updater.ts       verificação e instalação de atualizações
  themes.ts        temas do terminal
  *.test.ts        testes unitários (Vitest)
src-tauri/
  src/main.rs      gerenciamento de PTY, plugins e ícone do Dock
  src/shells.rs    integração OSC 133 / OSC 7 para zsh, bash e fish
  src/menu.rs      menu nativo do macOS
Casks/term-lab.rb  Homebrew Cask oficial
```

## Licença

Distribuído sob a licença [MIT](LICENSE).
