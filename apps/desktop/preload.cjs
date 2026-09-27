const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("autoScreen", {
  getState: () => invoke("app:get-state"),
  bootstrap: () => invoke("app:bootstrap"),
  refreshDoctor: () => invoke("app:refresh-doctor"),
  listDisplays: () => invoke("app:list-displays"),
  listWindows: () => invoke("app:list-windows"),
  listWebcams: () => invoke("app:list-webcams"),
  listMicrophones: () => invoke("app:list-microphones"),
  previewCamera: (deviceId) => invoke("app:preview-camera", deviceId),
  stopCameraPreview: () => invoke("app:stop-camera-preview"),
  selectDisplay: (index) => invoke("app:select-display", index),
  selectWindow: (handle) => invoke("app:select-window", handle),
  selectRegion: () => invoke("app:select-region"),
  updateSettings: (patch) => invoke("app:update-settings", patch),
  chooseOutputDirectory: () => invoke("app:choose-output-directory"),
  startRecording: (options) => invoke("recording:start", options),
  pauseOrResume: () => invoke("recording:pause-resume"),
  retryPreview: () => invoke("recording:retry-preview"),
  stopRecording: () => invoke("recording:stop"),
  saveRecording: () => invoke("recording:save"),
  discardRecording: () => invoke("recording:discard"),
  openOutput: () => invoke("recording:open-output"),
  storeOpenRouterKey: (value) => invoke("voice:store-key", value),
  removeOpenRouterKey: () => invoke("voice:remove-key"),
  chooseVoiceReference: () => invoke("voice:choose-reference"),
  useRecordedVoiceReference: () => invoke("voice:recorded-reference"),
  processVoiceLocal: (options) => invoke("voice:process-local", options),
  restoreOriginalVoice: () => invoke("voice:original"),
  adjustVoiceSync: (milliseconds) => invoke("voice:sync", milliseconds),
  transcribeVoice: () => invoke("voice:transcribe"),
  generateVoice: (options) => invoke("voice:generate", options),
  applyWebcamFilters: (options) => invoke("webcam-effects:apply", options),
  confirmRegion: (rect) => ipcRenderer.send("region:confirm", rect),
  cancelRegion: () => ipcRenderer.send("region:cancel"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("recording:state", listener);
    return () => ipcRenderer.removeListener("recording:state", listener);
  },
  onSetupCameraFrame: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("setup-camera:frame", listener);
    return () => ipcRenderer.removeListener("setup-camera:frame", listener);
  },
  onOverlayConfig: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("overlay:configure", listener);
    return () => ipcRenderer.removeListener("overlay:configure", listener);
  },
  onOverlayPaused: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("overlay:paused", listener);
    return () => ipcRenderer.removeListener("overlay:paused", listener);
  },
  onOverlayFrame: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("overlay:frame", listener);
    return () => ipcRenderer.removeListener("overlay:frame", listener);
  },
  reportOverlayCameraState: (state) => ipcRenderer.send("overlay:camera-state", state),
  onWebcamEffectsConfig: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("webcam-effects:configure", listener);
    return () => ipcRenderer.removeListener("webcam-effects:configure", listener);
  },
  appendWebcamEffectsChunk: (token, bytes) => invoke("webcam-effects:chunk", token, bytes),
  completeWebcamEffects: (token, error) => invoke("webcam-effects:complete", token, error),
});
