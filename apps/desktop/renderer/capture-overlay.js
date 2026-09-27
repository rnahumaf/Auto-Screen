import { createCameraEffects } from "./camera-effects.js";

const camera = document.querySelector("#camera");
const image = document.querySelector("#cameraImage");
const canvas = document.querySelector("#cameraCanvas");
const message = document.querySelector("#cameraMessage");
const sourceCanvas = document.createElement("canvas");
let effects;
let configured = false;
let ready = false;
let cameraConfig;

function positionCamera(config) {
  if (!config) { camera.hidden = true; return; }
  camera.hidden = false;
  const shortest = Math.min(window.innerWidth, window.innerHeight);
  const margin = Math.max(8, Math.round(shortest * 0.025));
  const fraction = { small: .18, medium: .25, large: .33 }[config.size] ?? .25;
  const size = Math.min(shortest - margin * 2, Math.max(48, Math.round(shortest * fraction)));
  const border = config.border === "none" ? 0 : Math.max(2, Math.round(size * .04));
  const [vertical, horizontal] = config.position === "center" ? ["center", "center"] : config.position.split("-");
  camera.style.width = `${size}px`;
  camera.style.height = `${size}px`;
  camera.style.borderRadius = config.shape === "circle" ? "50%" : "3px";
  camera.style.border = `${border}px solid ${config.border === "black" ? "#000" : config.borderColor}`;
  camera.style.left = horizontal === "left" ? `${margin}px` : horizontal === "right" ? `${window.innerWidth - size - margin}px` : `${Math.round((window.innerWidth - size) / 2)}px`;
  camera.style.top = vertical === "top" ? `${margin}px` : vertical === "bottom" ? `${window.innerHeight - size - margin}px` : `${Math.round((window.innerHeight - size) / 2)}px`;
}

function showMessage(value) {
  message.textContent = value;
  message.hidden = !value;
}

async function configureCamera(config, modelUrls) {
  if (!config) return;
  configured = false;
  showMessage("Aguardando quadros da webcam…");
  try {
    if (config.backgroundBlur > 0 || config.faceRetouch > 0) {
      effects = await createCameraEffects({ ...config, modelUrls });
      image.hidden = true;
      canvas.hidden = false;
    }
    configured = true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    showMessage(`Não foi possível preparar o filtro da webcam: ${detail}`);
    window.autoScreen.reportOverlayCameraState({ ok: false, error: detail });
  }
}

window.autoScreen.onOverlayConfig((config) => {
  cameraConfig = config.webcam;
  positionCamera(config.webcam);
  void configureCamera(config.webcam, config.modelUrls);
});
image.addEventListener("load", () => {
  if (!configured) return;
  try {
    if (effects) {
      if (sourceCanvas.width !== image.naturalWidth || sourceCanvas.height !== image.naturalHeight) {
        sourceCanvas.width = image.naturalWidth;
        sourceCanvas.height = image.naturalHeight;
      }
      sourceCanvas.getContext("2d").drawImage(image, 0, 0);
      const applied = effects.draw(sourceCanvas, canvas, Math.round(performance.now()));
      if (cameraConfig?.backgroundBlur > 0 && !applied.backgroundApplied) {
        showMessage("Pessoa não identificada; desfoque suspenso.");
      } else if (cameraConfig?.faceRetouch > 0 && !applied.faceRetouchApplied) {
        showMessage("Rosto não identificado; retoque suspenso.");
      } else showMessage("");
    }
    if (!ready) {
      ready = true;
      if (!effects) showMessage("");
      window.autoScreen.reportOverlayCameraState({ ok: true });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    showMessage(`A prévia da webcam falhou: ${detail}`);
    window.autoScreen.reportOverlayCameraState({ ok: false, error: detail });
  }
});
window.autoScreen.onOverlayFrame((jpeg) => {
  if (configured && typeof jpeg === "string") image.src = `data:image/jpeg;base64,${jpeg}`;
});
window.autoScreen.onOverlayPaused((paused) => {
  document.body.classList.toggle("is-paused", paused === true);
});
window.addEventListener("beforeunload", () => {
  effects?.close();
});
