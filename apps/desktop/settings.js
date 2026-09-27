import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const POSITIONS = new Set([
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

export function defaultSettings(videosDirectory) {
  return {
    fps: 60,
    cursorMode: "software",
    quality: "balanced",
    outputDirectory: videosDirectory,
    autoSave: false,
    microphone: { enabled: false, deviceId: "", latencyMs: 0, latencyByDevice: {} },
    voice: { localMethod: "rnnoise", localStrength: 70 },
    webcam: {
      enabled: false,
      deviceId: "",
      size: "medium",
      shape: "square",
      border: "none",
      borderColor: "#3560C9",
      position: "bottom-right",
      backgroundBlur: 0,
      faceRetouch: 0,
    },
  };
}

function oneOf(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

export function normalizeSettings(input, videosDirectory) {
  const defaults = defaultSettings(videosDirectory);
  const raw = input && typeof input === "object" ? input : {};
  const webcam = raw.webcam && typeof raw.webcam === "object" ? raw.webcam : {};
  const microphone = raw.microphone && typeof raw.microphone === "object" ? raw.microphone : {};
  const latencyByDevice = Object.fromEntries(
    Object.entries(microphone.latencyByDevice && typeof microphone.latencyByDevice === "object" ? microphone.latencyByDevice : {})
      .filter(([id, value]) => typeof id === "string" && id.length > 0 && id.length <= 1_024 &&
        Number.isInteger(value) && value >= 0 && value <= 1_000 && value % 25 === 0)
      .slice(0, 32),
  );
  const microphoneDeviceId = typeof microphone.deviceId === "string" ? microphone.deviceId.slice(0, 1_024) : "";
  const voice = raw.voice && typeof raw.voice === "object" ? raw.voice : {};
  const outputDirectory = typeof raw.outputDirectory === "string" && raw.outputDirectory.trim()
    ? resolve(raw.outputDirectory) : videosDirectory;
  return {
    fps: raw.fps === 30 ? 30 : 60,
    cursorMode: oneOf(raw.cursorMode, ["software", "native", "hidden"], defaults.cursorMode),
    quality: oneOf(raw.quality, ["high", "balanced", "compact"], defaults.quality),
    outputDirectory,
    autoSave: raw.autoSave === true,
    microphone: {
      enabled: microphone.enabled === true,
      deviceId: microphoneDeviceId,
      latencyMs: Object.hasOwn(latencyByDevice, microphoneDeviceId) ? latencyByDevice[microphoneDeviceId] : 0,
      latencyByDevice,
    },
    voice: {
      localMethod: oneOf(voice.localMethod, ["rnnoise", "spectral"], defaults.voice.localMethod),
      localStrength: Number.isFinite(Number(voice.localStrength))
        ? Math.max(10, Math.min(100, Math.round(Number(voice.localStrength) / 5) * 5))
        : defaults.voice.localStrength,
    },
    webcam: {
      enabled: webcam.enabled === true,
      deviceId: typeof webcam.deviceId === "string" ? webcam.deviceId.slice(0, 1_024) : "",
      size: oneOf(webcam.size, ["small", "medium", "large"], defaults.webcam.size),
      shape: oneOf(webcam.shape, ["square", "circle"], defaults.webcam.shape),
      border: oneOf(webcam.border, ["none", "black", "color"], defaults.webcam.border),
      borderColor: /^#[0-9a-fA-F]{6}$/.test(webcam.borderColor) ? webcam.borderColor.toUpperCase() : defaults.webcam.borderColor,
      position: POSITIONS.has(webcam.position) ? webcam.position : defaults.webcam.position,
      backgroundBlur: Number.isFinite(Number(webcam.backgroundBlur)) ? Math.max(0, Math.min(100, Math.round(Number(webcam.backgroundBlur)))) : 0,
      faceRetouch: Number.isFinite(Number(webcam.faceRetouch)) ? Math.max(0, Math.min(100, Math.round(Number(webcam.faceRetouch)))) : 0,
    },
  };
}

export class SettingsStore {
  constructor(path, videosDirectory) {
    this.path = path;
    this.videosDirectory = videosDirectory;
    this.value = defaultSettings(videosDirectory);
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    try {
      this.value = normalizeSettings(JSON.parse(await readFile(this.path, "utf8")), this.videosDirectory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error(`Não foi possível ler as preferências: ${error.message}`);
    }
    return this.value;
  }

  async update(patch) {
    const raw = patch && typeof patch === "object" ? patch : {};
    this.pendingWrite = this.pendingWrite.catch(() => undefined).then(async () => {
      const microphonePatch = raw.microphone && typeof raw.microphone === "object" ? raw.microphone : {};
      const deviceId = typeof microphonePatch.deviceId === "string" ? microphonePatch.deviceId : this.value.microphone.deviceId;
      const requestedLatency = Number(microphonePatch.latencyMs);
      const latencyByDevice = {
        ...this.value.microphone.latencyByDevice,
        ...(microphonePatch.latencyByDevice && typeof microphonePatch.latencyByDevice === "object" ? microphonePatch.latencyByDevice : {}),
      };
      if (Object.hasOwn(microphonePatch, "latencyMs") && deviceId) latencyByDevice[deviceId] = requestedLatency;
      const next = normalizeSettings({
        ...this.value,
        ...raw,
        webcam: { ...this.value.webcam, ...(raw.webcam && typeof raw.webcam === "object" ? raw.webcam : {}) },
        microphone: { ...this.value.microphone, ...microphonePatch, latencyByDevice },
        voice: { ...this.value.voice, ...(raw.voice && typeof raw.voice === "object" ? raw.voice : {}) },
      }, this.videosDirectory);
      await mkdir(dirname(this.path), { recursive: true });
      const stagingPath = join(dirname(this.path), `settings-${randomUUID()}.tmp`);
      await writeFile(stagingPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(stagingPath, this.path);
      this.value = next;
      return next;
    });
    return await this.pendingWrite;
  }
}
