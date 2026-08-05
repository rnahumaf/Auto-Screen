import { readFile, rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Button, Key, Point as NutPoint, clipboard, getActiveWindow, keyboard, mouse } from "@nut-tree-fork/nut-js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { probeMedia, resolveFfmpegPath } from "./ffmpeg.js";
import { inputToPhysicalPoint, inputToPhysicalRect, physicalToInputPoint } from "./coordinates.js";
import { spawnProcess } from "./process.js";
import { validateRecorderConfig } from "./validation.js";
import { resolveCaptureBounds } from "./windows.js";
import type {
  CaptureProject, CursorMode, InputControlOptions, KeyboardKey, KeyboardModifier, MouseButton, MovementEasing,
  Point, PointerSample, RecordedAction, RecorderConfig, Rect, TimelineMark,
} from "./types.js";

const DEFAULT_FPS = 30;
const DEFAULT_MAX_DURATION_SECONDS = 300;
const POINTER_SAMPLE_INTERVAL_MS = 1000 / 60;
const MAX_TEXT_LENGTH = 4_096;

function ease(value: number, kind: MovementEasing): number {
  if (kind === "ease-in") return value * value;
  if (kind === "ease-out") return 1 - (1 - value) ** 2;
  if (kind === "ease-in-out") return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
  return value;
}

function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function buttonValue(button: MouseButton): Button {
  if (button === "right") return Button.RIGHT;
  if (button === "middle") return Button.MIDDLE;
  return Button.LEFT;
}

const KEY_VALUES: Record<KeyboardKey, Key> = {
  Escape: Key.Escape, Tab: Key.Tab, Enter: Key.Enter, Space: Key.Space, Backspace: Key.Backspace,
  Delete: Key.Delete, Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
};

const MODIFIER_VALUES: Record<KeyboardModifier, Key> = {
  Alt: Key.LeftAlt, Control: Key.LeftControl, Shift: Key.LeftShift, Meta: Key.LeftMeta,
};

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function evenBounds(rect: Rect): Rect {
  return { ...rect, width: Math.max(2, Math.floor(rect.width / 2) * 2), height: Math.max(2, Math.floor(rect.height / 2) * 2) };
}

function resolveCursorMode(config: RecorderConfig): CursorMode {
  if (config.cursorMode) return config.cursorMode;
  if (config.drawMouse === true) return "native";
  if (config.drawMouse === false) return "hidden";
  return "software";
}

export class ScreenRecorderSession {
  readonly config: RecorderConfig;
  private process?: ChildProcessWithoutNullStreams;
  private processExit?: Promise<{ code: number; stderr: string }>;
  private startedAt = 0;
  private workDirectory = "";
  private rawVideoPath = "";
  private workDirectoryToken = "";
  private bounds?: Rect;
  private requestedBounds?: Rect;
  private dpi = 96;
  private input?: string;
  private cursorMode: CursorMode = "software";
  private pointerTimer?: NodeJS.Timeout;
  private maxTimer?: NodeJS.Timeout;
  private sampling = false;
  private stopped = false;
  private abortedReason?: Error;
  private readonly actions: RecordedAction[] = [];
  private readonly pointerPath: PointerSample[] = [];
  private readonly marks: TimelineMark[] = [];
  private readonly warnings: string[] = [];

  constructor(config: RecorderConfig = {}) {
    this.config = validateRecorderConfig(config);
  }

