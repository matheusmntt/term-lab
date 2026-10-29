import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

let cachedUpdate: Update | null = null;

function renderModal(html: string, onClose?: () => void): HTMLElement {
  const root = document.getElementById("modal-root")!;
  const close = () => {
    root.replaceChildren();
    onClose?.();
  };
  root.innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
  root.querySelector(".overlay")!.addEventListener("mousedown", (e) => {
    if (e.target === e.currentTarget) close();
  });
  root.querySelector('[data-a="close"]')?.addEventListener("click", close);
  return root.querySelector(".modal") as HTMLElement;
}

function showUpdateAvailable(update: Update, onClose?: () => void) {
  cachedUpdate = update;
  const notes = update.body?.trim() || "Melhorias e correções.";
  const modal = renderModal(
    `
    <h3>Atualização disponível (v${esc(update.version)})</h3>
    <div class="hint">Versão instalada: v${esc(update.currentVersion)}</div>
    <div class="notes">${esc(notes)}</div>
    <div class="hint" id="upd-status"></div>
    <div class="modal-actions">
      <button type="button" class="btn" data-a="close">Depois</button>
      <button type="button" class="btn primary" data-a="install">Atualizar e reiniciar</button>
    </div>`,
    onClose,
  );

  const installBtn = modal.querySelector('[data-a="install"]') as HTMLButtonElement;
  const statusEl = modal.querySelector("#upd-status") as HTMLElement;
  installBtn.onclick = async () => {
    installBtn.disabled = true;
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
          statusEl.textContent = "Baixando atualização…";
        } else if (ev.event === "Progress") {
          downloaded += ev.data.chunkLength;
          const pct = total > 0 ? ` (${Math.min(100, Math.round((downloaded / total) * 100))}%)` : "";
          statusEl.textContent = `Baixando atualização…${pct}`;
        } else if (ev.event === "Finished") {
          statusEl.textContent = "Instalando e reiniciando…";
        }
      });
      await relaunch();
    } catch (err) {
      installBtn.disabled = false;
      statusEl.textContent = `Falha ao atualizar: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export async function checkForUpdatesInteractive(onClose?: () => void) {
  if (cachedUpdate) {
    showUpdateAvailable(cachedUpdate, onClose);
    return;
  }
  renderModal(
    `
    <h3>Atualizações</h3>
    <div class="hint">Verificando novas versões no GitHub Releases…</div>
    <div class="modal-actions">
      <button type="button" class="btn" data-a="close">Cancelar</button>
    </div>`,
    onClose,
  );
  try {
    const update = await check();
    if (!document.getElementById("modal-root")?.children.length) return;
    if (update) {
      revealBanner(update, onClose);
      showUpdateAvailable(update, onClose);
    } else {
      renderModal(
        `
        <h3>Term Lab está atualizado</h3>
        <div class="hint">Você já está usando a versão mais recente disponível.</div>
        <div class="modal-actions">
          <button type="button" class="btn primary" data-a="close">OK</button>
        </div>`,
        onClose,
      );
    }
  } catch {
    if (!document.getElementById("modal-root")?.children.length) return;
    renderModal(
      `
      <h3>Não foi possível verificar atualizações</h3>
      <div class="hint">Verifique sua conexão ou se já existe uma release publicada em matheusmntt/term-lab.</div>
      <div class="modal-actions">
        <button type="button" class="btn primary" data-a="close">Fechar</button>
      </div>`,
      onClose,
    );
  }
}

function revealBanner(update: Update, onClose?: () => void) {
  cachedUpdate = update;
  const banner = document.getElementById("update-banner");
  if (!banner) return;
  banner.hidden = false;
  banner.innerHTML = `<span>Nova versão <strong>v${esc(update.version)}</strong></span><span>Atualizar →</span>`;
  banner.onclick = () => showUpdateAvailable(update, onClose);
}

export function initUpdater(
  registerMenuHandler: (fn: () => void) => void,
  refocusTerminal?: () => void,
) {
  registerMenuHandler(() => void checkForUpdatesInteractive(refocusTerminal));
  setTimeout(async () => {
    try {
      const update = await check();
      if (update) revealBanner(update, refocusTerminal);
    } catch {
      // silencioso no startup (modo dev, offline ou antes da primeira release)
    }
  }, 2000);
}
