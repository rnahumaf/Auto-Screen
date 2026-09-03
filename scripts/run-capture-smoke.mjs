import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupScreenProject, createScreenRecorder, listWindows } from "../dist/index.js";

const title = "Auto-Screen Capture Fixture";
const fixture = spawn("powershell.exe", [
  "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
  resolve("scripts/capture-fixture.ps1"), "-DurationSeconds", "15",
], { windowsHide: false, stdio: ["ignore", "ignore", "pipe"], shell: false });

let project;
let session;
try {
  let found = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await listWindows()).some((window) => window.title === title)) { found = true; break; }
    await delay(100);
  }
  assert.ok(found, "a fixture visual precisa abrir antes da captura");
  await delay(500);
  if (fixture.exitCode !== null) {
    throw new Error(`A fixture visual encerrou antes de abrir: ${fixture.stderr.read()?.toString("utf8") ?? "sem diagnóstico"}`);
  }
  session = createScreenRecorder({
    capture: { kind: "window", title, match: "exact" }, captureBackend: "dda", fps: 60,
    cursorMode: "hidden", maxDurationSeconds: 10,
  });
  await session.start();
  await session.wait(5_000);
  project = await session.stop();
  session = undefined;
  const cadence = project.capture.cadence;
  assert.equal(cadence.constantFrameRate, true);
  assert.ok(Math.abs(cadence.measuredFps - 60) < 0.01, `cadência medida: ${cadence.measuredFps}`);
  assert.ok(cadence.maximumGapMs <= 21, `lacuna máxima: ${cadence.maximumGapMs} ms`);

  const decoded = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", project.rawVideoPath,
    "-vf", "crop=iw-80:ih-140:40:100,scale=16:16:flags=area,format=rgb24", "-f", "rawvideo", "-",
  ], { encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (decoded.status !== 0) throw new Error(decoded.stderr?.toString("utf8") || "FFmpeg não decodificou a fixture.");
  const bytes = decoded.stdout;
  const frameBytes = 16 * 16 * 3;
  assert.equal(bytes.length % frameBytes, 0, "a saída RGB precisa conter quadros completos");
  const first = [32, 64, 96];
  const second = [224, 192, 64];
  for (let frameOffset = 0; frameOffset < bytes.length; frameOffset += frameBytes) {
    let firstPixels = 0;
    let secondPixels = 0;
    let classification = "";
    for (let offset = frameOffset; offset < frameOffset + frameBytes; offset += 3) {
      const red = bytes[offset] ?? 0, green = bytes[offset + 1] ?? 0, blue = bytes[offset + 2] ?? 0;
      const firstDistance = (red - first[0]) ** 2 + (green - first[1]) ** 2 + (blue - first[2]) ** 2;
      const secondDistance = (red - second[0]) ** 2 + (green - second[1]) ** 2 + (blue - second[2]) ** 2;
      if (firstDistance < secondDistance) { firstPixels += 1; classification += "A"; }
      else { secondPixels += 1; classification += "B"; }
    }
    const pixelCount = frameBytes / 3;
    if (Math.min(firstPixels, secondPixels) / pixelCount >= 0.15) {
      const frameIndex = frameOffset / frameBytes;
      const diagnosticPath = resolve("output/capture-smoke-hybrid.png");
      mkdirSync(resolve("output"), { recursive: true });
      spawnSync("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-i", project.rawVideoPath,
        "-vf", `select=eq(n\\,${frameIndex})`, "-frames:v", "1", diagnosticPath,
      ], { windowsHide: true });
    }
    assert.ok(
      Math.min(firstPixels, secondPixels) / pixelCount < 0.15,
      `quadro híbrido ${frameOffset / frameBytes}: ${firstPixels}/${secondPixels} pixels\n` +
        classification.match(/.{16}/g).join("\n"),
    );
  }
  console.log(`DDA aprovado: ${cadence.frameCount} quadros a ${cadence.measuredFps} fps, sem quadros híbridos.`);
} finally {
  if (session) await session.stop().catch(() => undefined);
  if (project) await cleanupScreenProject(project).catch(() => undefined);
  if (fixture.exitCode === null) fixture.kill();
}
