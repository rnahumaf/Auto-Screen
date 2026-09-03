const elements = {
  environmentStatus: document.querySelector("#environmentStatus"),
  errorBanner: document.querySelector("#errorBanner"),
  errorMessage: document.querySelector("#errorMessage"),
  dismissError: document.querySelector("#dismissError"),
  setupPanel: document.querySelector("#setupPanel"),
  optionsPanel: document.querySelector("#optionsPanel"),
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
  cursorToggle: document.querySelector("#cursorToggle"),
  startButton: document.querySelector("#startButton"),
  startHint: document.querySelector("#startHint"),
  resultPanel: document.querySelector("#resultPanel"),
  resultDescription: document.querySelector("#resultDescription"),
  resultDuration: document.querySelector("#resultDuration"),
  resultResolution: document.querySelector("#resultResolution"),
  resultSegments: document.querySelector("#resultSegments"),
  saveButton: document.querySelector("#saveButton"),
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

function renderState(state) {
  if (!state) return;
  currentState = state;

  const phase = state.phase;
  const hasProject = phase === "captured";
  const isSaving = phase === "rendering";
  const canConfigure = ["idle", "saved"].includes(phase);
  const environmentReady = state.doctor?.ok === true;
  const selectionReady = sourceIsReady(state);

  elements.setupPanel.hidden = !canConfigure;
  elements.optionsPanel.hidden = !canConfigure;
  elements.actionPanel.hidden = !canConfigure;
  elements.resultPanel.hidden = !hasProject;
  elements.savingPanel.hidden = !isSaving;
  elements.savedPanel.hidden = !state.lastSavedPath || hasProject || isSaving;

  setSourceCard(pendingMode);
  elements.selectionTitle.textContent = state.source?.label ?? "Nenhuma seleção";
  elements.selectionDetail.textContent = state.source?.detail ?? "";
  renderDoctor(state.doctor);

  elements.startButton.disabled = busy || !canConfigure || !selectionReady || !environmentReady;
  elements.displaySource.disabled = busy || !canConfigure;
  elements.regionSource.disabled = busy || !canConfigure;
  elements.windowSource.disabled = busy || !canConfigure;
  elements.displaySelect.disabled = busy || !canConfigure;
  elements.refreshDisplays.disabled = busy || !canConfigure;
  elements.windowSelect.disabled = busy || !canConfigure;
  elements.refreshWindows.disabled = busy || !canConfigure;
  elements.fpsSelect.disabled = busy || !canConfigure;
  elements.cursorToggle.disabled = busy || !canConfigure;
  elements.saveButton.disabled = busy || !hasProject;
  elements.discardButton.disabled = busy || !hasProject;

  if (!environmentReady) {
    elements.startHint.textContent = "Corrija os itens do diagnóstico antes de iniciar.";
  } else if (!selectionReady) {
    elements.startHint.textContent = pendingMode === "window"
      ? "Selecione uma janela visível."
      : pendingMode === "display"
        ? "Selecione um monitor."
        : "Defina a área de gravação.";
  } else {
    elements.startHint.textContent = "A barra de controle aparecerá no topo da tela durante a gravação.";
  }

  if (state.project) {
    elements.resultDuration.textContent = formatTime(state.project.durationSeconds);
    elements.resultResolution.textContent = `${state.project.width} × ${state.project.height}`;
    const count = state.project.segmentCount ?? 1;
    elements.resultSegments.textContent = `${count} ${count === 1 ? "segmento" : "segmentos"}`;
    elements.resultDescription.textContent = count > 1
      ? "Os períodos pausados foram removidos e os segmentos foram consolidados."
      : "O vídeo temporário está pronto para ser salvo.";
  }

  if (state.lastSavedPath) elements.savedPath.textContent = state.lastSavedPath;

  if (state.error && state.error !== dismissedError) {
    elements.errorMessage.textContent = state.error;
    elements.errorBanner.hidden = false;
  }
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

elements.startButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    const state = await unwrap(window.autoScreen.startRecording({
      fps: Number(elements.fpsSelect.value),
      showCursor: elements.cursorToggle.checked,
    }));
    renderState(state);
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
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
    currentState = value.state;
    pendingMode = value.state.source?.mode ?? "display";
    selectedDisplayIndex = value.state.source?.displayIndex ?? null;
    populateDisplays(value.displays ?? [], selectedDisplayIndex);
    populateWindows(value.windows ?? []);
    renderState(value.state);
  } catch (error) {
    showLocalError(error);
  } finally {
    setBusy(false);
  }
}

void bootstrap();
