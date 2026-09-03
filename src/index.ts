export { midiAudioSource, renderMidiToWav } from "./audio.js";
export { buildAssDocument } from "./captions.js";
export { runDoctor } from "./doctor.js";
export { probeMedia, probeVideoCadence } from "./ffmpeg.js";
export { cleanupScreenProject, createScreenRecorder, ScreenRecorderSession } from "./recorder.js";
export { inputToPhysicalPoint, inputToPhysicalRect, physicalToInputPoint } from "./coordinates.js";
export { renderScreenProject } from "./render.js";
export { loadScreenScript, runScreenScript } from "./script.js";
export { buildSpeedMap, outputDuration, sourceToOutputTime } from "./timeline.js";
export { validateCaptureProject, validateRecorderConfig, validateRenderOptions, validateScreenScript } from "./validation.js";
export { findWindow, getDesktopMetrics, listDisplays, listWindows } from "./windows.js";
export type {
  AudioManifestEntry, AudioSource, AudioTrack, CameraCue, CameraTarget, Caption, CaptionAnchor,
  CaptionTransition, CaptureBackend, CaptureProject, CaptureSource, DesktopMetrics, DisplayInfo, DoctorCheck, DoctorResult,
  CursorMode, InputControlOptions, KeyboardKey, KeyboardModifier, MovementEasing, MouseButton, Point, PointerSample, RecordedAction,
  RecorderConfig, Rect, RenderOptions, RenderResult, ResolvedSpeedSegment, RunScriptOptions,
  ScreenManifest, ScreenScript, ScriptRenderOptions, ScriptStep, SpeedSegment, TimelineMark, VideoCadence, WindowInfo,
} from "./types.js";
