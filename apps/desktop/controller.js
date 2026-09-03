import { app, dialog, shell } from "electron";
import { extname, join } from "node:path";

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatBounds(bounds) {
  if (!bounds) return "";
  return `${Math.round(bounds.width)} × ${Math.round(bounds.height)} px em ${Math.round(bounds.x)}, ${Math.round(bounds.y)}`;
}

function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

export class DesktopController {
  constructor(windows, worker) {
    this.windows = windows;
    this.worker = worker;
    this.workerStatus = { phase: "idle", elapsedSeconds: 0, segmentCount: 0, project: null };
    this.statusTimer = undefined;
    this.statusPolling = false;
    this.doctorResult = undefined;
    this.displayCache = [];
    this.windowCache = [];
    this.lastSavedPath = undefined;
    this.lastError = undefined;
    this.forceQuit = false;
    this.quittingPrompt = false;
    this.selection = {
      mode: "display",
      label: "Tela inteira",
      detail: "Aguardando a lista de monitores",
      capture: { kind: "display" },
      bounds: undefined,
      window: undefined,
    };
  }

  phase() {
    if (this.workerStatus.phase === "idle" && this.lastSavedPath) return "saved";
    return this.workerStatus.phase;
  }

  publicState() {
    return {
      phase: this.phase(),
      elapsedSeconds: this.workerStatus.elapsedSeconds ?? 0,
      source: {
        mode: this.selection.mode,
        label: this.selection.label,
        detail: this.selection.detail,
        bounds: this.selection.bounds ?? null,
        displayIndex: this.selection.capture.displayIndex ?? null,
      },
      project: this.workerStatus.project ?? null,
      doctor: this.doctorResult ?? null,
      lastSavedPath: this.lastSavedPath ?? null,
      error: this.lastError ?? null,
    };
  }

  setWorkerStatus(status) {
    if (status && typeof status === "object") this.workerStatus = status;
  }

  sendState() {
    this.windows.sendState(this.publicState());
  }

  setError(error) {
    this.lastError = messageOf(error);
    this.sendState();
  }

  clearError() {
    this.lastError = undefined;
  }

  startStatusTimer() {
    this.stopStatusTimer();
    this.statusTimer = setInterval(() => { void this.pollStatus(); }, 250);
  }

