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
// Pinned commit, so a change upstream can't swap the weights under us.
const MODEL_REVISION = "034e2d884afbab897e10e78fc5bb566b29533fd6";

// Injected by next.config.ts from the installed onnxruntime-web package.
declare const __ORT__: { version: string; sha384: Record<string, string> };
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${__ORT__.version}/dist/`;

type Backend = "webgpu" | "wasm";
// fp16 on WebGPU (88 MB); the CPU path uses the 8-bit model (44 MB), which gives the same mask.
const DTYPE = { webgpu: "fp16", wasm: "q8" } as const;

env.allowLocalModels = false;

let remover: { backend: Backend; pipe: Promise<BackgroundRemovalPipeline> } | null = null;

async function hasWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  return !!(gpu && (await gpu.requestAdapter().catch(() => null)));
}

/** Download an ONNX Runtime file and hand it over as a blob URL only if it matches the pinned hash. */
async function verified(name: string, type: string) {
  const res = await fetch(ORT_CDN + name);
  if (!res.ok) throw new Error(`Couldn't download ${name} (${res.status})`);
  const buf = await res.arrayBuffer();
  const digest = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-384", buf))));
  if (digest !== __ORT__.sha384[name]) throw new Error(`${name} failed its integrity check`);
  return URL.createObjectURL(new Blob([buf], { type }));
}

let runtime: Promise<void> | null = null;

/** Point ONNX Runtime at verified copies. WebGPU needs the asyncify build; CPU-only uses the plain one. */
function prepareRuntime(webgpu: boolean) {
  runtime ??= (async () => {
    const base = webgpu ? "ort-wasm-simd-threaded.asyncify" : "ort-wasm-simd-threaded";
    const [mjs, wasm] = await Promise.all([
      verified(`${base}.mjs`, "text/javascript"),
      verified(`${base}.wasm`, "application/wasm"),
    ]);
    env.backends.onnx.wasm!.wasmPaths = { mjs, wasm };
  })().catch((err) => {
    runtime = null;
    throw err;
  });
  return runtime;
}

function load(backend: Backend, onProgress: (info: ProgressInfo) => void) {
  if (remover?.backend !== backend) {
    const pipe = pipeline("background-removal", MODEL, {
      device: backend,
      dtype: DTYPE[backend],
      revision: MODEL_REVISION,
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
    // The asyncify build also runs on the CPU, so a later fallback reuses it.
    await prepareRuntime(preferred === "webgpu");
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
