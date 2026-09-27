import { createCameraEffects } from "./camera-effects.js";

const video = document.querySelector("#source");
const canvas = document.querySelector("#output");

async function processSegment(config) {
  const effects = await createCameraEffects({ ...config.filters, modelUrls: config.modelUrls });
  let timer;
  let recorder;
  try {
    video.src = config.sourceUrl;
    await new Promise((resolvePromise, rejectPromise) => {
      video.addEventListener("loadeddata", resolvePromise, { once: true });
      video.addEventListener("error", () => rejectPromise(new Error("O navegador não abriu o vídeo da webcam.")), { once: true });
      video.load();
    });
    effects.draw(video, canvas, Math.round(performance.now()));
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("O codec WebM necessário ao filtro não está disponível.");
    const stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    let chunks = Promise.resolve();
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      chunks = chunks.then(async () => {
        const response = await window.autoScreen.appendWebcamEffectsChunk(config.token, new Uint8Array(await event.data.arrayBuffer()));
        if (!response.ok) throw new Error(response.error);
      });
    });
    const stopped = new Promise((resolvePromise, rejectPromise) => {
      recorder.addEventListener("stop", resolvePromise, { once: true });
      recorder.addEventListener("error", (event) => rejectPromise(event.error ?? new Error("Falha no codificador da webcam.")), { once: true });
    });
    recorder.start(1_000);
    timer = setInterval(() => effects.draw(video, canvas, Math.round(performance.now())), 33);
    await video.play();
    await new Promise((resolvePromise, rejectPromise) => {
      video.addEventListener("ended", resolvePromise, { once: true });
      video.addEventListener("error", () => rejectPromise(new Error("Falha ao reproduzir o segmento da webcam.")), { once: true });
    });
    clearInterval(timer);
    effects.draw(video, canvas, Math.round(performance.now()));
    recorder.stop();
    await stopped;
    await chunks;
    stream.getTracks().forEach((track) => track.stop());
  } finally {
    if (timer) clearInterval(timer);
    if (recorder?.state === "recording") recorder.stop();
    video.pause();
    video.removeAttribute("src");
    video.load();
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
