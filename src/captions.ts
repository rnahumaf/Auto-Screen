import { writeFile } from "node:fs/promises";
import type { Caption, CaptionAnchor, Point } from "./types.js";

const DEFAULT_FONT = "Segoe UI";
const DEFAULT_FONT_SIZE = 48;
const DEFAULT_COLOR = "#FFFFFFFF";
const DEFAULT_BACKGROUND = "#000000AD";

function parseColor(value: string): { red: number; green: number; blue: number; alpha: number } {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!match?.[1]) throw new TypeError(`Cor inválida: ${value}. Use #RRGGBB ou #RRGGBBAA.`);
  const hex = match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  };
}

function assColor(value: string): string {
  const { red, green, blue, alpha } = parseColor(value);
  const assAlpha = 255 - alpha;
  return `&H${assAlpha.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${red.toString(16).padStart(2, "0")}&`.toUpperCase();
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function anchorPosition(anchor: CaptionAnchor, width: number, height: number, padding: number): { alignment: number; point: Point } {
  const map: Record<Exclude<CaptionAnchor, "custom">, { alignment: number; point: Point }> = {
    "bottom-left": { alignment: 1, point: { x: padding, y: height - padding } },
    bottom: { alignment: 2, point: { x: width / 2, y: height - padding } },
    "bottom-right": { alignment: 3, point: { x: width - padding, y: height - padding } },
    left: { alignment: 4, point: { x: padding, y: height / 2 } },
    center: { alignment: 5, point: { x: width / 2, y: height / 2 } },
    right: { alignment: 6, point: { x: width - padding, y: height / 2 } },
    "top-left": { alignment: 7, point: { x: padding, y: padding } },
    top: { alignment: 8, point: { x: width / 2, y: padding } },
    "top-right": { alignment: 9, point: { x: width - padding, y: padding } },
  };
  return anchor === "custom" ? { alignment: 5, point: { x: width / 2, y: height / 2 } } : map[anchor];
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\N");
}

function wrapText(text: string, width: number, fontSize: number, maxWidth: number): string {
  const maxCharacters = Math.max(8, Math.floor(width * maxWidth / (fontSize * 0.55)));
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (current && `${current} ${word}`.length > maxCharacters) {
        lines.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    if (current) lines.push(current);
  }
  return lines.join("\n");
}

export function buildAssDocument(captions: Caption[], width: number, height: number): string {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${DEFAULT_FONT},${DEFAULT_FONT_SIZE},${assColor(DEFAULT_COLOR)},${assColor(DEFAULT_COLOR)},${assColor(DEFAULT_BACKGROUND)},${assColor(DEFAULT_BACKGROUND)},0,0,0,0,100,100,0,0,3,14,0,2,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = captions.map((caption, index) => {
    if (caption.endSeconds <= caption.startSeconds) throw new RangeError(`Legenda ${caption.id ?? index} tem intervalo inválido.`);
    const fontSize = caption.fontSize ?? DEFAULT_FONT_SIZE;
    const padding = caption.padding ?? 16;
    const anchor = caption.anchor ?? "bottom";
    const placement = anchorPosition(anchor, width, height, Math.max(24, padding * 2));
    const point = anchor === "custom" ? caption.position : placement.point;
    if (!point) throw new TypeError(`Legenda ${caption.id ?? index} exige uma posição customizada.`);
    const transitionSeconds = caption.transition?.durationSeconds ?? 0.25;
    const fadeIn = caption.transition?.in === "instant" ? 0 : Math.round(transitionSeconds * 1_000);
    const fadeOut = caption.transition?.out === "instant" ? 0 : Math.round(transitionSeconds * 1_000);
    const durationMs = Math.round((caption.endSeconds - caption.startSeconds) * 1_000);
    if (fadeIn + fadeOut > durationMs) throw new RangeError(`Os fades da legenda ${caption.id ?? index} excedem sua duração.`);
    const wrapped = wrapText(caption.text, width, fontSize, caption.maxWidth ?? 0.8);
    const tags = [
      `\\an${placement.alignment}`,
      `\\pos(${Math.round(point.x)},${Math.round(point.y)})`,
      `\\fn${escapeAssText(caption.fontFamily ?? DEFAULT_FONT)}`,
      `\\fs${fontSize}`,
      `\\c${assColor(caption.color ?? DEFAULT_COLOR)}`,
      `\\3c${assColor(caption.backgroundColor ?? DEFAULT_BACKGROUND)}`,
      `\\bord${padding}`,
      `\\fad(${fadeIn},${fadeOut})`,
    ].join("");
    return `Dialogue: 0,${assTime(caption.startSeconds)},${assTime(caption.endSeconds)},Default,${caption.id ?? `caption-${index + 1}`},0,0,0,,{${tags}}${escapeAssText(wrapped)}`;
  });
  return `${header}\n${events.join("\n")}\n`;
}

export async function writeAssFile(path: string, captions: Caption[], width: number, height: number): Promise<void> {
  await writeFile(path, buildAssDocument(captions, width, height), "utf8");
}

export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
