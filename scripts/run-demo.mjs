import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { generateMusic } from "auto-midi";
import { buildSpeedMap, createScreenRecorder, findWindow, outputDuration, renderScreenProject } from "../dist/index.js";

const title = "Auto-Screen Demo";
const soundfontPath = resolve("output/soundfonts/GeneralUser-GS.sf2");
try { await access(soundfontPath); }
catch { throw new Error("Execute npm run demo:setup antes da demonstração para baixar o SoundFont validado."); }

const app = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/demo-window.ps1"), "-Title", title], { windowsHide: false, stdio: "ignore" });
let session;
try {
  let window;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { window = await findWindow(title, "exact"); break; } catch { await delay(200); }
  }
  if (!window) throw new Error("A janela local de demonstração não abriu.");
  const rect = window.rect;
  session = createScreenRecorder({
    capture: { kind: "window", title, match: "exact" },
    fps: 30,
    maxDurationSeconds: 30,
    inputControl: { enabled: true, allowedRegion: rect },
  });
  await session.start();
  await session.wait(600);
  await session.moveMouse({ x: rect.x + 165, y: rect.y + 195 }, { durationMs: 700, easing: "ease-in-out" });
  await session.click();
  session.mark("action-complete", 0.8);
  await session.wait(700);
  await session.moveMouse({ x: rect.x + 660, y: rect.y + 300 }, { durationMs: 650 });
  await session.scroll({ deltaY: 8, durationMs: 800 });
  session.mark("list-scroll", 0.65);
  await session.wait(900);
  const project = await session.stop();
  session = undefined;
  const speed = project.rawDurationSeconds > 3.5 ? [{ startSeconds: 2.1, endSeconds: Math.min(3.5, project.rawDurationSeconds - 0.2), rate: 1.6 }] : [];
  const durationSeconds = outputDuration(buildSpeedMap(project.rawDurationSeconds, speed));
  const music = generateMusic({
    durationSeconds,
    style: "upbeat",
    tonic: "D",
    mode: "major",
    volume: 0.62,
    seed: "auto-screen-demo-v1",
    cues: project.marks.map((mark) => ({ id: mark.id, timeSeconds: Math.min(durationSeconds, mark.timeSeconds), intensity: mark.intensity })),
  });
  const result = await renderScreenProject(project, {
    outPrefix: resolve("output/demo/auto-screen-demo"),
    width: 1280,
    height: 720,
    fps: 30,
    speed,
    camera: [
      { atSeconds: 0, target: { kind: "desktop" }, transition: "instant" },
      { atSeconds: 0.5, target: { kind: "pointer", smoothing: 0.3 }, zoom: 1.45 },
    ],
    captions: [
      { text: "O agente executa a interação", startSeconds: 0.35, endSeconds: Math.min(2.6, durationSeconds), anchor: "bottom" },
      { text: "A gravação pode ser recomposta sem repetir os cliques", startSeconds: Math.min(2.7, durationSeconds - 1), endSeconds: durationSeconds - 0.1, anchor: "top", transition: { in: "fade", out: "fade", durationSeconds: 0.2 } },
    ].filter((caption) => caption.endSeconds > caption.startSeconds),
    audio: [{ id: "auto-midi", source: { kind: "midi", midi: music.midi, soundfontPath }, volume: 0.7, fadeInSeconds: 0.3, fadeOutSeconds: 0.6 }],
  });
  console.log(`Vídeo: ${result.videoPath}`);
  console.log(`Manifesto: ${result.manifestPath}`);
} finally {
  if (session) { try { await session.stop(); } catch {} }
  if (app.exitCode === null) app.kill();
}
