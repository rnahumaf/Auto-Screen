import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { enhanceVoiceLocal, fitGeneratedVoice, makeApiAudio, makeVoiceReference } from "../apps/desktop/voice.js";
import { synthesizeSeedAudio, transcribeOpenRouter } from "../apps/desktop/openrouter.js";
import { probeMedia } from "../dist/index.js";

function tone(output, duration = 2) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", String(duration), "-ac", "1", output,
    ], { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`FFmpeg retornou ${code}.`)));
  });
}

test("aplica o modelo local de voz e ajusta a duração da narração", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-screen-voice-test-"));
  const previous = process.env.AUTO_SCREEN_ASSETS_DIR;
  process.env.AUTO_SCREEN_ASSETS_DIR = resolve("assets");
  try {
    const original = join(directory, "original.wav");
    const cleaned = join(directory, "cleaned.wav");
    const fitted = join(directory, "fitted.wav");
    await tone(original);
    await enhanceVoiceLocal(original, cleaned, 0.7);
    const cleanProbe = await probeMedia(cleaned);
    assert.ok(cleanProbe.durationSeconds > 1.9 && cleanProbe.durationSeconds < 2.1);
    assert.notDeepEqual(await readFile(cleaned), await readFile(original));
    const spectral = join(directory, "spectral.wav");
    await enhanceVoiceLocal(original, spectral, 0.7, "spectral");
    const spectralProbe = await probeMedia(spectral);
    assert.ok(Math.abs(spectralProbe.durationSeconds - 2) < 0.1);
    const result = await fitGeneratedVoice(original, fitted, 2.5);
    assert.ok(result.speedRatio > 0.79 && result.speedRatio < 0.81);
    const fittedProbe = await probeMedia(fitted);
    assert.ok(Math.abs(fittedProbe.durationSeconds - 2.5) < 0.1);
  } finally {
    if (previous === undefined) delete process.env.AUTO_SCREEN_ASSETS_DIR;
    else process.env.AUTO_SCREEN_ASSETS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("envia áudio para transcrição e referência autorizada para síntese no formato documentado", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-screen-api-test-"));
  try {
    const sample = join(directory, "reference.wav");
    const apiAudio = join(directory, "api-input.mp3");
    const output = join(directory, "synthesized.mp3");
    await tone(sample, 0.5);
    await makeApiAudio(sample, apiAudio);
    const requests = [];
    const fetcher = async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return url.endsWith("/audio/transcriptions")
        ? Response.json({ text: "  Texto revisável  " })
        : new Response(Buffer.from("synthetic-mp3"), { headers: { "content-type": "audio/mpeg" } });
    };
    assert.equal(await transcribeOpenRouter(apiAudio, "test-key", fetcher), "Texto revisável");
    await synthesizeSeedAudio({
      text: "Nova narração", key: "test-key", referencePath: sample,
      referenceTranscript: "Voz de amostra", outputPath: output,
    }, fetcher);
    assert.equal(requests[0].body.model, "openai/whisper-large-v3");
    assert.equal(requests[0].body.input_audio.format, "mp3");
    assert.equal(requests[1].body.model, "bytedance-seed/seed-audio-1-0");
    assert.equal(requests[1].body.input_references[0].type, "input_audio");
    assert.match(requests[1].body.input_references[0].input_audio.data, /^data:audio\/wav;base64,/);
    assert.equal(requests[1].body.input_references[1].text, "Voz de amostra");
    assert.equal((await readFile(output)).toString(), "synthetic-mp3");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("prepara um trecho da própria gravação como referência local de voz", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-screen-recorded-reference-"));
  try {
    const input = join(directory, "voice.wav");
    const reference = join(directory, "reference.mp3");
    await tone(input, 20);
    const result = await makeVoiceReference(input, reference);
    assert.ok(result.durationSeconds >= 14 && result.durationSeconds <= 15.1);
    const probe = await probeMedia(reference);
    assert.ok(probe.streams.some((stream) => stream.codecType === "audio"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tenta outro provedor de transcrição quando o OpenRouter retorna 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-screen-stt-fallback-"));
  try {
    const audioPath = join(directory, "input.mp3");
    await tone(join(directory, "source.wav"), 0.3);
    await makeApiAudio(join(directory, "source.wav"), audioPath);
    const attemptedModels = [];
    const result = await transcribeOpenRouter(audioPath, "test-key", async (_url, options) => {
      const model = JSON.parse(options.body).model;
      attemptedModels.push(model);
      return model === "openai/whisper-large-v3"
        ? new Response("", { status: 404 })
        : Response.json({ text: "Voz reconhecida" });
    });
    assert.equal(result, "Voz reconhecida");
    assert.deepEqual(attemptedModels, ["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
