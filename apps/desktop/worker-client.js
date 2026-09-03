import { spawn } from "node:child_process";

const PROTOCOL_PREFIX = "@@AUTO_SCREEN@@";

function nodeExecutable() {
  return process.env.npm_node_execpath || process.env.NODE || "node";
}

export class NodeWorkerClient {
  constructor(projectRoot, workerPath) {
    this.projectRoot = projectRoot;
    this.workerPath = workerPath;
    this.child = undefined;
    this.buffer = "";
    this.stderr = "";
    this.sequence = 0;
    this.pending = new Map();
    this.closing = false;
  }

  ensureStarted() {
    if (this.child && this.child.exitCode === null) return;
    if (this.closing) throw new Error("O processo de gravação está sendo encerrado.");

    const child = spawn(nodeExecutable(), [this.workerPath], {
      cwd: this.projectRoot,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;
    this.buffer = "";
    this.stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consume(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });
    child.once("error", (error) => this.rejectAll(error));
    child.once("close", (code) => {
      const detail = this.stderr.trim();
      this.rejectAll(new Error(
        `O processo Node de gravação terminou com código ${code ?? -1}${detail ? `: ${detail}` : "."}`,
      ));
      if (this.child === child) this.child = undefined;
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!line.startsWith(PROTOCOL_PREFIX)) {
        this.stderr = `${this.stderr}${line}\n`.slice(-16_384);
        continue;
      }
      let message;
      try {
        message = JSON.parse(line.slice(PROTOCOL_PREFIX.length));
      } catch {
        this.rejectAll(new Error(`O worker retornou uma mensagem inválida: ${line.slice(0, 300)}`));
        continue;
      }
      const request = this.pending.get(message.id);
      if (!request) continue;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else request.reject(new Error(message.error || "O worker não informou o erro."));
    }
  }

  rejectAll(error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  invoke(command, payload) {
    this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) throw new Error("O processo de gravação não aceita comandos.");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async dispose() {
    if (this.closing) return;
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.closing = true;
      return;
    }
    try { await this.invoke("cleanup"); } catch { /* melhor esforço */ }
    this.closing = true;
    if (child.stdin.writable) child.stdin.end();
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 2_000);
    timer.unref();
  }
}
