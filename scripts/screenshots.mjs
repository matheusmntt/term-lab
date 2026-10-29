// Gera os prints do README em docs/screenshots.
//
// Sobe o frontend (Vite) e o abre no Chrome com um backend Tauri *simulado*:
// cada painel recebe uma saída de shell pré-definida (com as mesmas sequências OSC
// que os hooks reais do zsh emitem). Toda a interface é a real.
//
//   npm run screenshots
import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- saídas simuladas ----------
const ESC = "\x1b";
const osc7 = (dir) => `${ESC}]7;file://macbook/Users/dev/app-ola/${dir}\x07`;
const C = `${ESC}]133;C\x07`; // comando iniciou
const D = (code) => `${ESC}]133;D;${code}\x07`; // comando terminou
const prompt = (dir, code = 0, suggestion = "") =>
  osc7(dir) + D(code) +
  `${ESC}[1;32m➜${ESC}[0m  ${ESC}[1;36m${dir}${ESC}[0m ${ESC}[1;34mgit:(${ESC}[31mmain${ESC}[34m)${ESC}[0m ` +
  (suggestion ? `${ESC}[90m${suggestion}${ESC}[0m${ESC}[${suggestion.length}D` : "");
const g = (s) => `${ESC}[32m${s}${ESC}[39m`;
const r = (s) => `${ESC}[31m${s}${ESC}[39m`;
const y = (s) => `${ESC}[33m${s}${ESC}[39m`;
const c = (s) => `${ESC}[36m${s}${ESC}[39m`;
const b = (s) => `${ESC}[1m${s}${ESC}[22m`;
const dim = (s) => `${ESC}[90m${s}${ESC}[39m`;
const lines = (...l) => l.join("\r\n") + "\r\n";

const SCRIPTS = [
  // 1) web: dev server (em execução -> bolinha amarela)
  prompt("web") + "npm run dev\r\n" + C +
    lines("", "> web@0.1.0 dev", "> vite", "",
      `  ${g(b("VITE v5.4.0"))}  ${dim("ready in")} ${b("312")} ms`, "",
      `  ${g("➜")}  ${b("Local")}:   ${c("http://localhost:" + b("5173") + "/")}`,
      `  ${dim("➜  Network: use --host to expose")}`, "",
      `${dim("15:41:02")} ${c("[vite]")} ${g("hmr update")} /src/App.tsx`,
      `${dim("15:41:19")} ${c("[vite]")} ${g("hmr update")} /src/components/Login.tsx`,
      `${dim("15:42:07")} ${c("[vite]")} ${g("hmr update")} /src/index.css`),
  // 2) git (ocioso -> verde)
  prompt("web") + "git log --oneline -6\r\n" + C +
    lines(`${y("a1f3c9e")} ${c("(HEAD -> main)")} feat(auth): add login form`,
      `${y("7be2d40")} fix(api): handle expired tokens`,
      `${y("c90a115")} chore: bump vite to 5.4`,
      `${y("3d8e7b2")} feat(ui): add dark theme`,
      `${y("e41f0aa")} docs: add setup instructions`,
      `${y("0b6c2f8")} chore: initial commit`) +
    prompt("web", 0, 'git commit -m "feat(auth): validate form"'),
  // 3) testes (ok -> verde)
  prompt("web") + "npm test\r\n" + C +
    lines("", `${b(" RUN ")} v1.6.0 /Users/dev/app-ola/web`, "",
      ` ${g("✓")} src/auth/login.test.ts ${dim("(6 tests)")} 12ms`,
      ` ${g("✓")} src/components/Login.test.tsx ${dim("(4 tests)")} 48ms`,
      ` ${g("✓")} src/utils/format.test.ts ${dim("(9 tests)")} 5ms`, "",
      ` ${b("Test Files")}  ${g(b("3 passed"))} ${dim("(3)")}`,
      `      ${b("Tests")}  ${g(b("19 passed"))} ${dim("(19)")}`, "") +
    prompt("web", 0, "npm run build"),
  // 4) api: docker build com erro (vermelho)
  prompt("api") + "docker build -t app-ola-api .\r\n" + C +
    lines(`${c("[+] Building 14.2s (9/12)")}`,
      ` ${dim("=> [internal] load build definition from Dockerfile")}`,
      ` ${dim("=> [1/6] FROM docker.io/library/rust:1-bookworm")}`,
      ` ${dim("=> [4/6] COPY Cargo.toml Cargo.lock ./")}`,
      ` ${dim("=> [5/6] RUN cargo build --release")}`, "",
      r(" > [5/6] RUN cargo build --release:"),
      r("error[E0432]: unresolved import `crate::config`"),
      r("  --> src/main.rs:3:5"),
      r("error: could not compile `app-ola-api` (bin) due to 1 previous error"), "",
      r("ERROR: failed to solve: process \"/bin/sh -c cargo build --release\" did not complete successfully: exit code: 101")) +
    prompt("api", 1, "docker build --no-cache -t app-ola-api ."),
  // 5) docs (ocioso -> verde)
  prompt("docs") + "ls\r\n" + C +
    lines(`${ESC}[1;34mguides${ESC}[0m  ${ESC}[1;34massets${ESC}[0m  README.md  CONTRIBUTING.md`) +
    prompt("docs", 0, "git pull"),
];

