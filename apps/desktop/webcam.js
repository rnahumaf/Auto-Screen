import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { probeMedia } from "./runtime/index.js";

const READY_TIMEOUT_MS = 10_000;

function consumeJpegBytes(target, chunk) {
  target.previewBuffer = Buffer.concat([target.previewBuffer, chunk]);
  while (true) {
    const start = target.previewBuffer.indexOf(Buffer.from([0xff, 0xd8]));
    if (start < 0) { target.previewBuffer = Buffer.alloc(0); return; }
    if (start > 0) target.previewBuffer = target.previewBuffer.subarray(start);
    const end = target.previewBuffer.indexOf(Buffer.from([0xff, 0xd9]), 2);
    if (end < 0) {
      if (target.previewBuffer.length > 1_000_000) target.previewBuffer = Buffer.alloc(0);
      return;
    }
    const jpeg = target.previewBuffer.subarray(0, end + 2);
    target.previewFrame = { at: Date.now(), jpeg: jpeg.toString("base64") };
    target.previewBuffer = target.previewBuffer.subarray(end + 2);
    target.onPreviewFrame?.(target.previewFrame);
  }
}

export async function listDirectShowDevices(kind, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg") {
  if (kind !== "video" && kind !== "audio") throw new TypeError("Tipo de dispositivo inválido.");
  const child = spawn(ffmpegPath, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
    windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"],
  });
  let output = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { output += chunk; });
  await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", resolvePromise);
  });
  const devices = [];
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[dshow[^\]]*\]\s+"([^"]+)" \((video|audio)\)/);
    if (!match || match[2] !== kind) continue;
    const next = lines[index + 1]?.match(/Alternative name "([^"]+)"/);
    const id = next?.[1] ?? match[1];
    devices.push({ id, name: match[1] });
  }
  return devices;
}

export async function listWebcams(ffmpegPath) {
  return listDirectShowDevices("video", ffmpegPath);
}

async function runFfmpeg(ffmpegPath, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`A extração do microfone falhou: ${stderr.trim()}`)));
  });
}

export class WebcamRecorderSession {
  constructor({ deviceId, microphoneDeviceId, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg" }) {
    if (typeof deviceId !== "string" || !deviceId) throw new TypeError("Escolha uma webcam válida.");
    if (microphoneDeviceId !== undefined && (typeof microphoneDeviceId !== "string" || !microphoneDeviceId)) throw new TypeError("Escolha um microfone válido.");
    this.deviceId = deviceId;
    this.microphoneDeviceId = microphoneDeviceId;
    this.ffmpegPath = ffmpegPath;
    this.workDirectory = undefined;
    this.path = undefined;
    this.child = undefined;
    this.exit = undefined;
    this.epochMs = 0;
    this.startedAtMs = 0;
    this.stopped = false;
    this.previewFrame = undefined;
    this.previewBuffer = Buffer.alloc(0);
  }

  async start() {
    this.workDirectory = await mkdtemp(join(tmpdir(), "auto-screen-webcam-"));
    this.path = join(this.workDirectory, "webcam.mkv");
    const args = [
      "-y", "-hide_banner", "-loglevel", "warning", "-progress", "pipe:2", "-stats_period", "0.05",
      "-thread_queue_size", "512", "-use_video_device_timestamps", "false", "-f", "dshow", "-i",
      this.microphoneDeviceId ? `video=${this.deviceId}:audio=${this.microphoneDeviceId}` : `video=${this.deviceId}`,
      "-filter_complex", "[0:v]split=2[record-source][preview-source];[record-source]fps=30[record];[preview-source]fps=5,scale=320:-2[preview]",
      "-map", "[record]", ...(this.microphoneDeviceId ? ["-map", "0:a:0"] : ["-an"]),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
      "-pix_fmt", "yuv420p", "-fps_mode", "passthrough",
      ...(this.microphoneDeviceId ? ["-af", "aresample=async=1000:first_pts=0", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le"] : []),
      this.path,
      "-map", "[preview]", "-an", "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1",
    ];
    const processStartedAt = performance.now();
    this.startedAtMs = processStartedAt;
    this.child = spawn(this.ffmpegPath, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => this.consumePreviewBytes(chunk));
    let stderr = "";
    let buffer = "";
    let progress = {};
    let ready = false;
    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise;
      rejectReady = rejectPromise;
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-32_768);
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0) continue;
        progress[line.slice(0, separator)] = line.slice(separator + 1);
        if (!line.startsWith("progress=")) continue;
        if (Number(progress.frame ?? 0) > 0) {
          const observedAt = performance.now();
          const outputTimeMs = Math.max(0, Number(progress.out_time_us ?? 0) / 1_000 || 0);
          const candidate = Math.max(processStartedAt, observedAt - outputTimeMs);
          this.epochMs = this.epochMs === 0 ? candidate : Math.min(this.epochMs, candidate);
          if (!ready) { ready = true; resolveReady(); }
        }
        progress = {};
      }
    });
    this.exit = new Promise((resolvePromise, rejectPromise) => {
      this.child.once("error", (error) => { rejectReady(error); rejectPromise(error); });
      this.child.once("close", (code) => {
        if (!ready) rejectReady(new Error(`A webcam não entregou quadros: ${stderr.trim()}`));
        resolvePromise({ code: code ?? -1, stderr });
      });
    });
    let timer;
    try {
      await Promise.race([
        readyPromise,
        new Promise((_, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(new Error("A webcam não entregou quadros em dez segundos.")), READY_TIMEOUT_MS);
        }),
      ]);
      return this;
    } catch (error) {
      if (this.child.exitCode === null) this.child.kill();
      await this.exit.catch(() => undefined);
      await this.cleanup();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  consumePreviewBytes(chunk) {
    consumeJpegBytes(this, chunk);
  }

  async stop() {
    if (!this.child || !this.exit || this.stopped) throw new Error("A sessão da webcam não está ativa.");
    this.stopped = true;
    const stoppedAt = performance.now();
    if (this.child.exitCode === null && this.child.stdin.writable) this.child.stdin.write("q\n");
    const result = await this.exit;
    if (result.code !== 0) throw new Error(`A gravação da webcam falhou: ${result.stderr.trim()}`);
    const probe = await probeMedia(this.path, this.ffmpegPath);
    if (!probe.streams.some((stream) => stream.codecType === "video") || probe.durationSeconds <= 0) {
      throw new Error("A webcam não gerou vídeo válido.");
    }
    const video = probe.streams.find((stream) => stream.codecType === "video");
    const audio = probe.streams.find((stream) => stream.codecType === "audio");
    const originMs = stoppedAt - probe.durationSeconds * 1_000;
    const videoStart = video?.startTimeSeconds ?? 0;
    const videoDuration = video?.durationSeconds ?? Math.max(0, probe.durationSeconds - videoStart);
    if (videoDuration <= 0) throw new Error("A webcam não produziu quadros com timestamps válidos.");
    const epochMs = originMs + videoStart * 1_000;
    const resultMedia = { path: this.path, epochMs, endMs: epochMs + videoDuration * 1_000, durationSeconds: videoDuration };
    if (!this.microphoneDeviceId) return resultMedia;
    if (!audio) throw new Error("A captura conjunta não contém áudio do microfone.");
    const microphonePath = join(this.workDirectory, "microphone.wav");
    await runFfmpeg(this.ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "warning", "-i", this.path,
      "-map", "0:a:0", "-vn", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", microphonePath,
    ]);
    const microphoneProbe = await probeMedia(microphonePath, this.ffmpegPath);
    if (microphoneProbe.durationSeconds <= 0) throw new Error("A captura conjunta não gerou áudio válido.");
    const microphoneEpoch = originMs + (audio.startTimeSeconds ?? 0) * 1_000;
    return {
      ...resultMedia,
      microphone: {
        path: microphonePath,
        epochMs: microphoneEpoch,
        endMs: microphoneEpoch + microphoneProbe.durationSeconds * 1_000,
        durationSeconds: microphoneProbe.durationSeconds,
      },
    };
  }

  async cleanup() {
    if (this.child?.exitCode === null) {
      this.child.kill();
      await this.exit?.catch(() => undefined);
    }
    const directory = this.workDirectory && resolve(this.workDirectory);
    if (!directory) return;
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith("auto-screen-webcam-")) {
      throw new Error("Diretório temporário da webcam fora do local esperado.");
    }
    await rm(directory, { recursive: true, force: true });
    this.workDirectory = undefined;
  }
}

