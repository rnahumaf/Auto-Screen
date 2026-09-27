import { app } from "electron";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WindowManager } from "../window-manager.js";
import { probeMedia } from "../runtime/index.js";
import { applyWebcamEffects, prepareWebcamEffects } from "../webcam-effects.js";
import { SecretStore } from "../secret-store.js";
import { WebcamRecorderSession, listWebcams } from "../webcam.js";
import { listMicrophones } from "../microphone.js";
import { fixedPortraitBytes } from "./photo-fixture.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(desktopRoot, "..", "..");
const packagedArg = process.argv.indexOf("--packaged-resources");
const packagedResources = packagedArg >= 0 ? resolve(process.argv[packagedArg + 1]) : undefined;
const sampleArg = process.argv.indexOf("--sample-image");
const sampleImage = sampleArg >= 0 ? resolve(process.argv[sampleArg + 1]) : undefined;
const rendererRoot = packagedResources ? join(packagedResources, "app.asar") : desktopRoot;
process.env.AUTO_SCREEN_ASSETS_DIR = packagedResources
  ? join(packagedResources, "auto-screen-assets")
  : join(projectRoot, "assets");
app.on("window-all-closed", () => {});

function fixture(output) {
  return new Promise((resolvePromise, rejectPromise) => {
    const input = sampleImage
      ? ["-loop", "1", "-framerate", "30", "-i", sampleImage, "-vf", "crop=498:574:0:0,scale=500:574"]
      : ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"];
    const child = spawn("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", ...input,
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", output,
    ], { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`FFmpeg retornou ${code}.`)));
  });
}

async function main() {
  await app.whenReady();
  if (sampleImage) await fixedPortraitBytes(sampleImage);
  const directory = await mkdtemp(join(tmpdir(), "auto-screen-effects-"));
  try {
  const input = join(directory, "source.mkv");
  await fixture(input);
  process.stdout.write(sampleImage ? "Vídeo do retrato fixado pronto.\n" : "Vídeo sintético pronto.\n");
  const project = {
    workDirectory: directory,
    webcam: {
      layout: { backgroundBlur: 50, faceRetouch: 50 },
      segments: [{ path: input, startOffsetSeconds: 0, durationSeconds: 2 }],
    },
  };
  const [source] = await prepareWebcamEffects(project);
  const manager = new WindowManager(rendererRoot, join(rendererRoot, "preload.cjs"));
  process.stdout.write("Abrindo processamento da webcam.\n");
  const ipc = await import("electron");
  ipc.ipcMain.handle("webcam-effects:chunk", (event, token, bytes) => manager.appendWebcamEffectsChunk(event.sender, token, bytes).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error: error.message })));
  ipc.ipcMain.handle("webcam-effects:complete", (event, token, error) => manager.completeWebcamEffects(event.sender, token, error).then((value) => ({ ok: true, value }), (cause) => ({ ok: false, error: cause.message })));
  await manager.processWebcamSegment(source, { backgroundBlur: 50, faceRetouch: 50 });
  await applyWebcamEffects(project, [source.output]);
  const probe = await probeMedia(project.webcam.segments[0].path);
  if (probe.durationSeconds < 1 || !probe.streams.some((stream) => stream.codecType === "video")) {
    throw new Error("O filtro não produziu um vídeo válido.");
  }
  project.webcam.segments[0].path = input;
  project.webcam.layout.backgroundBlur = 100;
  project.webcam.layout.faceRetouch = 0;
  const [reprocessedSource] = await prepareWebcamEffects(project);
  await manager.processWebcamSegment(reprocessedSource, { backgroundBlur: 100, faceRetouch: 0 });
  await applyWebcamEffects(project, [reprocessedSource.output]);
  const reprocessed = await probeMedia(project.webcam.segments[0].path);
  if (reprocessed.durationSeconds < 1 || !reprocessed.streams.some((stream) => stream.codecType === "video")) {
    throw new Error("A reaplicação do filtro não produziu vídeo válido.");
  }
  const secret = new SecretStore(join(directory, "test-key.bin"));
  await secret.saveKey("synthetic-test-key-1234567890");
  if (await secret.readKey() !== "synthetic-test-key-1234567890") {
    throw new Error("A chave de teste não foi recuperada pela proteção do Windows.");
  }
  await secret.removeKey();
  if (process.argv.includes("--allow-webcam") && process.argv.includes("--allow-microphone")) {
    const [webcam] = await listWebcams();
    const [microphone] = await listMicrophones();
    if (!webcam || !microphone) throw new Error("Webcam ou microfone indisponível para o teste de filtros.");
    const paired = new WebcamRecorderSession({ deviceId: webcam.id, microphoneDeviceId: microphone.id });
    try {
      await paired.start();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
      const captured = await paired.stop();
      if (!captured.microphone?.path) throw new Error("A captura conjunta não produziu microfone.");
      const realProject = {
        workDirectory: directory,
        webcam: {
          layout: { backgroundBlur: 50, faceRetouch: 50 },
          segments: [{ path: captured.path, startOffsetSeconds: 0, durationSeconds: captured.durationSeconds }],
        },
      };
      const [realSource] = await prepareWebcamEffects(realProject);
      await manager.processWebcamSegment(realSource, realProject.webcam.layout);
      await applyWebcamEffects(realProject, [realSource.output]);
      const filtered = await probeMedia(realProject.webcam.segments[0].path);
      if (filtered.durationSeconds <= 0 || !filtered.streams.some((stream) => stream.codecType === "video")) {
        throw new Error("O filtro não processou a captura conjunta da webcam e do microfone.");
      }
      process.stdout.write("Captura conjunta real processada pelos filtros locais.\n");
    } finally {
      await paired.cleanup();
    }
  }
  process.stdout.write(`Filtro de webcam: ${probe.durationSeconds.toFixed(2)} s, reaplicação válida.\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
    app.quit();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  app.exit(1);
});
