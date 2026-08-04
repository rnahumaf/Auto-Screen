import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const validator = join(codexHome, "skills", ".system", "skill-creator", "scripts", "quick_validate.py");
const skills = ["capture-windows-sessions", "compose-screen-timelines", "integrate-video-audio"];

if (!existsSync(validator)) {
  console.error(`quick_validate.py não encontrado em ${validator}. Instale a skill-creator ou defina CODEX_HOME.`);
  process.exit(1);
}
for (const skill of skills) {
  const result = spawnSync(process.env.PYTHON || "python", [validator, resolve(".agents", "skills", skill)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
