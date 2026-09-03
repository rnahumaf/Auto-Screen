import { mouse } from "@nut-tree-fork/nut-js";
import { checkFfmpeg, resolveFfmpegPath, resolveFfprobePath } from "./ffmpeg.js";
import { runProcess } from "./process.js";
import { cleanupScreenProject, createScreenRecorder } from "./recorder.js";
import { getDesktopMetrics, listDisplays } from "./windows.js";
import type { DoctorCheck, DoctorResult } from "./types.js";

export async function runDoctor(options: { ffmpegPath?: string; captureSmoke?: boolean } = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [{
    name: "platform",
    ok: process.platform === "win32",
    detail: process.platform === "win32" ? "Windows disponível" : `plataforma não suportada: ${process.platform}`,
  }];
  const ffmpeg = resolveFfmpegPath(options.ffmpegPath);
  try { checks.push(...await checkFfmpeg(ffmpeg)); }
  catch (error) { checks.push({ name: "ffmpeg", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  try {
    const ffprobe = await runProcess(resolveFfprobePath(ffmpeg), ["-version"], { allowFailure: true });
    checks.push({ name: "ffprobe", ok: ffprobe.code === 0, detail: ffprobe.stdout.split(/\r?\n/)[0] || ffprobe.stderr.trim() });
  } catch (error) { checks.push({ name: "ffprobe", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  try {
    const metrics = await getDesktopMetrics();
    checks.push({ name: "desktop", ok: metrics.rect.width > 0 && metrics.rect.height > 0, detail: `${metrics.rect.width}x${metrics.rect.height} em ${metrics.rect.x},${metrics.rect.y}; ${metrics.dpi} DPI` });
  } catch (error) { checks.push({ name: "desktop", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  try {
    const displays = await listDisplays();
    checks.push({
      name: "displays",
      ok: displays.length > 0,
      detail: displays.map((display) =>
        `${display.index}:${display.rect.width}x${display.rect.height}@${display.rect.x},${display.rect.y} ` +
        `D3D11 ${display.adapterIndex}/${display.outputIndex}${display.primary ? " primário" : ""}`,
      ).join("; ") || "nenhum display",
    });
  } catch (error) { checks.push({ name: "displays", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  try {
    const point = await mouse.getPosition();
    checks.push({ name: "mouse", ok: true, detail: `cursor legível em ${point.x},${point.y}` });
  } catch (error) { checks.push({ name: "mouse", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  if (options.captureSmoke) {
    let displays = [] as Awaited<ReturnType<typeof listDisplays>>;
    try { displays = await listDisplays(); }
    catch { /* o diagnóstico de enumeração acima já contém o erro */ }
    for (const display of displays) {
      let project;
      try {
        const session = createScreenRecorder({
          capture: { kind: "display", displayIndex: display.index }, captureBackend: "dda", fps: 60,
          cursorMode: "hidden", maxDurationSeconds: 5,
          ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
        });
        await session.start();
        await session.wait(2_000);
        project = await session.stop();
        const cadence = project.capture.cadence;
        checks.push({
          name: `capture-smoke-${display.index}`,
          ok: cadence.constantFrameRate && cadence.maximumGapMs <= 25,
          detail: `D3D11 ${display.adapterIndex}/${display.outputIndex}; ${cadence.frameCount} quadros; ` +
            `${cadence.measuredFps.toFixed(3)} fps; lacuna ${cadence.maximumGapMs.toFixed(1)} ms`,
        });
      } catch (error) {
        checks.push({ name: `capture-smoke-${display.index}`, ok: false, detail: error instanceof Error ? error.message : String(error) });
      } finally {
        if (project) await cleanupScreenProject(project).catch(() => undefined);
      }
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}
