import { createCameraEffects } from "./camera-effects.js";
import { Input, CustomSource, ALL_FORMATS, VideoSampleSink, Output, WebMOutputFormat,
  StreamTarget, CanvasSource, Quality } from "../node_modules/mediabunny/dist/bundles/mediabunny.mjs";

const canvas = document.querySelector("#output");
const sourceCanvas = document.createElement("canvas");

async function processSegment(config) {
  const effects = await createCameraEffects({ ...config.filters, modelUrls: config.modelUrls });
  let input;
  let output;
  try {
    input = new Input({ formats: ALL_FORMATS, source: new CustomSource({
      getSize: () => config.sourceSize,
      maxCacheSize: 8 * 1024 * 1024,
      read: async (start, end) => {
        const response = await window.autoScreen.readWebcamEffectsSource(config.token, start, end);
        if (!response.ok) throw new Error(response.error);
        return response.value;
      },
    }) });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error("O codec da webcam não pôde ser decodificado.");
    const frames = new VideoSampleSink(track);
    const target = new StreamTarget(new WritableStream({
      async write({ data, position }) {
        const response = await window.autoScreen.appendWebcamEffectsChunk(config.token, data, position);
        if (!response.ok) throw new Error(response.error);
      },
    }), { chunked: true, chunkSize: 1024 * 1024 });
    output = new Output({ format: new WebMOutputFormat(), target });
    const videoSource = new CanvasSource(canvas, { codec: "vp8", quality: new Quality({ bitrate: 2_500_000 }) });
    // No frameRate metadata: it would snap VFR timestamps to a different clock.
    output.addVideoTrack(videoSource);
    await output.start();
    let origin;
    let previous = -Infinity;
    let count = 0;
    let reportedAt = -Infinity;
    for await (const sample of frames.samples()) {
      try {
        origin ??= sample.timestamp;
        const time = sample.timestamp - origin;
        if (!Number.isFinite(time) || time <= previous || !Number.isFinite(sample.duration) || sample.duration <= 0) {
          throw new Error("O quadro da webcam possui tempo ou duração inválidos.");
        }
        previous = time;
        if (sourceCanvas.width !== sample.displayWidth || sourceCanvas.height !== sample.displayHeight) {
          sourceCanvas.width = sample.displayWidth;
          sourceCanvas.height = sample.displayHeight;
        }
        sample.draw(sourceCanvas.getContext("2d"), 0, 0);
        effects.draw(sourceCanvas, canvas, time * 1_000 + 1);
        // Awaiting add respects decoder/encoder/writer backpressure; elapsed CPU
        // time never becomes a presentation timestamp in the output.
        await videoSource.add(time, sample.duration);
        count += 1;
        if (performance.now() - reportedAt >= 250) {
          window.autoScreen.reportWebcamProgress?.(config.token, count, time + sample.duration);
          reportedAt = performance.now();
        }
      } finally {
        sample.close();
      }
    }
    if (!count) throw new Error("A webcam não contém quadros para processar.");
    videoSource.close();
    await output.finalize();
  } finally {
    if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel();
    input?.dispose();
    effects.close();
  }
}

window.autoScreen.onWebcamEffectsConfig(async (config) => {
  try {
    await processSegment(config);
    await window.autoScreen.completeWebcamEffects(config.token, null);
  } catch (error) {
    await window.autoScreen.completeWebcamEffects(config.token, error instanceof Error ? error.message : String(error));
  }
});
