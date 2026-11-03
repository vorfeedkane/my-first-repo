Transformers.js 3.8.1 (Apache-2.0), Hugging Face: https://github.com/huggingface/transformers.js
ONNX Runtime Web (MIT), Microsoft: https://github.com/microsoft/onnxruntime
Manga OCR (Apache-2.0), kha-white: https://github.com/kha-white/manga-ocr
Browser ONNX export (Apache-2.0): kimchireader/manga-ocr-onnx-q8, revision 8e15f1319f1ed70b9560a39f42340dd19ee49f92.
The pinned encoder and tokenizer/processor metadata are fetched directly from Hugging Face. The partitioned decoder under decoder-cache.84b923b986de70d7 is hosted with this application. All may be cached by the browser. Images are processed locally and are not uploaded.
The decoder partition is a Mana modification: image-only projections are evaluated once per crop and reused during full-prefix greedy decoding. Weights, text-prefix operations and dynamic quantization are unchanged; no text KV cache or output-head slicing is used. scripts/build-precision-cache.py reproduces the partition from the SHA-256-pinned source decoder. manifest.json records provenance and hashes. Initialization falls back to the original pinned decoder when the partition cannot load.
