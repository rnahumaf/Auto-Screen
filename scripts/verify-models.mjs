import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const expected = {
  "face-landmarker.task": "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  "selfie-segmenter.tflite": "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b",
  "selfie-multiclass.tflite": "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0",
  "voice-denoise.rnnn": "f1357c4e5be9dee8467bead486dfced2d75b640c26ad0b594fa7f102322371d9",
};

for (const [name, hash] of Object.entries(expected)) {
  const file = await readFile(join("assets", "models", name));
  if (createHash("sha256").update(file).digest("hex") !== hash) {
    throw new Error(`O modelo ${name} não corresponde ao SHA-256 fixado.`);
  }
}
process.stdout.write("Modelos locais verificados por SHA-256.\n");
