import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  buildAssDocument,
  buildSpeedMap,
  cleanupScreenProject,
  createScreenRecorder,
  listDisplays,
  probeMedia,
  probeVideoCadence,
  renderScreenProject,
  inputToPhysicalPoint,
  inputToPhysicalRect,
  physicalToInputPoint,
  runScreenScript,
  sourceToOutputTime,
  validateScreenScript,
} from "../dist/index.js";

function syntheticCapture(bounds, fps) {
  return {
    backend: "dda",
    source: { kind: "region", rect: bounds },
    display: { index: 0, deviceName: "\\\\.\\DISPLAY1", adapterIndex: 0, outputIndex: 0, rect: bounds, dpi: 96, primary: true },
    bounds,
    requestedFps: fps,
    cursorMode: "software",
    dpi: 96,
    encodedSize: { width: bounds.width, height: bounds.height },
    timing: { firstFrameDelayMs: 10 },
    cadence: {
      frameCount: fps * 3, measuredFps: fps, maximumGapMs: 1000 / fps,
      duplicatedFrames: 0, droppedFrames: 0, constantFrameRate: true,
    },
  };
}

test("converte coordenadas físicas e lógicas entre 100% e 200% de DPI", () => {
  for (const dpi of [96, 120, 144, 168, 192]) {
    const physical = { x: -640, y: 900 };
    const logical = physicalToInputPoint(physical, dpi);
    const roundTrip = inputToPhysicalPoint(logical, dpi);
    const tolerance = dpi / 96;
    assert.ok(Math.abs(roundTrip.x - physical.x) <= tolerance);
    assert.ok(Math.abs(roundTrip.y - physical.y) <= tolerance);
  }
  assert.deepEqual(inputToPhysicalRect({ x: -100, y: 20, width: 800, height: 600 }, 144), {
    x: -150, y: 30, width: 1200, height: 900,
  });
});

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
  assert.throws(() => validateScreenScript({ schemaVersion: 2, steps: [{ type: "scroll" }] }));
  assert.throws(() => validateScreenScript({ schemaVersion: 1, steps: [] }));
});

test("roteiro exige confirmação externa antes de controlar o mouse", async () => {
  await assert.rejects(() => runScreenScript({
    schemaVersion: 2,
    recorder: { inputControl: { enabled: true } },
    steps: [{ type: "click" }],
  }, { outPrefix: "não-deve-ser-criado" }), /allowInputControl/);
});