  async start(): Promise<this> {
    if (this.process) throw new Error("A sessão já foi iniciada.");
    if (process.platform !== "win32") throw new Error("Auto-Screen 0.1.0 grava somente no Windows.");
    if (this.config.abortSignal?.aborted) throw new Error("A sessão foi cancelada antes de iniciar.");
    const source = this.config.capture ?? { kind: "desktop" as const };
    const resolvedCapture = await resolveCaptureBounds(source);
    this.requestedBounds = resolvedCapture.rect;
    this.bounds = evenBounds(resolvedCapture.rect);
    this.dpi = resolvedCapture.dpi;
    this.input = resolvedCapture.input;
    this.cursorMode = resolveCursorMode(this.config);
    const tempRoot = this.config.tempDirectory ? resolve(this.config.tempDirectory) : tmpdir();
    await mkdir(tempRoot, { recursive: true });
    this.workDirectory = await mkdtemp(join(tempRoot, "auto-screen-"));
    this.workDirectoryToken = randomUUID();
    await writeFile(join(this.workDirectory, ".auto-screen-workdir"), this.workDirectoryToken, "utf8");
    this.rawVideoPath = join(this.workDirectory, "capture.mkv");

    const fps = this.config.fps ?? DEFAULT_FPS;
    const ffmpeg = resolveFfmpegPath(this.config.ffmpegPath);
    const args = ["-y", "-hide_banner", "-loglevel", "warning", "-f", "gdigrab", "-draw_mouse", this.cursorMode === "native" ? "1" : "0", "-framerate", String(fps)];
    if (source.kind !== "desktop") {
      args.push("-offset_x", String(this.bounds.x), "-offset_y", String(this.bounds.y), "-video_size", `${this.bounds.width}x${this.bounds.height}`);
    }
    args.push("-i", this.input, "-vf", "crop=floor(iw/2)*2:floor(ih/2)*2", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", this.rawVideoPath);
    this.process = spawnProcess(ffmpeg, args);
    let stderr = "";
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => { stderr += chunk; });
    this.processExit = new Promise((resolveExit, reject) => {
      this.process?.once("error", reject);
      this.process?.once("close", (code) => resolveExit({ code: code ?? -1, stderr }));
    });
    try { await delay(400, undefined, { signal: this.config.abortSignal }); }
    catch (error) {
      if (this.process.exitCode === null) this.process.kill();
      await this.processExit;
      throw error;
    }
    if (this.process.exitCode !== null) {
      const exit = await this.processExit;
      throw new Error(`FFmpeg não iniciou a captura: ${exit.stderr.trim()}`);
    }
    this.startedAt = performance.now();
    this.pointerTimer = setInterval(() => { void this.samplePointer(); }, POINTER_SAMPLE_INTERVAL_MS);
    this.maxTimer = setTimeout(() => this.abort(new Error("A sessão atingiu a duração máxima configurada.")), (this.config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS) * 1_000);
    this.config.abortSignal?.addEventListener("abort", () => this.abort(new Error("A sessão foi cancelada.")), { once: true });
    await this.samplePointer();
    return this;
  }

  async moveMouse(point: Point, options: { durationMs?: number; easing?: MovementEasing } = {}): Promise<void> {
    this.assertControl(point);
    const requested = this.now();
    const start = inputToPhysicalPoint(await mouse.getPosition(), this.dpi);
    const durationMs = options.durationMs ?? 350;
    const easing = options.easing ?? "ease-in-out";
    const steps = Math.max(1, Math.ceil(durationMs / 16));
    for (let index = 1; index <= steps; index += 1) {
      this.assertUsable();
      const progress = ease(index / steps, easing);
      const x = Math.round(start.x + (point.x - start.x) * progress);
      const y = Math.round(start.y + (point.y - start.y) * progress);
      const nativePoint = physicalToInputPoint({ x, y }, this.dpi);
      await mouse.setPosition(new NutPoint(nativePoint.x, nativePoint.y));
      if (durationMs > 0) await delay(durationMs / steps, undefined, { signal: this.config.abortSignal });
    }
    this.record("moveMouse", requested, { ...point, durationMs, easing });
  }

  async click(options: { button?: MouseButton; count?: 1 | 2; holdMs?: number } = {}): Promise<void> {
    const position = inputToPhysicalPoint(await mouse.getPosition(), this.dpi);
    this.assertControl(position);
    const requested = this.now();
    const button = options.button ?? "left";
    const count = options.count ?? 1;
    const nativeButton = buttonValue(button);
    if ((options.holdMs ?? 0) > 0) {
      await mouse.pressButton(nativeButton);
      try { await delay(options.holdMs, undefined, { signal: this.config.abortSignal }); }
      finally { await mouse.releaseButton(nativeButton); }
    } else if (count === 2) await mouse.doubleClick(nativeButton);
    else await mouse.click(nativeButton);
    this.record("click", requested, { x: position.x, y: position.y, button, count, holdMs: options.holdMs ?? 0 });
  }

  async scroll(options: { deltaX?: number; deltaY?: number; durationMs?: number }): Promise<void> {
    const position = inputToPhysicalPoint(await mouse.getPosition(), this.dpi);
    this.assertControl(position);
    if (options.deltaX === undefined && options.deltaY === undefined) throw new TypeError("Informe deltaX ou deltaY.");
    const requested = this.now();
    const durationMs = options.durationMs ?? 0;
    const x = Math.trunc(options.deltaX ?? 0);
    const y = Math.trunc(options.deltaY ?? 0);
    const total = Math.max(Math.abs(x), Math.abs(y), 1);
    const batches = durationMs > 0 ? Math.min(total, Math.max(1, Math.ceil(durationMs / 30))) : 1;
    for (let index = 0; index < batches; index += 1) {
      const nextX = Math.round(Math.abs(x) * (index + 1) / batches) - Math.round(Math.abs(x) * index / batches);
      const nextY = Math.round(Math.abs(y) * (index + 1) / batches) - Math.round(Math.abs(y) * index / batches);
      if (nextX > 0) await (x > 0 ? mouse.scrollRight(nextX) : mouse.scrollLeft(nextX));
      if (nextY > 0) await (y > 0 ? mouse.scrollDown(nextY) : mouse.scrollUp(nextY));
      if (durationMs > 0) await delay(durationMs / batches, undefined, { signal: this.config.abortSignal });
    }
    this.record("scroll", requested, { x: position.x, y: position.y, deltaX: x, deltaY: y, durationMs });
  }

