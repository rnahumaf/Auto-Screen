import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

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
    this.selectorRequest = undefined;
  }

  rendererFile(name) {
    return join(this.baseDirectory, "renderer", name);
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
