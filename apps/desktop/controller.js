import { app, dialog, shell } from "electron";
import { basename, dirname, extname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { synthesizeSeedAudio, transcribeOpenRouter } from "./openrouter.js";
import { WebcamPreviewSession } from "./webcam.js";

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
    this.webcamCache = [];
    this.microphoneCache = [];
    this.apiKeySaved = false;
    this.voiceReferencePath = undefined;
    this.cameraPreviewSession = undefined;
    this.cameraPreviewTransition = Promise.resolve();
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
      audioWarnings: this.workerStatus.audioWarnings ?? [],
      effectsPending: this.workerStatus.effectsPending === true,
      webcam: {
        hasWebcam: this.workerStatus.hasWebcam === true,
        filters: this.workerStatus.webcamFilters ?? null,
      },
      previewUrl: this.workerStatus.previewPath ? pathToFileURL(this.workerStatus.previewPath).href : null,
      doctor: this.doctorResult ?? null,
      settings: this.settingsStore?.value ?? null,
      voice: {
        apiKeySaved: this.apiKeySaved,
        referenceName: this.voiceReferencePath ? basename(this.voiceReferencePath) : this.workerStatus.hasMicrophone === true ? "Voz desta gravação" : null,
        referenceSource: this.voiceReferencePath ? "file" : "recording",
        hasMicrophone: this.workerStatus.hasMicrophone === true,
        mode: this.workerStatus.voiceMode ?? "original",
        syncMs: this.workerStatus.voiceSyncMs ?? 0,
      },
      lastSavedPath: this.lastSavedPath ?? null,
      error: this.lastError ?? null,
    };
  }

  setWorkerStatus(status) {
    if (status && typeof status === "object") {
      if (status.previewFrame) this.windows.sendCameraFrame(status.previewFrame);
      const { previewFrame: _frame, ...publicStatus } = status;
      this.workerStatus = publicStatus;
    }
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
      this.windows.hideCaptureOverlay();
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

  async refreshWebcams() {
    this.webcamCache = await this.worker.invoke("webcams");
    return this.webcamCache;
  }

  async refreshMicrophones() {
    this.microphoneCache = await this.worker.invoke("microphones");
    return this.microphoneCache;
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
    const [doctor, displays, windows, webcams, microphones, status] = await Promise.all([
      this.worker.invoke("doctor"),
      this.worker.invoke("displays"),
      this.worker.invoke("windows"),
      this.worker.invoke("webcams").catch(() => []),
      this.worker.invoke("microphones").catch(() => []),
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
    this.webcamCache = webcams;
    this.microphoneCache = microphones;
    this.setWorkerStatus(status);
    this.clearError();
    this.sendState();
    return { state: this.publicState(), displays: this.displayCache, windows: this.windowCache, webcams: this.webcamCache, microphones: this.microphoneCache, cameraModelUrls: this.windows.cameraModelUrls() };
  }

  async previewCamera(deviceId) {
    this.cameraPreviewTransition = this.cameraPreviewTransition.catch(() => undefined).then(async () => {
      if (!["idle", "saved"].includes(this.phase())) throw new Error("A prévia da webcam só funciona antes da gravação.");
      const nextId = typeof deviceId === "string" ? deviceId : "";
      if (this.cameraPreviewSession?.deviceId === nextId) return;
      await this.cameraPreviewSession?.stop();
      this.cameraPreviewSession = undefined;
      if (!nextId) return;
      if (!this.webcamCache.some((device) => device.id === nextId)) await this.refreshWebcams();
      if (!this.webcamCache.some((device) => device.id === nextId)) throw new Error("A webcam escolhida não está disponível para a prévia.");
      const session = new WebcamPreviewSession({
        deviceId: nextId,
        onFrame: (frame) => this.windows.sendSetupCameraFrame(frame),
      });
      this.cameraPreviewSession = session;
      try { await session.start(); }
      catch (error) { this.cameraPreviewSession = undefined; throw error; }
    });
    await this.cameraPreviewTransition;
    return true;
  }

  async stopCameraPreview() {
    this.cameraPreviewTransition = this.cameraPreviewTransition.catch(() => undefined).then(async () => {
      await this.cameraPreviewSession?.stop();
      this.cameraPreviewSession = undefined;
    });
    await this.cameraPreviewTransition;
  }

  async updateSettings(patch) {
    if (!["idle", "saved"].includes(this.phase())) throw new Error("As preferências só podem mudar antes da gravação.");
    const raw = patch && typeof patch === "object" ? patch : {};
    const { outputDirectory: _ignored, ...allowed } = raw;
    await this.settingsStore.update(allowed);
    this.sendState();
    return this.publicState();
  }

  async chooseOutputDirectory() {
    if (!["idle", "saved"].includes(this.phase())) throw new Error("A pasta de saída só pode mudar antes da gravação.");
    const result = await dialog.showOpenDialog(this.windows.mainWindow, {
      title: "Pasta das gravações",
      defaultPath: this.settingsStore.value.outputDirectory,
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      await this.settingsStore.update({ outputDirectory: result.filePaths[0] });
      this.sendState();
    }
    return this.publicState();
  }

  async startRecording(options) {
    if (process.platform !== "win32") throw new Error("A interface de gravação funciona somente no Windows.");
    if (!["idle", "saved"].includes(this.phase())) throw new Error("Finalize a operação atual antes de iniciar outra gravação.");
    await this.stopCameraPreview();
    if (options && typeof options === "object") {
      const { outputDirectory: _ignored, ...allowed } = options;
      await this.settingsStore.update(allowed);
    }
    const settings = this.settingsStore.value;
    let webcam;
    let webcamPreview;
    let microphone;
    if (settings.webcam.enabled) {
      const devices = await this.refreshWebcams();
      const selected = devices.find((device) => device.id === settings.webcam.deviceId);
      if (!selected) throw new Error("A webcam escolhida não está disponível. Atualize a lista ou desative a webcam.");
      webcam = { ...settings.webcam, deviceId: selected.id };
      webcamPreview = { ...settings.webcam, name: selected.name };
    }
    if (settings.microphone.enabled) {
      const devices = await this.refreshMicrophones();
      const selected = devices.find((device) => device.id === settings.microphone.deviceId);
      if (!selected) throw new Error("O microfone escolhido não está disponível. Atualize a lista ou desative o microfone.");
      microphone = { enabled: true, deviceId: selected.id, latencyMs: settings.microphone.latencyMs ?? 0 };
    }

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

    const cursorMode = settings.cursorMode;

    this.clearError();
    this.lastSavedPath = undefined;
    this.voiceReferencePath = undefined;
    this.workerStatus = { phase: "starting", elapsedSeconds: 0, segmentCount: 0, project: null };
    let toolbar;
    let workerStarted = false;
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
        fps: settings.fps,
        cursorMode,
        quality: settings.quality,
        webcam,
        microphone,
      }));
      workerStarted = true;
      await this.windows.showCaptureOverlay(this.selection.bounds, webcamPreview);
      toolbar.showInactive();
      this.sendState();
      return this.publicState();
    } catch (error) {
      if (workerStarted) await this.worker.invoke("cleanup").catch(() => undefined);
      this.workerStatus = { phase: "idle", elapsedSeconds: 0, segmentCount: 0, project: null };
      this.stopStatusTimer();
      if (toolbar && !toolbar.isDestroyed()) toolbar.hide();
      this.windows.hideCaptureOverlay();
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
      this.windows.setCaptureOverlayPaused(this.workerStatus.phase === "paused");
      this.clearError();
      this.sendState();
      return this.publicState();
    } catch (error) {
      this.stopStatusTimer();
      this.windows.hideToolbar();
      this.windows.hideCaptureOverlay();
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
    this.windows.hideCaptureOverlay();
    this.workerStatus = { ...this.workerStatus, phase: "stopping" };
    this.sendState();
    try {
      this.setWorkerStatus(await this.worker.invoke("stop"));
      this.clearError();
      this.stopStatusTimer();
      this.windows.showMain();
      this.sendState();
    } catch (error) {
      this.stopStatusTimer();
      this.windows.showMain();
      this.workerStatus = { phase: "idle", elapsedSeconds: 0, segmentCount: 0, project: null };
      throw error;
    }

    return await this.preparePreview();
  }

  async preparePreview({ allowAutoSave = true } = {}) {
    if (this.workerStatus.phase !== "captured" || !this.workerStatus.project) throw new Error("Não há gravação pronta para visualizar.");
    this.workerStatus = { ...this.workerStatus, phase: "previewing" };
    this.sendState();
    try {
      const filterSources = await this.worker.invoke("webcam-effects-sources");
      if (filterSources.length > 0) {
        const paths = [];
        for (const source of filterSources) {
          paths.push(await this.windows.processWebcamSegment(source, {
            ...this.settingsStore.value.webcam,
            ...this.workerStatus.webcamFilters,
          }));
        }
        this.setWorkerStatus(await this.worker.invoke("webcam-effects-apply", { paths }));
      }
      this.setWorkerStatus(await this.worker.invoke("preview"));
      this.clearError();
      this.sendState();
      return allowAutoSave && this.settingsStore.value.autoSave && !this.settingsStore.value.microphone.enabled
        ? await this.saveRecording({ automatic: true })
        : this.publicState();
    } catch (error) {
      try { this.setWorkerStatus(await this.worker.invoke("status")); } catch { /* manter estado capturado */ }
      throw error;
    }
  }

  async retryPreview() {
    return await this.preparePreview();
  }

  async applyWebcamFilters({ backgroundBlur, faceRetouch } = {}) {
    if (this.workerStatus.phase !== "captured" || !this.workerStatus.hasWebcam) {
      throw new Error("Finalize uma gravação com webcam antes de aplicar os filtros.");
    }
    const values = { backgroundBlur: Number(backgroundBlur), faceRetouch: Number(faceRetouch) };
    this.setWorkerStatus(await this.worker.invoke("webcam-effects-configure", values));
    await this.settingsStore.update({ webcam: values });
    this.sendState();
    return await this.preparePreview({ allowAutoSave: false });
  }

  suggestedOutputPath() {
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    return join(this.settingsStore.value.outputDirectory, `Auto-Screen-${stamp}.mp4`);
  }

  async saveRecording({ automatic = false } = {}) {
    if (this.workerStatus.phase !== "captured" || !this.workerStatus.project) {
      throw new Error("Não há gravação pronta para salvar.");
    }
    if (this.workerStatus.effectsPending) throw new Error("Reprocesse os filtros da webcam antes de salvar.");
    let requestedPath = this.suggestedOutputPath();
    if (!automatic) {
      const result = await dialog.showSaveDialog(this.windows.mainWindow, {
        title: "Salvar gravação",
        defaultPath: requestedPath,
        buttonLabel: "Salvar MP4",
        filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
        properties: ["showOverwriteConfirmation", "createDirectory"],
      });
      if (result.canceled || !result.filePath) return this.publicState();
      requestedPath = result.filePath;
    } else {
      await mkdir(this.settingsStore.value.outputDirectory, { recursive: true });
    }
    const outputFile = extname(requestedPath).toLocaleLowerCase() === ".mp4"
      ? requestedPath
      : `${requestedPath}.mp4`;

    this.clearError();
    this.workerStatus = { ...this.workerStatus, phase: "rendering" };
    this.sendState();
    try {
      const saved = await this.worker.invoke("save", { outputFile });
      this.setWorkerStatus(saved.status);
      this.lastSavedPath = saved.videoPath;
      this.sendState();
      if (!automatic) shell.showItemInFolder(saved.videoPath);
      return this.publicState();
    } catch (error) {
      try { this.setWorkerStatus(await this.worker.invoke("status")); } catch { /* manter estado local */ }
      throw error;
    }
  }

  async discardRecording() {
    if (this.workerStatus.phase !== "captured") return this.publicState();
    this.setWorkerStatus(await this.worker.invoke("discard"));
    this.voiceReferencePath = undefined;
    this.clearError();
    this.sendState();
    return this.publicState();
  }

  openOutput() {
    if (!this.lastSavedPath) throw new Error("Nenhum arquivo foi salvo nesta sessão.");
    shell.showItemInFolder(this.lastSavedPath);
    return this.publicState();
  }

  async storeOpenRouterKey(value) {
    await this.secretStore.saveKey(value);
    this.apiKeySaved = true;
    this.sendState();
    return this.publicState();
  }

  async removeOpenRouterKey() {
    await this.secretStore.removeKey();
    this.apiKeySaved = false;
    this.sendState();
    return this.publicState();
  }

  async chooseVoiceReference() {
    if (this.workerStatus.phase !== "captured" || !this.workerStatus.hasMicrophone) {
      throw new Error("Grave a voz antes de escolher uma amostra de referência.");
    }
    const result = await dialog.showOpenDialog(this.windows.mainWindow, {
      title: "Amostra de voz autorizada",
      properties: ["openFile"],
      filters: [{ name: "Áudio", extensions: ["wav", "mp3", "m4a", "ogg"] }],
    });
    if (!result.canceled && result.filePaths[0]) this.voiceReferencePath = result.filePaths[0];
    this.sendState();
    return this.publicState();
  }

  resetVoiceReference() {
    if (this.workerStatus.phase !== "captured" || !this.workerStatus.hasMicrophone) {
      throw new Error("Grave a voz antes de escolher a referência da gravação.");
    }
    this.voiceReferencePath = undefined;
    this.sendState();
    return this.publicState();
  }

  async refreshVoicePreview(status) {
    this.setWorkerStatus(status);
    this.sendState();
    this.setWorkerStatus(await this.worker.invoke("preview"));
    this.sendState();
    return this.publicState();
  }

  async processVoiceLocal(options) {
    if (this.workerStatus.phase !== "captured") throw new Error("Finalize a gravação antes de processar a voz.");
    const strength = Number(options?.strength);
    const method = options?.method;
    if (!Number.isFinite(strength) || strength < 0 || strength > 1 || !["rnnoise", "spectral"].includes(method)) {
      throw new TypeError("Escolha uma intensidade e um método local válidos.");
    }
    return this.refreshVoicePreview(await this.worker.invoke("voice-local", { strength, method }));
  }

  async restoreOriginalVoice() {
    if (this.workerStatus.phase !== "captured") throw new Error("Finalize a gravação antes de trocar a voz.");
    return this.refreshVoicePreview(await this.worker.invoke("voice-original"));
  }

  async adjustVoiceSync(milliseconds) {
    if (this.workerStatus.phase !== "captured") throw new Error("Finalize a gravação antes de sincronizar a voz.");
    return this.refreshVoicePreview(await this.worker.invoke("voice-sync", { milliseconds }));
  }

  async transcribeVoice() {
    if (this.workerStatus.phase !== "captured") throw new Error("Finalize a gravação antes de transcrever.");
    const info = await this.worker.invoke("voice-info");
    if (info.durationSeconds > 120) throw new Error("A transcrição por API nesta versão aceita gravações de até 120 segundos.");
    const key = await this.secretStore.readKey();
    const audio = await this.worker.invoke("voice-api-audio");
    return { text: await transcribeOpenRouter(audio.path, key) };
  }

  async generateVoice({ text, referenceTranscript, referenceAuthorized } = {}) {
    if (this.workerStatus.phase !== "captured") throw new Error("Finalize a gravação antes de gerar uma voz.");
    const info = await this.worker.invoke("voice-info");
    if (info.durationSeconds > 120) throw new Error("O Seed Audio 1.0 aceita narrações de até 120 segundos por chamada.");
    if (referenceAuthorized !== true) throw new Error("Confirme a autorização para usar esta voz como referência.");
    const key = await this.secretStore.readKey();
    const referencePath = this.voiceReferencePath ?? (await this.worker.invoke("voice-reference-audio")).path;
    const outputPath = join(dirname(info.path), "voice-generated.mp3");
    await synthesizeSeedAudio({
      text, key, referencePath, referenceTranscript, outputPath,
    });
    const result = await this.worker.invoke("voice-replace", { path: outputPath });
    await this.refreshVoicePreview(result.status);
    return { state: this.publicState(), speedRatio: result.speedRatio };
  }

  hasPendingWork() {
    return ["starting", "recording", "pausing", "paused", "resuming", "stopping", "previewing", "captured", "rendering"]
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
        message: ["previewing", "rendering"].includes(this.workerStatus.phase)
          ? this.workerStatus.phase === "previewing"
            ? "A prévia do vídeo ainda está sendo preparada."
            : "O arquivo MP4 ainda está sendo finalizado."
          : ["starting", "recording", "pausing", "paused", "resuming", "stopping"].includes(this.workerStatus.phase)
            ? "Há uma gravação em andamento."
            : "Há uma gravação ainda não salva.",
        detail: ["previewing", "rendering"].includes(this.workerStatus.phase)
          ? "Encerrar agora pode preservar arquivos temporários para recuperação."
          : "Ao encerrar, a captura temporária será descartada.",
        buttons: ["Continuar no aplicativo", ["previewing", "rendering"].includes(this.workerStatus.phase) ? "Encerrar mesmo assim" : "Encerrar e descartar"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) return;

      try { await this.worker.invoke("cleanup"); } catch { /* melhor esforço */ }
      this.windows.hideCaptureOverlay();
      this.forceQuit = true;
      await this.worker.dispose();
      app.quit();
    } finally {
      if (!this.forceQuit) this.quittingPrompt = false;
    }
  }
}
