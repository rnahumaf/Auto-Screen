import { app, ipcMain, screen } from "electron";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WindowManager } from "../window-manager.js";
import { WebcamPreviewSession, listWebcams } from "../webcam.js";
import { defaultSettings } from "../settings.js";
import { fixedPortraitJpeg } from "./photo-fixture.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagedArg = process.argv.indexOf("--packaged-resources");
const packagedResources = packagedArg >= 0 ? resolve(process.argv[packagedArg + 1]) : undefined;
const rendererRoot = packagedResources ? join(packagedResources, "app.asar") : desktopRoot;
const fixtureArg = process.argv.indexOf("--fixture-image");
const fixtureImage = fixtureArg >= 0 ? resolve(process.argv[fixtureArg + 1]) : undefined;
const screenshotArg = process.argv.indexOf("--screenshot-output");
const screenshotOutput = screenshotArg >= 0 ? resolve(process.argv[screenshotArg + 1]) : undefined;
process.env.AUTO_SCREEN_ASSETS_DIR = packagedResources
  ? join(packagedResources, "auto-screen-assets")
  : resolve(desktopRoot, "..", "..", "assets");
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  const cameras = fixtureImage ? [{ id: "fixture", name: "Imagem de teste" }] : await listWebcams();
  if (cameras.length === 0) throw new Error("Não foi encontrada webcam para testar a prévia anterior à gravação.");
  const fixtureFrame = fixtureImage ? await fixedPortraitJpeg(fixtureImage) : undefined;
  const windows = new WindowManager(rendererRoot, join(rendererRoot, "preload.cjs"));
  let session;
  const display = screen.getPrimaryDisplay();
  const bounds = screen.dipToScreenRect(null, display.bounds);
  const settings = defaultSettings("C:\\Auto-Screen-Teste");
  settings.webcam.enabled = true;
  settings.webcam.deviceId = cameras[0].id;
  settings.webcam.backgroundBlur = 50;
  settings.webcam.faceRetouch = 50;
  const state = {
    phase: "idle", elapsedSeconds: 0,
    source: { mode: "display", label: "Tela de teste", detail: "", displayIndex: 0, bounds },
    settings, doctor: { ok: true, checks: [] },
    webcam: { hasWebcam: false }, voice: { hasMicrophone: false, apiKeySaved: false },
    audioWarnings: [], project: null, previewUrl: null, lastSavedPath: null,
  };
  ipcMain.handle("app:bootstrap", async () => ({ ok: true, value: {
    state, displays: [{ index: 0, primary: true, rect: bounds, deviceName: "Fixture" }],
    windows: [], webcams: cameras, microphones: [], cameraModelUrls: windows.cameraModelUrls(),
  } }));
  ipcMain.handle("app:preview-camera", async (_event, deviceId) => {
    if (fixtureFrame) {
      const timer = setInterval(() => windows.sendSetupCameraFrame({ jpeg: fixtureFrame, at: Date.now() }), 120);
      session = { stop: async () => clearInterval(timer) };
      return { ok: true, value: true };
    }
    session = new WebcamPreviewSession({
      deviceId,
      onFrame: (frame) => windows.sendSetupCameraFrame(frame),
    });
    await session.start();
    return { ok: true, value: true };
  });
  ipcMain.handle("app:stop-camera-preview", async () => {
    await session?.stop();
    session = undefined;
    return { ok: true, value: true };
  });
  const window = windows.createMainWindow(() => {});
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      window.webContents.once("did-finish-load", resolvePromise);
      window.webContents.once("did-fail-load", (_event, code, description) => rejectPromise(new Error(`A interface não abriu: ${code} ${description}`)));
    });
    let ready = false;
    let lastValue;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const value = await window.webContents.executeJavaScript(`({
        status: document.querySelector("#setupCameraStatus")?.textContent,
        width: document.querySelector("#setupCameraImage")?.naturalWidth,
        canvas: document.querySelector("#setupCameraCanvas")?.width
      })`);
      lastValue = value;
      if (value.width > 0 && value.canvas > 0 && value.status?.includes("com filtros locais")) { ready = true; break; }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (!ready) throw new Error(`A imagem ao vivo com filtros locais não ficou pronta em 30 segundos: ${JSON.stringify(lastValue)}`);
    const values = await window.webContents.executeJavaScript(`(() => {
      const blur = document.querySelector("#webcamBackgroundBlur");
      const face = document.querySelector("#webcamFaceRetouch");
      blur.value = "70";
      face.value = "30";
      blur.dispatchEvent(new Event("input", { bubbles: true }));
      face.dispatchEvent(new Event("input", { bubbles: true }));
      return [document.querySelector("#webcamBackgroundBlurValue").textContent,
        document.querySelector("#webcamFaceRetouchValue").textContent];
    })()`);
    if (values[0] !== "70%" || values[1] !== "30%") throw new Error("Os ajustes da prévia não responderam em tempo real.");
    if (fixtureFrame) {
      await window.webContents.executeJavaScript(`(() => {
        const blur = document.querySelector("#webcamBackgroundBlur");
        const face = document.querySelector("#webcamFaceRetouch");
        blur.value = "100"; face.value = "0";
        blur.dispatchEvent(new Event("input", { bubbles: true }));
        face.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
      const quality = await window.webContents.executeJavaScript(`(() => {
        const image = document.querySelector("#setupCameraImage");
        const filtered = document.querySelector("#setupCameraCanvas");
        const original = document.createElement("canvas");
        original.width = filtered.width; original.height = filtered.height;
        original.getContext("2d").drawImage(image, 0, 0, original.width, original.height);
        const source = original.getContext("2d").getImageData(0, 0, original.width, original.height).data;
        const output = filtered.getContext("2d").getImageData(0, 0, filtered.width, filtered.height).data;
        const diff = ([left, top, right, bottom]) => {
          let sum = 0, count = 0;
          for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            const index = (y * filtered.width + x) * 4;
            for (let channel = 0; channel < 3; channel++) sum += Math.abs(source[index + channel] - output[index + channel]);
            count += 3;
          }
          return +(sum / count).toFixed(2);
        };
        return { size: [filtered.width, filtered.height], source: [image.naturalWidth, image.naturalHeight],
          status: document.querySelector("#setupCameraStatus").textContent,
          face: diff([300, 300, 400, 400]),
          background: diff([20, 470, 130, 610]) };
      })()`);
      if (quality.face > 0.5 || quality.background < 0.5) {
        if (screenshotOutput) {
          const filteredImage = await window.webContents.executeJavaScript(`document.querySelector("#setupCameraCanvas").toDataURL("image/png").split(",")[1]`);
          await writeFile(`${screenshotOutput}.canvas.png`, Buffer.from(filteredImage, "base64"));
          await window.webContents.executeJavaScript(`document.querySelector("#setupCameraCanvas").scrollIntoView({ block: "center" })`);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
          await writeFile(screenshotOutput, (await window.webContents.capturePage()).toPNG());
        }
        throw new Error(`O desfoque da prévia afetou o rosto ou não alterou o fundo: ${JSON.stringify(quality)}`);
      }
      await window.webContents.executeJavaScript(`(() => {
        const blur = document.querySelector("#webcamBackgroundBlur");
        const face = document.querySelector("#webcamFaceRetouch");
        blur.value = "70"; face.value = "30";
        blur.dispatchEvent(new Event("input", { bubbles: true }));
        face.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
      const comparison = await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector("#compareCameraOriginal");
        const canvas = document.querySelector("#setupCameraCanvas");
        const before = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.slice();
        button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        const originalStatus = document.querySelector("#setupCameraStatus").textContent;
        const after = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let different = 0;
        for (let index = 0; index < Math.min(before.length, after.length); index += 4) {
          if (Math.abs(before[index] - after[index]) > 2) different++;
        }
        button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        return { originalStatus, restoredStatus: document.querySelector("#setupCameraStatus").textContent, different };
      })()`);
      if (!comparison.originalStatus.includes("original") || !comparison.restoredStatus.includes("com filtros locais") || comparison.different < 100) {
        throw new Error(`A comparação entre imagem original e filtros falhou: ${JSON.stringify(comparison)}`);
      }
    }
    if (fixtureFrame && screenshotOutput) {
      await window.webContents.executeJavaScript(`document.querySelector("#setupCameraCanvas").scrollIntoView({ block: "center" })`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      await writeFile(screenshotOutput, (await window.webContents.capturePage()).toPNG());
    }
    process.stdout.write("Prévia antes da gravação: imagem ao vivo, filtros locais e ajustes imediatos aprovados.\n");
  } finally {
    await session?.stop().catch(() => undefined);
    if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  app.exit(1);
});
