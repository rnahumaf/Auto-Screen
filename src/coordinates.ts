import type { Point, Rect } from "./types.js";

const BASE_DPI = 96;

function scale(dpi: number): number {
  if (!Number.isFinite(dpi) || dpi <= 0) throw new RangeError("dpi deve ser finito e positivo.");
  return dpi / BASE_DPI;
}

/** Converte coordenadas físicas do manifesto/captura para o espaço lógico do nut.js. */
export function physicalToInputPoint(point: Point, dpi: number): Point {
  const ratio = scale(dpi);
  return { x: Math.round(point.x / ratio), y: Math.round(point.y / ratio) };
}

/** Converte coordenadas lógicas retornadas pelo nut.js para pixels físicos. */
export function inputToPhysicalPoint(point: Point, dpi: number): Point {
  const ratio = scale(dpi);
  return { x: Math.round(point.x * ratio), y: Math.round(point.y * ratio) };
}

export function inputToPhysicalRect(rect: Rect, dpi: number): Rect {
  const origin = inputToPhysicalPoint(rect, dpi);
  const ratio = scale(dpi);
  return {
    ...origin,
    width: Math.round(rect.width * ratio),
    height: Math.round(rect.height * ratio),
  };
}
