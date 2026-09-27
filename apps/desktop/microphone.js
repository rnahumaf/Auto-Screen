import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { probeMedia } from "./runtime/index.js";
import { listDirectShowDevices } from "./webcam.js";

export async function listMicrophones(ffmpegPath) {
  return listDirectShowDevices("audio", ffmpegPath);
}

export class MicrophoneRecorderSession {
  constructor({ deviceId, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg" }) {
    if (typeof deviceId !== "string" || !deviceId) throw new TypeError("Escolha um microfone válido.");
    this.deviceId = deviceId;
    this.ffmpegPath = ffmpegPath;
    this.directory = undefined;
    this.path = undefined;
    this.child = undefined;
    this.exit = undefined;
    this.epochMs = 0;
    this.startedAtMs = 0;
    this.stopped = false;
  }

  async start() {
    this.directory = await mkdtemp(join(tmpdir(), "auto-screen-microphone-"));
    this.path = join(this.directory, "microphone.wav");
    const args = [
      "-y", "-hide_banner", "-loglevel", "warning", "-progress", "pipe:1", "-stats_period", "0.05",
      "-thread_queue_size", "512", "-f", "dshow", "-i", `audio=${this.deviceId}`,
      "-vn", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", this.path,
    ];
    const startedAt = performance.now();
    this.startedAtMs = startedAt;
    this.child = spawn(this.ffmpegPath, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
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
    this.child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_768); });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0) continue;
        progress[line.slice(0, separator)] = line.slice(separator + 1);
        if (!line.startsWith("progress=")) continue;
        const outputTimeMs = Number(progress.out_time_us ?? 0) / 1_000;
        if (outputTimeMs > 0) {
          const candidate = Math.max(startedAt, performance.now() - outputTimeMs);
          this.epochMs = this.epochMs === 0 ? candidate : Math.min(this.epochMs, candidate);
          if (!ready) { ready = true; resolveReady(); }
        }
        progress = {};
      }
    });
    this.exit = new Promise((resolvePromise, rejectPromise) => {
      this.child.once("error", (error) => { rejectReady(error); rejectPromise(error); });
      this.child.once("close", (code) => {
        if (!ready) rejectReady(new Error(`O microfone não entregou áudio: ${stderr.trim()}`));
        resolvePromise({ code: code ?? -1, stderr });
      });
    });
    let timer;
    try {
      await Promise.race([
        readyPromise,
        new Promise((_, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(new Error("O microfone não entregou áudio em dez segundos.")), 10_000);
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

  async stop() {
    if (!this.child || !this.exit || this.stopped) throw new Error("A sessão do microfone não está ativa.");
    this.stopped = true;
    const stoppedAt = performance.now();
    if (this.child.exitCode === null && this.child.stdin.writable) this.child.stdin.write("q\n");
    const result = await this.exit;
    if (result.code !== 0) throw new Error(`A gravação do microfone falhou: ${result.stderr.trim()}`);
    const probe = await probeMedia(this.path, this.ffmpegPath);
    if (!probe.streams.some((stream) => stream.codecType === "audio") || probe.durationSeconds <= 0) {
      throw new Error("O microfone não gerou áudio válido.");
    }
    // O progresso do DirectShow pode usar timestamps do dispositivo com atraso na
    // inicialização. A duração do WAV final e o instante de parada formam a
    // referência correta para alinhar a faixa à captura da tela.
    const epochMs = Math.max(this.startedAtMs, stoppedAt - probe.durationSeconds * 1_000);
    return { path: this.path, epochMs, endMs: stoppedAt, durationSeconds: probe.durationSeconds };
  }

  async cleanup() {
    if (this.child?.exitCode === null) {
      this.child.kill();
      await this.exit?.catch(() => undefined);
    }
    const directory = this.directory && resolve(this.directory);
    if (!directory) return;
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith("auto-screen-microphone-")) {
      throw new Error("Diretório temporário do microfone fora do local esperado.");
    }
    await rm(directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}
