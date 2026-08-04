import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const COMMIT = "684543d5e5efaef08d02be50dcda8d552478fa60";
const SHA256 = "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe";
const URL = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${COMMIT}/GeneralUser-GS.sf2`;
const outputPath = resolve("output/soundfonts/GeneralUser-GS.sf2");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

try {
  const existing = await readFile(outputPath);
  if (digest(existing) === SHA256) {
    console.log(`SoundFont pronto: ${outputPath}`);
    process.exit(0);
  }
  throw new Error(`O SoundFont existente não corresponde ao SHA-256 esperado: ${outputPath}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
console.log(`Baixando GeneralUser GS fixado em ${COMMIT}...`);
const response = await fetch(URL);
if (!response.ok) throw new Error(`Falha no download: HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (digest(bytes) !== SHA256) throw new Error("SHA-256 inesperado para o SoundFont baixado.");
await mkdir(dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.download`;
await rm(temporary, { force: true });
await writeFile(temporary, bytes);
await rename(temporary, outputPath);
console.log(`SoundFont pronto: ${outputPath}`);
