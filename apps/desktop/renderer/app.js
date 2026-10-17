import { createCameraEffects } from "./camera-effects.js";

const elements = {
  environmentStatus: document.querySelector("#environmentStatus"),
  errorBanner: document.querySelector("#errorBanner"),
  errorMessage: document.querySelector("#errorMessage"),
  dismissError: document.querySelector("#dismissError"),
  setupNavigation: document.querySelector("#setupNavigation"),
  webcamFilterStatus: document.querySelector("#webcamFilterStatus"),
  setupPanel: document.querySelector("#setupPanel"),
  optionsPanel: document.querySelector("#optionsPanel"),
  webcamPanel: document.querySelector("#webcamPanel"),
  webcamDetails: document.querySelector("#webcamDetails"),
  webcamDisabledHint: document.querySelector("#webcamDisabledHint"),
  saveOptionsPanel: document.querySelector("#saveOptionsPanel"),
  actionPanel: document.querySelector("#actionPanel"),
  displaySource: document.querySelector("#displaySource"),
  regionSource: document.querySelector("#regionSource"),
  windowSource: document.querySelector("#windowSource"),
  displayPicker: document.querySelector("#displayPicker"),
  displaySelect: document.querySelector("#displaySelect"),
  refreshDisplays: document.querySelector("#refreshDisplays"),
  windowPicker: document.querySelector("#windowPicker"),
  windowSelect: document.querySelector("#windowSelect"),
  refreshWindows: document.querySelector("#refreshWindows"),
  selectionTitle: document.querySelector("#selectionTitle"),
  selectionDetail: document.querySelector("#selectionDetail"),
  fpsSelect: document.querySelector("#fpsSelect"),
  cursorModeSelect: document.querySelector("#cursorModeSelect"),
  qualitySelect: document.querySelector("#qualitySelect"),
  webcamEnabled: document.querySelector("#webcamEnabled"),
  webcamSelect: document.querySelector("#webcamSelect"),
  refreshWebcams: document.querySelector("#refreshWebcams"),
  webcamSizeSelect: document.querySelector("#webcamSizeSelect"),
  webcamShapeSelect: document.querySelector("#webcamShapeSelect"),
  webcamBorderSelect: document.querySelector("#webcamBorderSelect"),
  webcamBorderColorField: document.querySelector("#webcamBorderColorField"),
  webcamBorderColor: document.querySelector("#webcamBorderColor"),
  webcamPositionSelect: document.querySelector("#webcamPositionSelect"),
  webcamBackgroundBlur: document.querySelector("#webcamBackgroundBlur"),
  webcamBackgroundBlurValue: document.querySelector("#webcamBackgroundBlurValue"),
  webcamFaceRetouch: document.querySelector("#webcamFaceRetouch"),
  webcamFaceRetouchValue: document.querySelector("#webcamFaceRetouchValue"),
  webcamLayoutPreview: document.querySelector("#webcamLayoutPreview"),
  webcamLayoutMarker: document.querySelector("#webcamLayoutMarker"),
  setupCameraCanvas: document.querySelector("#setupCameraCanvas"),
  setupCameraImage: document.querySelector("#setupCameraImage"),
  setupCameraStatus: document.querySelector("#setupCameraStatus"),
  compareCameraOriginal: document.querySelector("#compareCameraOriginal"),
  microphonePanel: document.querySelector("#microphonePanel"),
  microphoneDetails: document.querySelector("#microphoneDetails"),
  microphoneEnabled: document.querySelector("#microphoneEnabled"),
  microphoneSelect: document.querySelector("#microphoneSelect"),
  microphoneLatency: document.querySelector("#microphoneLatency"),
  microphoneLatencyValue: document.querySelector("#microphoneLatencyValue"),
  refreshMicrophones: document.querySelector("#refreshMicrophones"),
  outputDirectory: document.querySelector("#outputDirectory"),
  chooseOutputDirectory: document.querySelector("#chooseOutputDirectory"),
  autoSave: document.querySelector("#autoSave"),
  startButton: document.querySelector("#startButton"),
  startHint: document.querySelector("#startHint"),
  previewingPanel: document.querySelector("#previewingPanel"),
  processingTitle: document.querySelector("#processingTitle"),
  processingDescription: document.querySelector("#processingDescription"),
  recoveryPanel: document.querySelector("#recoveryPanel"),
  recoveryDescription: document.querySelector("#recoveryDescription"),
  retryStopButton: document.querySelector("#retryStopButton"),
  openRecoveryButton: document.querySelector("#openRecoveryButton"),
  resultPanel: document.querySelector("#resultPanel"),
  previewFrame: document.querySelector("#previewFrame"),
  previewVideo: document.querySelector("#previewVideo"),
  resultDescription: document.querySelector("#resultDescription"),
  audioWarning: document.querySelector("#audioWarning"),
  resultDuration: document.querySelector("#resultDuration"),
  resultResolution: document.querySelector("#resultResolution"),
  resultSegments: document.querySelector("#resultSegments"),
  voiceResultPanel: document.querySelector("#voiceResultPanel"),
  webcamResultPanel: document.querySelector("#webcamResultPanel"),
  resultBackgroundBlur: document.querySelector("#resultBackgroundBlur"),
  resultBackgroundBlurValue: document.querySelector("#resultBackgroundBlurValue"),
  resultFaceRetouch: document.querySelector("#resultFaceRetouch"),
  resultFaceRetouchValue: document.querySelector("#resultFaceRetouchValue"),
  applyWebcamFilters: document.querySelector("#applyWebcamFilters"),
  voiceModeLabel: document.querySelector("#voiceModeLabel"),
  voiceSyncOffset: document.querySelector("#voiceSyncOffset"),
  voiceSyncValue: document.querySelector("#voiceSyncValue"),
  applyVoiceSync: document.querySelector("#applyVoiceSync"),
  originalVoiceButton: document.querySelector("#originalVoiceButton"),
  voiceLocalMethod: document.querySelector("#voiceLocalMethod"),
  voiceStrength: document.querySelector("#voiceStrength"),
  voiceStrengthValue: document.querySelector("#voiceStrengthValue"),
  processLocalVoice: document.querySelector("#processLocalVoice"),
  openRouterKey: document.querySelector("#openRouterKey"),
  saveOpenRouterKey: document.querySelector("#saveOpenRouterKey"),
  removeOpenRouterKey: document.querySelector("#removeOpenRouterKey"),
  openRouterKeyStatus: document.querySelector("#openRouterKeyStatus"),
  transcribeVoice: document.querySelector("#transcribeVoice"),
  voiceText: document.querySelector("#voiceText"),
  chooseVoiceReference: document.querySelector("#chooseVoiceReference"),
  useRecordedVoiceReference: document.querySelector("#useRecordedVoiceReference"),
  voiceReferenceName: document.querySelector("#voiceReferenceName"),
  referenceTranscript: document.querySelector("#referenceTranscript"),
  voiceConsent: document.querySelector("#voiceConsent"),
  generateVoice: document.querySelector("#generateVoice"),
  voiceApiStatus: document.querySelector("#voiceApiStatus"),
  saveButton: document.querySelector("#saveButton"),
  retryPreviewButton: document.querySelector("#retryPreviewButton"),
  discardButton: document.querySelector("#discardButton"),
  savingPanel: document.querySelector("#savingPanel"),
  savedPanel: document.querySelector("#savedPanel"),
  savedPath: document.querySelector("#savedPath"),
  openOutput: document.querySelector("#openOutput"),
  diagnosticList: document.querySelector("#diagnosticList"),
  refreshDoctor: document.querySelector("#refreshDoctor"),
};

