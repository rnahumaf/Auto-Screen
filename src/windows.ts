import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { runProcess } from "./process.js";
import type { CaptureSource, DesktopMetrics, Rect, WindowInfo } from "./types.js";

function helperPath(): string {
  const resolver = createRequire(join(process.cwd(), "__auto_screen_resolver__.cjs"));
  const moduleDirectory = dirname(resolver.resolve("auto-screen"));
  return resolve(moduleDirectory, "..", "assets", "windows-helper.ps1");
}

async function runHelper(command: "metrics" | "windows"): Promise<unknown> {
  if (process.platform !== "win32") throw new Error("Auto-Screen 0.1.0 oferece captura somente no Windows.");
  const script = helperPath();
  await access(script);
  const result = await runProcess("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-Command",
    command,
  ]);
  return JSON.parse(result.stdout.trim()) as unknown;
}

export async function getDesktopMetrics(): Promise<DesktopMetrics> {
  const value = await runHelper("metrics") as Record<string, number>;
  return {
    rect: { x: value.x ?? 0, y: value.y ?? 0, width: value.width ?? 0, height: value.height ?? 0 },
    dpi: value.dpi ?? 96,
  };
}

export async function listWindows(): Promise<WindowInfo[]> {
  const value = await runHelper("windows");
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      title: String(item.title ?? ""),
      processId: Number(item.processId ?? 0),
      handle: String(item.handle ?? "0"),
      rect: {
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? 0),
      },
      dpi: Number(item.dpi ?? 96),
    };
  }).filter((window) => window.rect.width > 0 && window.rect.height > 0);
}

export async function findWindow(title: string, match: "exact" | "contains" = "contains"): Promise<WindowInfo> {
  const normalized = title.toLocaleLowerCase();
  const candidates = (await listWindows()).filter((window) => {
    const current = window.title.toLocaleLowerCase();
    return match === "exact" ? current === normalized : current.includes(normalized);
  });
  if (candidates.length === 0) throw new Error(`Janela não encontrada: ${title}`);
  if (candidates.length > 1 && match === "contains") {
    throw new Error(`Mais de uma janela corresponde a "${title}"; use um título exato.`);
  }
  return candidates[0] as WindowInfo;
}

export async function resolveCaptureBounds(source: CaptureSource): Promise<{ rect: Rect; dpi: number; input: string }> {
  if (source.kind === "region") return { rect: source.rect, dpi: 96, input: "desktop" };
  if (source.kind === "window") {
    const window = await findWindow(source.title, source.match);
    return { rect: window.rect, dpi: window.dpi, input: `title=${window.title}` };
  }
  const desktop = await getDesktopMetrics();
  return { rect: desktop.rect, dpi: desktop.dpi, input: "desktop" };
}

export function resolveFfprobePath(ffmpegPath: string): string {
  const directory = dirname(ffmpegPath);
  const extension = process.platform === "win32" ? ".exe" : "";
  return join(directory === "." ? "" : directory, `ffprobe${extension}`) || `ffprobe${extension}`;
}
