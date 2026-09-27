import { FaceLandmarker, FilesetResolver, ImageSegmenter } from "../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs";

const WASM_DIRECTORY = new URL("../node_modules/@mediapipe/tasks-vision/wasm", import.meta.url).href;
const MIN_INFERENCE_INTERVAL_MS = 90;
const FACE_OVAL = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map(({ start }) => start);
const LEFT_EYE = [...new Set([...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW].flatMap(({ start, end }) => [start, end]))];
const RIGHT_EYE = [...new Set([...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW].flatMap(({ start, end }) => [start, end]))];
const LIPS = [...new Set(FaceLandmarker.FACE_LANDMARKS_LIPS.flatMap(({ start, end }) => [start, end]))];

function strength(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function sourceSize(source) {
  return [source.videoWidth || source.naturalWidth || source.width,
    source.videoHeight || source.naturalHeight || source.height];
}

function cutout(context, landmarks, indices, width, height, padX, padY) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean);
  if (!points.length) return;
  const left = Math.min(...points.map(({ x }) => x)) * width;
  const right = Math.max(...points.map(({ x }) => x)) * width;
  const top = Math.min(...points.map(({ y }) => y)) * height;
  const bottom = Math.max(...points.map(({ y }) => y)) * height;
  context.beginPath();
  context.ellipse((left + right) / 2, (top + bottom) / 2,
    Math.max(1, (right - left) * (0.5 + padX)),
    Math.max(1, (bottom - top) * (0.5 + padY)), 0, 0, Math.PI * 2);
  context.fill();
}

function drawFaceMask(context, landmarks, width, height) {
  context.clearRect(0, 0, width, height);
  if (!landmarks?.length) return;
  context.fillStyle = "#fff";
  context.beginPath();
  FACE_OVAL.forEach((index, position) => {
    const point = landmarks[index];
    if (position === 0) context.moveTo(point.x * width, point.y * height);
    else context.lineTo(point.x * width, point.y * height);
  });
  context.closePath();
  context.fill();
  context.globalCompositeOperation = "destination-out";
  cutout(context, landmarks, LEFT_EYE, width, height, 0.16, 0.20);
  cutout(context, landmarks, RIGHT_EYE, width, height, 0.16, 0.20);
  cutout(context, landmarks, LIPS, width, height, 0.16, 0.45);
  context.globalCompositeOperation = "source-over";
}

function drawPersonMask(context, mask, previous) {
  const values = mask.getAsFloat32Array();
  if (values.length !== mask.width * mask.height) throw new Error("A máscara de pessoa retornou dimensões inválidas.");
  let personPixels = 0;
  for (const confidence of values) {
    if (!Number.isFinite(confidence)) return { valid: false, values };
    if (confidence > 0.5) personPixels += 1;
  }
  const coverage = personPixels / values.length;
  if (coverage < 0.08) return { valid: false, values };
  const pixels = context.createImageData(mask.width, mask.height);
  const next = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const alpha = Math.max(0, Math.min(1, (values[index] - 0.12) / 0.76));
    const smoothed = previous?.length === values.length ? previous[index] * 0.4 + alpha * 0.6 : alpha;
    next[index] = smoothed;
    const offset = index * 4;
    pixels.data[offset] = 255;
    pixels.data[offset + 1] = 255;
    pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = Math.round(smoothed * 255);
  }
  context.putImageData(pixels, 0, 0);
  return { valid: true, values, next };
}

function faceInsidePerson(landmarks, values, width, height) {
  if (!landmarks?.length) return true;
  const probes = [1, 4, 234, 454, 152].map((index) => landmarks[index]).filter(Boolean);
  const covered = probes.filter(({ x, y }) => {
    const px = Math.max(0, Math.min(width - 1, Math.floor(x * width)));
    const py = Math.max(0, Math.min(height - 1, Math.floor(y * height)));
    return values[py * width + px] > 0.42;
  }).length;
  return covered >= 3;
}

