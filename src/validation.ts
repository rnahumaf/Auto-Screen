import { z } from "zod";
import type { CaptureProject, RecorderConfig, RenderOptions, ScreenScript } from "./types.js";

const finite = z.number().finite();
const nonNegative = finite.min(0);
const positive = finite.positive();
const rectSchema = z.object({ x: finite, y: finite, width: positive, height: positive }).strict();
const captureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("display"), displayIndex: nonNegative.int().optional() }).strict(),
  z.object({ kind: z.literal("region"), rect: rectSchema, displayIndex: nonNegative.int().optional() }).strict(),
  z.object({
    kind: z.literal("window"), title: z.string().min(1), match: z.enum(["exact", "contains"]).optional(),
    displayIndex: nonNegative.int().optional(),
  }).strict(),
]);

const inputControlSchema = z.object({
  enabled: z.boolean().optional(),
  allowedRegion: rectSchema.optional(),
  keyboard: z.object({ enabled: z.boolean().optional() }).strict().optional(),
}).strict();

const recorderSchema = z.object({
  capture: captureSchema.optional(),
  captureBackend: z.enum(["dda", "gdi"]).optional(),
  fps: finite.int().min(1).max(120).optional(),
  cursorMode: z.enum(["software", "native", "hidden"]).optional(),
  ffmpegPath: z.string().min(1).optional(),
  tempDirectory: z.string().min(1).optional(),
  maxDurationSeconds: positive.max(3_600).optional(),
  inputControl: inputControlSchema.optional(),
  abortSignal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
}).strict();

const scriptRecorderSchema = recorderSchema.omit({ abortSignal: true });

const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("moveMouse"), x: finite, y: finite,
    durationMs: nonNegative.max(60_000).optional(),
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).optional(),
  }).strict(),
  z.object({
    type: z.literal("click"), button: z.enum(["left", "middle", "right"]).optional(),
    count: z.union([z.literal(1), z.literal(2)]).optional(), holdMs: nonNegative.max(10_000).optional(),
  }).strict(),
  z.object({
    type: z.literal("scroll"), deltaX: finite.optional(), deltaY: finite.optional(),
    durationMs: nonNegative.max(60_000).optional(),
  }).strict().refine((value) => value.deltaX !== undefined || value.deltaY !== undefined, "Informe deltaX ou deltaY."),
  z.object({
    type: z.literal("typeText"), text: z.string().min(1).max(4_096),
    intervalMs: nonNegative.max(1_000).optional(),
  }).strict(),
  z.object({
    type: z.literal("pressKey"),
    key: z.enum(["Escape", "Tab", "Enter", "Space", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]),
    modifiers: z.array(z.enum(["Alt", "Control", "Shift", "Meta"])).max(4).optional(),
  }).strict(),
  z.object({ type: z.literal("wait"), durationMs: nonNegative.max(3_600_000) }).strict(),
  z.object({ type: z.literal("mark"), id: z.string().min(1), intensity: finite.min(0).max(1).optional() }).strict(),
]);

const speedSchema = z.object({ startSeconds: nonNegative, endSeconds: positive, rate: finite.min(0.25).max(8) }).strict();
const cameraTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("desktop") }).strict(),
  z.object({ kind: z.literal("region"), rect: rectSchema }).strict(),
  z.object({ kind: z.literal("pointer"), smoothing: finite.min(0).max(1).optional() }).strict(),
]);
const cameraSchema = z.object({
  atSeconds: nonNegative,
  target: cameraTargetSchema,
  zoom: finite.min(1).max(4).optional(),
  transition: z.enum(["instant", "smooth"]).optional(),
  transitionSeconds: nonNegative.max(10).optional(),
}).strict();

const transitionSchema = z.object({
  in: z.enum(["instant", "fade"]).optional(),
  out: z.enum(["instant", "fade"]).optional(),
  durationSeconds: nonNegative.max(10).optional(),
}).strict();
const captionSchema = z.object({
  id: z.string().min(1).optional(), text: z.string().min(1), startSeconds: nonNegative, endSeconds: positive,
  anchor: z.enum(["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right", "auto", "custom"]).optional(),
  position: z.object({ x: finite, y: finite }).strict().optional(),
  fontFamily: z.string().min(1).optional(), fontSize: finite.min(8).max(300).optional(),
  color: z.string().min(1).optional(), backgroundColor: z.string().min(1).optional(),
  padding: finite.min(0).max(100).optional(), maxWidth: finite.min(0.1).max(1).optional(),
  transition: transitionSchema.optional(),
}).strict();

const audioBase = {
  id: z.string().min(1).optional(), startSeconds: nonNegative.optional(), volume: finite.min(0).max(1).optional(),
  fadeInSeconds: nonNegative.optional(), fadeOutSeconds: nonNegative.optional(), trimStartSeconds: nonNegative.optional(),
  trimEndSeconds: positive.optional(), loop: z.boolean().optional(),
};
const fileAudioSourceSchema = z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict();
const midiAudioSourceSchema = z.object({
  kind: z.literal("midi"), midi: z.string().min(1), soundfontPath: z.string().min(1), tailSeconds: nonNegative.max(30).optional(),
}).strict();
const audioTrackSchema = z.object({
  ...audioBase,
  source: z.discriminatedUnion("kind", [fileAudioSourceSchema, midiAudioSourceSchema]),
}).strict();

