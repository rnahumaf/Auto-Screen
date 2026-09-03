import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    allowFailure?: boolean;
    abortSignal?: AbortSignal;
    gracefulAbortInput?: string;
    gracefulAbortTimeoutMs?: number;
  } = {},
): Promise<ProcessResult> {
  if (options.abortSignal?.aborted) throw new Error("O processo foi cancelado antes de iniciar.");
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: "pipe",
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const append = (current: string, chunk: string): string => `${current}${chunk}`.slice(-1_048_576);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: string) => { stderr = append(stderr, chunk); });
    const abort = (): void => {
      aborted = true;
      if (child.exitCode !== null) return;
      if (options.gracefulAbortInput !== undefined && child.stdin.writable) {
        child.stdin.write(options.gracefulAbortInput);
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill();
        }, options.gracefulAbortTimeoutMs ?? 1_500);
      } else child.kill();
    };
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      options.abortSignal?.removeEventListener("abort", abort);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (code) => {
      options.abortSignal?.removeEventListener("abort", abort);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (aborted) {
        reject(new Error("O processo foi cancelado."));
        return;
      }
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(`${executable} terminou com código ${result.code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else if (options.gracefulAbortInput === undefined) child.stdin.end();
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
