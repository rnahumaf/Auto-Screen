import assert from "node:assert/strict";
import test from "node:test";
import { HumanRecorderSession } from "../apps/desktop/human-recorder.js";

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
  const stoppedProjects = [fakeProject("one", 1.25), fakeProject("two", 2.5)];
  const recorderFactory = () => {
    const project = stoppedProjects[sequence++];
    return {
      async start() { return this; },
      async stop() { return project; },
    };
  };
  let consolidatedCount = 0;
  const session = new HumanRecorderSession(
    { capture: { kind: "display", displayIndex: 0 }, fps: 60 },
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
