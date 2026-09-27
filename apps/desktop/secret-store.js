import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";

export class SecretStore {
  constructor(path) { this.path = path; }

  async hasKey() {
    try { await access(this.path); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }

  async saveKey(value) {
    const key = typeof value === "string" ? value.trim() : "";
    if (key.length < 20 || key.length > 512 || /\s/.test(key)) throw new TypeError("Informe uma chave OpenRouter válida.");
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("A proteção de credenciais do Windows não está disponível.");
    const encrypted = await safeStorage.encryptStringAsync(key);
    await mkdir(dirname(this.path), { recursive: true });
    const staging = join(dirname(this.path), `openrouter-key-${randomUUID()}.tmp`);
    await writeFile(staging, encrypted);
    await rename(staging, this.path);
  }

  async readKey() {
    if (!await this.hasKey()) throw new Error("Guarde sua chave OpenRouter antes de usar a API.");
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("A proteção de credenciais do Windows não está disponível.");
    const encrypted = await readFile(this.path);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    if (decrypted.shouldReEncrypt) await this.saveKey(decrypted.result);
    return decrypted.result;
  }

  async removeKey() { await rm(this.path, { force: true }); }
}
