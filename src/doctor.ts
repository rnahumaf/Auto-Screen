import { mouse } from "@nut-tree-fork/nut-js";
import { checkFfmpeg, resolveFfmpegPath, resolveFfprobePath } from "./ffmpeg.js";
import { runProcess } from "./process.js";
import { getDesktopMetrics } from "./windows.js";
import type { DoctorCheck, DoctorResult } from "./types.js";

export async function runDoctor(options: { ffmpegPath?: string } = {}): Promise<DoctorResult> {
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
    const point = await mouse.getPosition();
    checks.push({ name: "mouse", ok: true, detail: `cursor legível em ${point.x},${point.y}` });
  } catch (error) { checks.push({ name: "mouse", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  return { ok: checks.every((check) => check.ok), checks };
}
