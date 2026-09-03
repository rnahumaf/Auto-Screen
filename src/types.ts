export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export type CaptureBackend = "dda" | "gdi";

export type CaptureSource =
  | { kind: "display"; displayIndex?: number }
  | { kind: "region"; rect: Rect; displayIndex?: number }
  | { kind: "window"; title: string; match?: "exact" | "contains"; displayIndex?: number };

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
  captureBackend?: CaptureBackend;
  fps?: number;
  cursorMode?: CursorMode;
  observePointerButtons?: boolean;
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
    smoothing?: number;
  };
  keepIntermediates?: boolean;
  abortSignal?: AbortSignal;
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
  schemaVersion: 2;
  platform: "win32";
  createdAt: string;
  rawVideoPath: string;
  workDirectory: string;
  workDirectoryToken: string;
  capture: {
    backend: CaptureBackend;
    source: CaptureSource;
    display: DisplayInfo;
    bounds: Rect;
    requestedFps: number;
    cursorMode: CursorMode;
    dpi: number;
    requestedBounds?: Rect;
    encodedSize?: { width: number; height: number };
    window?: {
      handle: string;
      processId: number;
      initialTitle: string;
    };
    timing: {
      firstFrameDelayMs: number;
    };
    cadence: VideoCadence;
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
  schemaVersion: 2;
  platform: "win32";
  createdAt: string;
  capture: CaptureProject["capture"] & { rawDurationSeconds: number };
  output: {
    videoPath: string;
    width: number;
    height: number;
    fps: number;
    cadence: VideoCadence;
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
    smoothing: number;
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
  schemaVersion: 2;
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
  displayIndex: number;
}

export interface DisplayInfo {
  index: number;
  deviceName: string;
  adapterIndex: number;
  outputIndex: number;
  rect: Rect;
  dpi: number;
  primary: boolean;
}

export interface VideoCadence {
  frameCount: number;
  measuredFps: number;
  maximumGapMs: number;
  duplicatedFrames: number;
  droppedFrames: number;
  constantFrameRate: boolean;
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
