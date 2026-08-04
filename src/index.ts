export { midiAudioSource, renderMidiToWav } from "./audio.js";
export { buildAssDocument } from "./captions.js";
export { runDoctor } from "./doctor.js";
export { probeMedia } from "./ffmpeg.js";
export { cleanupScreenProject, createScreenRecorder, ScreenRecorderSession } from "./recorder.js";
export { renderScreenProject } from "./render.js";
export { loadScreenScript, runScreenScript } from "./script.js";
export { buildSpeedMap, outputDuration, sourceToOutputTime } from "./timeline.js";
export { validateRecorderConfig, validateScreenScript } from "./validation.js";
export { findWindow, getDesktopMetrics, listWindows } from "./windows.js";
export type {
  AudioManifestEntry, AudioSource, AudioTrack, CameraCue, CameraTarget, Caption, CaptionAnchor,
  CaptionTransition, CaptureProject, CaptureSource, DesktopMetrics, DoctorCheck, DoctorResult,
  InputControlOptions, MovementEasing, MouseButton, Point, PointerSample, RecordedAction,
  RecorderConfig, Rect, RenderOptions, RenderResult, ResolvedSpeedSegment, RunScriptOptions,
  ScreenManifest, ScreenScript, ScriptRenderOptions, ScriptStep, SpeedSegment, TimelineMark, WindowInfo,
} from "./types.js";
