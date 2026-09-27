import { app, ipcMain, screen } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WindowManager } from "../window-manager.js";
import { WebcamRecorderSession, listWebcams } from "../webcam.js";
import { fixedPortraitJpeg } from "./photo-fixture.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagedArg = process.argv.indexOf("--packaged-resources");
const packagedResources = packagedArg >= 0 ? resolve(process.argv[packagedArg + 1]) : undefined;
const rendererRoot = packagedResources ? join(packagedResources, "app.asar") : desktopRoot;
const fixtureArg = process.argv.indexOf("--fixture-image");
const fixtureImage = fixtureArg >= 0 ? resolve(process.argv[fixtureArg + 1]) : undefined;
process.env.AUTO_SCREEN_ASSETS_DIR = packagedResources
  ? join(packagedResources, "auto-screen-assets")
  : resolve(desktopRoot, "..", "..", "assets");
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  const cameras = fixtureImage ? [{ id: "fixture", name: "Imagem de teste" }] : await listWebcams();
  if (cameras.length === 0) throw new Error("Não foi encontrada webcam para o teste ao vivo.");
  const windows = new WindowManager(rendererRoot, join(rendererRoot, "preload.cjs"));
  const recorder = fixtureImage ? undefined : new WebcamRecorderSession({ deviceId: cameras[0].id });
  const fixtureFrame = fixtureImage ? await fixedPortraitJpeg(fixtureImage) : undefined;
  let frameTimer;
  try {
    await recorder?.start();
    const display = screen.getPrimaryDisplay();
    const bounds = screen.dipToScreenRect(null, {
      x: display.bounds.x + 20, y: display.bounds.y + 20,
      width: Math.min(640, display.bounds.width - 40), height: Math.min(480, display.bounds.height - 40),
    });
    const state = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("A prévia da webcam não respondeu em 20 segundos.")), 20_000);
      ipcMain.once("overlay:camera-state", (event, value) => {
        clearTimeout(timer);
        if (event.sender !== windows.captureOverlay?.webContents) rejectPromise(new Error("Estado da prévia veio de outra janela."));
        else if (value?.ok) resolvePromise(value);
        else rejectPromise(new Error(`A prévia falhou: ${value?.error ?? "erro desconhecido"}`));
      });
    });
    await windows.showCaptureOverlay(bounds, {
      name: cameras[0].name, size: "medium", shape: "circle", border: "color",
      borderColor: "#3560C9", position: "bottom-right", backgroundBlur: 50, faceRetouch: 50,
    });
    frameTimer = setInterval(() => windows.sendCameraFrame(fixtureFrame
      ? { jpeg: fixtureFrame, at: Date.now() } : recorder.previewFrame), 120);
    await state;
    process.stdout.write(fixtureFrame
      ? "Prévia da sobreposição e modelos visuais aprovados com retrato fixado.\n"
      : "Prévia ao vivo, modelos visuais e gravação simultânea da webcam aprovados.\n");
  } finally {
    if (frameTimer) clearInterval(frameTimer);
    windows.hideCaptureOverlay();
    await recorder?.stop().catch(() => undefined);
    await recorder?.cleanup();
    app.quit();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  app.exit(1);
});
