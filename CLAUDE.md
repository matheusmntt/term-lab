# CLAUDE.md — Guia de Arquitetura e Regras de Negócio do Term Lab

Este documento descreve a arquitetura, o modelo de domínio, as regras de negócio e as convenções técnicas do **Term Lab** para orientar assistentes de IA (Claude / Claude Code) e desenvolvedores na manutenção e evolução do projeto.

---

## 1. Visão Geral do Projeto

O **Term Lab** é um emulador de terminal desktop para macOS inspirado na interface limpa do OrbStack. Ele centraliza sessões de terminal em uma barra lateral colapsável, suporta múltiplos painéis divididos em árvore (_tiling_), monitora o status de execução e diretório atual dos comandos em tempo real via sequências OSC, e permite salvar/restaurar sessões e grupos de abas por projeto.

---

## 2. Stack Tecnológica e Arquitetura

- **Frontend (UI & Estado):** TypeScript + Vite (Vanilla DOM, sem frameworks reativos como React/Vue) + `@xterm/xterm` (com addons `fit`, `search`, `web-links` e `webgl`).
- **Backend (Desktop & PTY):** Rust + Tauri v2 + `portable-pty` (gerenciamento de pseudo-terminais) + `objc2` (integração nativa macOS para ícone do Dock em dev).
- **Testes:** Vitest (testes unitários de lógica pura de layout e persistência de estado).
- **Empacotamento e Distribuição:** GitHub Actions + `release-please` + Tauri Updater (`latest.json` assinado) + Homebrew Cask (`Casks/term-lab.rb`).

### Fluxo de Comunicação (IPC Tauri)

```
Frontend (src/main.ts)                         Backend (src-tauri/src/main.rs)
──────────────────────                         ───────────────────────────────
invoke("pty_spawn", { id, cols, rows, cwd, shell }) ──► Abre PTY + injeta hooks do shell (shells.rs)
                                                        Cria thread de leitura do master PTY
invoke("pty_write", { id, data })                   ──► Escreve bytes no stdin do PTY
invoke("pty_resize", { id, cols, rows })            ──► Redimensiona PTY (envia SIGWINCH)
invoke("pty_kill", { id })                          ──► Remove sessão e mata processo filho

listen("pty-output", { id, data })                  ◄── Bytes lidos do stdout/stderr do PTY
listen("pty-exit", { id })                          ◄── Processo do shell encerrou (EOF/erro)
listen("menu-action", actionId)                     ◄── Clique/atalho no menu nativo do macOS (menu.rs)
```

---

## 3. Estrutura de Arquivos

```text
src/
  main.ts          Orquestração da UI, DOM, ciclo de vida de abas/painéis, atalhos, drag & drop e IPC
  layout.ts        Árvore de layout tiling (funções puras e genéricas, sem dependência de DOM/xterm)
  groups.ts        Persistência e regras de grupos de abas no localStorage
  session.ts       Persistência e validação de esquema da sessão aberta no localStorage
  preferences.ts   Preferências do usuário com sanitização e limites (clamping)
  themes.ts        Definições de cores dos temas (Catppuccin Mocha, Dracula, Tokyo Night)
  updater.ts       Verificação de atualizações, banner na sidebar e modal de instalação
  style.css        Estilos da aplicação e variáveis CSS
  *.test.ts        Testes unitários (layout.test.ts, state.test.ts)
src-tauri/
  src/main.rs      Comandos Tauri (pty_spawn, pty_write, pty_resize, pty_kill), estado Sessions e Dock icon
  src/shells.rs    Construção do comando de shell e injeção transparente de hooks OSC 133 e OSC 7
  src/menu.rs      Construção do menu nativo do macOS em português e emissão de "menu-action"
  tauri.conf.json  Configuração da janela (titleBarStyle: Overlay), CSP estrita e chave pública do updater
Casks/
  term-lab.rb      Manifesto oficial do Homebrew Cask
scripts/
  bump-version.mjs Script para alinhar versões em todos os manifestos do repositório
  screenshots.mjs  Geração automatizada de capturas de tela da interface real
```

---

## 4. Regras de Negócio e Comportamento do Sistema

