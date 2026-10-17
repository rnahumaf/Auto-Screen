import { utilityProcess } from "electron";
import { spawn } from "node:child_process";

const PROTOCOL_PREFIX = "@@AUTO_SCREEN@@";
const LONG_COMMANDS = new Set(["stop", "pause-resume", "preview", "save", "webcam-effects-sources", "webcam-effects-apply", "voice-local", "voice-replace"]);

async function terminateTree(child) {
  // UtilityProcess.kill sozinho pode deixar seus processos FFmpeg gravando no Windows.
  if (process.platform === "win32" && Number.isInteger(child.pid) && child.pid > 0) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        shell: false, windowsHide: true, stdio: "ignore",
      });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, 3_000);
      const done = () => { clearTimeout(timer); resolve(); };
      killer.once("error", done);
      killer.once("close", done);
    });
  }
  child.kill();
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
    this.childExited = false;
    this.failure = undefined;
    this.disposing = undefined;
  }

  ensureStarted() {
    if (this.failure) throw this.failure;
    if (this.closing) throw new Error("O processo de gravação está sendo encerrado.");
    if (this.child && !this.childExited) return;

    const child = utilityProcess.fork(this.workerPath, [], {
      cwd: this.projectRoot,
      stdio: "pipe",
      env: process.env,
      serviceName: "Auto-Screen Recorder",
    });
    this.child = child;
    this.childExited = false;
    this.buffer = "";
    this.stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.consume(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });
    child.on("message", (message) => this.consumeMessage(message));
    child.once("error", (error) => { this.failure = error; this.rejectAll(error); });
    child.once("exit", (code) => {
      this.childExited = true;
      const detail = this.stderr.trim();
      const error = new Error(
        `O processo de gravação terminou com código ${code ?? -1}${detail ? `: ${detail}` : "."}`,
      );
      if (!this.closing) this.failure = error;
      this.rejectAll(error);
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
      this.consumeMessage(message);
    }
  }

  consumeMessage(message) {
    const request = this.pending.get(message?.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error(message.error || "O worker não informou o erro."));
  }

  rejectAll(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  invoke(command, payload) {
    this.ensureStarted();
    const child = this.child;
    if (!child || this.childExited) throw new Error("O processo de gravação não aceita comandos.");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = command === "status" ? 10_000 : LONG_COMMANDS.has(command) ? 6 * 60 * 60 * 1_000 : 120_000;
      const timer = setTimeout(() => {
        this.failure = new Error(`O gravador não respondeu à operação ${command} no prazo. Os arquivos temporários serão preservados. Reinicie o aplicativo para continuar.`);
        this.rejectAll(this.failure);
        void this.dispose();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.postMessage({ id, command, payload });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  dispose() {
    if (this.disposing) return this.disposing;
    this.closing = true;
    this.rejectAll(new Error("O gravador está sendo encerrado. Os arquivos temporários foram mantidos."));
    const child = this.child;
    if (!child || this.childExited) {
      return Promise.resolve();
    }
    this.disposing = (async () => {
      const id = ++this.sequence;
      await new Promise((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve(); }, 5_000);
        this.pending.set(id, { resolve, reject: resolve, timer });
        try { child.postMessage({ id, command: "shutdown" }); }
        catch { clearTimeout(timer); this.pending.delete(id); resolve(); }
      });
      if (!this.childExited) await terminateTree(child);
    })();
    return this.disposing;
  }
}
