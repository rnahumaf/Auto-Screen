import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanRecorderSession } from "../apps/desktop/human-recorder.js";
import { SettingsStore } from "../apps/desktop/settings.js";
import { probeMedia } from "../dist/index.js";

function makeTone(path, durationSeconds) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000", "-t", String(durationSeconds),
      "-ac", "1", path,
    ], { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`FFmpeg retornou ${code}.`)));
  });
}

function fakeProject(id, durationSeconds) {
  return {
    schemaVersion: 2,
    platform: "win32",
    createdAt: new Date().toISOString(),
    rawVideoPath: `C:\\Temp\\${id}\\capture.mkv`,
    workDirectory: `C:\\Temp\\${id}`,
    workDirectoryToken: id,
    capture: {
      backend: "dda",
      source: { kind: "display", displayIndex: 0 },
      display: {
        index: 0,
        deviceName: "DISPLAY1",
        adapterIndex: 0,
        outputIndex: 0,
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
        dpi: 96,
        primary: true,
      },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      requestedFps: 60,
      cursorMode: "native",
      dpi: 96,
      encodedSize: { width: 1920, height: 1080 },
      timing: { firstFrameDelayMs: 20 },
      cadence: {
        frameCount: Math.round(durationSeconds * 60),
        measuredFps: 60,
        maximumGapMs: 16.7,
        duplicatedFrames: 0,
        droppedFrames: 0,
        constantFrameRate: true,
      },
    },
    rawDurationSeconds: durationSeconds,
    actions: [],
    pointerPath: [],
    marks: [],
    warnings: [],
  };
}

test("controla iniciar, pausar, continuar e parar sem contar o intervalo pausado", async () => {
  let sequence = 0;
  const recorderConfigs = [];
  const stoppedProjects = [fakeProject("one", 1.25), fakeProject("two", 2.5)];
  const recorderFactory = (config) => {
    recorderConfigs.push(config);
    const project = stoppedProjects[sequence++];
    return {
      async start() { return this; },
      async stop() { return project; },
    };
  };
  let consolidatedCount = 0;
  const session = new HumanRecorderSession(
    { capture: { kind: "display", displayIndex: 0 }, fps: 60, cursorMode: "software" },
    {
      createRecorder: recorderFactory,
      consolidateProjects: async (projects) => {
        consolidatedCount = projects.length;
        return { ...projects[0], rawDurationSeconds: 3.75 };
      },
    },
  );

  assert.equal(session.state, "idle");
  await session.start();
  assert.equal(session.state, "recording");
  await session.pause();
  assert.equal(session.state, "paused");
  assert.equal(session.elapsedSeconds, 1.25);
  await session.resume();
  assert.equal(session.state, "recording");
  const project = await session.stop();

  assert.equal(session.state, "stopped");
  assert.equal(session.segmentCount, 2);
  assert.equal(consolidatedCount, 2);
  assert.deepEqual(recorderConfigs.map(({ cursorMode }) => cursorMode), ["software", "software"]);
  assert.equal(project.rawDurationSeconds, 3.75);
  assert.equal(session.elapsedSeconds, 3.75);
});

test("rejeita transições inválidas da interface humana", async () => {
  const session = new HumanRecorderSession(
    { capture: { kind: "display", displayIndex: 0 } },
    { createRecorder: () => ({ async start() {}, async stop() { return fakeProject("unused", 1); } }) },
  );

  await assert.rejects(() => session.pause(), /estado "idle"/);
  await assert.rejects(() => session.resume(), /estado "idle"/);
  await assert.rejects(() => session.stop(), /estado "idle"/);
});

