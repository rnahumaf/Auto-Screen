const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const timer = document.querySelector("#timer");
const pauseButton = document.querySelector("#pauseButton");
const stopButton = document.querySelector("#stopButton");

let state;
let busy = false;

function formatTime(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function unwrap(promise) {
  const result = await promise;
  if (!result?.ok) throw new Error(result?.error || "A ação falhou.");
  return result.value;
}

function render(nextState) {
  if (nextState) state = nextState;
  if (!state) return;

  const phase = state.phase;
  const paused = phase === "paused";
  const transitioning = ["starting", "cancelling", "pausing", "resuming", "stopping"].includes(phase);

  const preparing = ["starting", "cancelling"].includes(phase);
  timer.textContent = preparing ? `${((state.preparation?.elapsedMs ?? 0) / 1000).toFixed(1)} s de espera` : formatTime(state.elapsedSeconds);
  statusDot.classList.toggle("preparing", transitioning);
  statusDot.classList.toggle("paused", paused);
  statusText.textContent = paused
    ? "Gravação pausada"
    : transitioning
      ? phase === "stopping" ? "Finalizando captura" : phase === "cancelling" ? "Cancelando" : "Preparando"
      : phase === "recording" && state.remainingSeconds !== null && state.remainingSeconds <= 60
        ? `Encerra em ${Math.ceil(state.remainingSeconds)} s`
        : phase === "recording" ? "Gravando" : "Captura encerrada";

  pauseButton.textContent = paused ? "Continuar" : "Pausar";
  pauseButton.disabled = busy || transitioning || !["recording", "paused"].includes(phase);
  stopButton.textContent = preparing ? "Cancelar" : transitioning ? "Encerrar" : "Parar";
  stopButton.disabled = phase === "cancelling" || (!transitioning && (busy || !["recording", "paused"].includes(phase)));
}

pauseButton.addEventListener("click", async () => {
  busy = true;
  render();
  try {
    render(await unwrap(window.autoScreen.pauseOrResume()));
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    render();
  }
});

stopButton.addEventListener("click", async () => {
  if (["starting", "cancelling"].includes(state?.phase)) {
    stopButton.disabled = true;
    try { render(await unwrap(window.autoScreen.cancelOperation())); }
    catch (error) { statusText.textContent = error instanceof Error ? error.message : String(error); }
    return;
  }
  if (["starting", "cancelling", "pausing", "resuming", "stopping"].includes(state?.phase)) {
    try { await unwrap(window.autoScreen.requestQuit()); }
    catch (error) { statusText.textContent = error instanceof Error ? error.message : String(error); }
    return;
  }
  busy = true;
  render();
  try {
    render(await unwrap(window.autoScreen.stopRecording()));
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    render();
  }
});

window.autoScreen.onState(render);
void unwrap(window.autoScreen.getState()).then(render).catch((error) => {
  statusText.textContent = error instanceof Error ? error.message : String(error);
});
