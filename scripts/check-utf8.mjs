import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const included = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".md", ".html", ".css", ".ps1", ".cmd", ".yaml", ".yml"]);
const ignored = new Set([".git", "dist", "node_modules", "output"]);
const mojibake = /(?:\u00C3[\u00A7\u00A3\u00A1\u00A9\u00AA\u00B3\u00B5\u00BA]|\u00C2[\u00A0-\u00FF]|\u00E2(?:\u20AC|\u2122)|\uFFFD)/u;
const decoder = new TextDecoder("utf-8", { fatal: true });
const failures = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (!included.has(extname(entry.name).toLowerCase()) && entry.name !== "AGENTS.md" && entry.name !== "README.md") continue;
    const bytes = await readFile(path);
    let text;
    try { text = decoder.decode(bytes); }
    catch { failures.push(`${relative(root, path)} não é UTF-8 válido.`); continue; }
    if (mojibake.test(text)) failures.push(`${relative(root, path)} contém uma sequência típica de mojibake.`);
    if (extname(entry.name).toLowerCase() === ".ps1" && /[^\x00-\x7F]/u.test(text) && !bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) {
      failures.push(`${relative(root, path)} contém Unicode e precisa de UTF-8 BOM para Windows PowerShell 5.1.`);
    }
  }
}

await visit(root);
if (failures.length > 0) throw new Error(failures.join("\n"));
console.log("UTF-8 válido; nenhum mojibake conhecido encontrado.");
