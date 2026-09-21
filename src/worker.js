// src/worker.js
//
// Entry point — see src/worker/injection.js (per-origin toggle),
// src/worker/capture.js (capture -> fingerprint -> dedupe -> RECORD relay),
// and src/worker/usage.js (Jev spend tracking).
import './worker/injection.js';
import './worker/capture.js';
import './worker/usage.js';