test("roteiro exige confirmação independente antes de controlar o teclado", async () => {
  await assert.rejects(() => runScreenScript({
    schemaVersion: 2,
    recorder: { inputControl: { enabled: true, keyboard: { enabled: true } } },
    steps: [{ type: "typeText", text: "segredo que não deve chegar ao manifesto" }],
  }, { outPrefix: "não-deve-ser-criado" }), /allowKeyboardControl/);
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

test("aceita legenda automática, região negativa e teclado limitado", () => {
  const script = validateScreenScript({
    schemaVersion: 2,
    recorder: {
      capture: { kind: "region", rect: { x: -640, y: -20, width: 640, height: 360 } },
      cursorMode: "software",
      inputControl: { enabled: true, keyboard: { enabled: true } },
    },
    steps: [{ type: "typeText", text: "Teste", intervalMs: 25 }, { type: "pressKey", key: "Enter" }],
    render: { captions: [{ text: "Automática", startSeconds: 0, endSeconds: 1, anchor: "auto" }] },
  });
  assert.equal(script.recorder.capture.rect.x, -640);
  assert.throws(() => validateScreenScript({
    schemaVersion: 2,
    steps: [{ type: "typeText", text: "x".repeat(4_097) }],
  }));
});

test("rejeita região entre displays e allowedRegion fora da captura antes do FFmpeg", { skip: process.platform !== "win32" }, async () => {
  const displays = await listDisplays();
  assert.deepEqual(displays.map((display) => display.index), displays.map((_, index) => index));
  assert.ok(displays.every((display) => display.adapterIndex >= 0 && display.outputIndex >= 0));
  assert.equal(new Set(displays.map((display) => `${display.adapterIndex}/${display.outputIndex}`)).size, displays.length);
  const display = displays[0];
  assert.ok(display);
  const crossing = createScreenRecorder({
    capture: {
      kind: "region", displayIndex: display.index,
      rect: { x: display.rect.x + display.rect.width - 10, y: display.rect.y + 20, width: 20, height: 20 },
    },
  });
  await assert.rejects(() => crossing.start(), /não cabe integralmente/);

  const captureRect = { x: display.rect.x + 20, y: display.rect.y + 20, width: 200, height: 120 };
  const outsideAllowedRegion = createScreenRecorder({
    capture: { kind: "region", displayIndex: display.index, rect: captureRect },
    captureBackend: "gdi",
    inputControl: {
      enabled: true,
      allowedRegion: { ...captureRect, width: captureRect.width + 1 },
    },
  });
  await assert.rejects(() => outsideAllowedRegion.start(), /integralmente contida/);
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
    schemaVersion: 2,
    platform: "win32",
    createdAt: new Date().toISOString(),
    rawVideoPath,
    workDirectory: projectDir,
    workDirectoryToken,
    capture: syntheticCapture({ x: 0, y: 0, width: 640, height: 360 }, 24),
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
    assert.equal(result.manifest.cursor.mode, "software");
    assert.equal(result.manifest.cursor.clickIndicator, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderiza um único cursor por software sem borda preta", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-cursor-test-"));
  const projectDir = join(root, "project");
  await mkdir(projectDir);
  const rawVideoPath = join(projectDir, "capture.mkv");
  const workDirectoryToken = "cursor-test-token";
  await writeFile(join(projectDir, ".auto-screen-workdir"), workDirectoryToken, "utf8");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x336699:size=320x180:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", rawVideoPath]);
  const project = {
    schemaVersion: 2,
    platform: "win32",
    createdAt: new Date().toISOString(),
    rawVideoPath,
    workDirectory: projectDir,
    workDirectoryToken,
    capture: syntheticCapture({ x: 0, y: 0, width: 320, height: 180 }, 30),
    rawDurationSeconds: 2,
    actions: [],
    pointerPath: [{ x: 160, y: 90, timeSeconds: 0 }, { x: 160, y: 90, timeSeconds: 2 }],
    marks: [],
    warnings: [],
  };
  try {
    const result = await renderScreenProject(project, {
      outPrefix: join(root, "cursor"), width: 320, height: 180, fps: 30, camera: [],
      cursor: { size: 28, clickIndicator: false }, keepIntermediates: true,
    });
    const frame = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", result.videoPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const points = [];
    for (let y = 0; y < 180; y += 1) for (let x = 0; x < 320; x += 1) {
      const offset = (y * 320 + x) * 3;
      const red = frame[offset] ?? 0, green = frame[offset + 1] ?? 0, blue = frame[offset + 2] ?? 0;
      if (red > 220 && green > 220 && blue > 220 || red < 25 && green < 25 && blue < 25) points.push({ x, y });
    }
    assert.ok(points.length > 10, "o cursor precisa estar visível");
    assert.ok(Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)) < 50, "o cursor não pode deixar cópias espalhadas");
    assert.ok(Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)) < 50, "o cursor não pode deixar rastro vertical");
    const rightOffset = (90 * 320 + 319) * 3;
    assert.ok((frame[rightOffset] ?? 0) + (frame[rightOffset + 1] ?? 0) + (frame[rightOffset + 2] ?? 0) > 80, "a borda direita não pode ser preta");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normaliza entrada VFR com lacunas para 60 fps CFR após retiming", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-vfr-test-"));
  const projectDir = join(root, "project");
  await mkdir(projectDir);
  const rawVideoPath = join(projectDir, "capture.mkv");
  const workDirectoryToken = "vfr-test-token";
  await writeFile(join(projectDir, ".auto-screen-workdir"), workDirectoryToken, "utf8");
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=60",
    "-t", "2", "-vf", "select=not(eq(mod(n\\,12)\\,0))", "-fps_mode", "vfr",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", rawVideoPath,
  ]);
  const project = {
    schemaVersion: 2,
    platform: "win32",
    createdAt: new Date().toISOString(),
    rawVideoPath,
    workDirectory: projectDir,
    workDirectoryToken,
    capture: syntheticCapture({ x: 0, y: 0, width: 320, height: 180 }, 60),
    rawDurationSeconds: 2,
    actions: [{
      type: "click", requestedAtSeconds: 0.8, actualAtSeconds: 0.8, durationSeconds: 0,
      details: { button: "left", count: 1, position: { x: 160, y: 90 } },
    }],
    pointerPath: [{ x: 40, y: 40, timeSeconds: 0 }, { x: 160, y: 90, timeSeconds: 0.8 }, { x: 280, y: 140, timeSeconds: 2 }],
    marks: [],
    warnings: [],
  };
  try {
    const outPrefix = join(root, "cfr");
    await writeFile(`${outPrefix}.mp4`, "vídeo anterior");
    await writeFile(`${outPrefix}.json`, "manifesto anterior");
    const result = await renderScreenProject(project, {
      outPrefix, width: 320, height: 180, fps: 60, keepIntermediates: true,
      speed: [{ startSeconds: 0.5, endSeconds: 1.5, rate: 2 }],
      camera: [{ atSeconds: 0, target: { kind: "pointer" }, zoom: 1.2 }],
      captions: [{ text: "CFR 60", startSeconds: 0.1, endSeconds: 1.2 }],
    });
    const cadence = await probeVideoCadence(result.videoPath, 60);
    assert.equal(cadence.constantFrameRate, true);
    assert.equal(cadence.frameCount, 90);
    assert.ok(cadence.maximumGapMs <= 17);
    assert.equal(result.manifest.output.cadence.frameCount, 90);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelamento da renderização não publica resultado parcial", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-abort-test-"));
  const projectDir = join(root, "project");
  await mkdir(projectDir);
  const rawVideoPath = join(projectDir, "capture.mkv");
  const workDirectoryToken = "abort-test-token";
  await writeFile(join(projectDir, ".auto-screen-workdir"), workDirectoryToken, "utf8");
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=320x180:rate=60",
    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", rawVideoPath,
  ]);
  const project = {
    schemaVersion: 2,
    platform: "win32",
    createdAt: new Date().toISOString(),
    rawVideoPath,
    workDirectory: projectDir,
    workDirectoryToken,
    capture: syntheticCapture({ x: 0, y: 0, width: 320, height: 180 }, 60),
    rawDurationSeconds: 1,
    actions: [], pointerPath: [], marks: [], warnings: [],
  };
  const controller = new AbortController();
  controller.abort();
  const outPrefix = join(root, "cancelled");
  await writeFile(`${outPrefix}.mp4`, "resultado anterior");
  await writeFile(`${outPrefix}.json`, "manifesto anterior");
  try {
    await assert.rejects(
      () => renderScreenProject(project, { outPrefix, width: 320, height: 180, fps: 60, keepIntermediates: true, abortSignal: controller.signal }),
      /cancelad[oa]/i,
    );
    assert.equal(await readFile(`${outPrefix}.mp4`, "utf8"), "resultado anterior");
    assert.equal(await readFile(`${outPrefix}.json`, "utf8"), "manifesto anterior");
    await access(rawVideoPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
