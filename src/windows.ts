import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { runProcess } from "./process.js";
import type { CaptureSource, DesktopMetrics, DisplayInfo, Rect, WindowInfo } from "./types.js";

function helperPath(): string {
  const resolver = createRequire(join(process.cwd(), "__auto_screen_resolver__.cjs"));
  const moduleDirectory = dirname(resolver.resolve("@rnaf/auto-screen"));
  return resolve(moduleDirectory, "..", "assets", "windows-helper.ps1");
}

export interface PointerButtonState {
  x: number;
  y: number;
  mask: number;
  observedAtMs: number;
}

export interface PointerButtonMonitor {
  stop(): Promise<void>;
}

async function spawnPointerButtonMonitor(
  executable: string,
  script: string,
  onState: (state: PointerButtonState) => void,
  onError: (error: Error) => void,
): Promise<PointerButtonMonitor> {
  const child = spawn(executable, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", script, "-Command", "pointer-events",
  ], { windowsHide: true, shell: false, stdio: "pipe" });
  child.stdin.end();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let stopped = false;
  let ready = false;
  let clockOffsetMs: number | undefined;
  let resolveReady: ((monitor: PointerButtonMonitor) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let resolveClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolvePromise) => { resolveClosed = resolvePromise; });
  const monitor: PointerButtonMonitor = {
    async stop() {
      stopped = true;
      if (child.exitCode === null) child.kill();
      await closed;
    },
  };
  const readyPromise = new Promise<PointerButtonMonitor>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const fail = (error: Error): void => {
    if (!ready) rejectReady?.(error);
    else if (!stopped) onError(error);
  };
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const [rawX, rawY, rawMask, rawTimestamp, rawFrequency, ...extra] = line.split("\t");
      const x = Number(rawX);
      const y = Number(rawY);
      const mask = Number(rawMask);
      const timestamp = Number(rawTimestamp);
      const frequency = Number(rawFrequency);
      if (
        extra.length > 0 || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(mask) || mask < 0 || mask > 7 ||
        !Number.isFinite(timestamp) || !Number.isFinite(frequency) || frequency <= 0
      ) continue;
      const helperTimeMs = timestamp * 1_000 / frequency;
      clockOffsetMs ??= performance.now() - helperTimeMs;
      onState({ x, y, mask, observedAtMs: helperTimeMs + clockOffsetMs });
      if (!ready) {
        ready = true;
        resolveReady?.(monitor);
      }
    }
  });
  child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
  child.once("error", (error) => fail(error));
  child.once("close", (code) => {
    resolveClosed?.();
    if (!stopped) fail(new Error(`O monitor de cliques terminou com código ${code ?? -1}: ${stderr.trim()}`));
  });
  const timer = setTimeout(() => {
    if (ready) return;
    stopped = true;
    if (child.exitCode === null) child.kill();
    rejectReady?.(new Error(`O monitor de cliques não iniciou em cinco segundos: ${stderr.trim()}`));
  }, 5_000);
  try {
    return await readyPromise;
  } finally {
    clearTimeout(timer);
  }
}

export async function startPointerButtonMonitor(
  onState: (state: PointerButtonState) => void,
  onError: (error: Error) => void,
): Promise<PointerButtonMonitor> {
  if (process.platform !== "win32") throw new Error("O monitor de cliques está disponível somente no Windows.");
  const script = helperPath();
  await access(script);
  const candidates = [process.env.AUTO_SCREEN_POWERSHELL_PATH, "pwsh.exe", "powershell.exe"]
    .filter((value): value is string => Boolean(value));
  let lastError: unknown;
  for (const executable of candidates) {
    try {
      return await spawnPointerButtonMonitor(executable, script, onState, onError);
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") break;
    }
  }
  throw lastError ?? new Error("PowerShell não encontrado.");
}

async function runHelper(
  command: "metrics" | "windows" | "displays" | "type-unicode",
  point?: { x: number; y: number },
  extraArguments: string[] = [],
  input?: string,
): Promise<unknown> {
  if (process.platform !== "win32") throw new Error("Auto-Screen 0.1.0 oferece captura somente no Windows.");
  const script = helperPath();
  await access(script);
  const arguments_ = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Command", command];
  if (point) arguments_.push("-X", String(Math.round(point.x)), "-Y", String(Math.round(point.y)));
  arguments_.push(...extraArguments);
  const candidates = [process.env.AUTO_SCREEN_POWERSHELL_PATH, "pwsh.exe", "powershell.exe"].filter((value): value is string => Boolean(value));
  let lastError: unknown;
  for (const executable of candidates) {
    try {
      const result = await runProcess(executable, arguments_, input === undefined ? {} : { input });
      return JSON.parse(result.stdout.trim()) as unknown;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw lastError ?? new Error("PowerShell não encontrado.");
}

export async function typeUnicodeText(text: string, expectedHandle: string, intervalMs: number): Promise<void> {
  if (!text) throw new TypeError("O texto Unicode não pode ser vazio.");
  if (!/^\d+$/.test(expectedHandle)) throw new TypeError("O HWND esperado precisa ser um inteiro não negativo.");
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 1_000) {
    throw new RangeError("intervalMs deve ficar entre 0 e 1000.");
  }
  await runHelper(
    "type-unicode",
    undefined,
    ["-ExpectedHandle", expectedHandle, "-IntervalMs", String(intervalMs)],
    text,
  );
}

function parseWindow(row: unknown): WindowInfo {
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
    displayIndex: Number(item.displayIndex ?? -1),
  };
}