const renderSchema = z.object({
  width: finite.int().min(16).max(8_192).optional(), height: finite.int().min(16).max(8_192).optional(),
  fps: finite.int().min(1).max(120).optional(), ffmpegPath: z.string().min(1).optional(),
  captions: z.array(captionSchema).max(1_000).optional(), camera: z.array(cameraSchema).max(10_000).optional(),
  speed: z.array(speedSchema).max(1_000).optional(), audio: z.array(audioTrackSchema).max(64).optional(),
  cursor: z.object({
    size: finite.int().min(12).max(128).optional(),
    clickIndicator: z.boolean().optional(),
    clickColor: z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
  }).strict().optional(),
  keepIntermediates: z.boolean().optional(),
}).strict();

const screenScriptSchema = z.object({
  schemaVersion: z.literal(2), recorder: scriptRecorderSchema.optional(), steps: z.array(stepSchema).max(10_000), render: renderSchema.optional(),
}).strict();

const cadenceSchema = z.object({
  frameCount: nonNegative.int(), measuredFps: nonNegative, maximumGapMs: nonNegative,
  duplicatedFrames: nonNegative.int(), droppedFrames: nonNegative.int(), constantFrameRate: z.boolean(),
}).strict();

const displaySchema = z.object({
  index: nonNegative.int(), deviceName: z.string().min(1), adapterIndex: nonNegative.int(), outputIndex: nonNegative.int(),
  rect: rectSchema, dpi: positive, primary: z.boolean(),
}).strict();

const captureProjectSchema = z.object({
  schemaVersion: z.literal(2), platform: z.literal("win32"), createdAt: z.string().min(1),
  rawVideoPath: z.string().min(1), workDirectory: z.string().min(1), workDirectoryToken: z.string().min(1),
  capture: z.object({
    backend: z.enum(["dda", "gdi"]), source: captureSchema, display: displaySchema, bounds: rectSchema,
    requestedFps: finite.int().min(1).max(120), cursorMode: z.enum(["software", "native", "hidden"]), dpi: positive,
    requestedBounds: rectSchema.optional(), encodedSize: z.object({ width: positive.int(), height: positive.int() }).strict().optional(),
    window: z.object({ handle: z.string().min(1), processId: nonNegative.int(), initialTitle: z.string() }).strict().optional(),
    timing: z.object({ firstFrameDelayMs: nonNegative }).strict(), cadence: cadenceSchema,
  }).strict(),
  rawDurationSeconds: positive,
  actions: z.array(z.object({
    type: z.enum(["moveMouse", "click", "scroll", "typeText", "pressKey", "wait", "mark"]),
    requestedAtSeconds: nonNegative, actualAtSeconds: nonNegative, durationSeconds: nonNegative,
    details: z.record(z.string(), z.unknown()),
  }).strict()).max(10_000),
  pointerPath: z.array(z.object({ x: finite, y: finite, timeSeconds: nonNegative }).strict()).max(100_000),
  marks: z.array(z.object({ id: z.string().min(1), timeSeconds: nonNegative, intensity: finite.min(0).max(1) }).strict()).max(10_000),
  warnings: z.array(z.string()).max(10_000),
}).strict();

const programmaticAudioSourceSchema = z.discriminatedUnion("kind", [
  fileAudioSourceSchema,
  z.object({ kind: z.literal("bytes"), bytes: z.instanceof(Uint8Array), format: z.enum(["wav", "mp3"]) }).strict(),
  z.object({
    kind: z.literal("midi"), midi: z.union([z.instanceof(Uint8Array), z.string().min(1)]),
    soundfontPath: z.string().min(1), tailSeconds: nonNegative.max(30).optional(),
  }).strict(),
]);

const renderOptionsSchema = renderSchema.omit({ audio: true }).extend({
  outPrefix: z.string().min(1),
  audio: z.array(z.object({ ...audioBase, source: programmaticAudioSourceSchema }).strict()).max(64).optional(),
  abortSignal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
}).strict();

export function validateRecorderConfig(value: unknown): RecorderConfig {
  return recorderSchema.parse(value) as RecorderConfig;
}

export function validateScreenScript(value: unknown): ScreenScript {
  const parsed = screenScriptSchema.parse(value) as unknown as ScreenScript;
  for (const caption of parsed.render?.captions ?? []) {
    if (caption.endSeconds <= caption.startSeconds) throw new RangeError("O fim da legenda deve ocorrer depois do início.");
    if (caption.anchor === "custom" && !caption.position) throw new TypeError("Legenda custom exige position.");
    const fade = caption.transition?.durationSeconds ?? 0.25;
    if (fade * 2 > caption.endSeconds - caption.startSeconds &&
        (caption.transition?.in === "fade" || caption.transition?.out === "fade")) {
      throw new RangeError("A duração do fade não cabe no intervalo da legenda.");
    }
  }
  return parsed;
}

export function validateCaptureProject(value: unknown): CaptureProject {
  return captureProjectSchema.parse(value) as CaptureProject;
}

export function validateRenderOptions(value: unknown): RenderOptions {
  const parsed = renderOptionsSchema.parse(value) as RenderOptions;
  for (const caption of parsed.captions ?? []) {
    if (caption.endSeconds <= caption.startSeconds) throw new RangeError("O fim da legenda deve ocorrer depois do início.");
    if (caption.anchor === "custom" && !caption.position) throw new TypeError("Legenda custom exige position.");
  }
  return parsed;
}