  stopStatusTimer() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = undefined;
    this.statusPolling = false;
  }

  async pollStatus() {
    if (this.statusPolling) return;
    this.statusPolling = true;
    try {
      this.setWorkerStatus(await this.worker.invoke("status"));
      this.sendState();
    } catch (error) {
      this.stopStatusTimer();
      this.windows.hideToolbar();
      this.windows.showMain();
      this.setError(error);
    } finally {
      this.statusPolling = false;
    }
  }

  async refreshDoctor() {
    this.doctorResult = await this.worker.invoke("doctor");
    this.sendState();
    return this.doctorResult;
  }

  displaySelection(display) {
    return {
      mode: "display",
      label: display.primary ? `Tela ${display.index + 1} (principal)` : `Tela ${display.index + 1}`,
      detail: `${display.deviceName} · ${formatBounds(display.rect)}`,
      capture: { kind: "display", displayIndex: display.index },
      bounds: display.rect,
      window: undefined,
    };
  }

  async refreshDisplays() {
    this.displayCache = (await this.worker.invoke("displays")).sort((left, right) => left.index - right.index);
    if (this.displayCache.length === 0) throw new Error("Nenhum monitor compatível foi encontrado.");

    if (this.selection.mode === "display") {
      const selectedIndex = this.selection.capture.displayIndex;
      const selected = this.displayCache.find((display) => display.index === selectedIndex) ??
        this.displayCache.find((display) => display.primary) ?? this.displayCache[0];
      this.selection = this.displaySelection(selected);
    }
    this.sendState();
    return this.displayCache;
  }

  async refreshWindows() {
    this.windowCache = (await this.worker.invoke("windows"))
      .filter((window) => window.processId !== process.pid)
      .filter((window) => window.title.trim().length > 0)
      .filter((window) => window.rect.width >= 64 && window.rect.height >= 64)
      .filter((window) => window.displayIndex >= 0)
      .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));
    return this.windowCache;
  }

  async findWindowByHandle(handle) {
    const normalized = String(handle ?? "");
    if (!/^\d+$/.test(normalized)) throw new TypeError("O identificador da janela é inválido.");
    const selected = (await this.refreshWindows()).find((candidate) => candidate.handle === normalized);
    if (!selected) throw new Error("A janela selecionada não está mais disponível.");
    return selected;
  }

  async selectDisplay(index) {
    const normalized = Number(index);
    if (!Number.isInteger(normalized) || normalized < 0) throw new TypeError("O índice do monitor é inválido.");
    const selected = (await this.refreshDisplays()).find((display) => display.index === normalized);
    if (!selected) throw new Error(`O monitor ${normalized} não está mais disponível.`);
    this.selection = this.displaySelection(selected);
    this.clearError();
    this.sendState();
    return this.publicState();
  }

  async selectWindow(handle) {
    const selected = await this.findWindowByHandle(handle);
    this.selection = {
      mode: "window",
      label: selected.title,
      detail: `Janela fixa · ${formatBounds(selected.rect)}`,
      capture: {
        kind: "window",
        title: selected.title,
        match: "exact",
        displayIndex: selected.displayIndex,
      },
      bounds: selected.rect,
      window: selected,
    };
    this.clearError();
    this.sendState();
    return this.publicState();
  }

  async selectRegion() {
    const rect = await this.windows.chooseRegion();
    if (!rect) return this.publicState();
    const displays = await this.refreshDisplays();
    const matches = displays.filter((display) => containsRect(display.rect, rect));
    if (matches.length !== 1) throw new Error("A área precisa ficar integralmente dentro de um único monitor.");
    const display = matches[0];
    this.selection = {
      mode: "region",
      label: "Área personalizada",
      detail: `Tela ${display.index + 1} · ${formatBounds(rect)}`,
      capture: { kind: "region", rect, displayIndex: display.index },
      bounds: rect,
      window: undefined,
    };
    this.clearError();
    this.sendState();
    return this.publicState();
  }

  async bootstrap() {
    const [doctor, displays, windows, status] = await Promise.all([
      this.worker.invoke("doctor"),
      this.worker.invoke("displays"),
      this.worker.invoke("windows"),
      this.worker.invoke("status"),
    ]);
    this.doctorResult = doctor;
    this.displayCache = displays.sort((left, right) => left.index - right.index);
    if (this.displayCache.length === 0) throw new Error("Nenhum monitor compatível foi encontrado.");
    this.selection = this.displaySelection(
      this.displayCache.find((display) => display.primary) ?? this.displayCache[0],
    );
    this.windowCache = windows
      .filter((window) => window.processId !== process.pid)
      .filter((window) => window.title.trim().length > 0)
      .filter((window) => window.rect.width >= 64 && window.rect.height >= 64)
      .filter((window) => window.displayIndex >= 0)
      .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));
    this.setWorkerStatus(status);
    this.clearError();
    this.sendState();
    return { state: this.publicState(), displays: this.displayCache, windows: this.windowCache };
  }

  async startRecording(options) {
    if (process.platform !== "win32") throw new Error("A interface de gravação funciona somente no Windows.");
    if (!["idle", "saved"].includes(this.phase())) throw new Error("Finalize a operação atual antes de iniciar outra gravação.");

    const doctor = await this.refreshDoctor();
    if (!doctor.ok) {
      const failed = doctor.checks
        .filter((check) => !check.ok)
        .map((check) => `${check.name}: ${check.detail}`)
        .join("\n");
      throw new Error(`O ambiente ainda não está pronto:\n${failed}`);
    }

    let fixedCapture = this.selection.capture;
    let semanticSource;
    let windowMetadata;
    if (this.selection.mode === "window") {
      const selected = await this.findWindowByHandle(this.selection.window?.handle);
      this.selection = {
        mode: "window",
        label: selected.title,
        detail: `Janela fixa · ${formatBounds(selected.rect)}`,
        capture: {
          kind: "window",
          title: selected.title,
          match: "exact",
          displayIndex: selected.displayIndex,
        },
        bounds: selected.rect,
        window: selected,
      };
      fixedCapture = {
        kind: "region",
        rect: { ...selected.rect },
        displayIndex: selected.displayIndex,
      };
      semanticSource = this.selection.capture;
      windowMetadata = {
        handle: selected.handle,
        processId: selected.processId,
        initialTitle: selected.title,
      };
    }

    this.clearError();
    this.lastSavedPath = undefined;
    this.workerStatus = { phase: "starting", elapsedSeconds: 0, segmentCount: 0, project: null };
    let toolbar;
    try {
      this.windows.hideMain();
      toolbar = await this.windows.ensureToolbar(this.selection.bounds);
      toolbar.hide();
      this.startStatusTimer();
      this.sendState();
      this.setWorkerStatus(await this.worker.invoke("start", {
        capture: fixedCapture,
        semanticSource,
        windowMetadata,
        fps: options?.fps === 30 ? 30 : 60,
        showCursor: options?.showCursor !== false,
      }));
      toolbar.showInactive();
      this.sendState();
      return this.publicState();
    } catch (error) {
      this.workerStatus = { phase: "idle", elapsedSeconds: 0, segmentCount: 0, project: null };
      this.stopStatusTimer();
      if (toolbar && !toolbar.isDestroyed()) toolbar.hide();
      this.windows.showMain();
      throw error;
    }
  }

  async pauseOrResume() {
    if (!this.workerStatus || !["recording", "paused"].includes(this.workerStatus.phase)) {
      throw new Error("Não há gravação disponível para pausar ou continuar.");
    }
    const previous = this.workerStatus;
    this.workerStatus = {
      ...previous,
      phase: previous.phase === "recording" ? "pausing" : "resuming",
    };
    this.sendState();
    try {
      this.setWorkerStatus(await this.worker.invoke("pause-resume"));
      this.clearError();
      this.sendState();
      return this.publicState();
    } catch (error) {
      this.stopStatusTimer();
      this.windows.hideToolbar();
      this.windows.showMain();
      try { this.setWorkerStatus(await this.worker.invoke("cleanup")); } catch { /* melhor esforço */ }
      throw error;
    }
  }

  async stopRecording() {
    if (!this.workerStatus || !["recording", "paused"].includes(this.workerStatus.phase)) {
      throw new Error("Não há gravação em andamento.");
    }
    this.windows.hideToolbar();
    this.workerStatus = { ...this.workerStatus, phase: "stopping" };
    this.sendState();
    try {
      this.setWorkerStatus(await this.worker.invoke("stop"));
      this.clearError();
      this.stopStatusTimer();
      this.windows.showMain();
      this.sendState();
      return this.publicState();
    } catch (error) {
      this.stopStatusTimer();
      this.windows.showMain();
      this.workerStatus = { phase: "idle", elapsedSeconds: 0, segmentCount: 0, project: null };
      throw error;
    }
  }

  suggestedOutputPath() {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    return join(app.getPath("videos"), `Auto-Screen-${stamp}.mp4`);
  }

  async saveRecording() {
    if (this.workerStatus.phase !== "captured" || !this.workerStatus.project) {
      throw new Error("Não há gravação pronta para salvar.");
    }
    const result = await dialog.showSaveDialog(this.windows.mainWindow, {
      title: "Salvar gravação",
      defaultPath: this.suggestedOutputPath(),
      buttonLabel: "Salvar MP4",
      filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (result.canceled || !result.filePath) return this.publicState();
    const outputFile = extname(result.filePath).toLocaleLowerCase() === ".mp4"
      ? result.filePath
      : `${result.filePath}.mp4`;

    this.clearError();
    this.workerStatus = { ...this.workerStatus, phase: "rendering" };
    this.sendState();
    try {
      const saved = await this.worker.invoke("save", { outputFile });
      this.setWorkerStatus(saved.status);
      this.lastSavedPath = saved.videoPath;
      this.sendState();
      shell.showItemInFolder(saved.videoPath);
      return this.publicState();
    } catch (error) {
      try { this.setWorkerStatus(await this.worker.invoke("status")); } catch { /* manter estado local */ }
      throw error;
    }
  }

  async discardRecording() {
    if (this.workerStatus.phase !== "captured") return this.publicState();
    this.setWorkerStatus(await this.worker.invoke("discard"));
    this.clearError();
    this.sendState();
    return this.publicState();
  }

  openOutput() {
    if (!this.lastSavedPath) throw new Error("Nenhum arquivo foi salvo nesta sessão.");
    shell.showItemInFolder(this.lastSavedPath);
    return this.publicState();
  }

  hasPendingWork() {
    return ["starting", "recording", "pausing", "paused", "resuming", "stopping", "captured", "rendering"]
      .includes(this.workerStatus.phase);
  }

  async confirmQuit() {
    if (this.forceQuit || this.quittingPrompt) return;
    this.quittingPrompt = true;
    try {
      if (!this.hasPendingWork()) {
        this.forceQuit = true;
        await this.worker.dispose();
        app.quit();
        return;
      }

      const response = await dialog.showMessageBox(this.windows.mainWindow, {
        type: "warning",
        title: "Encerrar Auto-Screen",
        message: this.workerStatus.phase === "rendering"
          ? "O arquivo MP4 ainda está sendo finalizado."
          : ["starting", "recording", "pausing", "paused", "resuming", "stopping"].includes(this.workerStatus.phase)
            ? "Há uma gravação em andamento."
            : "Há uma gravação ainda não salva.",
        detail: this.workerStatus.phase === "rendering"
          ? "Encerrar agora pode preservar arquivos temporários para recuperação."
          : "Ao encerrar, a captura temporária será descartada.",
        buttons: ["Continuar no aplicativo", this.workerStatus.phase === "rendering" ? "Encerrar mesmo assim" : "Encerrar e descartar"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) return;

      try { await this.worker.invoke("cleanup"); } catch { /* melhor esforço */ }
      this.forceQuit = true;
      await this.worker.dispose();
      app.quit();
    } finally {
      if (!this.forceQuit) this.quittingPrompt = false;
    }
  }
}
