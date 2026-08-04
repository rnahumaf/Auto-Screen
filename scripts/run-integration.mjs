if (!process.argv.includes("--allow-input-control")) {
  throw new Error("Este teste movimenta e clica o mouse. Confirme com: npm run test:integration -- --allow-input-control");
}
await import("./run-demo.mjs");
