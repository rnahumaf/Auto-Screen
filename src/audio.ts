import { access, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  audioToWav, BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer,
} from "spessasynth_core";
import { probeMedia } from "./ffmpeg.js";
import type { AudioManifestEntry, AudioTrack } from "./types.js";

const SAMPLE_RATE = 48_000;
const BUFFER_SIZE = 128;

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function renderMidiToWav(
  midiInput: Uint8Array | string,
  soundfontPath: string,
  outputPath: string,
  tailSeconds = 1,
): Promise<{ durationSeconds: number; peak: number }> {
  const midiBytes = typeof midiInput === "string" ? await readFile(resolve(midiInput)) : midiInput;
  const soundfontBytes = await readFile(resolve(soundfontPath));
  const midi = BasicMIDI.fromArrayBuffer(exactArrayBuffer(midiBytes), typeof midiInput === "string" ? midiInput : "auto-screen.mid");
  const soundBank = SoundBankLoader.fromArrayBuffer(exactArrayBuffer(soundfontBytes));
  const synth = new SpessaSynthProcessor(SAMPLE_RATE, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(soundBank, "auto-screen");
  await synth.processorInitialized;
  synth.setSystemParameter("autoAllocateVoices", true);
  const sequencer = new SpessaSynthSequencer(synth);
  sequencer.loadNewSongList([midi]);
  sequencer.play();
  const sampleCount = Math.ceil(SAMPLE_RATE * (midi.duration + tailSeconds));
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  for (let offset = 0; offset < sampleCount; offset += BUFFER_SIZE) {
    sequencer.processTick();
    synth.process(left, right, offset, Math.min(BUFFER_SIZE, sampleCount - offset));
  }
  let peak = 0;
  for (const channel of [left, right]) {
    for (let index = 0; index < channel.length; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
  }
  const gain = peak > 0 ? Math.min(2, 0.9 / peak) : 1;
  const fadeSamples = Math.min(sampleCount, Math.round(SAMPLE_RATE * Math.min(tailSeconds, 1)));
  for (const channel of [left, right]) {
    for (let index = 0; index < channel.length; index += 1) {
      const fade = index >= channel.length - fadeSamples && fadeSamples > 0 ? (channel.length - index) / fadeSamples : 1;
      channel[index] = Math.tanh((channel[index] ?? 0) * gain) * fade;
    }
  }
  await writeFile(outputPath, new Uint8Array(audioToWav([left, right], SAMPLE_RATE, { normalizeAudio: false })));
  return { durationSeconds: midi.duration + tailSeconds, peak };
}

export function midiAudioSource(midi: Uint8Array | string, soundfontPath: string, tailSeconds = 1): AudioTrack["source"] {
  return { kind: "midi", midi, soundfontPath, tailSeconds };
}

export interface PreparedAudio {
  path: string;
  loop: boolean;
  startSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds?: number;
  durationSeconds: number;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  manifest: AudioManifestEntry;
}

export async function prepareAudioTracks(
  tracks: AudioTrack[], workDirectory: string, ffmpegPath: string, keepIntermediates: boolean,
): Promise<PreparedAudio[]> {
  const prepared: PreparedAudio[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index] as AudioTrack;
    let path: string;
    if (track.source.kind === "file") {
      path = resolve(track.source.path);
      await access(path);
    } else if (track.source.kind === "bytes") {
      path = join(workDirectory, `audio-${index + 1}.${track.source.format}`);
      await writeFile(path, track.source.bytes);
    } else {
      path = join(workDirectory, `midi-${index + 1}.wav`);
      await renderMidiToWav(track.source.midi, track.source.soundfontPath, path, track.source.tailSeconds ?? 1);
    }
    const probe = await probeMedia(path, ffmpegPath);
    const trimStart = track.trimStartSeconds ?? 0;
    const trimEnd = track.trimEndSeconds;
    if (trimStart >= probe.durationSeconds) throw new RangeError(`O corte inicial da faixa ${index + 1} excede sua duração.`);
    if (trimEnd !== undefined && (trimEnd <= trimStart || trimEnd > probe.durationSeconds)) {
      throw new RangeError(`O corte final da faixa ${index + 1} é inválido.`);
    }
    prepared.push({
      path,
      loop: track.loop ?? false,
      startSeconds: track.startSeconds ?? 0,
      trimStartSeconds: trimStart,
      ...(trimEnd === undefined ? {} : { trimEndSeconds: trimEnd }),
      durationSeconds: (trimEnd ?? probe.durationSeconds) - trimStart,
      volume: track.volume ?? 1,
      fadeInSeconds: track.fadeInSeconds ?? 0,
      fadeOutSeconds: track.fadeOutSeconds ?? 0,
      manifest: {
        id: track.id ?? `audio-${index + 1}`,
        kind: track.source.kind,
        startSeconds: track.startSeconds ?? 0,
        volume: track.volume ?? 1,
        ...(keepIntermediates && track.source.kind !== "file" ? { renderedPath: path } : {}),
      },
    });
  }
  return prepared;
}

export function audioInputArguments(tracks: PreparedAudio[], outputDurationSeconds: number): string[] {
  if (tracks.length === 0) {
    return ["-f", "lavfi", "-t", String(outputDurationSeconds), "-i", `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`];
  }
  const args: string[] = [];
  for (const track of tracks) {
    if (track.loop) args.push("-stream_loop", "-1");
    args.push("-i", track.path);
  }
  return args;
}

export function audioFilterGraph(tracks: PreparedAudio[], outputDurationSeconds: number): string[] {
  if (tracks.length === 0) return [`[1:a]atrim=duration=${outputDurationSeconds},asetpts=PTS-STARTPTS[aout]`];
  const lines: string[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index] as PreparedAudio;
    const available = Math.max(0, outputDurationSeconds - track.startSeconds);
    const localDuration = track.loop ? available : Math.min(track.durationSeconds, available);
    const fadeOutStart = Math.max(0, localDuration - track.fadeOutSeconds);
    const filters = [
      `atrim=start=${track.trimStartSeconds}${track.trimEndSeconds === undefined || track.loop ? "" : `:end=${track.trimEndSeconds}`}`,
      "asetpts=PTS-STARTPTS",
      ...(track.loop ? [`atrim=duration=${localDuration}`] : []),
      `volume=${track.volume}`,
      ...(track.fadeInSeconds > 0 ? [`afade=t=in:st=0:d=${Math.min(track.fadeInSeconds, localDuration)}`] : []),
      ...(track.fadeOutSeconds > 0 ? [`afade=t=out:st=${fadeOutStart}:d=${Math.min(track.fadeOutSeconds, localDuration)}`] : []),
      `adelay=${Math.round(track.startSeconds * 1_000)}|${Math.round(track.startSeconds * 1_000)}`,
      "apad",
      `atrim=duration=${outputDurationSeconds}`,
    ];
    lines.push(`[${index + 1}:a]${filters.join(",")}[a${index}]`);
  }
  lines.push(`${tracks.map((_, index) => `[a${index}]`).join("")}amix=inputs=${tracks.length}:duration=longest:normalize=0,alimiter=limit=0.95,atrim=duration=${outputDurationSeconds}[aout]`);
  return lines;
}