### 4.1. Abas (`Tab`) e Ciclo de Vida
1. **Sempre há ao menos uma aba aberta:** Quando o usuário fecha a última aba aberta (`closeTab`), uma nova aba padrão é criada automaticamente (`newTab()`).
2. **Fechamento em cascata:** Fechar o último painel de uma aba (`without(tab.root, pane) === null`) fecha a própria aba automaticamente. Fechar uma aba destrói todos os seus painéis (`pty_kill`, desconecta `ResizeObserver`, `term.dispose()`).
3. **Título da Aba (Automático vs. Customizado):**
   - Cada aba possui a flag `custom: boolean`.
   - Se `custom === false`, o título é atualizado automaticamente em `refreshTab()` para o `basename` do `cwd` do **primeiro painel folha** (`leaves(tab.root)[0]`), ou `"shell"` caso ainda não haja `cwd`.
   - Se o usuário renomear a aba (duplo clique na aba/título do topo ou `⌘⇧R`) com um texto não vazio, `custom` passa a `true` e o título manual é preservado mesmo que o diretório mude.
   - **Regra de reversão:** Se o usuário renomear a aba deixando o campo em branco (vazio/espaços) e confirmar (`Enter` ou `blur`), `custom` volta para `false` e a aba reassume o nome automático da pasta atual. Pressionar `Escape` cancela a edição mantendo o nome anterior.
4. **Contador de Painéis:** Na barra lateral, a aba exibe o número de painéis apenas quando possui **mais de 1 painel** (`ps.length > 1`).
5. **Vínculo com Grupo:** Cada aba pode ter `groupId`/`groupName` opcionais. Abas sem grupo ficam na raiz da seção **Terminais**; abas de um grupo são renderizadas por `renderSidebarTabs()` sob um cabeçalho `.tab-group-header` colapsável (ver 4.4).

### 4.2. Árvore de Layout Tiling (`src/layout.ts`)
O layout de cada aba é uma árvore binária/n-ária pura `Node<P>` onde cada nó é uma folha (`Leaf<P>`) ou uma divisão (`Split<P>` com `dir: "row" | "col"`, `children: Node<P>[]` e `sizes: number[]`).

1. **Invariantes de Normalização (`normalize`):**
   - Nós vazios são removidos.
   - Splits com apenas 1 filho colapsam diretamente para o próprio filho (não existem splits unários).
   - **Fusão de mesma direção:** Se um nó `Split` tem um filho que também é `Split` com a mesma direção (`nc.dir === n.dir`), os netos são achatados no pai e seus tamanhos são recalculados proporcionalmente.
   - Os valores de `sizes` de qualquer `Split` normalizado sempre somam `1.0`.
2. **Divisão de Painéis (`split` / `insertBeside`):**
   - Dividir ao lado (`right` / `⌘D`) cria ou expande um split `row`. Dividir abaixo (`down` / `⌘⇧D`) cria ou expande um split `col`.
   - O novo painel é inserido ao lado do painel alvo com proporção inicial `0.5 / 0.5` (antes da normalização).
   - **Herança de diretório:** Todo painel criado via split herda o `cwd` atual do painel que foi dividido.
3. **Redimensionamento por Divisor (`makeDivider`):**
   - Arrastar um divisor altera apenas o par de células adjacentes (`i - 1` e `i`), mantendo a soma `pair = sizes[i - 1] + sizes[i]` constante.
   - A fração `f` é limitada ao intervalo `[0.1, 0.9]` (nenhum painel pode ser reduzido a menos de 10% do par durante o arraste).
   - Ao soltar o mouse (`pointerup`), a sessão é persistida.
4. **Reorganização via Drag & Drop (`startDrag` / `movePane`):**
   - Inicia ao arrastar `.pane-header` (ignorando cliques nos botões de ação) após mover pelo menos `6px` (threshold anti-clique acidental).
   - Só é permitido soltar sobre outro painel pertencente à **mesma aba**.
   - **Zona de Drop:** Calcula a menor distância relativa `m` do ponteiro até as 4 bordas do painel alvo:
     - Se `m > 0.28` (**Centro**): executa `swapLeaves(root, source, target)`, trocando os dois painéis de lugar na árvore sem alterar proporções.
     - Se `m <= 0.28` (**Bordas** `left`, `right`, `top`, `bottom`): remove o painel de origem (`without`) e o insere na borda correspondente do alvo (`insertBeside`).