  async typeText(text: string, options: { intervalMs?: number } = {}): Promise<void> {
    if (!text || text.length > MAX_TEXT_LENGTH) throw new RangeError(`text deve conter entre 1 e ${MAX_TEXT_LENGTH} caracteres.`);
    const intervalMs = options.intervalMs ?? 20;
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 1_000) throw new RangeError("intervalMs deve ficar entre 0 e 1000.");
    await this.assertKeyboardControl();
    const requested = this.now();
    const characters = [...text];
    let inputMethod: "keys" | "clipboard" = "keys";
    const previousDelay = keyboard.config.autoDelayMs;
    keyboard.config.autoDelayMs = 0;
    try {
      if (/[^\x20-\x7E]/u.test(text)) {
        inputMethod = "clipboard";
        const previousClipboard = await clipboard.getContent();
        await clipboard.setContent(text);
        try {
          await keyboard.pressKey(Key.LeftControl, Key.V);
          await keyboard.releaseKey(Key.V, Key.LeftControl);
          await delay(Math.max(50, intervalMs), undefined, { signal: this.config.abortSignal });
        } finally {
          await clipboard.setContent(previousClipboard);
        }
      } else {
        for (let index = 0; index < characters.length; index += 1) {
          this.assertUsable();
          if (index > 0 && index % 16 === 0) await this.assertKeyboardControl();
          await keyboard.type(characters[index] as string);
          if (intervalMs > 0 && index < characters.length - 1) await delay(intervalMs, undefined, { signal: this.config.abortSignal });
        }
      }
    } finally {
      keyboard.config.autoDelayMs = previousDelay;
    }
    this.record("typeText", requested, { redacted: true, characterCount: characters.length, intervalMs, inputMethod });
  }

  async pressKey(key: KeyboardKey, options: { modifiers?: KeyboardModifier[] } = {}): Promise<void> {
    await this.assertKeyboardControl();
    const requested = this.now();
    const modifiers = [...new Set(options.modifiers ?? [])];
    const keys = [...modifiers.map((modifier) => MODIFIER_VALUES[modifier]), KEY_VALUES[key]];
    await keyboard.pressKey(...keys);
    try { await delay(40, undefined, { signal: this.config.abortSignal }); }
    finally { await keyboard.releaseKey(...[...keys].reverse()); }
    this.record("pressKey", requested, { key, modifiers });
  }

  async wait(durationMs: number): Promise<void> {
    this.assertUsable();
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError("durationMs deve ser finito e não negativo.");
    const requested = this.now();
    await delay(durationMs, undefined, { signal: this.config.abortSignal });
    this.record("wait", requested, { durationMs });
  }

  mark(id: string, intensity = 0.5): void {
    this.assertUsable();
    if (!id) throw new TypeError("A marca precisa de um id.");
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new RangeError("A intensidade deve ficar entre 0 e 1.");
    const timeSeconds = this.now();
    this.marks.push({ id, timeSeconds, intensity });
    this.record("mark", timeSeconds, { id, intensity });
  }

  async stop(): Promise<CaptureProject> {
    if (!this.process || !this.processExit || !this.bounds || !this.input) throw new Error("A sessão não foi iniciada.");
    if (this.stopped) throw new Error("A sessão já foi encerrada.");
    this.stopped = true;
    if (this.pointerTimer) clearInterval(this.pointerTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    await this.samplePointer();
    if (this.process.exitCode === null && !this.process.killed) this.process.stdin.write("q\n");
    const exit = await this.processExit;
    if (exit.code !== 0 && !this.abortedReason) throw new Error(`A captura falhou: ${exit.stderr.trim()}`);
    if (this.abortedReason) throw this.abortedReason;
    const ffmpeg = resolveFfmpegPath(this.config.ffmpegPath);
    const probe = await probeMedia(this.rawVideoPath, ffmpeg);
    if (probe.durationSeconds <= 0) throw new Error("O vídeo capturado não tem duração válida.");
    const video = probe.streams.find((stream) => stream.codecType === "video");
    if (!video?.width || !video.height) throw new Error("A captura não informou dimensões de vídeo válidas.");
    if (video.width !== this.bounds.width || video.height !== this.bounds.height) {
      this.warnings.push(`A superfície capturada foi ajustada de ${this.bounds.width}x${this.bounds.height} para ${video.width}x${video.height}.`);
      this.bounds = { ...this.bounds, width: video.width, height: video.height };
    }
    return {
      schemaVersion: 1,
      platform: "win32",
      createdAt: new Date().toISOString(),
      rawVideoPath: this.rawVideoPath,
      workDirectory: this.workDirectory,
      workDirectoryToken: this.workDirectoryToken,
      capture: {
        source: this.config.capture ?? { kind: "desktop" },
        bounds: this.bounds,
        fps: this.config.fps ?? DEFAULT_FPS,
        drawMouse: this.cursorMode === "native",
        cursorMode: this.cursorMode,
        dpi: this.dpi,
        ...(this.requestedBounds === undefined ? {} : { requestedBounds: this.requestedBounds }),
        encodedSize: { width: video.width, height: video.height },
      },
      rawDurationSeconds: probe.durationSeconds,
      actions: [...this.actions],
      pointerPath: [...this.pointerPath],
      marks: [...this.marks],
      warnings: [...this.warnings],
    };
  }

  private async samplePointer(): Promise<void> {
    if (!this.process || this.stopped && this.pointerPath.length > 0 || this.sampling || this.startedAt === 0) return;
    this.sampling = true;
    try {
      const point = inputToPhysicalPoint(await mouse.getPosition(), this.dpi);
      this.pointerPath.push({ x: point.x, y: point.y, timeSeconds: this.now() });
    } catch (error) {
      this.warnings.push(`Não foi possível amostrar o cursor: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sampling = false;
    }
  }

  private record(type: RecordedAction["type"], requestedAtSeconds: number, details: Record<string, unknown>): void {
    const actualAtSeconds = this.now();
    this.actions.push({ type, requestedAtSeconds, actualAtSeconds, durationSeconds: actualAtSeconds - requestedAtSeconds, details });
  }

  private now(): number { return Math.max(0, (performance.now() - this.startedAt) / 1_000); }

  private assertUsable(): void {
    if (!this.process || this.startedAt === 0) throw new Error("A sessão ainda não foi iniciada.");
    if (this.stopped || this.abortedReason) throw this.abortedReason ?? new Error("A sessão já foi encerrada.");
  }

  private assertControl(point: Point): void {
    this.assertUsable();
    const control: InputControlOptions = this.config.inputControl ?? {};
    if (!control.enabled) throw new Error("O controle de entrada está desabilitado. Use inputControl.enabled: true conscientemente.");
    const allowed = control.allowedRegion ?? this.bounds;
    if (!allowed || !contains(allowed, point)) throw new RangeError("A ação do mouse está fora da região autorizada.");
  }

  private async assertKeyboardControl(): Promise<void> {
    this.assertUsable();
    const control = this.config.inputControl ?? {};
    if (!control.enabled || !control.keyboard?.enabled) {
      throw new Error("O controle de teclado está desabilitado. Habilite inputControl e inputControl.keyboard conscientemente.");
    }
    const activeWindow = await getActiveWindow();
    const [activeTitle, activeRegion] = await Promise.all([activeWindow.title, activeWindow.region]);
    const source = this.config.capture ?? { kind: "desktop" as const };
    if (source.kind === "window") {
      const expected = source.title.toLocaleLowerCase();
      const actual = activeTitle.toLocaleLowerCase();
      const matches = source.match === "exact" ? actual === expected : actual.includes(expected);
      if (!matches) throw new Error(`A janela ativa não corresponde ao alvo autorizado: ${activeTitle}.`);
    }
    const allowed = control.allowedRegion ?? this.bounds;
    const activeRect = inputToPhysicalRect(
      { x: activeRegion.left, y: activeRegion.top, width: activeRegion.width, height: activeRegion.height },
      this.dpi,
    );
    if (!allowed || !intersects(allowed, activeRect)) {
      throw new RangeError("A janela em primeiro plano está fora da região autorizada para teclado.");
    }
  }

  private abort(reason: Error): void {
    if (this.stopped || this.abortedReason) return;
    this.abortedReason = reason;
    if (this.process?.exitCode === null) this.process.kill();
  }
}

export function createScreenRecorder(config: RecorderConfig = {}): ScreenRecorderSession {
  return new ScreenRecorderSession(config);
}

export async function cleanupScreenProject(project: CaptureProject): Promise<void> {
  const resolved = resolve(project.workDirectory);
  if (!basename(resolved).startsWith("auto-screen-")) throw new Error("Diretório sem prefixo seguro do Auto-Screen.");
  if (dirname(resolve(project.rawVideoPath)) !== resolved) throw new Error("O vídeo bruto não pertence ao diretório temporário informado.");
  const marker = await readFile(join(resolved, ".auto-screen-workdir"), "utf8");
  if (!project.workDirectoryToken || marker !== project.workDirectoryToken) throw new Error("Token do diretório temporário inválido.");
  await rm(resolved, { recursive: true, force: true });
}