export async function createCameraEffects({ backgroundBlur = 0, faceRetouch = 0, modelUrls, forceModel = false }) {
  let blur = strength(backgroundBlur);
  let retouch = strength(faceRetouch);
  let segmenter;
  let faceLandmarker;
  if (forceModel || blur > 0 || retouch > 0) {
    if (!modelUrls?.person || !modelUrls?.face) throw new Error("Os modelos locais dos filtros da webcam não estão disponíveis.");
    const vision = await FilesetResolver.forVisionTasks(WASM_DIRECTORY);
    try {
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrls.person, delegate: "CPU" },
        runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false,
      });
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrls.face, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1,
      });
    } catch (error) {
      segmenter?.close();
      throw new Error(`Os modelos locais da webcam não abriram: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const personMask = document.createElement("canvas");
  const personContext = personMask.getContext("2d", { willReadFrequently: true });
  const faceMask = document.createElement("canvas");
  const faceContext = faceMask.getContext("2d");
  const softenedFaceMask = document.createElement("canvas");
  const softenedFaceContext = softenedFaceMask.getContext("2d");
  const personLayer = document.createElement("canvas");
  const personLayerContext = personLayer.getContext("2d");
  const skinLayer = document.createElement("canvas");
  const skinLayerContext = skinLayer.getContext("2d");
  let previousPerson;
  let lastInferenceAt = -Infinity;
  let hasPersonMask = false;
  let faceLandmarks;
  let faceScale = 1;

  function updateMasks(source, timestamp, width, height) {
    if (!segmenter || timestamp - lastInferenceAt < MIN_INFERENCE_INTERVAL_MS) return;
    lastInferenceAt = timestamp;
    faceLandmarks = faceLandmarker.detectForVideo(source, timestamp).faceLandmarks[0];
    if (faceLandmarks?.length) {
      const xs = FACE_OVAL.map((index) => faceLandmarks[index].x);
      faceScale = Math.max(0.5, Math.min(1.8, (Math.max(...xs) - Math.min(...xs)) * width / 190));
    } else faceScale = 1;
    const result = segmenter.segmentForVideo(source, timestamp);
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error("O modelo local não retornou a máscara de pessoa.");
      if (personMask.width !== mask.width || personMask.height !== mask.height) {
        personMask.width = mask.width;
        personMask.height = mask.height;
        previousPerson = undefined;
      }
      const person = drawPersonMask(personContext, mask, previousPerson);
      hasPersonMask = person.valid && faceInsidePerson(faceLandmarks, person.values, mask.width, mask.height);
      previousPerson = hasPersonMask ? person.next : undefined;
      drawFaceMask(faceContext, faceLandmarks, width, height);
    } finally {
      result.close();
    }
  }

  function draw(source, canvas, timestamp) {
    const [sourceWidth, sourceHeight] = sourceSize(source);
    if (!sourceWidth || !sourceHeight) return { backgroundApplied: false, faceRetouchApplied: false };
    const scale = Math.min(1, 640 / sourceWidth);
    const width = Math.max(2, Math.round(sourceWidth * scale / 2) * 2);
    const height = Math.max(2, Math.round(sourceHeight * scale / 2) * 2);
    let resized = false;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      resized = true;
    }
    for (const layer of [faceMask, softenedFaceMask, personLayer, skinLayer]) {
      if (layer.width === width && layer.height === height) continue;
      layer.width = width;
      layer.height = height;
      resized = true;
    }
    if (resized) {
      lastInferenceAt = -Infinity;
    }
    if (blur > 0 || retouch > 0) updateMasks(source, timestamp, width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, width, height);
    const backgroundApplied = blur > 0 && hasPersonMask;
    if (backgroundApplied) {
      context.save();
      context.filter = `blur(${Math.max(1, blur / 10 * width / 640).toFixed(1)}px)`;
      context.drawImage(source, 0, 0, width, height);
      context.restore();
      personLayerContext.clearRect(0, 0, width, height);
      personLayerContext.globalCompositeOperation = "source-over";
      personLayerContext.drawImage(source, 0, 0, width, height);
      personLayerContext.globalCompositeOperation = "destination-in";
      personLayerContext.drawImage(personMask, 0, 0, width, height);
      personLayerContext.globalCompositeOperation = "source-over";
      context.drawImage(personLayer, 0, 0);
    } else {
      context.drawImage(source, 0, 0, width, height);
    }
    let faceRetouchApplied = false;
    if (retouch > 0 && faceLandmarks?.length) {
      softenedFaceContext.clearRect(0, 0, width, height);
      softenedFaceContext.save();
      softenedFaceContext.filter = `blur(${(2 * faceScale).toFixed(1)}px)`;
      softenedFaceContext.drawImage(faceMask, 0, 0);
      softenedFaceContext.restore();
      skinLayerContext.clearRect(0, 0, width, height);
      skinLayerContext.save();
      skinLayerContext.filter = `blur(${((1.2 + retouch / 100 * 5.2) * faceScale).toFixed(1)}px)`;
      skinLayerContext.drawImage(source, 0, 0, width, height);
      skinLayerContext.restore();
      const xs = FACE_OVAL.map((index) => faceLandmarks[index].x * width);
      const ys = FACE_OVAL.map((index) => faceLandmarks[index].y * height);
      const left = Math.max(0, Math.floor(Math.min(...xs)) - 8);
      const top = Math.max(0, Math.floor(Math.min(...ys)) - 8);
      const right = Math.min(width, Math.ceil(Math.max(...xs)) + 8);
      const bottom = Math.min(height, Math.ceil(Math.max(...ys)) + 8);
      if (right > left && bottom > top) {
        const regionWidth = right - left;
        const regionHeight = bottom - top;
        const original = context.getImageData(left, top, regionWidth, regionHeight);
        const softened = skinLayerContext.getImageData(left, top, regionWidth, regionHeight);
        const mask = softenedFaceContext.getImageData(left, top, regionWidth, regionHeight);
        const brightness = 1 + retouch / 100 * 0.045;
        for (let offset = 0; offset < original.data.length; offset += 4) {
          const maskAlpha = mask.data[offset + 3] / 255;
          if (maskAlpha === 0) continue;
          const difference = Math.max(
            Math.abs(original.data[offset] - softened.data[offset]),
            Math.abs(original.data[offset + 1] - softened.data[offset + 1]),
            Math.abs(original.data[offset + 2] - softened.data[offset + 2]),
          );
          const detailProtection = Math.max(0, Math.min(1, (35 - difference) / 25));
          const blend = maskAlpha * retouch / 100 * 0.85 * detailProtection;
          if (blend === 0) continue;
          for (let channel = 0; channel < 3; channel += 1) {
            const originalValue = original.data[offset + channel];
            const smoothValue = Math.min(255, softened.data[offset + channel] * brightness);
            original.data[offset + channel] = Math.round(originalValue * (1 - blend) + smoothValue * blend);
          }
          faceRetouchApplied = true;
        }
        context.putImageData(original, left, top);
      }
    }
    return { backgroundApplied, faceRetouchApplied };
  }

  return {
    draw,
    setStrengths: (values) => { blur = strength(values.backgroundBlur); retouch = strength(values.faceRetouch); },
    close: () => { segmenter?.close(); faceLandmarker?.close(); },
  };
}
