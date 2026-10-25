// Background removal off the main thread. The model (ormbg, Apache-2.0) downloads from the
// Hugging Face hub on first use and transformers.js keeps it in the browser's Cache Storage.
// BiRefNet lite was tried first but fails in ONNX Runtime Web (WebGPU shader error, CPU out of memory).
import { env, pipeline, RawImage, type BackgroundRemovalPipeline, type ProgressInfo } from "@huggingface/transformers";

export type BgRequest = { id: number; blob: Blob };
export type BgResponse =
  | { id: number; type: "progress"; loaded: number; total: number }
  | { id: number; type: "processing" }
  | { id: number; type: "done"; blob: Blob }
  | { id: number; type: "error"; message: string };

const MODEL = "onnx-community/ormbg-ONNX";

type Backend = "webgpu" | "wasm";
// fp16 on WebGPU (88 MB); the CPU path uses the 8-bit model (44 MB), which gives the same mask.
const DTYPE = { webgpu: "fp16", wasm: "q8" } as const;

env.allowLocalModels = false;

let remover: { backend: Backend; pipe: Promise<BackgroundRemovalPipeline> } | null = null;

async function hasWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  return !!(gpu && (await gpu.requestAdapter().catch(() => null)));
}

function load(backend: Backend, onProgress: (info: ProgressInfo) => void) {
  if (remover?.backend !== backend) {
    const pipe = pipeline("background-removal", MODEL, {
      device: backend,
      dtype: DTYPE[backend],
      progress_callback: onProgress,
    }) as Promise<BackgroundRemovalPipeline>;
    pipe.catch(() => remover?.pipe === pipe && (remover = null));
    remover = { backend, pipe };
  }
  return remover.pipe;
}

let preferred: Backend | null = null;

const post = (msg: BgResponse) => self.postMessage(msg);

self.onmessage = async ({ data }: MessageEvent<BgRequest>) => {
  const { id, blob } = data;
  const onProgress = (info: ProgressInfo) => {
    if (info.status === "progress_total") post({ id, type: "progress", loaded: info.loaded, total: info.total });
  };
  const attempt = async (backend: Backend) => {
    const run = await load(backend, onProgress);
    post({ id, type: "processing" });
    return (await run(await RawImage.fromBlob(blob))) as RawImage;
  };
  try {
    preferred ??= (await hasWebGPU()) ? "webgpu" : "wasm";
    let out: RawImage;
    try {
      out = await attempt(preferred);
    } catch (err) {
      // Some GPUs and drivers can't run the model; the CPU path is slower but works everywhere.
      if (preferred !== "webgpu") throw err;
      preferred = "wasm";
      out = await attempt("wasm");
    }
    post({ id, type: "done", blob: await out.toBlob("image/png") });
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
