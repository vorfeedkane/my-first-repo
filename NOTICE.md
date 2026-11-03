This experimental service derives the manga-ocr-q8 processing pipeline from Mana's browser implementation.

Public model: kimchireader/manga-ocr-onnx-q8, pinned revision 8e15f1319f1ed70b9560a39f42340dd19ee49f92 (Apache-2.0).
Original Manga OCR project: https://github.com/kha-white/manga-ocr (Apache-2.0).
Transformers.js: Hugging Face, Apache-2.0. ONNX Runtime: Microsoft, MIT.
The accompanying upstream license and provenance notices are in licenses/.

The browser-origin notice describes processing on the user's device. This service processes document pages on the selected compute host instead. It receives only a short-lived signed GET for an allowed R2 object, and keeps a bounded temporary document cache. It does not receive bucket credentials or database credentials.

The image-only decoder partition is a Mana modification. Its graph/weight hashes and source provenance are included in models/cache/manifest.json. Raw inference output remains unreviewed. Cross-runtime sample differences are recorded in VALIDATION.json and are not an accuracy certification.
