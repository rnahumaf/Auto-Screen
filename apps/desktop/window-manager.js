import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";

const MIN_REGION_WIDTH = 160;
const MIN_REGION_HEIGHT = 90;
const TOOLBAR_WIDTH = 356;
const TOOLBAR_HEIGHT = 76;

export class WindowManager {
  constructor(baseDirectory, preloadPath) {
    this.baseDirectory = baseDirectory;
    this.preloadPath = preloadPath;
    this.mainWindow = undefined;
    this.toolbarWindow = undefined;
    this.captureOverlay = undefined;
    this.lastOverlayFrameAt = 0;
    this.lastSetupFrameAt = 0;
    this.effectsJob = undefined;
    this.selectorRequest = undefined;
  }

  rendererFile(name) {
    return join(this.baseDirectory, "renderer", name);
  }

  cameraModelUrls() {
    const root = process.env.AUTO_SCREEN_ASSETS_DIR;
    if (!root) throw new Error("Os modelos visuais da webcam não foram encontrados.");
    return {
      person: pathToFileURL(join(root, "models", "selfie-segmenter.tflite")).href,
      face: pathToFileURL(join(root, "models", "face-landmarker.task")).href,
    };
  }

  createMainWindow(onClose) {
    const window = new BrowserWindow({
      width: 900,
      height: 760,
      minWidth: 760,
      minHeight: 640,
      show: false,
      backgroundColor: "#f4f6f8",
      title: "Auto-Screen",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.mainWindow = window;
    window.setContentProtection(true);
    void window.loadFile(this.rendererFile("index.html"));
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => onClose(event));
    window.on("closed", () => {
      if (this.mainWindow === window) this.mainWindow = undefined;
    });
    return window;
  }

  displayForPhysicalBounds(selectionBounds) {
    if (!selectionBounds) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const dipBounds = screen.screenToDipRect(null, selectionBounds);
    return screen.getDisplayMatching(dipBounds);
  }

  toolbarBounds(selectionBounds) {
    const display = this.displayForPhysicalBounds(selectionBounds);
    return {
      x: Math.round(display.workArea.x + display.workArea.width - TOOLBAR_WIDTH - 16),
      y: Math.round(display.workArea.y + 16),
      width: TOOLBAR_WIDTH,
      height: TOOLBAR_HEIGHT,
    };
  }

  async ensureToolbar(selectionBounds) {
    const bounds = this.toolbarBounds(selectionBounds);
    if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
      this.toolbarWindow.setBounds(bounds);
      return this.toolbarWindow;
    }

    const window = new BrowserWindow({
      ...bounds,
      minWidth: TOOLBAR_WIDTH,
      minHeight: TOOLBAR_HEIGHT,
      maxWidth: TOOLBAR_WIDTH,
      maxHeight: TOOLBAR_HEIGHT,
      show: false,
      frame: false,
      thickFrame: false,
      transparent: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#111827",
      title: "Controles de gravação do Auto-Screen",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.toolbarWindow = window;
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, "screen-saver");
    window.on("closed", () => {
      if (this.toolbarWindow === window) this.toolbarWindow = undefined;
    });
    await window.loadFile(this.rendererFile("toolbar.html"));
    return window;
  }

  sendState(payload) {
    for (const window of [this.mainWindow, this.toolbarWindow]) {
      if (window && !window.isDestroyed()) {
        window.webContents.send("recording:state", payload);
      }
    }
  }

  sendSetupCameraFrame(frame) {
    const window = this.mainWindow;
    if (!window || window.isDestroyed() || !window.isVisible() || !frame?.jpeg || frame.at <= this.lastSetupFrameAt) return;
    this.lastSetupFrameAt = frame.at;
    window.webContents.send("setup-camera:frame", frame.jpeg);
  }

  hideMain() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.hide();
  }