let currentState;
let pendingMode = "display";
let selectedDisplayIndex = null;
let selectedWindowHandle = "";
let busy = false;
let dismissedError;
let webcams = [];
let microphones = [];
let settingsWrite = Promise.resolve();
let cameraModelUrls;
let cameraEffects;
let cameraEffectsPromise;
let previewDeviceId = "";
let previewRevision = 0;
let previewTransition = Promise.resolve();
let compareCameraOriginal = false;

function selectedCameraDevice() {
  return elements.webcamEnabled.checked ? elements.webcamSelect.value : "";
}

function updatePreviewStrengths() {
  cameraEffects?.setStrengths({
    backgroundBlur: Number(elements.webcamBackgroundBlur.value),
    faceRetouch: Number(elements.webcamFaceRetouch.value),
  });
}

function ensureCameraEffects() {
  if (cameraEffects || cameraEffectsPromise || !cameraModelUrls) return;
  cameraEffectsPromise = createCameraEffects({
    backgroundBlur: Number(elements.webcamBackgroundBlur.value),
    faceRetouch: Number(elements.webcamFaceRetouch.value),
    modelUrls: cameraModelUrls,
    forceModel: true,
  }).then((effects) => {
    cameraEffects = effects;
    updatePreviewStrengths();
    if (previewDeviceId) elements.setupCameraStatus.textContent = "Prévia ao vivo com filtros locais.";
  }).catch((error) => {
    elements.setupCameraStatus.textContent = `A imagem está sem filtros: ${error instanceof Error ? error.message : String(error)}`;
  }).finally(() => { cameraEffectsPromise = undefined; });
}

function queueSetupCameraPreview() {
  const deviceId = selectedCameraDevice();
  const revision = ++previewRevision;
  previewTransition = previewTransition.catch(() => undefined).then(async () => {
    if (previewDeviceId && previewDeviceId !== deviceId) {
      await unwrap(window.autoScreen.stopCameraPreview());
      previewDeviceId = "";
    }
    if (revision !== previewRevision) return;
    if (!deviceId) {
      compareCameraOriginal = false;
      elements.compareCameraOriginal.disabled = true;
      elements.setupCameraStatus.textContent = elements.webcamEnabled.checked
        ? "Escolha uma câmera para ver a imagem." : "Ative a webcam para visualizar os filtros.";
      const context = elements.setupCameraCanvas.getContext("2d");
      context.clearRect(0, 0, elements.setupCameraCanvas.width, elements.setupCameraCanvas.height);
      return;
    }
    if (previewDeviceId === deviceId) return;
    elements.setupCameraStatus.textContent = "Abrindo a webcam…";
    ensureCameraEffects();
    await unwrap(window.autoScreen.previewCamera(deviceId));
    previewDeviceId = deviceId;
    if (cameraEffects) elements.setupCameraStatus.textContent = "Prévia ao vivo com filtros locais.";
    else elements.setupCameraStatus.textContent = "Prévia ao vivo; preparando os filtros locais…";
  }).catch((error) => {
    previewDeviceId = "";
    compareCameraOriginal = false;
    elements.compareCameraOriginal.disabled = true;
    elements.setupCameraStatus.textContent = error instanceof Error ? error.message : String(error);
  });
}

