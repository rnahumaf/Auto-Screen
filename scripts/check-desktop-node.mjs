const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || major === 22 && minor < 12) {
  throw new Error(
    `A interface Electron exige Node.js 22.12 ou mais recente; versão atual: ${process.versions.node}. ` +
    "A biblioteca e a CLI continuam compatíveis com Node.js 20.",
  );
}
console.log(`Node.js ${process.versions.node} compatível com a interface Electron.`);
