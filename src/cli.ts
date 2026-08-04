#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runDoctor } from "./doctor.js";
import { renderScreenProject } from "./render.js";
import { loadScreenScript, runScreenScript } from "./script.js";
import { listWindows } from "./windows.js";
import type { CaptureProject, RenderOptions } from "./types.js";

const HELP = `Auto-Screen 0.1.0

Uso:
  auto-screen doctor [--ffmpeg <caminho>]
  auto-screen windows
  auto-screen run --config <roteiro.json> --out <prefixo> --allow-input-control
  auto-screen render --project <projeto.json> --out <prefixo>

O controle real do mouse nunca é liberado pelo CLI sem --allow-input-control.`;

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = valueAfter(args, name);
  if (!value) throw new Error(`Parâmetro obrigatório ausente: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return;
  }
  if (command === "doctor") {
    const ffmpegPath = valueAfter(args, "--ffmpeg");
    const result = await runDoctor(ffmpegPath === undefined ? {} : { ffmpegPath });
    for (const check of result.checks) console.log(`${check.ok ? "OK" : "ERRO"}  ${check.name}: ${check.detail}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "windows") {
    console.log(JSON.stringify(await listWindows(), null, 2));
    return;
  }
  if (command === "run") {
    const script = await loadScreenScript(required(args, "--config"));
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    const result = await runScreenScript(script, {
      outPrefix: required(args, "--out"),
      allowInputControl: args.includes("--allow-input-control"),
      abortSignal: controller.signal,
    });
    console.log(`Vídeo: ${result.videoPath}`);
    console.log(`Manifesto: ${result.manifestPath}`);
    return;
  }
  if (command === "render") {
    const value = JSON.parse(await readFile(resolve(required(args, "--project")), "utf8")) as unknown;
    const container = value as { project?: CaptureProject; render?: Omit<RenderOptions, "outPrefix"> };
    const project = container.project ?? value as CaptureProject;
    const result = await renderScreenProject(project, { outPrefix: required(args, "--out"), ...(container.render ?? {}) });
    console.log(`Vídeo: ${result.videoPath}`);
    console.log(`Manifesto: ${result.manifestPath}`);
    return;
  }
  throw new Error(`Comando desconhecido: ${command}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