### 4.3. Status de Comandos em Tempo Real e Integração com Shells (`src-tauri/src/shells.rs`)
1. **Preservação de Dotfiles e Injeção de Hooks:**
   - O backend detecta o executável do shell (`zsh`, `bash`, `fish` ou outro) a partir da preferência do usuário, variável `$SHELL` ou fallback `/bin/zsh`.
   - Define sempre `TERM=xterm-256color` e `COLORTERM=truecolor`.
   - **`zsh`**: Cria scripts temporários em `$TMPDIR/termlab-zsh` (`.zshenv`, `.zprofile`, `.zshrc`), salva o `ZDOTDIR` original (ou `$HOME`) em `TERMLAB_USER_ZDOTDIR`, carrega os arquivos originais do usuário e registra os hooks `add-zsh-hook preexec` e `precmd`.
   - **`bash`**: Cria um rcfile temporário em `$TMPDIR/termlab-bash/bashrc`, carrega `/etc/profile` e o primeiro arquivo encontrado entre `.bash_profile`, `.bash_login`, `.profile` ou `.bashrc`, e injeta hooks via `PROMPT_COMMAND` e `trap DEBUG`.
   - **`fish`**: Inicia com `-l --init-command` registrando funções para os eventos `fish_preexec` e `fish_prompt`.
   - **Outros shells**: Iniciados apenas com `-l` (sem hooks automáticos de OSC).
2. **Protocolo de Sequências OSC:**
   - `OSC 133;C` (`\e]133;C\a`): Emitido imediatamente antes de um comando iniciar → muda o status do painel para `"running"` (bolinha amarela pulsante).
   - `OSC 133;D;<code>` (`\e]133;D;%s\a`): Emitido antes do próximo prompt com o exit code `$?` do último comando:
     - Se `code === 0` ou `code === 130` (interrupção manual com `Ctrl+C` / `SIGINT`), o status vai para `"idle"` (bolinha verde). **Regra importante:** `Ctrl+C` nunca é tratado como erro.
     - Para qualquer outro exit code (`!= 0` e `!= 130`), o status vai para `"error"` (bolinha vermelha).
   - `OSC 7` (`\e]7;file://HOST/PATH\a`): Emitido a cada prompt com o `PWD` atual (com espaços escapados como `%20`). O frontend decodifica a URL, atualiza `pane.cwd`, atualiza o título do cabeçalho do painel, recalcula o título da aba e salva a sessão.
3. **Agregação de Status na Aba (`tabStatus`):**
   - A bolinha da aba na sidebar resume todos os seus painéis seguindo a prioridade:
     1. `"running"` (amarelo) — se **qualquer** painel da aba estiver executando um comando.
     2. `"error"` (vermelho) — se nenhum estiver executando e **algum** painel estiver com erro.
     3. `"idle"` (verde) — se todos os painéis estiverem ociosos/com sucesso.

### 4.4. Grupos de Abas (`src/groups.ts`)
1. **Conceito:** Um grupo salva um conjunto de abas (com seus respectivos layouts de painéis e diretórios) associado a um nome de projeto e um diretório base (`dir`).
2. **Validação ao Salvar:**
   - O nome do grupo é obrigatório (não pode ser vazio).
   - Ao menos uma aba deve estar marcada no modal.
   - Ao serializar os painéis de cada aba do grupo, se um painel não tiver `cwd` próprio, utiliza-se o `dir` do grupo como fallback (`p.cwd || dir`).
3. **Substituição Case-Insensitive:**
   - Salvar um grupo cujo `name` já existe (comparação `toLowerCase()`) **substitui** o grupo existente mantendo o mesmo `id` (`UUID`). Caso contrário, cria um novo registro.
4. **Abertura de Grupo (`openGroup`) sem duplicação:**
   - Cada aba salva tem uma `key` estável (atribuída por `upsertGroup`/`appendTabToGroup`, e por `loadGroups` para grupos antigos); a aba aberta guarda a mesma chave em `groupKey`.
   - Clicar no grupo cria **apenas as abas salvas que não estão abertas** (`missingGroupTabs`), vinculadas a `groupId`/`groupName`/`groupKey`. Se todas já estiverem abertas, nada é recriado.
   - O agrupamento é expandido (se recolhido) e o foco vai para a aba ativa do grupo, a primeira aberta dele ou a primeira recém-criada.
