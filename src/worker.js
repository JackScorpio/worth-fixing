// src/worker.js
//
// Entry point — see src/worker/injection.js (per-origin toggle) and
// src/worker/capture.js (capture -> fingerprint -> dedupe -> RECORD relay).
import './worker/injection.js';
import './worker/capture.js';