test("mantém preferências válidas e grava alterações concorrentes em ordem", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-settings-test-"));
  try {
    const store = new SettingsStore(join(root, "settings.json"), join(root, "Videos"));
    await store.load();
    await Promise.all([
      store.update({ quality: "high", webcam: { shape: "circle", border: "color" }, voice: { localMethod: "spectral", localStrength: 85 } }),
      store.update({ autoSave: true, webcam: { borderColor: "#ab12cd", position: "top-left" } }),
    ]);
    const reloaded = new SettingsStore(join(root, "settings.json"), join(root, "Videos"));
    const value = await reloaded.load();
    assert.equal(value.quality, "high");
    assert.equal(value.autoSave, true);
    assert.equal(value.webcam.shape, "circle");
    assert.equal(value.webcam.border, "color");
    assert.equal(value.webcam.borderColor, "#AB12CD");
    assert.equal(value.webcam.position, "top-left");
    assert.equal(value.voice.localStrength, 85);
    assert.equal(value.voice.localMethod, "spectral");
    await store.update({ microphone: { enabled: true, deviceId: "usb-mic", latencyMs: 0 } });
    await store.update({ microphone: { deviceId: "bluetooth-mic", latencyMs: 325 } });
    await store.update({ microphone: { deviceId: "usb-mic", latencyMs: 0 } });
    assert.equal(store.value.microphone.latencyByDevice["bluetooth-mic"], 325);
    assert.equal(store.value.microphone.latencyMs, 0);
    assert.deepEqual(JSON.parse(await readFile(store.path, "utf8")), store.value);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("usa o mesmo relógio para webcam e microfone e compensa a latência do dispositivo", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-paired-av-test-"));
  const screenDirectory = join(root, "screen");
  const cameraDirectory = join(root, "camera");
  let standaloneMicrophoneCreated = false;
  try {
    await Promise.all([mkdir(screenDirectory), mkdir(cameraDirectory)]);
    const cameraPath = join(cameraDirectory, "camera.mkv");
    const audioPath = join(cameraDirectory, "microphone.wav");
    await Promise.all([writeFile(cameraPath, "fixture"), makeTone(audioPath, 3.4)]);
    const session = new HumanRecorderSession({
      capture: { kind: "display", displayIndex: 0 },
      webcam: { enabled: true, deviceId: "camera", size: "medium", shape: "square", border: "none", borderColor: "#000000", position: "bottom-right" },
      microphone: { enabled: true, deviceId: "bluetooth", latencyMs: 325 },
    }, {
      createRecorder: () => ({
        timelineEpochMilliseconds: 10_000,
        timelineStopMilliseconds: 13_000,
        async start() {},
        async stop() { return { ...fakeProject("screen", 3), workDirectory: screenDirectory }; },
      }),
      createWebcam: ({ microphoneDeviceId }) => {
        assert.equal(microphoneDeviceId, "bluetooth");
        return {
          async start() {},
          async stop() {
            return {
              path: cameraPath, epochMs: 10_080, endMs: 12_980, durationSeconds: 2.9,
              microphone: { path: audioPath, epochMs: 10_000, endMs: 13_400, durationSeconds: 3.4 },
            };
          },
          async cleanup() {},
        };
      },
      createMicrophone: () => { standaloneMicrophoneCreated = true; throw new Error("Microfone separado não deveria iniciar."); },
    });
    await session.start();
    const project = await session.stop();
    assert.equal(standaloneMicrophoneCreated, false);
    assert.ok(Math.abs(project.webcam.segments[0].startOffsetSeconds + 0.08) < 0.001);
    assert.ok(Math.abs(project.microphone.segments[0].startOffsetSeconds - 0.325) < 0.001);
    const audio = await probeMedia(project.microphone.path);
    assert.ok(Math.abs(audio.durationSeconds - 3) < 0.1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserva a gravação e preenche silêncio quando o microfone termina cedo", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-mic-gap-test-"));
  const screenDirectory = join(root, "screen");
  const microphonePath = join(root, "source.wav");
  try {
    await mkdir(screenDirectory);
    await makeTone(microphonePath, 0.8);
    const session = new HumanRecorderSession(
      {
        capture: { kind: "display", displayIndex: 0 },
        microphone: { enabled: true, deviceId: "microphone-test" },
      },
      {
        createRecorder: () => ({
          timelineEpochMilliseconds: 10_000,
          async start() {},
          async stop() {
            return {
              ...fakeProject("screen", 3),
              workDirectory: screenDirectory,
              rawVideoPath: join(screenDirectory, "capture.mkv"),
            };
          },
        }),
        createMicrophone: () => ({
          async start() {},
          async stop() { return { path: microphonePath, epochMs: 10_000, durationSeconds: 0.8 }; },
          async cleanup() {},
        }),
      },
    );
    await session.start();
    const project = await session.stop();
    assert.equal(session.state, "stopped");
    assert.match(project.warnings.join(" "), /Microfone:.*vídeo foi preservado/);
    assert.ok(project.microphone?.path);
    const audio = await probeMedia(project.microphone.path);
    assert.ok(Math.abs(audio.durationSeconds - 3) < 0.1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sincroniza a webcam em cada segmento da pausa", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-webcam-session-test-"));
  const projects = [];
  let count = 0;
  try {
    const session = new HumanRecorderSession(
      {
        capture: { kind: "display", displayIndex: 0 },
        webcam: {
          enabled: true, deviceId: "camera-test", size: "medium", shape: "circle",
          border: "black", borderColor: "#000000", position: "bottom-right",
        },
      },
      {
        createRecorder: () => {
          const index = count++;
          const directory = join(root, `screen-${index}`);
          return {
            timelineEpochMilliseconds: (index + 1) * 10_000,
            async start() { await mkdir(directory); },
            async stop() {
              const project = fakeProject(`screen-${index}`, 1);
              return { ...project, workDirectory: directory, rawVideoPath: join(directory, "capture.mkv") };
            },
          };
        },
        createWebcam: () => {
          const index = count + 1;
          const directory = join(root, `camera-${index}`);
          return {
            async start() { await mkdir(directory); await writeFile(join(directory, "webcam.mkv"), "fixture"); },
            async stop() { return { path: join(directory, "webcam.mkv"), epochMs: index * 10_000 - 300, durationSeconds: 1.4 }; },
            async cleanup() { await rm(directory, { recursive: true, force: true }); },
          };
        },
        consolidateProjects: async (items) => {
          projects.push(...items);
          return { ...items[0], rawDurationSeconds: 2 };
        },
      },
    );
    await session.start();
    await session.pause();
    await session.resume();
    await session.stop();
    assert.equal(projects.length, 2);
    assert.ok(projects.every((project) => project.webcam.segments.length === 1));
    assert.ok(projects.every((project) => project.webcam.segments[0].startOffsetSeconds === 0.3));
    assert.equal(session.segmentCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("alinha webcam e microfone pelos instantes finais mesmo com relógios iniciais imprecisos", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-screen-sync-test-"));
  const screenDirectory = join(root, "screen");
  const webcamPath = join(root, "webcam-source.mkv");
  const microphonePath = join(root, "microphone-source.wav");
  try {
    await mkdir(screenDirectory);
    await writeFile(webcamPath, "fixture");
    await makeTone(microphonePath, 1.3);
    const session = new HumanRecorderSession(
      {
        capture: { kind: "display", displayIndex: 0 },
        webcam: { enabled: true, deviceId: "camera-test", size: "medium", shape: "square", border: "none", borderColor: "#000000", position: "bottom-right" },
        microphone: { enabled: true, deviceId: "microphone-test" },
      },
      {
        createRecorder: () => ({
          timelineEpochMilliseconds: 5_000,
          timelineStopMilliseconds: 11_000,
          async start() {},
          async stop() { return { ...fakeProject("screen", 1), workDirectory: screenDirectory, rawVideoPath: join(screenDirectory, "capture.mkv") }; },
        }),
        createWebcam: ({ microphoneDeviceId }) => {
          assert.equal(microphoneDeviceId, "microphone-test");
          return {
            async start() {},
            async stop() { return {
              path: webcamPath, epochMs: 5_500, endMs: 11_020, durationSeconds: 1.4,
              microphone: { path: microphonePath, epochMs: 7_000, endMs: 11_040, durationSeconds: 1.3 },
            }; },
            async cleanup() {},
          };
        },
        createMicrophone: () => { throw new Error("O microfone não deve iniciar uma segunda captura."); },
      },
    );
    await session.start();
    const project = await session.stop();
    assert.ok(Math.abs(project.webcam.segments[0].startOffsetSeconds - 0.38) < 0.001);
    assert.ok(Math.abs(project.microphone.segments[0].startOffsetSeconds - 0.26) < 0.001);
    const alignedAudio = await probeMedia(project.microphone.path);
    assert.ok(Math.abs(alignedAudio.durationSeconds - 1) < 0.05);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
