import { readFile, rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Button, Key, Point as NutPoint, getActiveWindow, keyboard, mouse } from "@nut-tree-fork/nut-js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { probeMedia, probeVideoCadence, resolveFfmpegPath } from "./ffmpeg.js";
import { inputToPhysicalPoint, inputToPhysicalRect, physicalToInputPoint } from "./coordinates.js";
import { spawnProcess } from "./process.js";
import { validateRecorderConfig } from "./validation.js";
import { resolveCaptureBounds, startPointerButtonMonitor, typeUnicodeText } from "./windows.js";
import type { PointerButtonMonitor, PointerButtonState } from "./windows.js";
import type {
  CaptureBackend, CaptureProject, CursorMode, DisplayInfo, InputControlOptions, KeyboardKey, KeyboardModifier,
  MouseButton, MovementEasing, Point, PointerSample, RecordedAction, RecorderConfig, Rect, TimelineMark, WindowInfo,
} from "./types.js";

const DEFAULT_FPS = 60;
const DEFAULT_MAX_DURATION_SECONDS = 300;
const POINTER_SAMPLE_INTERVAL_MS = 1000 / 60;
const MAX_TEXT_LENGTH = 4_096;
const PHYSICAL_BUTTONS = [
  { bit: 1, button: "left" },
  { bit: 2, button: "right" },
  { bit: 4, button: "middle" },
] as const;

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
  return "software";
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
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
  private backend: CaptureBackend = "dda";
  private display?: DisplayInfo;
  private targetWindow: WindowInfo | undefined;
  private cursorMode: CursorMode = "software";
  private pointerTimer?: NodeJS.Timeout;
  private pointerButtonMonitor?: PointerButtonMonitor;
  private pointerButtonMask?: number;
  private lastPointerButtonState?: PointerButtonState;
  private readonly physicalButtonStarts = new Map<MouseButton, PointerSample>();
  private maxTimer?: NodeJS.Timeout;
  private sampling = false;
  private stopped = false;
  private abortedReason?: Error;
  private firstFrameDelayMs = 0;
  private duplicatedFrames = 0;
  private droppedFrames = 0;
  private abortListener?: () => void;
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
    const source = this.config.capture ?? { kind: "display" as const };
    const resolvedCapture = await resolveCaptureBounds(source);
    this.requestedBounds = resolvedCapture.rect;
    this.bounds = evenBounds(resolvedCapture.rect);
    this.dpi = resolvedCapture.dpi;
    this.input = resolvedCapture.input;
    this.display = resolvedCapture.display;
    this.targetWindow = resolvedCapture.window;
    this.backend = this.config.captureBackend ?? "dda";
    this.cursorMode = resolveCursorMode(this.config);
    const allowedRegion = this.config.inputControl?.allowedRegion;
    if (allowedRegion && !containsRect(this.bounds, allowedRegion)) {
      throw new RangeError("allowedRegion precisa estar integralmente contida na captura.");
    }
    const tempRoot = this.config.tempDirectory ? resolve(this.config.tempDirectory) : tmpdir();
    await mkdir(tempRoot, { recursive: true });
    this.workDirectory = await mkdtemp(join(tempRoot, "auto-screen-"));
    this.workDirectoryToken = randomUUID();
    await writeFile(join(this.workDirectory, ".auto-screen-workdir"), this.workDirectoryToken, "utf8");
    this.rawVideoPath = join(this.workDirectory, "capture.mkv");

    const fps = this.config.fps ?? DEFAULT_FPS;
    const ffmpeg = resolveFfmpegPath(this.config.ffmpegPath);
    const args = ["-y", "-hide_banner", "-loglevel", "warning", "-progress", "pipe:1", "-stats_period", "0.05"];
    if (this.backend === "dda") {
      const offsetX = this.bounds.x - this.display.rect.x;
      const offsetY = this.bounds.y - this.display.rect.y;
      const graphPath = join(this.workDirectory, "capture-filtergraph.txt");
      const graph = [
        `ddagrab=output_idx=${this.display.outputIndex}:draw_mouse=${this.cursorMode === "native" ? 1 : 0}:framerate=${fps}:` +
          `video_size=${this.bounds.width}x${this.bounds.height}:offset_x=${offsetX}:offset_y=${offsetY}:dup_frames=1`,
        "hwdownload", "format=bgra", `fps=${fps}`, "format=yuv420p[capture]",
      ].join(",");
      await writeFile(graphPath, `${graph}\n`, "utf8");
      args.push(
        "-init_hw_device", `d3d11va=auto_screen_dda:${this.display.adapterIndex}`,
        "-filter_hw_device", "auto_screen_dda",
        "-/filter_complex", graphPath, "-map", "[capture]",
      );
    } else {
      this.warnings.push("Backend GDI solicitado explicitamente; a captura pode apresentar quadros parcialmente obsoletos.");
      args.push(
        "-f", "gdigrab", "-draw_mouse", this.cursorMode === "native" ? "1" : "0", "-framerate", String(fps),
        "-offset_x", String(this.bounds.x), "-offset_y", String(this.bounds.y),
        "-video_size", `${this.bounds.width}x${this.bounds.height}`, "-i", this.input,
        "-vf", `crop=floor(iw/2)*2:floor(ih/2)*2,fps=${fps}`,
      );
    }
    args.push(
      "-an", "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12",
      "-pix_fmt", "yuv420p", this.rawVideoPath,
    );
    if (this.config.observePointerButtons) {
      try {
        this.pointerButtonMonitor = await startPointerButtonMonitor(
          (state) => this.observePointerButtons(state),
          (error) => this.warnings.push(`O monitor de cliques foi encerrado: ${error.message}`),
        );
      } catch (error) {
        this.warnings.push(`Não foi possível monitorar cliques físicos: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const processStartedAt = performance.now();
    this.process = spawnProcess(ffmpeg, args);
    let stderr = "";
    let progressBuffer = "";
    let progress: Record<string, string> = {};
    let ready = false;
    let resolveReady: (() => void) | undefined;
    let rejectReady: ((error: Error) => void) | undefined;
    const readyPromise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise;
      rejectReady = rejectPromise;
    });
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => { stderr += chunk; });
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => {
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        progress[key] = value;
        if (key !== "progress") continue;
        this.duplicatedFrames = Math.max(this.duplicatedFrames, Number(progress.dup_frames ?? 0) || 0);
        this.droppedFrames = Math.max(this.droppedFrames, Number(progress.drop_frames ?? 0) || 0);
        if ((Number(progress.frame ?? 0) || 0) > 0) {
          const observedAt = performance.now();
          const outputTimeMs = Math.max(0, (Number(progress.out_time_us ?? 0) || 0) / 1_000);
          this.refineTimelineEpoch(Math.max(processStartedAt, observedAt - outputTimeMs));
          if (!ready) {
            this.firstFrameDelayMs = observedAt - processStartedAt;
            ready = true;
            resolveReady?.();
          }
        }
        progress = {};
      }
    });
    this.processExit = new Promise((resolveExit, reject) => {
      this.process?.once("error", (error) => {
        rejectReady?.(error);
        reject(error);
      });
      this.process?.once("close", (code) => {
        if (!ready) rejectReady?.(new Error(`FFmpeg não iniciou a captura: ${stderr.trim()}`));
        resolveExit({ code: code ?? -1, stderr });
      });
    });
    let readinessTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        readyPromise,
        new Promise<never>((_, reject) => {
          readinessTimer = setTimeout(() => reject(new Error("FFmpeg não entregou o primeiro quadro em cinco segundos.")), 5_000);
        }),
      ]);
    }
    catch (error) {
      if (this.process.exitCode === null) this.process.kill();
      try { await this.processExit; } catch { /* preservar erro de prontidão */ }
      if (this.pointerButtonMonitor) await this.pointerButtonMonitor.stop();
      const detail = error instanceof Error ? error.message : String(error);
      if (this.backend === "dda" && /desktop duplication access denied/i.test(`${detail}\n${stderr}`)) {
        throw new Error(
          "Desktop Duplication foi recusada pelo Windows. Desbloqueie a sessão e encerre outros gravadores/compartilhamentos " +
          "de tela antes de tentar novamente; o Auto-Screen não fará fallback implícito para GDI.",
        );
      }
      throw error;
    } finally {
      if (readinessTimer) clearTimeout(readinessTimer);
    }
    if (!this.config.observePointerButtons) {
      this.pointerTimer = setInterval(() => { void this.samplePointer(); }, POINTER_SAMPLE_INTERVAL_MS);
    } else if (this.lastPointerButtonState) {
      this.appendPointerSample({ x: this.lastPointerButtonState.x, y: this.lastPointerButtonState.y, timeSeconds: 0 });
    }
    const elapsedMs = Math.max(0, performance.now() - this.startedAt);
    this.maxTimer = setTimeout(
      () => this.abort(new Error("A sessão atingiu a duração máxima configurada.")),
      Math.max(1, (this.config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS) * 1_000 - elapsedMs),
    );
    this.abortListener = () => this.abort(new Error("A sessão foi cancelada."));
    this.config.abortSignal?.addEventListener("abort", this.abortListener, { once: true });
    if (!this.config.observePointerButtons) await this.samplePointer();
    return this;
  }

  async moveMouse(point: Point, options: { durationMs?: number; easing?: MovementEasing } = {}): Promise<void> {
    this.assertControl(point);
    const requested = this.now();
    const start = inputToPhysicalPoint(await mouse.getPosition(), this.dpi);
    const durationMs = options.durationMs ?? 350;
    const easing = options.easing ?? "ease-in-out";
    const movementStartedAt = performance.now();
    while (true) {
      this.assertUsable();
      const elapsed = performance.now() - movementStartedAt;
      const progress = ease(durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs), easing);
      const x = Math.round(start.x + (point.x - start.x) * progress);
      const y = Math.round(start.y + (point.y - start.y) * progress);
      const nativePoint = physicalToInputPoint({ x, y }, this.dpi);
      await mouse.setPosition(new NutPoint(nativePoint.x, nativePoint.y));
      this.appendPointerSample({ x, y, timeSeconds: this.now() });
      if (progress >= 1) break;
      const remaining = durationMs - (performance.now() - movementStartedAt);
      if (remaining > 0) await delay(Math.min(POINTER_SAMPLE_INTERVAL_MS, remaining), undefined, { signal: this.config.abortSignal });
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
    const scrollStartedAt = performance.now();
    let completed = 0;
    while (completed < batches) {
      const targetBatch = durationMs === 0 ? batches : Math.min(batches, Math.max(completed + 1, Math.floor((performance.now() - scrollStartedAt) / durationMs * batches)));
      const nextX = Math.round(Math.abs(x) * targetBatch / batches) - Math.round(Math.abs(x) * completed / batches);
      const nextY = Math.round(Math.abs(y) * targetBatch / batches) - Math.round(Math.abs(y) * completed / batches);
      if (nextX > 0) await (x > 0 ? mouse.scrollRight(nextX) : mouse.scrollLeft(nextX));
      if (nextY > 0) await (y > 0 ? mouse.scrollDown(nextY) : mouse.scrollUp(nextY));
      completed = targetBatch;
      if (completed < batches && durationMs > 0) {
        const nextDeadline = scrollStartedAt + durationMs * (completed + 1) / batches;
        const waitMs = nextDeadline - performance.now();
        if (waitMs > 0) await delay(waitMs, undefined, { signal: this.config.abortSignal });
      }
    }
    this.record("scroll", requested, { x: position.x, y: position.y, deltaX: x, deltaY: y, durationMs });
  }

  async typeText(text: string, options: { intervalMs?: number } = {}): Promise<void> {
    if (!text || text.length > MAX_TEXT_LENGTH) throw new RangeError(`text deve conter entre 1 e ${MAX_TEXT_LENGTH} caracteres.`);
    const intervalMs = options.intervalMs ?? 20;
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 1_000) throw new RangeError("intervalMs deve ficar entre 0 e 1000.");
    const activeHandle = await this.assertKeyboardControl();
    const requested = this.now();
    const characters = [...text];
    await typeUnicodeText(text, activeHandle, intervalMs);
    this.record("typeText", requested, {
      redacted: true,
      characterCount: characters.length,
      intervalMs,
      inputMethod: "windows-send-input-unicode",
    });
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
    if (!this.process || !this.processExit || !this.bounds || !this.input || !this.display) throw new Error("A sessão não foi iniciada.");
    if (this.stopped) throw new Error("A sessão já foi encerrada.");
    if (this.pointerTimer) clearInterval(this.pointerTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.pointerButtonMonitor) await this.pointerButtonMonitor.stop();
    if (!this.config.observePointerButtons) await this.samplePointer();
    this.stopped = true;
    if (this.abortListener) this.config.abortSignal?.removeEventListener("abort", this.abortListener);
    if (this.process.exitCode === null && !this.process.killed) this.process.stdin.write("q\n");
    const exit = await this.processExit;
    if (exit.code !== 0 && !this.abortedReason) throw new Error(`A captura falhou: ${exit.stderr.trim()}`);
    if (this.abortedReason) throw this.abortedReason;
    const ffmpeg = resolveFfmpegPath(this.config.ffmpegPath);
    const probe = await probeMedia(this.rawVideoPath, ffmpeg);
    const requestedFps = this.config.fps ?? DEFAULT_FPS;
    const cadence = await probeVideoCadence(this.rawVideoPath, requestedFps, ffmpeg, {
      duplicatedFrames: this.duplicatedFrames, droppedFrames: this.droppedFrames,
    });
    if (probe.durationSeconds <= 0) throw new Error("O vídeo capturado não tem duração válida.");
    const video = probe.streams.find((stream) => stream.codecType === "video");
    if (!video?.width || !video.height) throw new Error("A captura não informou dimensões de vídeo válidas.");
    if (video.width !== this.bounds.width || video.height !== this.bounds.height) {
      this.warnings.push(`A superfície capturada foi ajustada de ${this.bounds.width}x${this.bounds.height} para ${video.width}x${video.height}.`);
      this.bounds = { ...this.bounds, width: video.width, height: video.height };
    }
    const correctedRatio = cadence.frameCount > 0 ? (cadence.duplicatedFrames + cadence.droppedFrames) / cadence.frameCount : 0;
    if (correctedRatio > 0.05 || cadence.maximumGapMs > 100) {
      throw new Error(
        `A captura não atingiu a cadência mínima: ${(correctedRatio * 100).toFixed(2)}% de quadros corrigidos; ` +
        `maior lacuna ${cadence.maximumGapMs.toFixed(1)} ms. Intermediários preservados em ${this.workDirectory}.`,
      );
    }
    if (correctedRatio > 0.01 || !cadence.constantFrameRate) {
      this.warnings.push(
        `Cadência abaixo do ideal: ${(correctedRatio * 100).toFixed(2)}% de quadros corrigidos; ` +
        `maior lacuna ${cadence.maximumGapMs.toFixed(1)} ms.`,
      );
    }
    return {
      schemaVersion: 2,
      platform: "win32",
      createdAt: new Date().toISOString(),
      rawVideoPath: this.rawVideoPath,
      workDirectory: this.workDirectory,
      workDirectoryToken: this.workDirectoryToken,
      capture: {
        backend: this.backend,
        source: this.config.capture ?? { kind: "display" },
        display: this.display,
        bounds: this.bounds,
        requestedFps,
        cursorMode: this.cursorMode,
        dpi: this.dpi,
        ...(this.requestedBounds === undefined ? {} : { requestedBounds: this.requestedBounds }),
        encodedSize: { width: video.width, height: video.height },
        ...(this.targetWindow === undefined ? {} : {
          window: {
            handle: this.targetWindow.handle,
            processId: this.targetWindow.processId,
            initialTitle: this.targetWindow.title,
          },
        }),
        timing: { firstFrameDelayMs: Number(this.firstFrameDelayMs.toFixed(3)) },
        cadence,
      },
      rawDurationSeconds: probe.durationSeconds,
      actions: [...this.actions],
      pointerPath: [...this.pointerPath],
      marks: [...this.marks],
      warnings: [...this.warnings],
    };
  }

  private async samplePointer(): Promise<void> {
    if (!this.process || this.stopped || this.sampling || this.startedAt === 0) return;
    this.sampling = true;
    try {
      const point = inputToPhysicalPoint(await mouse.getPosition(), this.dpi);
      this.appendPointerSample({ x: point.x, y: point.y, timeSeconds: this.now() });
    } catch (error) {
      this.warnings.push(`Não foi possível amostrar o cursor: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sampling = false;
    }
  }

  private observePointerButtons(state: PointerButtonState): void {
    this.lastPointerButtonState = state;
    const previousMask = this.pointerButtonMask;
    this.pointerButtonMask = state.mask;
    if (!this.process || this.stopped || this.startedAt === 0) return;
    const timeSeconds = Math.max(0, (state.observedAtMs - this.startedAt) / 1_000);
    const sample = { x: state.x, y: state.y, timeSeconds };
    this.appendPointerSample(sample);
    if (previousMask === undefined) return;
    for (const { bit, button } of PHYSICAL_BUTTONS) {
      const wasPressed = (previousMask & bit) !== 0;
      const isPressed = (state.mask & bit) !== 0;
      if (!wasPressed && isPressed) {
        this.physicalButtonStarts.set(button, sample);
        continue;
      }
      if (!wasPressed || isPressed) continue;
      const start = this.physicalButtonStarts.get(button);
      this.physicalButtonStarts.delete(button);
      if (!start) continue;
      const durationSeconds = Math.max(0, timeSeconds - start.timeSeconds);
      this.actions.push({
        type: "click",
        requestedAtSeconds: start.timeSeconds,
        actualAtSeconds: timeSeconds,
        durationSeconds,
        details: {
          x: start.x,
          y: start.y,
          releaseX: state.x,
          releaseY: state.y,
          button,
          count: 1,
          holdMs: Math.round(durationSeconds * 1_000),
          inputMethod: "physical-observer",
        },
      });
    }
  }

  private record(type: RecordedAction["type"], requestedAtSeconds: number, details: Record<string, unknown>): void {
    const actualAtSeconds = this.now();
    this.actions.push({ type, requestedAtSeconds, actualAtSeconds, durationSeconds: actualAtSeconds - requestedAtSeconds, details });
  }

  private appendPointerSample(sample: PointerSample): void {
    const previous = this.pointerPath.at(-1);
    if (previous && sample.timeSeconds < previous.timeSeconds) return;
    if (previous && sample.timeSeconds === previous.timeSeconds && sample.x === previous.x && sample.y === previous.y) return;
    this.pointerPath.push(sample);
  }

  private refineTimelineEpoch(candidateMs: number): void {
    if (this.startedAt === 0) {
      this.startedAt = candidateMs;
      return;
    }
    if (candidateMs >= this.startedAt) return;
    const correctionSeconds = (this.startedAt - candidateMs) / 1_000;
    for (const sample of this.pointerPath) sample.timeSeconds += correctionSeconds;
    for (const action of this.actions) {
      action.requestedAtSeconds += correctionSeconds;
      action.actualAtSeconds += correctionSeconds;
    }
    for (const mark of this.marks) mark.timeSeconds += correctionSeconds;
    this.startedAt = candidateMs;
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

  private async assertKeyboardControl(): Promise<string> {
    this.assertUsable();
    const control = this.config.inputControl ?? {};
    if (!control.enabled || !control.keyboard?.enabled) {
      throw new Error("O controle de teclado está desabilitado. Habilite inputControl e inputControl.keyboard conscientemente.");
    }
    const activeWindow = await getActiveWindow();
    const [activeTitle, activeRegion] = await Promise.all([activeWindow.title, activeWindow.region]);
    const activeHandle = String((activeWindow as unknown as { windowHandle?: number }).windowHandle ?? "");
    if (this.targetWindow) {
      if (!activeHandle || activeHandle !== this.targetWindow.handle) {
        throw new Error(`A janela ativa não corresponde ao HWND autorizado: ${activeTitle}.`);
      }
    }
    const allowed = control.allowedRegion ?? this.bounds;
    const activeRect = inputToPhysicalRect(
      { x: activeRegion.left, y: activeRegion.top, width: activeRegion.width, height: activeRegion.height },
      this.dpi,
    );
    if (!allowed || !intersects(allowed, activeRect)) {
      throw new RangeError("A janela em primeiro plano está fora da região autorizada para teclado.");
    }
    if (!activeHandle) throw new Error("O provedor nativo não informou o HWND da janela ativa.");
    return activeHandle;
  }

  private abort(reason: Error): void {
    if (this.stopped || this.abortedReason) return;
    this.abortedReason = reason;
    if (this.pointerButtonMonitor) void this.pointerButtonMonitor.stop();
    if (this.process?.exitCode === null) {
      if (this.process.stdin.writable) this.process.stdin.write("q\n");
      setTimeout(() => {
        if (this.process?.exitCode === null) this.process.kill();
      }, 1_500).unref();
    }
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
