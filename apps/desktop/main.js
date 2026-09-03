import { app, Menu, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopController } from "./controller.js";
import { WindowManager } from "./window-manager.js";
import { NodeWorkerClient } from "./worker-client.js";

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(baseDirectory, "..", "..");
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
  registerHandler("app:select-display", async (_event, index) => await controller.selectDisplay(index));
  registerHandler("app:select-window", async (_event, handle) => await controller.selectWindow(handle));
  registerHandler("app:select-region", async () => await controller.selectRegion());
  registerHandler("recording:start", async (_event, options) => await controller.startRecording(options));
  registerHandler("recording:pause-resume", async () => await controller.pauseOrResume());
  registerHandler("recording:stop", async () => await controller.stopRecording());
  registerHandler("recording:save", async () => await controller.saveRecording());
  registerHandler("recording:discard", async () => await controller.discardRecording());
  registerHandler("recording:open-output", async () => controller.openOutput());
  ipcMain.on("region:confirm", (event, value) => windows.confirmRegion(event.sender, value));
  ipcMain.on("region:cancel", (event) => windows.cancelRegion(event.sender));
}

app.on("before-quit", (event) => {
  if (controller.forceQuit || !controller.hasPendingWork()) return;
  event.preventDefault();
  void controller.confirmQuit();
});

app.whenReady().then(() => {
  if (process.platform !== "win32") {
    void dialog.showMessageBox({
      type: "error",
      title: "Auto-Screen",
      message: "A interface humana do Auto-Screen funciona somente no Windows.",
    }).finally(() => app.quit());
    return;
  }
  app.setAppUserModelId("com.rnaf.auto-screen");
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
