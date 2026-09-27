import { app, Menu, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopController } from "./controller.js";
import { WindowManager } from "./window-manager.js";
import { NodeWorkerClient } from "./worker-client.js";
import { SettingsStore } from "./settings.js";
import { SecretStore } from "./secret-store.js";

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = app.isPackaged ? process.resourcesPath : join(baseDirectory, "..", "..");
process.env.AUTO_SCREEN_ASSETS_DIR = app.isPackaged
  ? join(process.resourcesPath, "auto-screen-assets")
  : join(projectRoot, "assets");
process.chdir(projectRoot);

const windows = new WindowManager(baseDirectory, join(baseDirectory, "preload.cjs"));
const worker = new NodeWorkerClient(projectRoot, join(baseDirectory, "worker.js"));
const controller = new DesktopController(windows, worker);

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await handler(event, ...args) };
    } catch (error) {
      controller.setError(error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function registerIpc() {
  registerHandler("app:get-state", async () => controller.publicState());
  registerHandler("app:bootstrap", async () => await controller.bootstrap());
  registerHandler("app:refresh-doctor", async () => await controller.refreshDoctor());
  registerHandler("app:list-displays", async () => await controller.refreshDisplays());
  registerHandler("app:list-windows", async () => await controller.refreshWindows());
  registerHandler("app:list-webcams", async () => await controller.refreshWebcams());
  registerHandler("app:list-microphones", async () => await controller.refreshMicrophones());
  registerHandler("app:preview-camera", async (_event, deviceId) => await controller.previewCamera(deviceId));
  registerHandler("app:stop-camera-preview", async () => await controller.stopCameraPreview());
  registerHandler("app:select-display", async (_event, index) => await controller.selectDisplay(index));
  registerHandler("app:select-window", async (_event, handle) => await controller.selectWindow(handle));
  registerHandler("app:select-region", async () => await controller.selectRegion());
  registerHandler("app:update-settings", async (_event, patch) => await controller.updateSettings(patch));
  registerHandler("app:choose-output-directory", async () => await controller.chooseOutputDirectory());
  registerHandler("recording:start", async (_event, options) => await controller.startRecording(options));
  registerHandler("recording:pause-resume", async () => await controller.pauseOrResume());
  registerHandler("recording:stop", async () => await controller.stopRecording());
  registerHandler("recording:retry-preview", async () => await controller.retryPreview());
  registerHandler("recording:save", async () => await controller.saveRecording());
  registerHandler("recording:discard", async () => await controller.discardRecording());
  registerHandler("recording:open-output", async () => controller.openOutput());
  registerHandler("voice:store-key", async (_event, value) => await controller.storeOpenRouterKey(value));
  registerHandler("voice:remove-key", async () => await controller.removeOpenRouterKey());
  registerHandler("voice:choose-reference", async () => await controller.chooseVoiceReference());
  registerHandler("voice:recorded-reference", async () => controller.resetVoiceReference());
  registerHandler("voice:process-local", async (_event, options) => await controller.processVoiceLocal(options));
  registerHandler("voice:original", async () => await controller.restoreOriginalVoice());
  registerHandler("voice:sync", async (_event, milliseconds) => await controller.adjustVoiceSync(milliseconds));
  registerHandler("voice:transcribe", async () => await controller.transcribeVoice());
  registerHandler("voice:generate", async (_event, options) => await controller.generateVoice(options));
  registerHandler("webcam-effects:apply", async (_event, options) => await controller.applyWebcamFilters(options));
  registerHandler("webcam-effects:chunk", async (event, token, bytes) => await windows.appendWebcamEffectsChunk(event.sender, token, bytes));
  registerHandler("webcam-effects:complete", async (event, token, error) => await windows.completeWebcamEffects(event.sender, token, error));
  ipcMain.on("region:confirm", (event, value) => windows.confirmRegion(event.sender, value));
  ipcMain.on("region:cancel", (event) => windows.cancelRegion(event.sender));
  ipcMain.on("overlay:camera-state", (event, state) => {
    if (event.sender !== windows.captureOverlay?.webContents) return;
    if (state?.ok === false) controller.setError(new Error(`Prévia da webcam indisponível: ${String(state.error).slice(0, 500)}`));
  });
}

app.on("before-quit", (event) => {
  if (controller.forceQuit || !controller.hasPendingWork()) return;
  event.preventDefault();
  void controller.confirmQuit();
});
app.on("will-quit", () => { controller.cameraPreviewSession?.abort(); });

app.whenReady().then(async () => {
  if (process.platform !== "win32") {
    void dialog.showMessageBox({
      type: "error",
      title: "Auto-Screen",
      message: "A interface humana do Auto-Screen funciona somente no Windows.",
    }).finally(() => app.quit());
    return;
  }
  app.setAppUserModelId("com.rnaf.auto-screen");
  controller.settingsStore = new SettingsStore(join(app.getPath("userData"), "settings.json"), app.getPath("videos"));
  controller.secretStore = new SecretStore(join(app.getPath("userData"), "openrouter-key.bin"));
  try { await controller.settingsStore.load(); }
  catch (error) { controller.setError(error); }
  try { controller.apiKeySaved = await controller.secretStore.hasKey(); }
  catch (error) { controller.setError(error); }
  Menu.setApplicationMenu(null);
  registerIpc();
  windows.createMainWindow((event) => {
    if (controller.forceQuit) return;
    event.preventDefault();
    void controller.confirmQuit();
  });
});

app.on("window-all-closed", () => {
  if (!controller.forceQuit) void controller.confirmQuit();
});