  showMain() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  hideToolbar() {
    if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) this.toolbarWindow.hide();
  }

  async showCaptureOverlay(selectionBounds, webcam) {
    this.hideCaptureOverlay();
    const bounds = screen.screenToDipRect(null, selectionBounds);
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      thickFrame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      backgroundColor: "#00000000",
      title: "Indicador de gravação do Auto-Screen",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.captureOverlay = window;
    this.lastOverlayFrameAt = 0;
    window.setContentProtection(true);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setAlwaysOnTop(true, "screen-saver");
    window.on("closed", () => {
      if (this.captureOverlay === window) this.captureOverlay = undefined;
    });
    await window.loadFile(this.rendererFile("capture-overlay.html"));
    window.webContents.send("overlay:configure", {
      webcam,
      ...(webcam?.backgroundBlur || webcam?.faceRetouch ? { modelUrls: this.cameraModelUrls() } : {}),
    });
    window.showInactive();
    return window;
  }

  setCaptureOverlayPaused(paused) {
    const window = this.captureOverlay;
    if (window && !window.isDestroyed()) window.webContents.send("overlay:paused", paused);
  }

  sendCameraFrame(frame) {
    const window = this.captureOverlay;
    if (!window || window.isDestroyed() || !frame?.jpeg || frame.at <= this.lastOverlayFrameAt) return;
    this.lastOverlayFrameAt = frame.at;
    window.webContents.send("overlay:frame", frame.jpeg);
  }

  hideCaptureOverlay() {
    const window = this.captureOverlay;
    this.captureOverlay = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }

  async appendWebcamEffectsChunk(sender, token, bytes) {
    const job = this.effectsJob;
    if (!job || sender !== job.window.webContents || token !== job.token || !(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 8_000_000) {
      throw new Error("Trecho do filtro da webcam inválido.");
    }
    await job.file.writeFile(bytes);
    job.bytes += bytes.length;
    return true;
  }

  async completeWebcamEffects(sender, token, error) {
    const job = this.effectsJob;
    if (!job || sender !== job.window.webContents || token !== job.token) throw new Error("Processamento da webcam inválido.");
    if (error) job.reject(new Error(`Falha no filtro da webcam: ${String(error).slice(0, 1_000)}`));
    else if (job.bytes === 0) job.reject(new Error("O filtro da webcam não produziu vídeo."));
    else job.resolve();
    return true;
  }

  async processWebcamSegment(source, filters) {
    if (this.effectsJob) throw new Error("Já existe um filtro da webcam em andamento.");
    const window = new BrowserWindow({
      width: 640, height: 360, show: false, skipTaskbar: true,
      backgroundColor: "#111111",
      webPreferences: {
        preload: this.preloadPath, contextIsolation: true, nodeIntegration: false,
        sandbox: true, backgroundThrottling: false,
      },
    });
    window.setContentProtection(true);
    const file = await open(source.output, "w");
    let timeout;
    let done = false;
    let failed = false;
    const completed = new Promise((resolvePromise, rejectPromise) => {
      this.effectsJob = {
        window, file, token: randomUUID(), bytes: 0,
        resolve: () => { if (!done) { done = true; resolvePromise(); } },
        reject: (error) => { if (!done) { done = true; rejectPromise(error); } },
      };
    });
    window.on("closed", () => this.effectsJob?.window === window && this.effectsJob.reject(new Error("A janela do filtro da webcam foi encerrada.")));
    try {
      await window.loadFile(this.rendererFile("camera-filter.html"));
      const job = this.effectsJob;
      window.webContents.send("webcam-effects:configure", {
        token: job.token,
        sourceUrl: pathToFileURL(source.input).href,
        filters,
        modelUrls: this.cameraModelUrls(),
      });
      timeout = setTimeout(() => job.reject(new Error("O processamento da webcam excedeu o tempo esperado.")), Math.max(90_000, (source.durationSeconds * 2 + 60) * 1_000));
      await completed;
      return source.output;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      clearTimeout(timeout);
      this.effectsJob = undefined;
      await file.close();
      if (!window.isDestroyed()) window.destroy();
      if (failed) await rm(source.output, { force: true });
    }
  }

  async chooseRegion() {
    if (this.selectorRequest) throw new Error("Já existe uma seleção de área em andamento.");
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      thickFrame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      title: "Selecionar área de gravação",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setContentProtection(true);
    this.hideMain();

    const resultPromise = new Promise((resolvePromise) => {
      this.selectorRequest = { window, display, resolve: resolvePromise };
    });
    window.on("closed", () => {
      if (this.selectorRequest?.window === window) this.closeSelector(null);
    });

    try {
      await window.loadFile(this.rendererFile("region.html"));
      window.show();
      window.focus();
      return await resultPromise;
    } catch (error) {
      this.closeSelector(null);
      throw error;
    }
  }

  confirmRegion(sender, value) {
    const request = this.selectorRequest;
    if (!request || sender !== request.window.webContents) return;
    const local = this.normalizeLocalRect(value, request.display);
    const absoluteDipRect = {
      x: request.display.bounds.x + local.x,
      y: request.display.bounds.y + local.y,
      width: local.width,
      height: local.height,
    };
    this.closeSelector(screen.dipToScreenRect(null, absoluteDipRect));
  }

  cancelRegion(sender) {
    const request = this.selectorRequest;
    if (!request || sender !== request.window.webContents) return;
    this.closeSelector(null);
  }

  normalizeLocalRect(value, display) {
    const raw = value && typeof value === "object" ? value : {};
    const width = Math.min(
      display.bounds.width,
      Math.max(MIN_REGION_WIDTH, Math.round(Number(raw.width) || MIN_REGION_WIDTH)),
    );
    const height = Math.min(
      display.bounds.height,
      Math.max(MIN_REGION_HEIGHT, Math.round(Number(raw.height) || MIN_REGION_HEIGHT)),
    );
    return {
      x: Math.min(display.bounds.width - width, Math.max(0, Math.round(Number(raw.x) || 0))),
      y: Math.min(display.bounds.height - height, Math.max(0, Math.round(Number(raw.y) || 0))),
      width,
      height,
    };
  }

  closeSelector(result) {
    const request = this.selectorRequest;
    this.selectorRequest = undefined;
    if (!request) return;
    if (!request.window.isDestroyed()) request.window.destroy();
    this.showMain();
    request.resolve(result);
  }
}
