import { readFile, stat, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const BASE_URL = "https://openrouter.ai/api/v1";
const TTS_MODEL = "bytedance-seed/seed-audio-1-0";
const STT_MODELS = ["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"];
const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

function apiError(status) {
  if (status === 401 || status === 403) return new Error("A chave OpenRouter foi recusada. Confira a chave e as permissões.");
  if (status === 402) return new Error("A conta OpenRouter não possui crédito suficiente para esta operação.");
  if (status === 429) return new Error("O limite de chamadas do OpenRouter foi atingido. Tente mais tarde.");
  const error = new Error(status === 404
    ? "O OpenRouter não encontrou uma rota para o modelo solicitado (HTTP 404)."
    : `O OpenRouter não concluiu a operação (HTTP ${status}).`);
  error.status = status;
  return error;
}

async function request(path, key, body, fetcher) {
  const response = await fetcher(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Auto-Screen",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw apiError(response.status);
  return response;
}

export async function transcribeOpenRouter(audioPath, key, fetcher = fetch) {
  const audio = await readFile(audioPath);
  const inputAudio = { data: audio.toString("base64"), format: "mp3" };
  for (const [index, model] of STT_MODELS.entries()) {
    let response;
    try {
      response = await request("/audio/transcriptions", key, {
        model, input_audio: inputAudio, language: "pt", response_format: "json",
      }, fetcher);
    } catch (error) {
      if (error?.status === 404 && index < STT_MODELS.length - 1) continue;
      if (error?.status === 404) {
        throw new Error("O OpenRouter retornou HTTP 404 para os dois modelos de transcrição disponíveis. Confira o acesso à API e tente mais tarde.");
      }
      throw error;
    }
    const payload = await response.json();
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) throw new Error("A transcrição não retornou texto. Confira se o microfone captou voz.");
    return text;
  }
  throw new Error("Nenhum modelo de transcrição está disponível.");
}

function referenceMime(path) {
  const extension = extname(path).toLowerCase();
  return { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg" }[extension];
}

export async function synthesizeSeedAudio({ text, key, referencePath, referenceTranscript, outputPath }, fetcher = fetch) {
  const input = typeof text === "string" ? text.trim() : "";
  if (!input || input.length > 12_000) throw new RangeError("O texto da narração deve ter entre 1 e 12.000 caracteres.");
  const body = { model: TTS_MODEL, input, response_format: "mp3" };
  if (referencePath) {
    const mime = referenceMime(referencePath);
    if (!mime) throw new TypeError("A amostra precisa ser WAV, MP3, M4A ou OGG.");
    const info = await stat(referencePath);
    if (!info.isFile() || info.size > MAX_REFERENCE_BYTES) throw new RangeError("A amostra de voz deve ter no máximo 15 MiB.");
    const reference = await readFile(referencePath);
    body.input_references = [{ type: "input_audio", input_audio: { data: `data:${mime};base64,${reference.toString("base64")}` } }];
    const transcript = typeof referenceTranscript === "string" ? referenceTranscript.trim() : "";
    if (transcript) body.input_references.push({ type: "text", text: transcript.slice(0, 1_000) });
  }
  const response = await request("/audio/speech", key, body, fetcher);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/")) throw new Error("A API não retornou um arquivo de áudio.");
  const advertisedSize = Number(response.headers.get("content-length") ?? 0);
  if (advertisedSize > MAX_RESPONSE_BYTES) throw new Error("O áudio gerado excede o limite de 20 MiB.");
  const output = Buffer.from(await response.arrayBuffer());
  if (output.length === 0 || output.length > MAX_RESPONSE_BYTES) throw new Error("A API retornou um áudio vazio ou grande demais.");
  await writeFile(outputPath, output);
  return { path: outputPath, bytes: output.length };
}

export const openRouterModels = { transcription: STT_MODELS[0], transcriptionFallback: STT_MODELS[1], speech: TTS_MODEL };
