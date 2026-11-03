# OCR review — 2026-11-03

This update preserves first-pass OCR and human corrections and adds bounded alternative readings for difficult regions. It does not claim a measured accuracy gain or approve a new model.

## Recognition and limits

- Browser and native CPU workers use the same crop implementation. First-pass vertical cuts retain the previous algorithm; alternative cuts prefer blank bands and add white padding and conservative contrast normalization.
- At most `min(4, ceil(regions / 4))` flagged regions receive one additional pass, in stable reading order. Each region has a maximum of 32 parts. This is a region limit, not a four-decoder-call limit. Existing deadlines, cancellation and page quotas continue to apply.
- Candidate text is returned separately from original text. Rechecks never automatically overwrite primary OCR or manual corrections. Existing stored pages are not rescanned automatically by this update.
- Crop analysis is one linear pixel pass plus bounded projection scans. White-space/glyph association uses an index instead of scanning every glyph for every white region. These are local algorithm improvements, not a claim that the entire OCR pipeline has linear runtime.
- Region comparison uses exact character edit distance with rolling rows: worst-case O(nm) time, O(m) memory, a 6,000-character cap and a separate UI worker with a 15-second timeout.

## Review interface and persistence

The right reading panel provides an original-region crop, original OCR, alternative text, explicit adoption and undo, and an independent human-reference field. Scoring uses NFC, ignores whitespace and includes punctuation. Human edits are not substituted for machine outputs in scores.

Machine evidence travels with PDF blocks and local region drafts. Existing CAS, version and manual-correction protections remain in force. Evaluation records are account-scoped in the current browser, capped at 100 regions, and exportable as JSON. Development and untouched validation samples are reported separately.

## Validation performed

- Unit/integration checks: crop coverage and safe cuts; bounded retries and cancellation; evidence normalization; browser/native module packaging; CER differential checks against exact edit distance; explicit candidate adoption, undo, notes and draft restoration; existing free selection, deletion and PDF refresh protections.
- Real pinned-model native CPU regression, using existing repository manga and novel fixtures: 10 manga regions and 17 novel regions. All primary texts match the pre-change baseline; one-lane and four-lane outputs including review metadata are identical.
- Manga: no regions required rechecking. Novel: four regions rechecked; two alternative readings differ. Differences are not evidence of correctness without human transcription.
- Browser interaction checks use a clearly labeled synthetic difference to exercise scoring and restoration. These are not OCR accuracy samples.

The baseline in `tests/fixtures/precision-review-baseline.json` is previous machine output, not human ground truth. Run the native regression after preparing `.sites-runtime/runpod-package` with pinned models and dependencies:

```sh
node tests/precision-review-native.mjs
```

Cloud endpoint build/runtime and human-reference accuracy acceptance remain separate deployment checks. No cloud latency, cost or accuracy figure is inferred from local CPU measurements.
