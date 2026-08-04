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
  const requestedControl = script.recorder?.inputControl?.enabled === true;
  if (requestedControl && !options.allowInputControl) {
    throw new Error("O roteiro solicita controle do mouse; confirme com allowInputControl: true.");
  }
  const recorderConfig = {
    ...(script.recorder ?? {}),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    inputControl: {
      ...(script.recorder?.inputControl ?? {}),
      enabled: requestedControl && options.allowInputControl === true,
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