function drawSetupCameraPreview() {
  if (!selectedCameraDevice()) return;
  const image = elements.setupCameraImage;
  const canvas = elements.setupCameraCanvas;
  if (!image.naturalWidth) return;
  try {
    if (compareCameraOriginal) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      elements.setupCameraStatus.textContent = "Imagem original, sem filtros.";
    } else if (cameraEffects) {
      updatePreviewStrengths();
      const applied = cameraEffects.draw(image, canvas, Math.round(performance.now()));
      const needsPerson = Number(elements.webcamBackgroundBlur.value) > 0;
      const needsFace = Number(elements.webcamFaceRetouch.value) > 0;
      if (needsPerson && !applied.backgroundApplied && needsFace && !applied.faceRetouchApplied) {
        elements.setupCameraStatus.textContent = "Pessoa e rosto não identificados; filtros suspensos neste quadro.";
      } else if (needsPerson && !applied.backgroundApplied) {
        elements.setupCameraStatus.textContent = "Pessoa não identificada; desfoque suspenso neste quadro.";
      } else if (needsFace && !applied.faceRetouchApplied) {
        elements.setupCameraStatus.textContent = "Rosto não identificado; retoque suspenso neste quadro.";
      } else {
        elements.setupCameraStatus.textContent = "Prévia ao vivo com filtros locais.";
      }
    } else {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
    }
  } catch (error) {
    elements.setupCameraStatus.textContent = `Os filtros falharam: ${error instanceof Error ? error.message : String(error)}`;
  }
}

elements.setupCameraImage.addEventListener("load", () => {
  elements.compareCameraOriginal.disabled = false;
  drawSetupCameraPreview();
});
function setCompareCameraOriginal(value) {
  if (elements.compareCameraOriginal.disabled || compareCameraOriginal === value) return;
  compareCameraOriginal = value;
  drawSetupCameraPreview();
}
elements.compareCameraOriginal.addEventListener("pointerdown", (event) => {
  elements.compareCameraOriginal.setPointerCapture(event.pointerId);
  setCompareCameraOriginal(true);
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  elements.compareCameraOriginal.addEventListener(eventName, () => setCompareCameraOriginal(false));
}
elements.compareCameraOriginal.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); setCompareCameraOriginal(true); }
});
elements.compareCameraOriginal.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); setCompareCameraOriginal(false); }
});
elements.compareCameraOriginal.addEventListener("blur", () => setCompareCameraOriginal(false));
window.autoScreen.onSetupCameraFrame((jpeg) => {
  if (selectedCameraDevice() && typeof jpeg === "string") elements.setupCameraImage.src = `data:image/jpeg;base64,${jpeg}`;
});

function settingsFromControls() {
  return {
    fps: Number(elements.fpsSelect.value),
    cursorMode: elements.cursorModeSelect.value,
    quality: elements.qualitySelect.value,
    autoSave: elements.autoSave.checked,
    microphone: {
      enabled: elements.microphoneEnabled.checked,
      deviceId: elements.microphoneSelect.value,
      latencyMs: Number(elements.microphoneLatency.value),
    },
    voice: { localMethod: elements.voiceLocalMethod.value, localStrength: Number(elements.voiceStrength.value) },
    webcam: {
      enabled: elements.webcamEnabled.checked,
      deviceId: elements.webcamSelect.value,
      size: elements.webcamSizeSelect.value,
      shape: elements.webcamShapeSelect.value,
      border: elements.webcamBorderSelect.value,
      borderColor: elements.webcamBorderColor.value,
      position: elements.webcamPositionSelect.value,
      backgroundBlur: Number(elements.webcamBackgroundBlur.value),
      faceRetouch: Number(elements.webcamFaceRetouch.value),
    },
  };
}

function applySettings(settings) {
  if (!settings) return;
  elements.fpsSelect.value = String(settings.fps);
  elements.cursorModeSelect.value = settings.cursorMode;
  elements.qualitySelect.value = settings.quality;
  elements.autoSave.checked = settings.autoSave;
  elements.microphoneEnabled.checked = settings.microphone?.enabled === true;
  elements.voiceLocalMethod.value = settings.voice?.localMethod ?? "rnnoise";
  elements.voiceStrength.value = String(settings.voice?.localStrength ?? 70);
  elements.voiceStrengthValue.textContent = `${elements.voiceStrength.value}%`;
  elements.webcamEnabled.checked = settings.webcam.enabled;
  elements.webcamSizeSelect.value = settings.webcam.size;
  elements.webcamShapeSelect.value = settings.webcam.shape;
  elements.webcamBorderSelect.value = settings.webcam.border;
  elements.webcamBorderColor.value = settings.webcam.borderColor.toLowerCase();
  elements.webcamPositionSelect.value = settings.webcam.position;
  elements.webcamBackgroundBlur.value = String(settings.webcam.backgroundBlur ?? 0);
  elements.webcamFaceRetouch.value = String(settings.webcam.faceRetouch ?? 0);
  elements.outputDirectory.textContent = settings.outputDirectory;
  elements.outputDirectory.title = settings.outputDirectory;
  if (webcams.some((camera) => camera.id === settings.webcam.deviceId)) {
    elements.webcamSelect.value = settings.webcam.deviceId;
  }
  if (microphones.some((microphone) => microphone.id === settings.microphone?.deviceId)) {
    elements.microphoneSelect.value = settings.microphone.deviceId;
  }
  elements.microphoneLatency.value = String(settings.microphone?.latencyByDevice?.[elements.microphoneSelect.value] ?? 0);
  elements.microphoneLatencyValue.textContent = `${elements.microphoneLatency.value} ms`;
  renderWebcamOptions();
  renderMicrophoneOptions();
}

