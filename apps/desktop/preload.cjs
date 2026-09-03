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
  selectDisplay: (index) => invoke("app:select-display", index),
  selectWindow: (handle) => invoke("app:select-window", handle),
  selectRegion: () => invoke("app:select-region"),
  startRecording: (options) => invoke("recording:start", options),
  pauseOrResume: () => invoke("recording:pause-resume"),
  stopRecording: () => invoke("recording:stop"),
  saveRecording: () => invoke("recording:save"),
  discardRecording: () => invoke("recording:discard"),
  openOutput: () => invoke("recording:open-output"),
  confirmRegion: (rect) => ipcRenderer.send("region:confirm", rect),
  cancelRegion: () => ipcRenderer.send("region:cancel"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("recording:state", listener);
    return () => ipcRenderer.removeListener("recording:state", listener);
  },
});
