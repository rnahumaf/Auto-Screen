import { z } from "zod";
import type { RecorderConfig, ScreenScript } from "./types.js";

const finite = z.number().finite();
const nonNegative = finite.min(0);
const positive = finite.positive();
const rectSchema = z.object({ x: finite, y: finite, width: positive, height: positive }).strict();
const captureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("desktop") }).strict(),
  z.object({ kind: z.literal("region"), rect: rectSchema }).strict(),
  z.object({ kind: z.literal("window"), title: z.string().min(1), match: z.enum(["exact", "contains"]).optional() }).strict(),
]);

const inputControlSchema = z.object({
  enabled: z.boolean().optional(),
  allowedRegion: rectSchema.optional(),
  keyboard: z.object({ enabled: z.boolean().optional() }).strict().optional(),
}).strict();

const recorderSchema = z.object({
  capture: captureSchema.optional(),
  fps: finite.int().min(1).max(120).optional(),
  cursorMode: z.enum(["software", "native", "hidden"]).optional(),
  drawMouse: z.boolean().optional(),
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
  z.object({ kind: z.literal("window"), title: z.string().min(1), match: z.enum(["exact", "contains"]).optional() }).strict(),
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
  schemaVersion: z.literal(1), recorder: scriptRecorderSchema.optional(), steps: z.array(stepSchema).max(10_000), render: renderSchema.optional(),
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