export class WebcamPreviewSession {
  constructor({ deviceId, onFrame, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg" }) {
    if (typeof deviceId !== "string" || !deviceId) throw new TypeError("Escolha uma webcam válida.");
    this.deviceId = deviceId;
    this.ffmpegPath = ffmpegPath;
    this.onPreviewFrame = onFrame;
    this.previewFrame = undefined;
    this.previewBuffer = Buffer.alloc(0);
    this.child = undefined;
    this.exit = undefined;
  }

  async start() {
    const args = [
      "-hide_banner", "-loglevel", "warning",
      "-use_video_device_timestamps", "false", "-f", "dshow", "-i", `video=${this.deviceId}`,
      "-an", "-vf", "fps=10,scale=640:-2", "-c:v", "mjpeg", "-q:v", "4",
      "-f", "image2pipe", "pipe:1",
    ];
    this.child = spawn(this.ffmpegPath, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let resolveReady;
    const ready = new Promise((resolvePromise) => { resolveReady = resolvePromise; });
    this.child.stdout.on("data", (chunk) => {
      consumeJpegBytes(this, chunk);
      if (this.previewFrame) resolveReady();
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
    this.exit = new Promise((resolvePromise, rejectPromise) => {
      this.child.once("error", rejectPromise);
      this.child.once("close", (code) => resolvePromise({ code: code ?? -1, stderr }));
    });
    let timer;
    try {
      await Promise.race([
        ready,
        this.exit.then((result) => { throw new Error(`A webcam encerrou a prévia (código ${result.code}): ${result.stderr.trim()}`); }),
        new Promise((_, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(new Error("A webcam não mostrou imagem em dez segundos.")), READY_TIMEOUT_MS);
        }),
      ]);
      return this;
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async stop() {
    if (!this.child) return;
    if (this.child.exitCode === null && this.child.stdin.writable) this.child.stdin.write("q\n");
    const timer = setTimeout(() => { if (this.child?.exitCode === null) this.child.kill(); }, 2_000);
    try { await this.exit; }
    finally {
      clearTimeout(timer);
      this.child = undefined;
      this.exit = undefined;
      this.previewFrame = undefined;
    }
  }

  abort() {
    if (this.child?.exitCode === null) this.child.kill();
  }
}