function renderMicrophoneOptions() {
  elements.microphoneDetails.hidden = false;
}

function renderWebcamOptions() {
  const enabled = elements.webcamEnabled.checked;
  elements.webcamDetails.hidden = false;
  elements.webcamDisabledHint.hidden = enabled;
  elements.webcamBorderColorField.hidden = elements.webcamBorderSelect.value !== "color";
  elements.webcamBackgroundBlurValue.textContent = elements.webcamBackgroundBlur.value === "0" ? "Desligado" : `${elements.webcamBackgroundBlur.value}%`;
  elements.webcamFaceRetouchValue.textContent = elements.webcamFaceRetouch.value === "0" ? "Desligado" : `${elements.webcamFaceRetouch.value}%`;
  const activeFilters = [];
  if (Number(elements.webcamBackgroundBlur.value) > 0) activeFilters.push("desfoque");
  if (Number(elements.webcamFaceRetouch.value) > 0) activeFilters.push("retoque");
  elements.webcamFilterStatus.textContent = !enabled
    ? "Webcam desativada"
    : activeFilters.length
      ? `Filtros ativos: ${activeFilters.join(" e ")}`
      : "Filtros da webcam desligados";
  updatePreviewStrengths();
  const marker = elements.webcamLayoutMarker;
  const size = { small: 48, medium: 66, large: 84 }[elements.webcamSizeSelect.value] ?? 66;
  const [vertical, horizontal] = elements.webcamPositionSelect.value === "center"
    ? ["center", "center"]
    : elements.webcamPositionSelect.value.split("-");
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.style.borderRadius = elements.webcamShapeSelect.value === "circle" ? "50%" : "3px";
  marker.style.borderWidth = elements.webcamBorderSelect.value === "none" ? "0" : "4px";
  marker.style.borderColor = elements.webcamBorderSelect.value === "black"
    ? "#111111" : elements.webcamBorderColor.value;
  marker.style.left = horizontal === "left" ? "12px" : horizontal === "right"
    ? `calc(100% - ${size + 12}px)` : `calc(50% - ${size / 2}px)`;
  marker.style.top = vertical === "top" ? "12px" : vertical === "bottom"
    ? `calc(100% - ${size + 12}px)` : `calc(50% - ${size / 2}px)`;
}

function queueSettingsUpdate() {
  const next = settingsFromControls();
  renderWebcamOptions();
  renderMicrophoneOptions();
  settingsWrite = settingsWrite.catch(() => undefined).then(async () => {
    try {
      renderState(await unwrap(window.autoScreen.updateSettings(next)));
    } catch (error) {
      showLocalError(error);
      throw error;
    }
  });
  renderState(currentState);
}

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
  if (!result?.ok) throw new Error(result?.error || "A ação não retornou um resultado válido.");
  return result.value;
}

function showLocalError(error) {
  dismissedError = undefined;
  elements.errorMessage.textContent = error instanceof Error ? error.message : String(error);
  elements.errorBanner.hidden = false;
}

function setBusy(value) {
  busy = value;
  renderState(currentState);
}

function setSourceCard(mode) {
  for (const [name, element] of [
    ["display", elements.displaySource],
    ["region", elements.regionSource],
    ["window", elements.windowSource],
  ]) {
    element.classList.toggle("is-selected", name === mode);
  }
  elements.displayPicker.hidden = mode !== "display";
  elements.windowPicker.hidden = mode !== "window";
}

function renderDoctor(doctor) {
  elements.diagnosticList.replaceChildren();
  if (!doctor) {
    elements.environmentStatus.textContent = "Verificando ambiente";
    elements.environmentStatus.className = "status-pill status-pending";
    return;
  }

  elements.environmentStatus.textContent = doctor.ok ? "Ambiente pronto" : "Configuração incompleta";
  elements.environmentStatus.className = `status-pill ${doctor.ok ? "status-ready" : "status-error"}`;

  for (const check of doctor.checks ?? []) {
    const row = document.createElement("div");
    row.className = "diagnostic-item";

    const status = document.createElement("span");
    status.className = check.ok ? "ok" : "failure";
    status.textContent = check.ok ? "OK" : "ERRO";

    const name = document.createElement("strong");
    name.textContent = check.name;

    const detail = document.createElement("span");
    detail.textContent = check.detail;

    row.append(status, name, detail);
    elements.diagnosticList.append(row);
  }
}

function sourceIsReady(state) {
  if (pendingMode === "display") return selectedDisplayIndex !== null && state?.source?.mode === "display";
  if (pendingMode === "window") return Boolean(selectedWindowHandle) && state?.source?.mode === "window";
  return state?.source?.mode === "region" && Boolean(state?.source?.bounds);
}

function renderResultFilterValues() {
  elements.resultBackgroundBlurValue.textContent = elements.resultBackgroundBlur.value === "0"
    ? "Desligado" : `${elements.resultBackgroundBlur.value}%`;
  elements.resultFaceRetouchValue.textContent = elements.resultFaceRetouch.value === "0"
    ? "Desligado" : `${elements.resultFaceRetouch.value}%`;
}

function renderVoiceSyncValue() {
  const value = Number(elements.voiceSyncOffset.value);
  elements.voiceSyncValue.textContent = `${value > 0 ? "+" : ""}${value} ms`;
}