// ---------- backend Tauri simulado (roda dentro da página) ----------
function installMock(scripts) {
  const handlers = {};
  let cb = 0;
  let spawned = 0;
  const enc = new TextEncoder();
  const emit = (event, payload) =>
    (handlers[event] ?? []).forEach((h) => window["_" + h]?.({ event, id: 0, payload }));

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback(fn) { const id = ++cb; window["_" + id] = fn; return id; },
    unregisterCallback(id) { delete window["_" + id]; },
    convertFileSrc: (p) => p,
    async invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { (handlers[args.event] ??= []).push(args.handler); return args.handler; }
      if (cmd === "plugin:updater|check") return null;
      if (cmd === "pty_spawn") {
        const text = scripts[spawned++ % scripts.length];
        setTimeout(() => emit("pty-output", { id: args.id, data: Array.from(enc.encode(text)) }), 60);
      }
    },
  };
  localStorage.removeItem("term-lab.groups");
  localStorage.removeItem("term-lab.session");
  localStorage.removeItem("term-lab.preferences");
}

// ---------- execução ----------
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 1421, strictPort: true }, logLevel: "silent" });
await server.listen();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(installMock, SCRIPTS);
  await page.goto("http://localhost:1421/", { waitUntil: "networkidle0" });
  await sleep(700);

  // aba 1 (web): painel à direita + painel abaixo dele
  await page.click("#split");
  await sleep(500);
  await page.click("#split-down");
  await sleep(500);

  const rename = async (index, name) => {
    const items = await page.$$("#tabs .item");
    await items[index].click({ count: 2 });
    await sleep(150);
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await sleep(150);
  };
  await rename(0, "App Olá · web");

  await page.click("#new-tab");
  await sleep(900);
  await rename(1, "App Olá · api");

  await page.click("#new-tab");
  await sleep(900);
  await rename(2, "docs");

  // volta para a primeira aba
  await (await page.$$("#tabs .item"))[0].click();
  await sleep(500);

  // "janela" do macOS: semáforos
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:16px;top:14px;z-index:9999;display:flex;gap:8px";
    for (const col of ["#ff5f57", "#febc2e", "#28c840"]) {
      const s = document.createElement("span");
      s.style.cssText = `width:12px;height:12px;border-radius:50%;background:${col}`;
      d.appendChild(s);
    }
    document.body.appendChild(d);
  });

  // diálogo de salvar grupo
  await page.click("#save-group");
  await sleep(200);
  await page.type('input[name="name"]', "App Olá");
  await page.$eval('input[name="dir"]', (el) => (el.value = "/Users/dev/app-ola"));
  await sleep(200);
  await page.screenshot({ path: OUT + "save-group.png" });
  await page.click('button[type="submit"]');
  await sleep(400);

  // visão geral (Catppuccin) e Tokyo Night
  await page.screenshot({ path: OUT + "overview.png" });
  await page.select("#theme", "Tokyo Night");
  await sleep(500);
  await page.screenshot({ path: OUT + "tokyo-night.png" });
  console.log("Prints salvos em", OUT);
} finally {
  await browser.close();
  await server.close();
}
