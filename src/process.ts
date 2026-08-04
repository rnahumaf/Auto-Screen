import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  executable: string,
  args: string[],
  options: { cwd?: string; input?: string; allowFailure?: boolean } = {},
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: "pipe",
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(`${executable} terminou com código ${result.code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export function spawnProcess(executable: string, args: string[], cwd?: string): ChildProcessWithoutNullStreams {
  return spawn(executable, args, {
    cwd,
    windowsHide: true,
    stdio: "pipe",
    shell: false,
  });
}

export async function waitForProcess(child: ChildProcessWithoutNullStreams): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
