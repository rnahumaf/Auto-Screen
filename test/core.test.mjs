import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  buildAssDocument,
  buildSpeedMap,
  cleanupScreenProject,
  probeMedia,
  renderScreenProject,
  runScreenScript,
  sourceToOutputTime,
  validateScreenScript,
} from "../dist/index.js";

test("mapeia segmentos de velocidade sem lacunas", () => {
  const map = buildSpeedMap(10, [{ startSeconds: 2, endSeconds: 6, rate: 2 }]);
  assert.deepEqual(map.map(({ startSeconds, endSeconds, rate }) => ({ startSeconds, endSeconds, rate })), [
    { startSeconds: 0, endSeconds: 2, rate: 1 },
    { startSeconds: 2, endSeconds: 6, rate: 2 },
    { startSeconds: 6, endSeconds: 10, rate: 1 },
  ]);
  assert.equal(sourceToOutputTime(6, map), 4);
  assert.equal(map.at(-1).outputEndSeconds, 8);
});

test("rejeita velocidade sobreposta e roteiro inseguro", () => {
  assert.throws(() => buildSpeedMap(5, [
    { startSeconds: 1, endSeconds: 3, rate: 2 },
    { startSeconds: 2, endSeconds: 4, rate: 1.5 },
  ]), /sobrepor/);
  assert.throws(() => validateScreenScript({ schemaVersion: 1, steps: [{ type: "scroll" }] }));
});

test("roteiro exige confirmação externa antes de controlar o mouse", async () => {
  await assert.rejects(() => runScreenScript({
    schemaVersion: 1,
    recorder: { inputControl: { enabled: true } },
    steps: [{ type: "click" }],
  }, { outPrefix: "não-deve-ser-criado" }), /allowInputControl/);
});

test("não remove diretório temporário sem token correspondente", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-cleanup-test-"));
  const workDirectory = join(root, "auto-screen-owned");
  const rawVideoPath = join(workDirectory, "capture.mkv");
  await mkdir(workDirectory);
  await writeFile(rawVideoPath, "test");
  await writeFile(join(workDirectory, ".auto-screen-workdir"), "real-token", "utf8");
  try {
    await assert.rejects(() => cleanupScreenProject({ workDirectory, rawVideoPath, workDirectoryToken: "wrong-token" }), /Token/);
    await access(rawVideoPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gera ASS UTF-8 com posição, cores e fade", () => {
  const ass = buildAssDocument([{
    text: "Ação concluída com êxito",
    startSeconds: 0.5,
    endSeconds: 2,
    anchor: "center",
    color: "#12AB34FF",
    backgroundColor: "#00000080",
    transition: { in: "fade", out: "instant", durationSeconds: 0.2 },
  }], 1280, 720);
  assert.match(ass, /Ação concluída com êxito/);
  assert.match(ass, /\\an5/);
  assert.match(ass, /\\fad\(200,0\)/);
});

test("exports CommonJS", () => {
  const require = createRequire(import.meta.url);
  const api = require("../dist/index.cjs");
  assert.equal(typeof api.createScreenRecorder, "function");
  assert.equal(typeof api.renderScreenProject, "function");
});

test("compõe vídeo H.264/AAC com câmera, legenda, velocidade e áudio", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-test-"));
  const projectDir = join(root, "project");
  await mkdir(projectDir);
  const rawVideoPath = join(projectDir, "capture.mkv");
  const audioPath = join(root, "tone.wav");
  const workDirectoryToken = "synthetic-test-token";
  await writeFile(join(projectDir, ".auto-screen-workdir"), workDirectoryToken, "utf8");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", rawVideoPath]);
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "3", audioPath]);
  const project = {
    schemaVersion: 1,
    platform: "win32",
    createdAt: new Date().toISOString(),
    rawVideoPath,
    workDirectory: projectDir,
    workDirectoryToken,
    capture: { source: { kind: "region", rect: { x: 0, y: 0, width: 640, height: 360 } }, bounds: { x: 0, y: 0, width: 640, height: 360 }, fps: 24, drawMouse: true, dpi: 96 },
    rawDurationSeconds: 3,
    actions: [],
    pointerPath: [{ x: 120, y: 100, timeSeconds: 0 }, { x: 500, y: 260, timeSeconds: 2 }],
    marks: [{ id: "reveal", timeSeconds: 1, intensity: 0.8 }],
    warnings: [],
  };
  try {
    const result = await renderScreenProject(project, {
      outPrefix: join(root, "result"), width: 640, height: 360, fps: 24, keepIntermediates: true,
      speed: [{ startSeconds: 0.5, endSeconds: 1.5, rate: 2 }],
      camera: [{ atSeconds: 0.2, target: { kind: "pointer", smoothing: 0.4 }, zoom: 1.4 }],
      captions: [{ text: "Teste com acentuação", startSeconds: 0.2, endSeconds: 1.8 }],
      audio: [{ source: { kind: "file", path: audioPath }, volume: 0.4, fadeInSeconds: 0.1, fadeOutSeconds: 0.2 }],
    });
    const probe = await probeMedia(result.videoPath);
    assert.equal(probe.streams.find((stream) => stream.codecType === "video")?.codecName, "h264");
    assert.equal(probe.streams.find((stream) => stream.codecType === "audio")?.codecName, "aac");
    assert.ok(Math.abs(probe.durationSeconds - 2.5) < 0.15);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
