// @ts-check
/** @typedef {"idle"|"starting"|"recording"|"pausing"|"paused"|"resuming"|"stopping"|"stopped"|"failed"|"captured"|"previewing"|"rendering"} WorkerPhase */
/**
 * @typedef {object} WorkerState
 * @property {WorkerPhase} phase
 * @property {number} elapsedSeconds
 * @property {Record<string, unknown>|null} [project]
 */
/** @type {ReadonlySet<string>} */
const phases = new Set(["idle", "starting", "recording", "pausing", "paused", "resuming", "stopping", "stopped", "failed", "captured", "previewing", "rendering"]);

/** Validate the worker boundary before showing a recording state.
 * @param {unknown} value
 * @returns {WorkerState & Record<string, unknown>}
 */
export function checkedWorkerState(value) {
  if (!value || typeof value !== "object") throw new Error("O gravador retornou um estado inválido.");
  const state = /** @type {Record<string, unknown>} */ (value);
  if (typeof state.phase !== "string" || !phases.has(state.phase) ||
      typeof state.elapsedSeconds !== "number" || !Number.isFinite(state.elapsedSeconds) || state.elapsedSeconds < 0) {
    throw new Error("O gravador retornou fase ou duração inválida. Interrompa a operação e reinicie o aplicativo.");
  }
  return /** @type {WorkerState & Record<string, unknown>} */ (state);
}
