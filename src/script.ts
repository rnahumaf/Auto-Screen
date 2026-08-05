import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createScreenRecorder } from "./recorder.js";
import { renderScreenProject } from "./render.js";
import type { RenderResult, RunScriptOptions, ScreenScript } from "./types.js";
import { validateScreenScript } from "./validation.js";

export async function loadScreenScript(path: string): Promise<ScreenScript> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  return validateScreenScript(parsed);
}

export async function runScreenScript(scriptInput: ScreenScript | unknown, options: RunScriptOptions): Promise<RenderResult> {
  const script = validateScreenScript(scriptInput);
  const hasMouseSteps = script.steps.some((step) => step.type === "moveMouse" || step.type === "click" || step.type === "scroll");
  const hasKeyboardSteps = script.steps.some((step) => step.type === "typeText" || step.type === "pressKey");
  const requestedMouseControl = script.recorder?.inputControl?.enabled === true && hasMouseSteps;
  const requestedKeyboardControl = script.recorder?.inputControl?.enabled === true &&
    script.recorder.inputControl.keyboard?.enabled === true && hasKeyboardSteps;
  if (requestedMouseControl && !options.allowInputControl) {
    throw new Error("O roteiro solicita controle do mouse; confirme com allowInputControl: true.");
  }
  if (requestedKeyboardControl && !options.allowKeyboardControl) {
    throw new Error("O roteiro solicita controle do teclado; confirme com allowKeyboardControl: true.");
  }
  const recorderConfig = {
    ...(script.recorder ?? {}),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    inputControl: {
      ...(script.recorder?.inputControl ?? {}),
      enabled: (requestedMouseControl && options.allowInputControl === true) ||
        (requestedKeyboardControl && options.allowKeyboardControl === true),
      keyboard: {
        ...(script.recorder?.inputControl?.keyboard ?? {}),
        enabled: requestedKeyboardControl && options.allowKeyboardControl === true,
      },
    },
  };
  const session = createScreenRecorder(recorderConfig);
  await session.start();
  try {
    for (const step of script.steps) {
      if (step.type === "moveMouse") await session.moveMouse({ x: step.x, y: step.y }, {
        ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
        ...(step.easing === undefined ? {} : { easing: step.easing }),
      });
      else if (step.type === "click") await session.click({
        ...(step.button === undefined ? {} : { button: step.button }),
        ...(step.count === undefined ? {} : { count: step.count }),
        ...(step.holdMs === undefined ? {} : { holdMs: step.holdMs }),
      });
      else if (step.type === "scroll") await session.scroll({
        ...(step.deltaX === undefined ? {} : { deltaX: step.deltaX }),
        ...(step.deltaY === undefined ? {} : { deltaY: step.deltaY }),
        ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
      });
      else if (step.type === "typeText") await session.typeText(step.text, {
        ...(step.intervalMs === undefined ? {} : { intervalMs: step.intervalMs }),
      });
      else if (step.type === "pressKey") await session.pressKey(step.key, {
        ...(step.modifiers === undefined ? {} : { modifiers: step.modifiers }),
      });
      else if (step.type === "wait") await session.wait(step.durationMs);
      else session.mark(step.id, step.intensity);
    }
    const project = await session.stop();
    return await renderScreenProject(project, { outPrefix: options.outPrefix, ...(script.render ?? {}) });
  } catch (error) {
    try { await session.stop(); } catch { /* preservar o erro original */ }
    throw error;
  }
}
