import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupScreenProject, listWindows, probeMedia, renderScreenProject } from "../dist/index.js";
import { HumanRecorderSession } from "../apps/desktop/human-recorder.js";
import { listWebcams } from "../apps/desktop/webcam.js";
import { listMicrophones } from "../apps/desktop/microphone.js";

if (!process.argv.includes("--allow-webcam")) {
  throw new Error("Este teste abre a webcam. Execute com --allow-webcam para confirmar.");
}

const webcams = await listWebcams();
assert.ok(webcams.length > 0, "Nenhuma webcam disponível para o teste.");
const withMicrophone = process.argv.includes("--allow-microphone");
const microphones = withMicrophone ? await listMicrophones() : [];
if (withMicrophone) assert.ok(microphones.length > 0, "Nenhum microfone disponível para o teste.");
const useSavedDevices = process.argv.includes("--use-saved-devices");
const saved = useSavedDevices
  ? JSON.parse(await readFile(join(process.env.APPDATA, "auto-screen-desktop", "settings.json"), "utf8"))
  : null;
const webcam = useSavedDevices
  ? webcams.find((device) => device.id === saved.webcam?.deviceId)
  : webcams[0];
assert.ok(webcam, "A webcam guardada nas preferências não está disponível.");
const microphone = withMicrophone && (useSavedDevices
  ? microphones.find((device) => device.id === saved.microphone?.deviceId)
  : microphones[0]);
if (withMicrophone) assert.ok(microphone, "O microfone guardado nas preferências não está disponível.");
const segmentSeconds = process.argv.includes("--long-segments") ? 3_000 : 1_200;
const fps = process.argv.includes("--fps=60") ? 60 : 30;
const title = "Auto-Screen Capture Fixture";
const fixture = spawn("powershell.exe", [
  "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
  resolve("scripts/capture-fixture.ps1"), "-DurationSeconds", "45",
], { windowsHide: false, stdio: ["ignore", "ignore", "pipe"], shell: false });
const outputRoot = await mkdtemp(join(tmpdir(), "auto-screen-webcam-smoke-"));
let session;
let project;
try {
  let found = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await listWindows()).some((window) => window.title === title)) { found = true; break; }
    await delay(100);
  }
  assert.ok(found, "A janela de teste não abriu.");
  session = new HumanRecorderSession({
    capture: { kind: "window", title, match: "exact" }, captureBackend: "dda", fps,
    cursorMode: "hidden", maxDurationSeconds: 20,
    webcam: {
      enabled: true, deviceId: webcam.id, size: "medium", shape: "circle",
      border: "color", borderColor: "#3560C9", position: "top-right",
    },
    ...(withMicrophone ? { microphone: { enabled: true, deviceId: microphone.id } } : {}),
  });
  await session.start();
  await delay(segmentSeconds);
  await session.pause();
  await delay(500);
  await session.resume();
  await delay(segmentSeconds);
  project = await session.stop();
  session = undefined;
  assert.equal(project.webcam?.segments.length, 2);
  if (withMicrophone) {
    assert.ok(project.microphone?.path);
    if (project.warnings.some((warning) => warning.startsWith("Microfone:"))) {
      console.log(JSON.stringify({
        screenSeconds: project.rawDurationSeconds,
        cameraOffsets: project.webcam.segments.map((segment) => segment.startOffsetSeconds),
        microphoneOffsets: project.microphone.segments.map((segment) => segment.startOffsetSeconds),
        warnings: project.warnings.filter((warning) => warning.startsWith("Microfone:")),
      }));
    }
    assert.deepEqual(project.warnings.filter((warning) => warning.startsWith("Microfone:")), []);
    assert.equal(project.microphone.segments.length, project.webcam.segments.length);
    for (const [index, cameraSegment] of project.webcam.segments.entries()) {
      const audioSegment = project.microphone.segments[index];
      assert.ok(Number.isFinite(cameraSegment.startOffsetSeconds));
      assert.ok(Number.isFinite(audioSegment.startOffsetSeconds));
      assert.ok(Math.abs(cameraSegment.startOffsetSeconds - audioSegment.startOffsetSeconds) < 2,
        "A diferença entre os inícios da câmera e do microfone excedeu dois segundos.");
    }
  }
  const result = await renderScreenProject(project, {
    outPrefix: join(outputRoot, "smoke"),
    width: project.capture.encodedSize.width,
    height: project.capture.encodedSize.height,
    fps: project.capture.requestedFps,
    camera: [], quality: "balanced", keepIntermediates: true,
    ...(withMicrophone ? { audio: [{ id: "smoke-microphone", source: { kind: "file", path: project.microphone.path } }] } : {}),
  });
  assert.equal(result.manifest.webcam?.segmentCount, 2);
  assert.ok(result.manifest.output.durationSeconds > 2);
  if (withMicrophone) {
    const probe = await probeMedia(result.videoPath);
    assert.ok(probe.streams.some((stream) => stream.codecType === "audio"));
  }
  const startDifferences = withMicrophone
    ? project.webcam.segments.map((segment, index) =>
      Math.round((segment.startOffsetSeconds - project.microphone.segments[index].startOffsetSeconds) * 1_000))
    : [];
  if (withMicrophone && process.argv.includes("--sync-details")) {
    const samples = await Promise.all(project.webcam.segments.map(async (segment) => {
      const media = await probeMedia(segment.path);
      return media.streams.filter((stream) => ["video", "audio"].includes(stream.codecType))
        .map((stream) => ({ type: stream.codecType, start: stream.startTimeSeconds, duration: stream.durationSeconds }));
    }));
    console.log(JSON.stringify(samples));
  }
  console.log(`Webcam, tela${withMicrophone ? " e microfone" : ""} aprovados: ${result.manifest.output.durationSeconds.toFixed(2)} s, ${fps} fps, dois segmentos, MP4 validado. Diferenças de início câmera/microfone: ${startDifferences.join(", ") || "não se aplica"} ms.`);
} finally {
  if (session) await session.cleanup().catch(() => undefined);
  if (project) await cleanupScreenProject(project).catch(() => undefined);
  if (fixture.exitCode === null) fixture.kill();
  await rm(outputRoot, { recursive: true, force: true });
}
