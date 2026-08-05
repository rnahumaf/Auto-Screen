export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export type CaptureSource =
  | { kind: "desktop" }
  | { kind: "region"; rect: Rect }
  | { kind: "window"; title: string; match?: "exact" | "contains" };

export interface InputControlOptions {
  enabled?: boolean;
  allowedRegion?: Rect;
  keyboard?: {
    enabled?: boolean;
  };
}

export type CursorMode = "software" | "native" | "hidden";

export interface RecorderConfig {
  capture?: CaptureSource;
  fps?: number;
  cursorMode?: CursorMode;
  /** @deprecated Use cursorMode. */
  drawMouse?: boolean;
  ffmpegPath?: string;
  tempDirectory?: string;
  maxDurationSeconds?: number;
  inputControl?: InputControlOptions;
  abortSignal?: AbortSignal;
}

export type MouseButton = "left" | "middle" | "right";
export type MovementEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type KeyboardKey = "Escape" | "Tab" | "Enter" | "Space" | "Backspace" | "Delete" |
  "Home" | "End" | "PageUp" | "PageDown" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
export type KeyboardModifier = "Alt" | "Control" | "Shift" | "Meta";

export type ScriptStep =
  | { type: "moveMouse"; x: number; y: number; durationMs?: number; easing?: MovementEasing }
  | { type: "click"; button?: MouseButton; count?: 1 | 2; holdMs?: number }
  | { type: "scroll"; deltaX?: number; deltaY?: number; durationMs?: number }
  | { type: "typeText"; text: string; intervalMs?: number }
  | { type: "pressKey"; key: KeyboardKey; modifiers?: KeyboardModifier[] }
  | { type: "wait"; durationMs: number }
  | { type: "mark"; id: string; intensity?: number };

export interface SpeedSegment {
  startSeconds: number;
  endSeconds: number;
  rate: number;
}

export interface ResolvedSpeedSegment extends SpeedSegment {
  outputStartSeconds: number;
  outputEndSeconds: number;
}

export type CameraTarget =
  | { kind: "desktop" }
  | { kind: "region"; rect: Rect }
  | { kind: "window"; title: string; match?: "exact" | "contains" }
  | { kind: "pointer"; smoothing?: number };

export interface CameraCue {
  atSeconds: number;
  target: CameraTarget;
  zoom?: number;
  transition?: "instant" | "smooth";
  transitionSeconds?: number;
}

export type CaptionAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right"
  | "auto"
  | "custom";

export interface CaptionTransition {
  in?: "instant" | "fade";
  out?: "instant" | "fade";
  durationSeconds?: number;
}

export interface Caption {
  id?: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  anchor?: CaptionAnchor;
  position?: Point;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  padding?: number;
  maxWidth?: number;
  transition?: CaptionTransition;
}

interface AudioTrackBase {
  id?: string;
  startSeconds?: number;
  volume?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  loop?: boolean;
}

export type AudioSource =
  | { kind: "file"; path: string }
  | { kind: "bytes"; bytes: Uint8Array; format: "wav" | "mp3" }
  | { kind: "midi"; midi: Uint8Array | string; soundfontPath: string; tailSeconds?: number };

export interface AudioTrack extends AudioTrackBase {
  source: AudioSource;
}

export interface RenderOptions {
  outPrefix: string;
  width?: number;
  height?: number;
  fps?: number;
  ffmpegPath?: string;
  captions?: Caption[];
  camera?: CameraCue[];
  speed?: SpeedSegment[];
  audio?: AudioTrack[];
  cursor?: {
    size?: number;
    clickIndicator?: boolean;
    clickColor?: string;
  };
  keepIntermediates?: boolean;
}

export interface RecordedAction {
  type: ScriptStep["type"];
  requestedAtSeconds: number;
  actualAtSeconds: number;
  durationSeconds: number;
  details: Record<string, unknown>;
}

export interface PointerSample extends Point {
  timeSeconds: number;
}

export interface TimelineMark {
  id: string;
  timeSeconds: number;
  intensity: number;
}

export interface CaptureProject {
  schemaVersion: 1;
  platform: "win32";
  createdAt: string;
  rawVideoPath: string;
  workDirectory: string;
  workDirectoryToken: string;
  capture: {
    source: CaptureSource;
    bounds: Rect;
    fps: number;
    drawMouse: boolean;
    cursorMode: CursorMode;
    dpi: number;
    requestedBounds?: Rect;
    encodedSize?: { width: number; height: number };
  };
  rawDurationSeconds: number;
  actions: RecordedAction[];
  pointerPath: PointerSample[];
  marks: TimelineMark[];
  warnings: string[];
}

export interface AudioManifestEntry {
  id: string;
  kind: AudioSource["kind"];
  startSeconds: number;
  volume: number;
  renderedPath?: string;
}

export interface ScreenManifest {
  schemaVersion: 1;
  platform: "win32";
  createdAt: string;
  capture: CaptureProject["capture"] & { rawDurationSeconds: number };
  output: {
    videoPath: string;
    width: number;
    height: number;
    fps: number;
    durationSeconds: number;
    videoCodec: "h264";
    audioCodec: "aac";
  };
  actions: RecordedAction[];
  pointerPath: PointerSample[];
  marks: TimelineMark[];
  speed: ResolvedSpeedSegment[];
  camera: CameraCue[];
  cameraGenerated: boolean;
  cursor: {
    mode: CursorMode;
    size: number;
    clickIndicator: boolean;
    clickColor: string;
  };
  captions: Caption[];
  audio: AudioManifestEntry[];
  warnings: string[];
}

export interface RenderResult {
  videoPath: string;
  manifestPath: string;
  manifest: ScreenManifest;
}

export interface ScriptRenderOptions extends Omit<RenderOptions, "outPrefix" | "audio"> {
  audio?: Array<Omit<AudioTrack, "source"> & { source: Exclude<AudioSource, { kind: "bytes" }> }>;
}

export interface ScreenScript {
  schemaVersion: 1;
  recorder?: Omit<RecorderConfig, "abortSignal">;
  steps: ScriptStep[];
  render?: ScriptRenderOptions;
}

export interface RunScriptOptions {
  outPrefix: string;
  allowInputControl?: boolean;
  allowKeyboardControl?: boolean;
  abortSignal?: AbortSignal;
}

export interface WindowInfo {
  title: string;
  processId: number;
  handle: string;
  rect: Rect;
  dpi: number;
}

export interface DesktopMetrics {
  rect: Rect;
  dpi: number;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}
