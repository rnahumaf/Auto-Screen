import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// https://developers.google.com/static/mediapipe/images/solutions/examples/image_segmentation.png
const SAMPLE_SHA256 = "f244712571dbf91857847d0b60185323fa2270f5ed26eb642127ccac81e99bbc";

export async function fixedPortraitBytes(path) {
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== SAMPLE_SHA256) {
    throw new Error("A imagem de teste não corresponde ao retrato oficial fixado por SHA-256.");
  }
  return bytes;
}

export async function fixedPortraitJpeg(path) {
  const bytes = await fixedPortraitBytes(path);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-i", "pipe:0",
      "-frames:v", "1", "-vf", "crop=498:574:0:0,scale=640:-2", "-c:v", "mjpeg", "-q:v", "4",
      "-f", "image2pipe", "pipe:1"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0
      ? resolvePromise(Buffer.concat(output).toString("base64"))
      : rejectPromise(new Error(`FFmpeg não preparou a imagem de teste: ${Buffer.concat(errors).toString("utf8")}`)));
    child.stdin.end(bytes);
  });
}