5. **Vínculo ao Salvar (`saveGroupDialog`):** As abas marcadas no modal passam imediatamente a pertencer ao grupo salvo (`upsertGroup` devolve o registro com `id` estável). Abas que pertenciam a um grupo substituído e foram desmarcadas voltam a ser avulsas.
6. **Agrupamento na seção "Terminais":**
   - O cabeçalho do grupo (na posição da primeira aba do grupo) mostra seta `▾`/`▸`, bolinha com o **status agregado** de todos os painéis do grupo (mesma prioridade de `tabStatus`), nome e número de terminais abertos.
   - Clicar no cabeçalho recolhe/expande o grupo (`collapsedGroups`, persistido na sessão). O `✕` do cabeçalho fecha todos os terminais do grupo (`closeGroupTabs`).
7. **Arrastar abas para grupos (`startTabDrag` / `assignTabToGroup`):**
   - Arrastar uma aba (`.item`) em **Terminais** por pelo menos `6px` (eventos de ponteiro; o drag & drop nativo do HTML5 é interceptado pelo WebView do Tauri) e soltar sobre um `.tab-group` (cabeçalho ou itens) a coloca naquele grupo, após o último membro (`moveIntoGroup`), expandindo o grupo.
   - Ao **entrar** num grupo, a aba também é acrescentada ao grupo salvo (`appendTabToGroup`, com fallback `p.cwd || g.dir`); se ela já estiver lá (mesma `key`), é atualizada em vez de duplicada. Ao **sair** (soltar na área livre de `#tabs`) ou ser movida para outro grupo, apenas o vínculo da sessão muda; o grupo salvo de origem não é alterado.
   - Soltar no mesmo grupo (ou uma aba avulsa na área livre) não faz nada. O clique que segue o arraste é suprimido para não selecionar a aba.
8. **Exclusão de Grupo:** Excluir um grupo na seção **Grupos** mantém suas abas abertas, mas limpa `groupId`/`groupName` (`unlinkGroupTabs`). Ao restaurar a sessão, vínculos com grupos inexistentes também são descartados.

### 4.5. Persistência de Sessão (`src/session.ts`)
1. **Gatilhos de Gravação:** `persistSession()` é chamado sempre que abas ou painéis são criados, fechados, divididos, movidos, redimensionados, renomeados, quando a aba ativa muda ou quando um painel muda de diretório (`OSC 7`).
2. **Bloqueio de Boot (`booting`):** Enquanto `init()` está restaurando as abas iniciais (`booting === true`), `persistSession()` não faz nada para evitar sobrescrever a sessão salva com um estado parcial.
3. **Preferência `restoreSession`:** Se o usuário desmarcar `restoreSession` nas preferências, `persistSession()` limpa imediatamente a chave `term-lab.session` do `localStorage`.
4. **Grupos na Sessão:** Cada `SavedTab` pode trazer `groupId`/`groupName` e o `SessionState` traz `collapsedGroups` (ids recolhidos). `loadSession()` descarta campos de grupo com tipos inválidos.
5. **Validação de Integridade:** `loadSession()` valida recursivamente a árvore `SavedNode` (`isValidNode`) e faz clamp de `activeIndex` dentro de `[0, tabs.length - 1]`. Dados inválidos ou corrompidos retornam `null` sem quebrar a inicialização.

### 4.6. Preferências (`src/preferences.ts`) e Temas (`src/themes.ts`)
1. **Sanitização e Limites (`sanitizePreferences`):**
   - `fontSize`: inteiro entre `10` e `28` px (padrão: `13`). Atalhos `⌘=`, `⌘-` e `⌘0` ajustam e persistem imediatamente.
   - `scrollback`: inteiro entre `500` e `50000` linhas (padrão: `5000`).
   - `cursorStyle`: `"block" | "bar" | "underline"` (padrão: `"block"`).
   - `cursorBlink`: booleano (padrão: `true`).
   - `restoreSession`: booleano (padrão: `true`).
   - `shell`: string com `trim()` (padrão: `""`, que delega ao `$SHELL` do sistema no backend).
2. **Contraste e Temas:**
   - Os temas (`Catppuccin Mocha`, `Dracula`, `Tokyo Night`) mantêm a cor `brightBlack` (ANSI 8) original escura porque aplicações TUI (como o próprio Claude Code) utilizam a cor 8 como **plano de fundo** de caixas e rodapés.
   - Para garantir que textos apagados e _autosuggestions_ de shells (que usam `brightBlack` como **primeiro plano**) fiquem legíveis, o `Terminal` do xterm.js é configurado com `minimumContrastRatio: 4`, que clareia apenas o texto quando necessário.

