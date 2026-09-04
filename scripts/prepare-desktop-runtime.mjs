import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repositoryRoot, "dist", "index.js");
const runtimeDirectory = join(repositoryRoot, "apps", "desktop", "runtime");
const destinationPath = join(runtimeDirectory, "index.js");

await access(sourcePath);
await mkdir(runtimeDirectory, { recursive: true });
await copyFile(sourcePath, destinationPath);
console.log(`Runtime do desktop preparado em ${destinationPath}.`);