function parseDisplay(row: unknown): DisplayInfo {
  const item = row as Record<string, unknown>;
  return {
    index: Number(item.index ?? -1),
    deviceName: String(item.deviceName ?? ""),
    adapterIndex: Number(item.adapterIndex ?? -1),
    outputIndex: Number(item.outputIndex ?? -1),
    rect: {
      x: Number(item.x ?? 0), y: Number(item.y ?? 0),
      width: Number(item.width ?? 0), height: Number(item.height ?? 0),
    },
    dpi: Number(item.dpi ?? 96),
    primary: Boolean(item.primary),
  };
}

export async function getDesktopMetrics(): Promise<DesktopMetrics> {
  const value = await runHelper("metrics") as Record<string, number>;
  return {
    rect: { x: value.x ?? 0, y: value.y ?? 0, width: value.width ?? 0, height: value.height ?? 0 },
    dpi: value.dpi ?? 96,
  };
}

export async function getDpiAtPoint(point: { x: number; y: number }): Promise<number> {
  const value = await runHelper("metrics", point) as Record<string, number>;
  return value.dpi ?? 96;
}

export async function listWindows(): Promise<WindowInfo[]> {
  const [value, displays] = await Promise.all([runHelper("windows"), listDisplays()]);
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map((row) => {
    const window = parseWindow(row);
    const deviceName = String((row as Record<string, unknown>).displayDeviceName ?? "");
    window.displayIndex = displays.find((display) => display.deviceName.toLocaleLowerCase() === deviceName.toLocaleLowerCase())?.index ?? -1;
    return window;
  }).filter((window) => window.rect.width > 0 && window.rect.height > 0);
}

export async function listDisplays(): Promise<DisplayInfo[]> {
  const value = await runHelper("displays");
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map(parseDisplay)
    .filter((display) => display.index >= 0 && display.adapterIndex >= 0 && display.outputIndex >= 0 && display.deviceName && display.rect.width > 0 && display.rect.height > 0)
    .sort((a, b) => a.index - b.index);
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

function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function requestedDisplay(displays: DisplayInfo[], index: number | undefined): DisplayInfo | undefined {
  if (index === undefined) return undefined;
  const display = displays.find((candidate) => candidate.index === index);
  if (!display) throw new Error(`Display ${index} não foi encontrado. Execute auto-screen displays para listar os índices disponíveis.`);
  return display;
}

function displayContaining(displays: DisplayInfo[], rect: Rect, explicitIndex?: number): DisplayInfo {
  const explicit = requestedDisplay(displays, explicitIndex);
  if (explicit) {
    if (!containsRect(explicit.rect, rect)) throw new Error(`A região solicitada não cabe integralmente no display ${explicit.index}.`);
    return explicit;
  }
  const matches = displays.filter((display) => containsRect(display.rect, rect));
  if (matches.length !== 1) {
    throw new Error("A captura precisa pertencer integralmente a um único display DDA; regiões entre monitores não são suportadas.");
  }
  return matches[0] as DisplayInfo;
}

export interface ResolvedCapture {
  rect: Rect;
  dpi: number;
  input: "desktop";
  display: DisplayInfo;
  window?: WindowInfo;
}

export async function resolveCaptureBounds(source: CaptureSource): Promise<ResolvedCapture> {
  const displays = await listDisplays();
  if (displays.length === 0) throw new Error("Nenhum display compatível com Desktop Duplication foi encontrado.");
  if (source.kind === "region") {
    const display = displayContaining(displays, source.rect, source.displayIndex);
    return { rect: source.rect, dpi: display.dpi, input: "desktop", display };
  }
  if (source.kind === "window") {
    const window = await findWindow(source.title, source.match);
    const display = displayContaining(displays, window.rect, source.displayIndex ?? window.displayIndex);
    return { rect: window.rect, dpi: window.dpi, input: "desktop", display, window };
  }
  const display = requestedDisplay(displays, source.displayIndex) ?? displays.find((candidate) => candidate.primary) ?? displays[0];
  if (!display) throw new Error("Nenhum display foi encontrado.");
  return { rect: display.rect, dpi: display.dpi, input: "desktop", display };
}

export function resolveFfprobePath(ffmpegPath: string): string {
  const directory = dirname(ffmpegPath);
  const extension = process.platform === "win32" ? ".exe" : "";
  return join(directory === "." ? "" : directory, `ffprobe${extension}`) || `ffprobe${extension}`;
}