function renderState(state) {
  if (!state) return;
  currentState = state;

  const phase = state.phase;
  const hasProject = phase === "captured";
  const isPreviewing = phase === "previewing";
  const isSaving = phase === "rendering";
  const canConfigure = ["idle", "saved"].includes(phase);
  const needsRecovery = phase === "failed";
  elements.recoveryPanel.hidden = !needsRecovery;
  elements.retryStopButton.disabled = busy || !state.recovery?.canRetry;
  elements.openRecoveryButton.disabled = !(state.recovery?.directories?.length > 0);
  elements.recoveryDescription.textContent = state.recovery?.canRetry
    ? "Os trechos originais foram preservados. Corrija o problema informado e tente finalizar novamente."
    : "A operação foi interrompida. Os arquivos temporários disponíveis foram mantidos para recuperação manual. Reinicie o aplicativo antes de gravar novamente.";
  const environmentReady = state.doctor?.ok === true;
  const selectionReady = sourceIsReady(state);

  elements.setupPanel.hidden = !canConfigure;
  elements.setupNavigation.hidden = !canConfigure;
  elements.optionsPanel.hidden = !canConfigure;
  elements.webcamPanel.hidden = !canConfigure;
  elements.microphonePanel.hidden = !canConfigure && !(hasProject && state.voice?.hasMicrophone);
  elements.saveOptionsPanel.hidden = !canConfigure;
  elements.actionPanel.hidden = !canConfigure;
  elements.previewingPanel.hidden = !isPreviewing && phase !== "stopping";
  elements.processingTitle.textContent = phase === "stopping" ? "Finalizando captura" : "Preparando a prévia";
  elements.processingDescription.textContent = phase === "stopping"
    ? "Encerrando os dispositivos e consolidando os trechos. Você pode fechar o aplicativo para interromper e preservar os arquivos."
    : "Aplicando o cursor escolhido e codificando uma visualização local.";
  elements.resultPanel.hidden = !hasProject;
  elements.voiceResultPanel.hidden = !hasProject || state.voice?.hasMicrophone !== true;
  elements.webcamResultPanel.hidden = !hasProject || state.webcam?.hasWebcam !== true;
  if (hasProject && state.webcam?.hasWebcam) {
    elements.resultBackgroundBlur.value = String(state.webcam.filters?.backgroundBlur ?? 0);
    elements.resultFaceRetouch.value = String(state.webcam.filters?.faceRetouch ?? 0);
    renderResultFilterValues();
  }
  elements.voiceSyncOffset.value = String(state.voice?.syncMs ?? 0);
  renderVoiceSyncValue();
  elements.voiceModeLabel.textContent = {
    original: "Áudio original do microfone",
    local: "Limpeza local aplicada ao microfone",
    openrouter: "Narração recriada com Seed Audio 1.0",
  }[state.voice?.mode] ?? "Áudio original do microfone";
  elements.openRouterKeyStatus.textContent = state.voice?.apiKeySaved
    ? "Chave protegida no Windows e pronta para uso."
    : "Nenhuma chave guardada.";
  elements.voiceReferenceName.textContent = state.voice?.referenceName ?? "Voz desta gravação";
  elements.useRecordedVoiceReference.hidden = state.voice?.referenceSource !== "file";
  elements.audioWarning.textContent = (state.audioWarnings ?? []).join(" ");
  elements.audioWarning.hidden = !hasProject || !elements.audioWarning.textContent;
  elements.savingPanel.hidden = !isSaving;
  elements.savedPanel.hidden = !state.lastSavedPath || hasProject || isSaving;

  setSourceCard(pendingMode);
  elements.selectionTitle.textContent = state.source?.label ?? "Nenhuma seleção";
  elements.selectionDetail.textContent = state.source?.detail ?? "";
  renderDoctor(state.doctor);

  const webcamReady = !elements.webcamEnabled.checked || Boolean(elements.webcamSelect.value);
  const microphoneReady = !elements.microphoneEnabled.checked || Boolean(elements.microphoneSelect.value);
  elements.startButton.disabled = busy || !canConfigure || !selectionReady || !environmentReady || !webcamReady || !microphoneReady;
  elements.displaySource.disabled = busy || !canConfigure;
  elements.regionSource.disabled = busy || !canConfigure;
  elements.windowSource.disabled = busy || !canConfigure;
  elements.displaySelect.disabled = busy || !canConfigure;
  elements.refreshDisplays.disabled = busy || !canConfigure;
  elements.windowSelect.disabled = busy || !canConfigure;
  elements.refreshWindows.disabled = busy || !canConfigure;
  elements.fpsSelect.disabled = busy || !canConfigure;
  elements.cursorModeSelect.disabled = busy || !canConfigure;
  for (const control of [
    elements.qualitySelect, elements.webcamEnabled, elements.chooseOutputDirectory,
    elements.autoSave,
    elements.microphoneEnabled, elements.microphoneSelect, elements.refreshMicrophones,
    elements.microphoneLatency,
  ]) control.disabled = busy || !canConfigure;
  for (const control of [
    elements.webcamSelect, elements.refreshWebcams, elements.webcamSizeSelect,
    elements.webcamShapeSelect, elements.webcamBorderSelect, elements.webcamBorderColor,
    elements.webcamPositionSelect, elements.webcamBackgroundBlur, elements.webcamFaceRetouch,
  ]) control.disabled = busy || !canConfigure || !elements.webcamEnabled.checked;
  elements.retryPreviewButton.hidden = !hasProject || Boolean(state.previewUrl);
  elements.retryPreviewButton.disabled = busy || !hasProject;
  elements.saveButton.disabled = busy || !hasProject || state.effectsPending === true;
  elements.discardButton.disabled = busy || !hasProject;
  elements.applyWebcamFilters.disabled = busy || !hasProject;
  elements.resultBackgroundBlur.disabled = busy || !hasProject;
  elements.resultFaceRetouch.disabled = busy || !hasProject;
  elements.applyVoiceSync.disabled = busy || !hasProject;
  elements.voiceSyncOffset.disabled = busy || !hasProject;
  for (const control of [
    elements.originalVoiceButton, elements.processLocalVoice,
    elements.transcribeVoice, elements.voiceText, elements.chooseVoiceReference,
    elements.useRecordedVoiceReference,
    elements.referenceTranscript, elements.voiceConsent, elements.generateVoice,
  ]) control.disabled = busy || !hasProject;
  elements.voiceStrength.disabled = busy || (!canConfigure && !hasProject);
  elements.voiceLocalMethod.disabled = busy || (!canConfigure && !hasProject);
  for (const control of [elements.openRouterKey, elements.saveOpenRouterKey, elements.removeOpenRouterKey]) {
    control.disabled = busy || (!canConfigure && !hasProject);
  }

  if (!environmentReady) {
    elements.startHint.textContent = "Corrija os itens do diagnóstico antes de iniciar.";
  } else if (!selectionReady) {
    elements.startHint.textContent = pendingMode === "window"
      ? "Selecione uma janela visível."
      : pendingMode === "display"
        ? "Selecione um monitor."
        : "Defina a área de gravação.";
  } else if (!webcamReady) {
    elements.startHint.textContent = "Escolha uma webcam ou desative a gravação da câmera.";
  } else if (!microphoneReady) {
    elements.startHint.textContent = "Escolha um microfone ou desative a gravação de voz.";
  } else {
    elements.startHint.textContent = "A barra de controle aparecerá no topo da tela durante a gravação.";
  }

  if (state.project) {
    elements.resultDuration.textContent = formatTime(state.project.durationSeconds);
    elements.resultResolution.textContent = `${state.project.width} × ${state.project.height}`;
    const count = state.project.segmentCount ?? 1;
    elements.resultSegments.textContent = `${count} ${count === 1 ? "segmento" : "segmentos"}`;
    elements.resultDescription.textContent = !state.previewUrl
      ? "A captura foi preservada. Reprocesse a prévia antes de salvar."
      : count > 1
        ? "Os períodos pausados foram removidos e os segmentos foram consolidados."
        : "O vídeo temporário está pronto para ser salvo.";
  }

  const previewUrl = state.previewUrl ?? "";
  elements.previewFrame.hidden = !previewUrl;
  if (elements.previewVideo.dataset.source !== previewUrl) {
    elements.previewVideo.pause();
    elements.previewVideo.dataset.source = previewUrl;
    if (previewUrl) elements.previewVideo.src = previewUrl;
    else elements.previewVideo.removeAttribute("src");
    elements.previewVideo.load();
  }

  if (state.lastSavedPath) elements.savedPath.textContent = state.lastSavedPath;
  if (state.settings) {
    elements.outputDirectory.textContent = state.settings.outputDirectory;
    elements.outputDirectory.title = state.settings.outputDirectory;
  }

  if (state.error && state.error !== dismissedError) {
    elements.errorMessage.textContent = state.error;
    elements.errorBanner.hidden = false;
  }
}

