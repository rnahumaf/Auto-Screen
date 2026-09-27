import { app, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixedPortraitBytes, fixedPortraitJpeg } from "./photo-fixture.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagedArg = process.argv.indexOf("--packaged-resources");
const packagedResources = packagedArg >= 0 ? resolve(process.argv[packagedArg + 1]) : undefined;
const rendererRoot = packagedResources ? join(packagedResources, "app.asar") : desktopRoot;
const assetsRoot = packagedResources ? join(packagedResources, "auto-screen-assets") : resolve(desktopRoot, "..", "..", "assets");
const sampleArg = process.argv.indexOf("--sample-image");
if (sampleArg < 0 || !process.argv[sampleArg + 1]) throw new Error("Informe --sample-image com um retrato de teste.");
const samplePath = resolve(process.argv[sampleArg + 1]);
const previewArg = process.argv.indexOf("--preview-output");
const previewPath = previewArg >= 0 ? resolve(process.argv[previewArg + 1]) : undefined;
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: join(rendererRoot, "preload.cjs"), contextIsolation: true, nodeIntegration: false,
  } });
  try {
    await window.loadFile(join(rendererRoot, "renderer", "camera-filter.html"));
    const sample = await fixedPortraitBytes(samplePath);
    const dataUrl = `data:image/png;base64,${sample.toString("base64")}`;
    const jpegUrl = `data:image/jpeg;base64,${await fixedPortraitJpeg(samplePath)}`;
    const models = {
      person: pathToFileURL(join(assetsRoot, "models", "selfie-segmenter.tflite")).href,
      face: pathToFileURL(join(assetsRoot, "models", "face-landmarker.task")).href,
    };
    const result = await window.webContents.executeJavaScript(`(async () => {
      const { createCameraEffects } = await import("./camera-effects.js");
      const image = new Image();
      image.src = ${JSON.stringify(dataUrl)};
      await image.decode();
      const source = document.createElement("canvas");
      source.width = 500; source.height = 574;
      source.getContext("2d").drawImage(image, 0, 0, 498, 574, 0, 0, 500, 574);
      const output = document.createElement("canvas");
      output.width = source.width; output.height = source.height;
      const jpegImage = new Image(); jpegImage.src = ${JSON.stringify(jpegUrl)}; await jpegImage.decode();
      const jpegSource = document.createElement("canvas");
      jpegSource.width = jpegImage.naturalWidth; jpegSource.height = jpegImage.naturalHeight;
      jpegSource.getContext("2d").drawImage(jpegImage, 0, 0);
      const effects = await createCameraEffects({ backgroundBlur: 0, faceRetouch: 0,
        modelUrls: ${JSON.stringify(models)}, forceModel: true });
      const pixels = () => output.getContext("2d").getImageData(0, 0, output.width, output.height).data.slice();
      const diff = (first, second, bounds, width) => {
        let total = 0, count = 0;
        for (let y = bounds[1]; y < bounds[3]; y++) for (let x = bounds[0]; x < bounds[2]; x++) {
          const i = (y * width + x) * 4;
          total += Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]);
          count += 3;
        }
        return +(total / count).toFixed(2);
      };
      try {
        effects.draw(source, output, 1000);
        const original = pixels();
        effects.setStrengths({ backgroundBlur: 100, faceRetouch: 0 });
        const blurState = effects.draw(source, output, 1200);
        const blurred = pixels();
        effects.setStrengths({ backgroundBlur: 0, faceRetouch: 100 });
        const retouchState = effects.draw(source, output, 1400);
        const retouched = pixels();
        const preview = ${previewPath ? "output.toDataURL('image/png').split(',')[1]" : "undefined"};
        const bounds = { face: [175, 180, 300, 330], background: [15, 360, 95, 460],
          cheek: [175, 245, 205, 300], eye: [167, 181, 185, 197], mouth: [225, 295, 280, 320] };
        const metrics = { blurState, retouchState,
          blur: Object.fromEntries(Object.entries(bounds).map(([key, rect]) => [key, diff(original, blurred, rect, 500)])),
          retouch: Object.fromEntries(Object.entries(bounds).map(([key, rect]) => [key, diff(original, retouched, rect, 500)])) };
        const empty = document.createElement("canvas"); empty.width = 500; empty.height = 574;
        empty.getContext("2d").fillRect(0, 0, 500, 574);
        effects.setStrengths({ backgroundBlur: 100, faceRetouch: 100 });
        metrics.empty = effects.draw(empty, output, 1600);
        const small = document.createElement("canvas"); small.width = 320; small.height = 368;
        small.getContext("2d").drawImage(source, 0, 0, 320, 368);
        metrics.small = effects.draw(small, output, 1800);
        const jpegEffects = await createCameraEffects({ backgroundBlur: 50, faceRetouch: 50,
          modelUrls: ${JSON.stringify(models)}, forceModel: true });
        try {
          const jpegOutput = document.createElement("canvas");
          for (let frame = 0; frame < 8; frame++) jpegEffects.draw(jpegSource, jpegOutput, 2000 + frame * 120);
          jpegEffects.setStrengths({ backgroundBlur: 70, faceRetouch: 30 });
          for (let frame = 0; frame < 3; frame++) jpegEffects.draw(jpegSource, jpegOutput, 3000 + frame * 120);
          jpegEffects.setStrengths({ backgroundBlur: 100, faceRetouch: 0 });
          metrics.jpeg = jpegEffects.draw(jpegSource, jpegOutput, 4000);
          const raw = jpegSource.getContext("2d").getImageData(0, 0, 640, 738).data;
          const filtered = jpegOutput.getContext("2d").getImageData(0, 0, 640, 738).data;
          metrics.jpegDiff = { face: diff(raw, filtered, [300, 300, 400, 400], 640),
            background: diff(raw, filtered, [20, 470, 130, 610], 640) };
        } finally { jpegEffects.close(); }
        return { metrics, preview };
      } finally { effects.close(); }
    })()`);
    if (!result.metrics.blurState.backgroundApplied || !result.metrics.retouchState.faceRetouchApplied) {
      throw new Error("Os filtros não reconheceram a pessoa e o rosto no retrato de teste.");
    }
    if (result.metrics.empty.backgroundApplied || result.metrics.empty.faceRetouchApplied) {
      throw new Error("Os filtros foram aplicados a uma imagem sem pessoa.");
    }
    if (!result.metrics.small.backgroundApplied || !result.metrics.small.faceRetouchApplied) {
      throw new Error("Os filtros falharam na imagem reduzida da prévia de gravação.");
    }
    if (result.metrics.blur.background < 2.5 || result.metrics.blur.face > 0.5) {
      throw new Error("O desfoque não separou o fundo do rosto no retrato de teste.");
    }
    if (result.metrics.retouch.face < 1 || result.metrics.retouch.background > 0.5
      || result.metrics.retouch.eye > 0.5 || result.metrics.retouch.mouth > 0.5) {
      throw new Error("O retoque não alterou a pele de modo visível ou afetou olhos, boca ou fundo.");
    }
    if (!result.metrics.jpeg.backgroundApplied || result.metrics.jpegDiff.face > 0.5
      || result.metrics.jpegDiff.background < 2.5) {
      throw new Error("O desfoque falhou nos quadros JPEG usados pela prévia da webcam.");
    }
    if (previewPath && result.preview) await writeFile(previewPath, Buffer.from(result.preview, "base64"));
    process.stdout.write(`Qualidade da webcam: ${JSON.stringify(result.metrics)}\n`);
  } finally {
    window.destroy();
    app.quit();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  app.exit(1);
});