---

## 5. Detalhes Técnicos Importantes (Armadilhas Evitadas)

Ao modificar `src/main.ts` ou `src/style.css`, preserve os seguintes comportamentos críticos:

1. **Montagem do xterm em `.term-host` sem padding:**
   - O `FitAddon` mede `clientWidth`/`clientHeight` do elemento pai. Se o xterm fosse montado diretamente em `.pane-body` (que possui padding), o `box-sizing: border-box` faria o `FitAddon` calcular linhas/colunas extras que ficariam cortadas na base do painel. Por isso o xterm é aberto dentro de `.term-host` (`width: 100%; height: 100%` sem padding).
2. **Ressincronização de Scroll ao Trocar de Aba (`resyncScroll`):**
   - Abas inativas ficam com `display: none`. Enquanto ocultas, o navegador zera a altura da área de scroll e o viewport do xterm pode perder sincronia quando chega saída em background. Ao selecionar uma aba (`select`), `resyncScroll(p)` move o buffer 1 linha e volta (ou rola para o final se o usuário já acompanhava o fim da saída), forçando o xterm a recalcular `scrollTop`.
3. **Renderizador WebGL com Fallback (`enableWebgl`):**
   - Cada painel carrega o `WebglAddon` para desenhar caracteres de caixa (`─ │ ╭ ▌`) sem falhas de alinhamento e com melhor performance. Em caso de falha ou perda de contexto da GPU (`onContextLoss`), o addon é descartado (`dispose()`) e o xterm volta automaticamente para o renderizador DOM.
4. **Debounce de Ações (`runAction`):**
   - No macOS, um atalho como `⌘T` pode disparar tanto o listener `window.addEventListener("keydown")` quanto o evento `"menu-action"` vindo do acelerador do menu nativo do Tauri. `runAction` ignora a mesma ação se disparada novamente em menos de `60ms`.
5. **Foco em Inputs:**
   - Ao trocar de aba, fechar modais ou atualizar status, o código verifica se o elemento focado não é o input de busca (`searchInput`) ou de renomeação de aba (`HTMLInputElement`) antes de devolver o foco ao terminal (`p.term.focus()`).

---

## 6. Chaves do `localStorage`

| Chave | Módulo | Conteúdo |
| --- | --- | --- |
| `term-lab.preferences` | `src/preferences.ts` | Objeto `Preferences` |
| `term-lab.session` | `src/session.ts` | Objeto `SessionState` (`tabs`, `activeIndex`, `collapsedGroups`) |
| `term-lab.groups` | `src/groups.ts` | Array `Group[]` |
| `term-lab.sidebarHidden` | `src/main.ts` | `"1"` (oculta) ou `"0"` (visível) |
| `theme` | `src/main.ts` | Nome do tema ativo (padrão `"Catppuccin Mocha"`) |

---

## 7. Comandos de Desenvolvimento, Build e Release

```bash
# Instalar dependências
npm install

# Executar testes unitários (Vitest)
npm test

# Verificar tipagem TypeScript e build do frontend
npm run build

# Rodar em modo desenvolvimento (Tauri + Vite)
npm run tauri dev

# Build local macOS sem exigir chave de assinatura do updater
npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'

# Validação completa via Docker (tsc + vitest + cargo check)
docker compose run --rm check

# Atualizar versão em todos os manifestos (package.json, Cargo.toml, tauri.conf.json, Cask, release-please)
npm run version:bump -- <major.minor.patch>
```

### Convenções do Repositório
- **Idioma:** Toda a interface do usuário (menus, botões, tooltips, modais) e os comentários do código estão em **português (pt-BR)**. Mensagens de commit seguem **Conventional Commits** em inglês (`feat(ui): ...`, `fix(terminal): ...`) para integração com o `release-please`.
- **Simplicidade e Zero Dependências Desnecessárias:** O frontend foi projetado sem frameworks pesados. Novas funcionalidades de estado ou layout devem priorizar funções puras testáveis com Vitest (seguindo o padrão de `layout.ts`, `groups.ts`, `session.ts` e `preferences.ts`).