function populateWebcams(devices) {
  webcams = devices;
  const preferred = currentState?.settings?.webcam?.deviceId;
  elements.webcamSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = devices.length ? "Escolha uma câmera" : "Nenhuma câmera encontrada";
  elements.webcamSelect.append(placeholder);
  for (const camera of devices) {
    const option = document.createElement("option");
    option.value = camera.id;
    option.textContent = camera.name;
    elements.webcamSelect.append(option);
  }
  if (devices.some((camera) => camera.id === preferred)) elements.webcamSelect.value = preferred;
  else if (devices.length === 1) elements.webcamSelect.value = devices[0].id;
  renderState(currentState);
}

function populateMicrophones(devices) {
  microphones = devices;
  const preferred = currentState?.settings?.microphone?.deviceId;
  elements.microphoneSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = devices.length ? "Escolha um microfone" : "Nenhum microfone encontrado";
  elements.microphoneSelect.append(placeholder);
  for (const microphone of devices) {
    const option = document.createElement("option");
    option.value = microphone.id;
    option.textContent = microphone.name;
    elements.microphoneSelect.append(option);
  }
  if (devices.some((microphone) => microphone.id === preferred)) elements.microphoneSelect.value = preferred;
  else if (devices.length === 1) elements.microphoneSelect.value = devices[0].id;
  elements.microphoneLatency.value = String(currentState?.settings?.microphone?.latencyByDevice?.[elements.microphoneSelect.value] ?? 0);
  elements.microphoneLatencyValue.textContent = `${elements.microphoneLatency.value} ms`;
  renderState(currentState);
}

function populateDisplays(displays, preferredIndex = selectedDisplayIndex) {
  elements.displaySelect.replaceChildren();
  for (const display of displays) {
    const option = document.createElement("option");
    option.value = String(display.index);
    option.textContent = `${display.primary ? "Principal · " : ""}Tela ${display.index + 1} — ${Math.round(display.rect.width)} × ${Math.round(display.rect.height)}`;
    elements.displaySelect.append(option);
  }

  const preferred = displays.find((display) => display.index === preferredIndex) ??
    displays.find((display) => display.primary) ?? displays[0];
  selectedDisplayIndex = preferred?.index ?? null;
  elements.displaySelect.value = selectedDisplayIndex === null ? "" : String(selectedDisplayIndex);
  renderState(currentState);
}

