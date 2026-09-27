import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { probeMedia } from "./runtime/index.js";

const MODEL_SHA256 = "f1357c4e5be9dee8467bead486dfced2d75b640c26ad0b594fa7f102322371d9";

async function runFfmpeg(ffmpegPath, args, cwd) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, args, { cwd, windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`O FFmpeg não concluiu o processamento da voz: ${stderr.trim()}`)));
  });
}

async function assertAudio(path, ffmpegPath) {
  const probe = await probeMedia(path, ffmpegPath);
  if (!probe.streams.some((stream) => stream.codecType === "audio") || probe.durationSeconds <= 0) {
    throw new Error("O processamento não produziu uma faixa de voz válida.");
  }
  return probe.durationSeconds;
}

export async function enhanceVoiceLocal(input, output, strength, method = "rnnoise", ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg") {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError("A intensidade da limpeza deve ficar entre 0 e 100%.");
  if (!["rnnoise", "spectral"].includes(method)) throw new TypeError("Escolha um processamento local válido.");
  let filter;
  let cwd;
  if (method === "rnnoise") {
    const modelPath = join(process.env.AUTO_SCREEN_ASSETS_DIR ?? "", "models", "voice-denoise.rnnn");
    const model = await readFile(modelPath);
    if (createHash("sha256").update(model).digest("hex") !== MODEL_SHA256) {
      throw new Error("O modelo local de redução de ruído está ausente ou foi alterado.");
    }
    filter = `arnndn=m=${basename(modelPath)}:mix=${Math.max(0.05, strength).toFixed(2)}`;
    cwd = dirname(modelPath);
  } else {
    filter = `afftdn=nr=${(5 + strength * 20).toFixed(1)}:tn=1`;
  }
  await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "warning", "-i", input,
    "-af", `highpass=f=70,${filter},acompressor=threshold=-20dB:ratio=2:attack=15:release=120`,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ], cwd);
  return { path: output, durationSeconds: await assertAudio(output, ffmpegPath) };
}

function tempoFilters(ratio) {
  const filters = [];
  let remaining = ratio;
  while (remaining > 2) { filters.push("atempo=2"); remaining /= 2; }
  while (remaining < 0.5) { filters.push("atempo=0.5"); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}

export async function fitGeneratedVoice(input, output, targetSeconds, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg") {
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new RangeError("A duração alvo é inválida.");
  const sourceSeconds = await assertAudio(input, ffmpegPath);
  const ratio = sourceSeconds / targetSeconds;
  if (ratio < 0.25 || ratio > 4) {
    throw new Error("A duração da voz gerada difere demais do vídeo. Ajuste o texto e gere novamente.");
  }
  await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "warning", "-i", input,
    "-af", [...tempoFilters(ratio), "apad", `atrim=duration=${targetSeconds}`].join(","),
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ]);
  return { path: output, durationSeconds: await assertAudio(output, ffmpegPath), speedRatio: ratio };
}

export async function makeApiAudio(input, output, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg") {
  await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "warning", "-i", input,
    "-vn", "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", output,
  ]);
  return { path: output, durationSeconds: await assertAudio(output, ffmpegPath) };
}

export async function makeVoiceReference(input, output, ffmpegPath = process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg") {
  await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "warning", "-i", input,
    "-vn", "-af", "silenceremove=start_periods=1:start_duration=0.1:start_threshold=-42dB,atrim=duration=15,asetpts=PTS-STARTPTS",
    "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", output,
  ]);
  const durationSeconds = await assertAudio(output, ffmpegPath);
  if (durationSeconds < 1) throw new Error("A gravação não contém fala suficiente para servir de referência de voz.");
  return { path: output, durationSeconds };
}
