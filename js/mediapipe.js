// Gedeelde lader voor MediaPipe (lokaal in vendor/, dus ook offline).
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from "../vendor/mediapipe/vision_bundle.mjs";

let bestanden = null;
function fileset() {
  if (!bestanden) {
    bestanden = FilesetResolver.forVisionTasks(new URL("../vendor/mediapipe/wasm", import.meta.url).href);
    bestanden.catch(() => { bestanden = null; });
  }
  return bestanden;
}
const model = (naam) => new URL(`../vendor/mediapipe/${naam}`, import.meta.url).href;

export async function maakGezichtsherkenner(aantalGezichten = 1) {
  return FaceLandmarker.createFromOptions(await fileset(), {
    baseOptions: { modelAssetPath: model("face_landmarker.task"), delegate: "CPU" },
    runningMode: "IMAGE",
    numFaces: aantalGezichten,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

export async function maakPersoonSegmenter() {
  return ImageSegmenter.createFromOptions(await fileset(), {
    baseOptions: { modelAssetPath: model("selfie_segmenter.tflite"), delegate: "CPU" },
    runningMode: "IMAGE",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}