function populateWindows(windows) {
  const previous = selectedWindowHandle;
  elements.windowSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = windows.length > 0 ? "Selecione uma janela" : "Nenhuma janela disponível";
  elements.windowSelect.append(placeholder);

  for (const windowInfo of windows) {
    const option = document.createElement("option");
    option.value = windowInfo.handle;
    option.textContent = `${windowInfo.title} — ${Math.round(windowInfo.rect.width)} × ${Math.round(windowInfo.rect.height)}`;
    elements.windowSelect.append(option);
  }

  if (windows.some((windowInfo) => windowInfo.handle === previous)) {
    elements.windowSelect.value = previous;
  } else {
    selectedWindowHandle = "";
  }
  renderState(currentState);
}

async function refreshDisplayList(selectCurrent = false) {
  setBusy(true);
  try {
    const displays = await unwrap(window.autoScreen.listDisplays());
    populateDisplays(displays, currentState?.source?.displayIndex ?? selectedDisplayIndex);
    if (selectCurrent && selectedDisplayIndex !== null) {
      const state = await unwrap(window.autoScreen.selectDisplay(selectedDisplayIndex));
      pendingMode = "display";
      selectedWindowHandle = "";
      renderState(state);
    }
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
}

async function refreshWindowList() {
  setBusy(true);
  try {
    const windows = await unwrap(window.autoScreen.listWindows());
    populateWindows(windows);
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
}

elements.displaySource.addEventListener("click", async () => {
  pendingMode = "display";
  selectedWindowHandle = "";
  setSourceCard(pendingMode);
  await refreshDisplayList(true);
});

elements.displaySelect.addEventListener("change", async () => {
  const index = Number(elements.displaySelect.value);
  if (!Number.isInteger(index)) return;
  selectedDisplayIndex = index;
  setBusy(true);
  try {
    const state = await unwrap(window.autoScreen.selectDisplay(index));
    pendingMode = "display";
    selectedWindowHandle = "";
    renderState(state);
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.refreshDisplays.addEventListener("click", () => refreshDisplayList(pendingMode === "display"));

elements.regionSource.addEventListener("click", async () => {
  const previousMode = pendingMode;
  pendingMode = "region";
  setSourceCard(pendingMode);
  setBusy(true);
  try {
    const state = await unwrap(window.autoScreen.selectRegion());
    pendingMode = state.source?.mode ?? previousMode;
    selectedWindowHandle = "";
    selectedDisplayIndex = state.source?.displayIndex ?? selectedDisplayIndex;
    renderState(state);
  } catch (error) {
    pendingMode = previousMode;
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.windowSource.addEventListener("click", async () => {
  pendingMode = "window";
  selectedWindowHandle = "";
  setSourceCard(pendingMode);
  renderState(currentState);
  if (elements.windowSelect.options.length <= 1) await refreshWindowList();
  elements.windowSelect.focus();
});

elements.windowSelect.addEventListener("change", async () => {
  const handle = elements.windowSelect.value;
  selectedWindowHandle = handle;
  if (!handle) {
    renderState(currentState);
    return;
  }
  setBusy(true);
  try {
    const state = await unwrap(window.autoScreen.selectWindow(handle));
    pendingMode = "window";
    selectedDisplayIndex = state.source?.displayIndex ?? selectedDisplayIndex;
    renderState(state);
  } catch (error) {
    selectedWindowHandle = "";
    elements.windowSelect.value = "";
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.refreshWindows.addEventListener("click", refreshWindowList);

for (const control of [
  elements.fpsSelect, elements.cursorModeSelect, elements.qualitySelect,
  elements.webcamEnabled, elements.webcamSelect, elements.webcamSizeSelect,
  elements.webcamShapeSelect, elements.webcamBorderSelect, elements.webcamBorderColor,
  elements.webcamPositionSelect, elements.webcamBackgroundBlur,
  elements.webcamFaceRetouch, elements.autoSave,
  elements.microphoneEnabled, elements.microphoneSelect,
  elements.microphoneLatency,
]) control.addEventListener("change", () => {
  if (control === elements.microphoneSelect) {
    const profiles = currentState?.settings?.microphone?.latencyByDevice ?? {};
    elements.microphoneLatency.value = String(profiles[elements.microphoneSelect.value] ?? 0);
    elements.microphoneLatencyValue.textContent = `${elements.microphoneLatency.value} ms`;
  }
  queueSettingsUpdate();
});

elements.microphoneLatency.addEventListener("input", () => {
  elements.microphoneLatencyValue.textContent = `${elements.microphoneLatency.value} ms`;
});

for (const control of [elements.webcamEnabled, elements.webcamSelect]) {
  control.addEventListener("change", queueSetupCameraPreview);
}

for (const control of [elements.webcamBackgroundBlur, elements.webcamFaceRetouch]) {
  control.addEventListener("input", () => { renderWebcamOptions(); ensureCameraEffects(); });
}

elements.refreshWebcams.addEventListener("click", async () => {
  setBusy(true);
  try {
    populateWebcams(await unwrap(window.autoScreen.listWebcams()));
    queueSetupCameraPreview();
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.refreshMicrophones.addEventListener("click", async () => {
  setBusy(true);
  try { populateMicrophones(await unwrap(window.autoScreen.listMicrophones())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.chooseOutputDirectory.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState(await unwrap(window.autoScreen.chooseOutputDirectory()));
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.startButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    await settingsWrite;
    const state = await unwrap(window.autoScreen.startRecording(settingsFromControls()));
    renderState(state);
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.retryPreviewButton.addEventListener("click", async () => {
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.retryPreview())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.retryStopButton.addEventListener("click", async () => {
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.stopRecording())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.openRecoveryButton.addEventListener("click", async () => {
  try { await unwrap(window.autoScreen.openRecovery()); }
  catch (error) { showLocalError(error); }
});

for (const control of [elements.resultBackgroundBlur, elements.resultFaceRetouch]) {
  control.addEventListener("input", renderResultFilterValues);
}

elements.applyWebcamFilters.addEventListener("click", async () => {
  const options = {
    backgroundBlur: Number(elements.resultBackgroundBlur.value),
    faceRetouch: Number(elements.resultFaceRetouch.value),
  };
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.applyWebcamFilters(options))); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.voiceSyncOffset.addEventListener("input", renderVoiceSyncValue);
elements.applyVoiceSync.addEventListener("click", async () => {
  const milliseconds = Number(elements.voiceSyncOffset.value);
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.adjustVoiceSync(milliseconds))); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.saveButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState(await unwrap(window.autoScreen.saveRecording()));
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.discardButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState(await unwrap(window.autoScreen.discardRecording()));
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.openOutput.addEventListener("click", async () => {
  try {
    renderState(await unwrap(window.autoScreen.openOutput()));
  } catch (error) {
    showLocalError(error);
  }
});

elements.voiceStrength.addEventListener("input", () => {
  elements.voiceStrengthValue.textContent = `${elements.voiceStrength.value}%`;
});
elements.voiceStrength.addEventListener("change", () => {
  if (["idle", "saved"].includes(currentState?.phase)) queueSettingsUpdate();
});
elements.voiceLocalMethod.addEventListener("change", () => {
  if (["idle", "saved"].includes(currentState?.phase)) queueSettingsUpdate();
});

elements.processLocalVoice.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState(await unwrap(window.autoScreen.processVoiceLocal({
      method: elements.voiceLocalMethod.value,
      strength: Number(elements.voiceStrength.value) / 100,
    })));
  }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.originalVoiceButton.addEventListener("click", async () => {
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.restoreOriginalVoice())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.saveOpenRouterKey.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState(await unwrap(window.autoScreen.storeOpenRouterKey(elements.openRouterKey.value)));
    elements.openRouterKey.value = "";
  } catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.removeOpenRouterKey.addEventListener("click", async () => {
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.removeOpenRouterKey())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.transcribeVoice.addEventListener("click", async () => {
  setBusy(true);
  elements.voiceApiStatus.textContent = "Transcrevendo pela API…";
  try {
    const result = await unwrap(window.autoScreen.transcribeVoice());
    elements.voiceText.value = result.text;
    elements.voiceApiStatus.textContent = "Transcrição pronta. Revise o texto antes de gerar a voz.";
  } catch (error) { elements.voiceApiStatus.textContent = ""; showLocalError(error); }
  finally { setBusy(false); }
});

elements.chooseVoiceReference.addEventListener("click", async () => {
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.chooseVoiceReference())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.useRecordedVoiceReference.addEventListener("click", async () => {
  setBusy(true);
  try { renderState(await unwrap(window.autoScreen.useRecordedVoiceReference())); }
  catch (error) { showLocalError(error); }
  finally { setBusy(false); }
});

elements.generateVoice.addEventListener("click", async () => {
  setBusy(true);
  elements.voiceApiStatus.textContent = "Gerando e ajustando a narração…";
  try {
    const result = await unwrap(window.autoScreen.generateVoice({
      text: elements.voiceText.value,
      referenceTranscript: elements.referenceTranscript.value,
      referenceAuthorized: elements.voiceConsent.checked,
    }));
    renderState(result.state);
    elements.voiceApiStatus.textContent = `Narração pronta. Ajuste de tempo: ${result.speedRatio.toFixed(2)}×. Ouça a prévia antes de salvar.`;
  } catch (error) { elements.voiceApiStatus.textContent = ""; showLocalError(error); }
  finally { setBusy(false); }
});

elements.refreshDoctor.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderDoctor(await unwrap(window.autoScreen.refreshDoctor()));
    renderState(await unwrap(window.autoScreen.getState()));
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
});

elements.dismissError.addEventListener("click", () => {
  dismissedError = elements.errorMessage.textContent;
  elements.errorBanner.hidden = true;
});

window.autoScreen.onState((state) => renderState(state));

async function bootstrap() {
  setBusy(true);
  try {
    const value = await unwrap(window.autoScreen.bootstrap());
    cameraModelUrls = value.cameraModelUrls;
    currentState = value.state;
    pendingMode = value.state.source?.mode ?? "display";
    selectedDisplayIndex = value.state.source?.displayIndex ?? null;
    populateDisplays(value.displays ?? [], selectedDisplayIndex);
    populateWindows(value.windows ?? []);
    populateWebcams(value.webcams ?? []);
    populateMicrophones(value.microphones ?? []);
    applySettings(value.state.settings);
    renderState(value.state);
    queueSetupCameraPreview();
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
}

void bootstrap();
window.addEventListener("beforeunload", () => {
  cameraEffects?.close();
  void window.autoScreen.stopCameraPreview();
});
