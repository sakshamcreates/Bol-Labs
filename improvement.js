/**
 * BOL — Break Your Stage Fear
 * Improvement Lab — improvement.js
 * Vanilla JS · No frameworks · No external libraries
 *
 * MICRO DRILL MODE — Dynamic Intelligent Metric-Aware Correction Engine
 *  - computeDistance(drillConfig, value): generic distance for any metric type
 *  - computeImprovement(previousDistance, currentDistance): improvement status
 *  - evaluateDrill(drillConfig, audioBlob): isolated, metric-aware evaluation
 *  - Works with ANY drillConfig from LLM: { title, metric, type, target: {min?, max?} }
 *  - 2 consecutive passes required before marking drill complete
 *  - Auto-submit when timer reaches 0 (no manual submit needed)
 *  - Submit button only shown on early manual stop
 *  - Take Help feature with static prompt bank (no LLM auto-call)
 *  - Result display: Previous / Current / Distance / Improvement Status
 *  - Attempt history stored in localStorage per drillId
 */

/* ═══════════════════════════════════════════════════════════════
   PART 1 — GENERIC METRIC ENGINE
═══════════════════════════════════════════════════════════════ */

/**
 * computeDistance(drillConfig, value)
 * Works for any metric config returned by LLM.
 *
 * drillConfig shape:
 * {
 *   metric: string,
 *   type: "range" | "max" | "min",
 *   target: { min?: number, max?: number }
 * }
 */

// ─────────────────────────────────────────────────────────────────
// FIXED #1 — Single Supabase client instance.
// Previously `window.supabase = window.supabase.createClient(...)`
// overwrote the library object with a client, which is brittle and
// causes "already declared" errors in strict mode.
// Now we store the client in a dedicated module-level const and use
// that everywhere — window.supabase (the library) is left untouched.
// ─────────────────────────────────────────────────────────────────
if (!window.supabase) {
  console.error("Supabase library not loaded");
}

const supabaseClient = window.supabase.createClient(
  "https://muifdxmbtrpbqglyuudx.supabase.co",
  "sb_publishable_vD-_br5ry0EDmwkTgPVCHg_a9Bazjcv"
);

// ─────────────────────────────────────────────────────────────────
// FIXED #2 & #3 & #8 — Single consolidated fetchScoreFromSupabase.
// Previously there were two definitions; now there is exactly one.
// Query uses user_id (NOT session_id — that column does not exist).
// Removed .single() to prevent PGRST116 crashes when zero rows exist;
// instead we take data[0] and return 0 gracefully on empty results.
// ─────────────────────────────────────────────────────────────────
async function fetchScoreFromSupabase(userId) {
  const { data, error } = await supabaseClient
    .from("Attempts")
    .select("confidence_score")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  // NOTE: no .single() — avoids crash when 0 rows exist

  if (error) {
    console.error("Score fetch error:", error);
    return 0;
  }

  // FIXED #8 — graceful empty-result handling
  if (!data || data.length === 0) return 0;
  return data[0].confidence_score ?? 0;
}

let currentUser = null;


function computeDistance(drillConfig, value) {
  const { type, target } = drillConfig;
  const min = target && target.min !== undefined ? Number(target.min) : null;
  const max = target && target.max !== undefined ? Number(target.max) : null;

  if (type === 'range') {
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
  }

  if (type === 'max') {
    if (value <= max) return 0;
    return value - max;
  }

  if (type === 'min') {
    if (value >= min) return 0;
    return min - value;
  }

  return 0;
}

/**
 * computeImprovement(previousDistance, currentDistance)
 * Returns: "Perfect" | "Improving" | "Worsened" | "No Change"
 */
function computeImprovement(previousDistance, currentDistance) {
  if (currentDistance === 0) return 'Perfect';
  if (previousDistance === null || previousDistance === undefined) return 'No Change';
  const delta = previousDistance - currentDistance;
  if (delta > 0) return 'Improving';
  if (delta < 0) return 'Worsened';
  return 'No Change';
}

/**
 * extractMetricValue(metric, backendData, frontendSignals)
 * Generic extractor — works for any metric string.
 * Falls back to frontend signals when backend is unavailable.
 */
function extractMetricValue(metric, backendData, frontendSignals) {
  const m = (metric || '').toLowerCase();
  const bd = backendData || {};
  const fs = frontendSignals || {};

  // WPM / speech rate
  if (m === 'wpm' || m === 'speechrate' || m === 'speech_rate' || m === 'words_per_minute') {
    const wpm = Number(bd.speechRate || 0);
    if (wpm > 0) return Math.round(wpm);
    // fallback from frontend
    const speechMs = fs.totalSpeechMs || 0;
    const duration = fs.duration || 45;
    const words    = fs.estimatedWords || 0;
    if (words > 0 && duration > 0) return Math.round((words / duration) * 60);
    if (speechMs > 0) return Math.round((speechMs / 1000 / duration) * 130);
    return 0;
  }

  // Filler count
  if (m === 'fillercount' || m === 'filler_count' || m === 'fillers') {
    if (bd.fillerCount !== undefined) return Number(bd.fillerCount);
    if (Array.isArray(bd.fillers)) return bd.fillers.length;
    return 0;
  }

  // Pause duration / panic pauses
  if (m === 'pauseduration' || m === 'pause_duration' || m === 'panicpauses' || m === 'panic_pauses') {
    const pauses = fs.pauseEvents || [];
    return pauses.filter(p => p.durationMs > 800).length;
  }

  // Total pauses
  if (m === 'pauses' || m === 'pausecount' || m === 'pause_count') {
    const pauses = fs.pauseEvents || [];
    return pauses.length;
  }

  // Volume / loudness variance
  if (m === 'volumevariance' || m === 'volume_variance' || m === 'volumestability' || m === 'volume_stability') {
    const samples = fs.loudnessSamples || [];
    if (samples.length < 20) return 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length;
    return Math.round(variance);
  }

  // Repetition / repeated words
  if (m === 'repetition' || m === 'repeated_words' || m === 'repeatcount' || m === 'repeat_count') {
    const transcript = bd.transcript || '';
    if (transcript) {
      const words    = transcript.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const wordFreq = {};
      words.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
      return Object.values(wordFreq).filter(c => c > 1).length;
    }
    const pauses = fs.pauseEvents || [];
    return Math.max(0, pauses.length - 2);
  }

  // Sentence completion score
  if (m === 'sentencecompletion' || m === 'sentence_completion') {
    return Number(
      (bd.sentenceCompletion && bd.sentenceCompletion.score) ||
      (bd.sentenceCompletionStep2 && bd.sentenceCompletionStep2.score) || 60
    );
  }

  // Silence ratio
  if (m === 'silenceratio' || m === 'silence_ratio') {
    const totalMs   = (fs.duration || 45) * 1000;
    const speechMs  = fs.totalSpeechMs || 0;
    const silenceMs = Math.max(0, totalMs - speechMs);
    return Math.round((silenceMs / totalMs) * 100);
  }

  // Default: try common backend fields
  if (bd[metric] !== undefined) return Number(bd[metric]);

  return 0;
}

/* ═══════════════════════════════════════════════════════════════
   PART 3 — HELP CONTENT (static prompt bank, no LLM auto-call)
═══════════════════════════════════════════════════════════════ */

const HELP_CONTENT = {
  default: [
    'Describe your daily routine in detail.',
    'Explain your favorite book.',
    'Talk about a challenge you overcame.',
    'Describe a goal you are working toward.',
    'Tell a story about a memorable experience.',
    'Explain what you do for work or study in simple words.',
    'Describe your hometown and what makes it special.',
    'Talk about something you recently learned.'
  ]
};

function getRandomHelp() {
  const pool = HELP_CONTENT.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Optional LLM help stub — NOT auto-called
async function generateLLMHelp(drillConfig) {
  console.log('[generateLLMHelp] drillConfig:', drillConfig, '— not auto-called');
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   DRILL ID HELPER
═══════════════════════════════════════════════════════════════ */

function makeDrillId(drillConfig) {

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session') || 'global';

  const metric = (drillConfig.metric || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');

  const type = (drillConfig.type || 'range').toLowerCase();

  return `drill_${sessionId}_${metric}_${type}`;
}


/* ═══════════════════════════════════════════════════════════════
   DRILL COMPLETION PERSISTENCE (localStorage)
═══════════════════════════════════════════════════════════════ */

const STORAGE_KEY_COMPLETION = 'bol_drill_completion';
const STORAGE_KEY_HISTORY    = 'bol_drill_history';

function getDrillCompletion(drillId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COMPLETION);
    const obj = raw ? JSON.parse(raw) : {};
    return !!obj[drillId];
  } catch { return false; }
}

function setDrillCompletion(drillId, value) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COMPLETION);
    const obj = raw ? JSON.parse(raw) : {};
    obj[drillId] = value;
    localStorage.setItem(STORAGE_KEY_COMPLETION, JSON.stringify(obj));
  } catch (e) { console.warn('localStorage write failed', e); }
}

/**
 * saveDrillAttempt — stores one attempt record.
 * Schema: { attemptNumber, metricValue, distance, passed, timestamp }
 */
function saveDrillAttempt(drillId, attemptData) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    const obj = raw ? JSON.parse(raw) : {};
    if (!obj[drillId]) obj[drillId] = [];
    obj[drillId].push(attemptData);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(obj));
  } catch (e) { console.warn('localStorage history write failed', e); }
}

function getDrillHistory(drillId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj[drillId] || [];
  } catch { return []; }
}

/**
 * checkConsecutivePasses — requires 2 consecutive passes before drill is "complete".
 */
function checkConsecutivePasses(drillId) {
  const history = getDrillHistory(drillId);
  if (history.length < 2) return false;
  const last2 = history.slice(-2);
  return last2.every(a => a.passed === true);
}

/* ═══════════════════════════════════════════════════════════════
   SESSION LOAD
═══════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────
// FIXED #6 — Deterministic initialization flow.
// Old code: passed `sessionId` (a string) to fetchScoreFromSupabase
//           instead of `currentUser.id`, then loadSession re-fetched
//           the score internally (race condition + duplicate work).
// New flow: DOMContentLoaded → getUser → fetchScore(userId) →
//           loadSession(sessionId, score) → populateImprovement()
// ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Step 1 — get authenticated user
  const { data, error } = await supabaseClient.auth.getUser();

  if (error) {
    console.error("User fetch error:", error);
    return;
  }

  currentUser = data.user;

  if (!currentUser) {
    console.error("User not logged in");
    return;
  }

  console.log("Logged in user:", currentUser.id);

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  if (!sessionId) {
    console.error("No session id found in URL");
    return;
  }

  // Step 2 — fetch latest confidence score using the authenticated user's id
  // FIXED: was fetchScoreFromSupabase(sessionId) — sessionId is wrong here
  const score = await fetchScoreFromSupabase(currentUser.id);

  console.log("Fetched score:", score);

  // Step 3 — load session data, then populate UI
  loadSession(sessionId, score);
});

// ─────────────────────────────────────────────────────────────────
// FIXED #9 — Removed duplicate score fetch and duplicate
// populateImprovement() call that existed inside loadSession.
// The score is now passed in as a parameter (already fetched above).
// Also removed the duplicate `if (!data.ok)` guard that appeared
// after code that had already consumed `data`.
// ─────────────────────────────────────────────────────────────────
async function loadSession(id, score) {
  try {
    const res  = await fetch(`http://localhost:3001/api/session/${id}`);
    const data = await res.json();

    if (!data.ok) {
      console.error('Session fetch failed');
      return;
    }

    console.log('SESSION DATA:', data.session);

    // FIXED #7 — populateImprovement called exactly once with (session, score)
    populateImprovement(data.session, score);

  } catch (err) {
    console.error('Session load error:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   RENDER FOCUS AREAS
═══════════════════════════════════════════════════════════════ */

function renderFocusAreas(mistakes) {
  const container = document.getElementById('dynamicFocusAreas');
  if (!container) return;

  container.innerHTML = '';

  mistakes.forEach((m) => {
    const priority =
      m.severity >= 80 ? 'Critical' :
      m.severity >= 60 ? 'High'     : 'Medium';

    const card = document.createElement('div');
    card.className = 'glass-card focus-card';

    card.innerHTML = `
      <div class="focus-card-left">
        <div class="focus-info">
          <h3 class="focus-title">${m.title}</h3>
          <p class="focus-desc">${m.description}</p>
        </div>
      </div>
      <span class="priority-badge">${priority}</span>
    `;

    container.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════════
   INFER DRILL CONFIG FROM MISTAKE (fallback when LLM doesn't supply one)
═══════════════════════════════════════════════════════════════ */

function inferDrillConfigFromMistake(mistake) {
  // If the LLM returned a drillConfig directly, use it
  if (mistake.drillConfig && mistake.drillConfig.metric && mistake.drillConfig.type) {
    return mistake.drillConfig;
  }

  // Infer from mistake title / description
  const t = ((mistake.title || '') + ' ' + (mistake.description || '')).toLowerCase();

  if (t.includes('pace') || t.includes('speed') || t.includes('wpm') || t.includes('fast') || t.includes('slow') || t.includes('rate')) {
    return {
      title:  'Pace Control Drill',
      metric: 'wpm',
      type:   'range',
      target: { min: 110, max: 155 },
      objective: 'Speak at a natural, confident pace — not too fast, not too slow.',
      passCriteriaLabel: 'Target: 110–155 WPM',
      duration: 45,
      tips: 'Imagine speaking to someone in the second row of an audience. Not too close, not too far.'
    };
  }

  if (t.includes('filler') || t.includes('umm') || t.includes('uhh') || t.includes('uh') || t.includes('repeat')) {
    return {
      title:  'Filler Word Drill',
      metric: 'fillerCount',
      type:   'max',
      target: { max: 2 },
      objective: 'Speak for 45 seconds with fewer than 3 filler words.',
      passCriteriaLabel: 'Pass: ≤ 2 filler words',
      duration: 45,
      tips: 'Pause silently instead of filling gaps with "umm" or "uh". Silence is stronger.'
    };
  }

  if (t.includes('flow') || t.includes('pause') || t.includes('stutter') || t.includes('freeze') || t.includes('stop')) {
    return {
      title:  'Delivery Flow Drill',
      metric: 'pauseDuration',
      type:   'max',
      target: { max: 0 },
      objective: 'Speak in complete sentences with no panic pauses longer than 1 second.',
      passCriteriaLabel: 'Pass: 0 panic pauses',
      duration: 45,
      tips: 'If you blank out, finish the current sentence with a filler thought rather than stopping cold.'
    };
  }

  if (t.includes('clarity') || t.includes('volume') || t.includes('articul') || t.includes('voice') || t.includes('loud')) {
    return {
      title:  'Vocal Clarity Drill',
      metric: 'volumeVariance',
      type:   'max',
      target: { max: 90 },
      objective: 'Speak with consistent volume and clear articulation throughout.',
      passCriteriaLabel: 'Pass: Stable volume throughout',
      duration: 45,
      tips: 'Over-articulate slightly — it sounds exaggerated in your head but sounds natural to listeners.'
    };
  }

  if (t.includes('repetit') || t.includes('word') || t.includes('vocabul')) {
    return {
      title:  'Word Repetition Drill',
      metric: 'repetition',
      type:   'max',
      target: { max: 1 },
      objective: 'Speak for 45 seconds without repeating any content word more than once.',
      passCriteriaLabel: 'Pass: ≤ 1 repeated word',
      duration: 45,
      tips: 'Pause briefly when you feel the urge to repeat — a short silence is better than saying "basically" again.'
    };
  }

  // Default fallback
  return {
    title:  'Confidence Drill',
    metric: 'wpm',
    type:   'range',
    target: { min: 100, max: 160 },
    objective: 'Speak naturally and confidently for the full duration.',
    passCriteriaLabel: 'Target: 100–160 WPM',
    duration: 45,
    tips: 'Breathe before starting. Speak as if you already know the answer.'
  };
}

/* ═══════════════════════════════════════════════════════════════
   RENDER DRILLS — dynamic, metric-aware
═══════════════════════════════════════════════════════════════ */

function renderDrills(mistakes) {
  const container = document.getElementById('dynamicDrills');
  if (!container) return;

  // UI FIX: prevent duplicate drill rendering
  // Clear the container before inserting new drill cards so that
  // re-renders (e.g. from hot-reload or repeated populateImprovement calls)
  // never leave stale duplicate cards in the DOM.
  container.innerHTML = '';

  mistakes.forEach((m, index) => {
    const drillConfig = inferDrillConfigFromMistake(m);
    const drillId     = makeDrillId(drillConfig);
    const isComplete  = getDrillCompletion(drillId);

    const group = document.createElement('div');
    group.className = 'glass-card drill-group';
    group.setAttribute('data-drill-id', drillId);

    group.innerHTML = `
      <div class="drill-group-header">
        <div style="display:flex;align-items:center;gap:10px">
          <h3 style="margin:0">${m.title} — Micro Drill</h3>
          <span class="drill-completion-badge ${isComplete ? 'drill-completion-badge--done' : ''}" id="badge-${drillId}">
            ${isComplete ? '✓ Passed' : 'Not started'}
          </span>
        </div>
      </div>
      <div class="drill-group-body is-open">
        <div class="drill-row" data-group="${index}" data-drill="0">
          <div class="drill-row-info">
            <p class="drill-row-title">${drillConfig.title}</p>
            <p class="drill-row-desc">${drillConfig.objective}</p>
            <p class="drill-row-criteria">${drillConfig.passCriteriaLabel} · ${drillConfig.duration || 45}s</p>
          </div>
          <div class="drill-row-right">
            <button
              class="start-btn ${isComplete ? 'start-btn--done' : ''}"
              data-drill-id="${drillId}"
              data-drill-title="${m.title}"
              data-drill-index="${index}"
            >${isComplete ? '✓ Redo Drill' : 'Start'}</button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(group);
  });

  initStartButtons();
}

/* ═══════════════════════════════════════════════════════════════
   START BUTTON INIT
═══════════════════════════════════════════════════════════════ */

// Global registry: drillId → drillConfig (populated during renderDrills)
const _drillConfigRegistry = {};

function renderDrillsWithRegistry(mistakes) {
  // Build registry before rendering
  mistakes.forEach((m) => {
    const drillConfig = inferDrillConfigFromMistake(m);
    const drillId     = makeDrillId(drillConfig);
    _drillConfigRegistry[drillId] = drillConfig;
  });
  renderDrills(mistakes);
}
let drillButtonsInitialized = false;

function initStartButtons() {

  if (drillButtonsInitialized) return;
  drillButtonsInitialized = true;

  document.addEventListener("click", function(e){

    const btn = e.target.closest(".start-btn");
    if(!btn) return;

    const drillId = btn.getAttribute('data-drill-id');
    const drillTitle = btn.getAttribute('data-drill-title');
    const drillConfig = _drillConfigRegistry[drillId];

    if(!drillConfig) return;

    openDrillOverlay(drillId, drillConfig, drillTitle);

  });

}

/* ═══════════════════════════════════════════════════════════════
   DRILL OVERLAY STATE
═══════════════════════════════════════════════════════════════ */

let drillRecorder             = null;
let drillAudioChunks          = [];
let drillStream               = null;
let drillAudioContext         = null;
let drillAnalyser             = null;
let drillDataArray            = null;
let drillIsRecording          = false;
let drillTimerInterval        = null;
let drillSecondsLeft          = 0;
let drillSecondsElapsed       = 0;
let drillRecordedBlob         = null;
let drillPauseEvents          = [];
let drillLastSilenceTs        = null;
let drillLoudnessSamples      = [];
let drillSilenceThreshold     = 12;
let drillSpeechSegmentStartMs = null;
let drillLastAboveThresholdMs = null;
let drillTotalSpeechMs        = 0;
let drillRecordStartMs        = null;
let drillAutoSubmitPending    = false;

const DRILL_SILENCE_MIN_MS = 700;
const DRILL_MIN_SEGMENT_MS = 250;
const DRILL_MAX_GAP_MS     = 350;

/* ═══════════════════════════════════════════════════════════════
   DRILL OVERLAY — openDrillOverlay accepts drillId + drillConfig
═══════════════════════════════════════════════════════════════ */

function openDrillOverlay(drillId, drillConfig, drillTitle) {

  // UI FIX: prevent multiple overlays
  // If a user clicks Start rapidly or multiple times, only one overlay
  // should ever exist in the DOM. Remove any pre-existing overlay before
  // creating a new one so they cannot stack on top of each other.
  const existing = document.getElementById("drillOverlay");
  if (existing) {
    stopDrillRecording();
    resetDrillState();
    existing.remove();
  }

  const duration = drillConfig.duration || 45;

  const overlay = document.createElement('div');
  overlay.id        = 'drillOverlay';
  overlay.className = 'drill-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="drill-overlay__backdrop"></div>
    <div class="drill-overlay__panel">

      <!-- Header -->
      <div class="drill-overlay__header">
        <div class="drill-overlay__logo">BOL</div>
        <span class="drill-overlay__subtitle">Micro Drill</span>
        <button class="drill-overlay__close" id="drillCloseBtn" aria-label="Close drill">✕</button>
      </div>

      <!-- Title block -->
      <div class="drill-overlay__title-block">
        <h2 class="drill-overlay__title">${drillConfig.title}</h2>
        <p class="drill-overlay__objective">${drillConfig.objective}</p>
        <div class="drill-overlay__criteria-pill">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          ${drillConfig.passCriteriaLabel}
        </div>
      </div>

      <!-- Live metric display -->
      <div class="drill-overlay__metric-row">
        <div class="drill-metric-card" id="drillMetricCard">
          <div class="drill-metric-card__label" id="drillMetricLabel">${formatMetricLabel(drillConfig.metric)}</div>
          <div class="drill-metric-card__value" id="drillMetricValue">—</div>
          <div class="drill-metric-card__status" id="drillMetricStatus">Start recording to measure</div>
        </div>
        <div class="drill-timer-card">
          <div class="drill-timer-card__label">Time</div>
          <div class="drill-timer-card__value" id="drillTimerDisplay">${String(duration).padStart(2, '0')}s</div>
          <div class="drill-timer-ring-wrap">
            <svg class="drill-timer-ring-svg" viewBox="0 0 64 64">
              <circle class="drill-timer-ring-bg" cx="32" cy="32" r="28"/>
              <circle class="drill-timer-ring-fg" id="drillTimerRingFg" cx="32" cy="32" r="28"
                stroke-dasharray="${(2 * Math.PI * 28).toFixed(2)}"
                stroke-dashoffset="0"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- Tip -->
      <div class="drill-overlay__tip">
        <span class="drill-overlay__tip-icon">💡</span>
        <span>${drillConfig.tips || 'Speak clearly and at a natural pace throughout the drill.'}</span>
      </div>

      <!-- Waveform -->
      <div class="drill-overlay__waveform" id="drillWaveform">
        ${Array.from({ length: 10 }).map(() => '<div class="drill-wave-bar"></div>').join('')}
      </div>

      <!-- Controls -->
      <div class="drill-overlay__controls" id="drillControlsArea">
        <button class="drill-record-btn" id="drillRecordBtn">
          <span class="drill-record-btn__icon" id="drillRecordIcon">🎙️</span>
          <span id="drillRecordLabel">Hold tight, tap to begin</span>
        </button>
        <button class="drill-submit-btn" id="drillSubmitBtn" style="display:none">
          Submit Early
        </button>
      </div>

      <!-- Take Help -->
      <div class="drill-overlay__help-section" id="drillHelpSection">
        <button class="drill-help-btn" id="drillHelpBtn">💡 Take Help</button>
        <div class="drill-help-container" id="drillHelpContainer" style="display:none">
          <p class="drill-help-text" id="drillHelpText"></p>
        </div>
      </div>

      <!-- Result area (hidden until submission) -->
      <div class="drill-overlay__result" id="drillResultArea" style="display:none">
        <div class="drill-result-badge" id="drillResultBadge">
          <span id="drillResultIcon">—</span>
          <span id="drillResultText">—</span>
        </div>

        <!-- Metric comparison row -->
        <div class="drill-result-comparison" id="drillResultComparison"></div>

        <!-- Improvement status row -->
        <div class="drill-result-improvement" id="drillResultImprovement" style="display:none">
          <span class="drill-improvement-label" id="drillImprovementLabel"></span>
        </div>

        <div class="drill-result-actions">
          <button class="drill-try-again-btn" id="drillTryAgainBtn">Try Again</button>
          <button class="drill-done-btn" id="drillDoneBtn">Done</button>
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('drill-overlay--visible');
    });
  });

  // Wire close
  document.getElementById('drillCloseBtn').addEventListener('click', () => closeDrillOverlay(overlay));
  overlay.querySelector('.drill-overlay__backdrop').addEventListener('click', () => closeDrillOverlay(overlay));

  // Wire record button
  const recordBtn   = document.getElementById('drillRecordBtn');
  const submitBtn   = document.getElementById('drillSubmitBtn');
  const recordLabel = document.getElementById('drillRecordLabel');
  const recordIcon  = document.getElementById('drillRecordIcon');

  recordBtn.addEventListener('click', async () => {
    if (drillIsRecording) {
      // Manual early stop — show submit button
      stopDrillRecording();
      if (submitBtn) {
        submitBtn.style.display = '';
        submitBtn.disabled      = false;
      }
    } else {
      drillAutoSubmitPending = false;
      await startDrillRecording(drillConfig, drillId, recordBtn, recordLabel, recordIcon, submitBtn, overlay);
    }
  });

  submitBtn.addEventListener('click', () => {
    submitDrillAttempt(drillId, drillConfig, overlay);
  });

  // Wire Take Help button — static, no LLM auto-call
  const helpBtn       = document.getElementById('drillHelpBtn');
  const helpContainer = document.getElementById('drillHelpContainer');
  const helpText      = document.getElementById('drillHelpText');

  helpBtn.addEventListener('click', () => {
    const prompt = getRandomHelp();
    helpText.textContent = prompt;
    const isHidden = helpContainer.style.display === 'none';
    helpContainer.style.display = isHidden ? 'block' : 'none';
    helpBtn.textContent = isHidden ? '✕ Hide Help' : '💡 Take Help';
  });

  // Keyboard close
  function handleKey(e) {
    if (e.key === 'Escape') {
      closeDrillOverlay(overlay);
      document.removeEventListener('keydown', handleKey);
    }
  }
  document.addEventListener('keydown', handleKey);
}

function closeDrillOverlay(overlay) {
  stopDrillRecording();
  resetDrillState();

  overlay.classList.remove('drill-overlay--visible');
  overlay.style.opacity = '0';

  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.style.overflow = 'auto';
  }, 320);
}

/* ═══════════════════════════════════════════════════════════════
   DRILL RECORDING
═══════════════════════════════════════════════════════════════ */

async function startDrillRecording(drillConfig, drillId, recordBtn, recordLabel, recordIcon, submitBtn, overlay) {
  resetDrillState();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    recordLabel.textContent = 'Mic permission denied';
    return;
  }

  drillStream      = stream;
  drillIsRecording = true;

  drillAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source      = drillAudioContext.createMediaStreamSource(stream);
  drillAnalyser     = drillAudioContext.createAnalyser();
  drillAnalyser.fftSize = 1024;
  drillDataArray    = new Uint8Array(drillAnalyser.frequencyBinCount);
  source.connect(drillAnalyser);

  drillAudioChunks = [];
  drillRecorder    = new MediaRecorder(stream);
  drillRecorder.ondataavailable = e => drillAudioChunks.push(e.data);
  drillRecorder.onstop = () => {
    drillRecordedBlob = new Blob(drillAudioChunks, { type: 'audio/webm;codecs=opus' });
    if (drillAutoSubmitPending) {
      drillAutoSubmitPending = false;
      setTimeout(() => submitDrillAttempt(drillId, drillConfig, overlay), 150);
    }
  };
  drillRecorder.start();
  drillRecordStartMs = performance.now();

  recordBtn.classList.add('drill-record-btn--recording');
  recordLabel.textContent = 'Recording… tap to stop early';
  recordIcon.textContent  = '⏹';
  if (submitBtn) submitBtn.style.display = 'none';

  const totalDuration = drillConfig.duration || 45;
  drillSecondsLeft    = totalDuration;
  drillSecondsElapsed = 0;
  const circumference = 2 * Math.PI * 28;

  updateDrillTimer(drillSecondsLeft, totalDuration, circumference);

  drillTimerInterval = setInterval(() => {
    drillSecondsLeft--;
    drillSecondsElapsed++;
    updateDrillTimer(drillSecondsLeft, totalDuration, circumference);

    if (drillSecondsLeft <= 0) {
      // PART 2 — AUTO SUBMIT: timer reached 0, auto-evaluate
      drillAutoSubmitPending = true;
      stopDrillRecording();
      recordBtn.classList.remove('drill-record-btn--recording');
      recordLabel.textContent = 'Time up! Analyzing…';
      recordIcon.textContent  = '🎙️';
      recordBtn.disabled      = true;
      if (submitBtn) submitBtn.style.display = 'none';
    }
  }, 1000);

  requestAnimationFrame(monitorDrillAudio);
}

function updateDrillTimer(secondsLeft, total, circumference) {
  const display = document.getElementById('drillTimerDisplay');
  const ringFg  = document.getElementById('drillTimerRingFg');
  if (display) display.textContent = secondsLeft + 's';
  if (ringFg) {
    const progress = secondsLeft / total;
    const offset   = circumference * (1 - progress);
    ringFg.style.strokeDashoffset = offset.toFixed(2);

    if (secondsLeft <= 10) {
      ringFg.style.stroke = '#f87171';
    } else if (secondsLeft <= 20) {
      ringFg.style.stroke = '#fbbf24';
    } else {
      ringFg.style.stroke = '#6366f1';
    }
  }
}

function stopDrillRecording() {
  clearInterval(drillTimerInterval);
  drillTimerInterval = null;

  if (!drillIsRecording) return;
  drillIsRecording = false;

  if (drillRecorder && drillRecorder.state !== 'inactive') {
    drillRecorder.stop();
  }

  if (drillStream) {
    drillStream.getTracks().forEach(t => t.stop());
    drillStream = null;
  }

  if (drillAudioContext) {
    try { drillAudioContext.close(); } catch (e) {}
    drillAudioContext = null;
  }

  if (drillSpeechSegmentStartMs !== null && drillLastAboveThresholdMs !== null) {
    const seg = drillLastAboveThresholdMs - drillSpeechSegmentStartMs;
    if (seg >= DRILL_MIN_SEGMENT_MS) drillTotalSpeechMs += seg;
  }
  drillSpeechSegmentStartMs = null;
  drillLastAboveThresholdMs = null;

  const recordBtn   = document.getElementById('drillRecordBtn');
  const recordLabel = document.getElementById('drillRecordLabel');
  const recordIcon  = document.getElementById('drillRecordIcon');
  if (recordBtn)   recordBtn.classList.remove('drill-record-btn--recording');
  if (recordLabel && !drillAutoSubmitPending) recordLabel.textContent = 'Recording stopped';
  if (recordIcon)  recordIcon.textContent = '🎙️';
}

function monitorDrillAudio() {
  if (!drillIsRecording || !drillAnalyser) return;

  drillAnalyser.getByteFrequencyData(drillDataArray);

  const sampleRate = drillAudioContext ? drillAudioContext.sampleRate : 44100;
  const binSize    = sampleRate / (drillDataArray.length * 2);
  let sum = 0, count = 0;
  for (let i = 0; i < drillDataArray.length; i++) {
    const freq = i * binSize;
    if (freq >= 300 && freq <= 3400) { sum += drillDataArray[i]; count++; }
  }
  const energy = count ? sum / count : 0;

  drillLoudnessSamples.push(energy);
  if (drillLoudnessSamples.length > 1000) drillLoudnessSamples.shift();

  const dynamicGate = drillSilenceThreshold + Math.max(4, drillSilenceThreshold * 0.35);
  const nowMs       = performance.now();
  const aboveGate   = energy > dynamicGate;

  if (aboveGate) {
    drillLastAboveThresholdMs = nowMs;
    if (drillSpeechSegmentStartMs === null) drillSpeechSegmentStartMs = nowMs;
    if (drillLastSilenceTs) {
      const dur = nowMs - drillLastSilenceTs;
      if (dur >= DRILL_SILENCE_MIN_MS) {
        drillPauseEvents.push({ durationMs: dur, time: drillSecondsElapsed, energy });
      }
      drillLastSilenceTs = null;
    }
  } else {
    if (!drillLastSilenceTs) drillLastSilenceTs = nowMs;
    if (drillLastAboveThresholdMs !== null) {
      const gapMs = nowMs - drillLastAboveThresholdMs;
      if (gapMs > DRILL_MAX_GAP_MS) {
        if (drillSpeechSegmentStartMs !== null) {
          const seg = drillLastAboveThresholdMs - drillSpeechSegmentStartMs;
          if (seg >= DRILL_MIN_SEGMENT_MS) drillTotalSpeechMs += seg;
        }
        drillSpeechSegmentStartMs = null;
        drillLastAboveThresholdMs = null;
      }
    }
  }

  // UI FIX: scope waveform bars
  // Restrict the querySelector to bars inside the active overlay only.
  // Without this scope, if multiple overlays were ever in the DOM (or
  // stale bar elements existed from a previous overlay), all matching
  // elements would animate — causing visual glitches on the wrong nodes.
  const bars = document.querySelectorAll('#drillOverlay .drill-wave-bar');
  bars.forEach(bar => {
    const h   = 10 + Math.abs(Math.sin(Math.random() * 3.14) * Math.min(energy * 0.8, 50));
    const opc = 0.2 + Math.min(energy / 120, 0.8);
    bar.style.height  = Math.min(h, 52) + 'px';
    bar.style.opacity = opc.toFixed(2);
  });

  updateLiveDrillMetric(energy);
  requestAnimationFrame(monitorDrillAudio);
}

function updateLiveDrillMetric(energy) {
  const metricCard = document.getElementById('drillMetricCard');
  if (!metricCard) return;

  const valueEl  = document.getElementById('drillMetricValue');
  const statusEl = document.getElementById('drillMetricStatus');
  if (!valueEl || !statusEl) return;

  const smoothed = drillLoudnessSamples.length
    ? drillLoudnessSamples.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, drillLoudnessSamples.length)
    : 0;

  const pct = Math.min(100, Math.round((smoothed / 80) * 100));
  valueEl.textContent  = pct + '%';
  statusEl.textContent = pct > 60 ? 'Strong signal' : pct > 30 ? 'Moderate' : 'Speak louder';

  metricCard.style.borderColor = pct > 60
    ? 'rgba(99,102,241,0.5)'
    : pct > 30 ? 'rgba(251,191,36,0.4)' : 'rgba(248,113,113,0.4)';
}

function resetDrillState() {
  drillAudioChunks          = [];
  drillPauseEvents          = [];
  drillLoudnessSamples      = [];
  drillLastSilenceTs        = null;
  drillSpeechSegmentStartMs = null;
  drillLastAboveThresholdMs = null;
  drillTotalSpeechMs        = 0;
  drillSecondsElapsed       = 0;
  drillRecordedBlob         = null;
  drillRecordStartMs        = null;
  drillAutoSubmitPending    = false;
}

/* ═══════════════════════════════════════════════════════════════
   PART 5 — MODULAR EVALUATION ARCHITECTURE
═══════════════════════════════════════════════════════════════ */

/**
 * evaluateDrill(drillConfig, audioBlob)
 * Generic: works with any drillConfig.metric from LLM.
 * Separated from UI rendering.
 */
async function evaluateDrill(drillConfig, audioBlob) {
  let backendData = null;
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'drill.webm');
    const res = await fetch('http://localhost:3001/api/transcribe', {
      method: 'POST',
      body: formData
    });
    if (res.ok) backendData = await res.json();
  } catch (err) {
    console.warn('Drill backend call failed, using frontend signals:', err);
  }

  const duration = drillConfig.duration || 45;

  const frontendSignals = {
    totalSpeechMs:   drillTotalSpeechMs,
    pauseEvents:     drillPauseEvents,
    loudnessSamples: drillLoudnessSamples,
    duration:        duration,
    secondsElapsed:  drillSecondsElapsed
  };

  const metricValue = extractMetricValue(drillConfig.metric, backendData, frontendSignals);
  const distance    = computeDistance(drillConfig, metricValue);
  const passed      = distance === 0;

  return {
    metricValue,
    metricLabel: formatMetricLabel(drillConfig.metric),
    distance,
    passed,
    detail: buildDetailString(drillConfig, metricValue)
  };
}

/**
 * buildDetailString — human-readable metric result line.
 */
function buildDetailString(drillConfig, value) {
  const label = formatMetricLabel(drillConfig.metric);
  const { type, target } = drillConfig;
  if (type === 'range') return `${label}: ${value} — target ${target.min}–${target.max}`;
  if (type === 'max')   return `${label}: ${value} — limit: ≤ ${target.max}`;
  if (type === 'min')   return `${label}: ${value} — target: ≥ ${target.min}`;
  return `${label}: ${value}`;
}

/**
 * formatMetricLabel — turns metric strings into readable labels.
 */
function formatMetricLabel(metric) {
  const m = (metric || '').toLowerCase();
  const labels = {
    wpm:                 'Words Per Minute',
    speechrate:          'Speech Rate (WPM)',
    speech_rate:         'Speech Rate (WPM)',
    words_per_minute:    'Words Per Minute',
    fillercount:         'Filler Words',
    filler_count:        'Filler Words',
    fillers:             'Filler Words',
    pauseduration:       'Panic Pauses',
    pause_duration:      'Panic Pauses',
    panicpauses:         'Panic Pauses',
    panic_pauses:        'Panic Pauses',
    pauses:              'Total Pauses',
    pausecount:          'Total Pauses',
    pause_count:         'Total Pauses',
    volumevariance:      'Volume Variance',
    volume_variance:     'Volume Variance',
    volumestability:     'Volume Stability',
    volume_stability:    'Volume Stability',
    repetition:          'Repeated Words',
    repeated_words:      'Repeated Words',
    repeatcount:         'Repeated Words',
    repeat_count:        'Repeated Words',
    sentencecompletion:  'Sentence Completion',
    sentence_completion: 'Sentence Completion',
    silenceratio:        'Silence Ratio (%)',
    silence_ratio:       'Silence Ratio (%)'
  };
  return labels[m] || metric || 'Metric';
}

/* ═══════════════════════════════════════════════════════════════
   DRILL SUBMISSION
═══════════════════════════════════════════════════════════════ */

async function submitDrillAttempt(drillId, drillConfig, overlay) {
  const submitBtn    = document.getElementById('drillSubmitBtn');
  const resultArea   = document.getElementById('drillResultArea');
  const controlsArea = document.getElementById('drillControlsArea');
  const helpSection  = document.getElementById('drillHelpSection');
  const recordBtn    = document.getElementById('drillRecordBtn');

  if (!drillRecordedBlob || drillRecordedBlob.size === 0) {
    if (recordBtn) {
      recordBtn.disabled = false;
      const label = document.getElementById('drillRecordLabel');
      if (label) label.textContent = 'Tap to record again';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled      = true;
    submitBtn.textContent   = 'Analyzing…';
    submitBtn.style.opacity = '0.6';
  }
  if (recordBtn) recordBtn.disabled = true;

  let evaluation;
  try {
    evaluation = await evaluateDrill(drillConfig, drillRecordedBlob);
  } catch (err) {
    console.error('Drill evaluation error:', err);
    // Fallback frontend-only
    const frontendSignals = {
      totalSpeechMs:   drillTotalSpeechMs,
      pauseEvents:     drillPauseEvents,
      loudnessSamples: drillLoudnessSamples,
      duration:        drillConfig.duration || 45,
      secondsElapsed:  drillSecondsElapsed
    };
    const metricValue = extractMetricValue(drillConfig.metric, null, frontendSignals);
    const distance    = computeDistance(drillConfig, metricValue);
    evaluation = {
      metricValue,
      metricLabel: formatMetricLabel(drillConfig.metric),
      distance,
      passed: distance === 0,
      detail: buildDetailString(drillConfig, metricValue)
    };
  }

  // Load history to find previous attempt
  const history       = getDrillHistory(drillId);
  const attemptNumber = history.length + 1;

  const attemptRecord = {
    attemptNumber,
    metricValue: evaluation.metricValue,
    distance:    evaluation.distance,
    passed:      evaluation.passed,
    timestamp:   Date.now()
  };

  saveDrillAttempt(drillId, attemptRecord);

  // Require 2 consecutive passes and drills will be saved in backend
  if (checkConsecutivePasses(drillId)) {
    setDrillCompletion(drillId, true);
    markDrillCardComplete(drillId);
      updateSessionProgress();
    const streak = updateStreak();
    renderStreak();

    // 🔥 SAVE TO DATABASE
    if (!currentUser) {
      console.error("MICRODRILL SAVE FAILED: currentUser is null — user not logged in");
    } else {
      const sessionId = new URLSearchParams(window.location.search).get("session");

      if (!sessionId) {
        console.error("MICRODRILL SAVE FAILED: sessionId is missing from URL params");
      } else {
        const { error } = await supabaseClient
          .from("microdrills")
          .upsert(
            {
              user_id:      currentUser.id,
              session_id:   sessionId,
              drill_type:   drillConfig.metric,
              drill_title:  drillConfig.title,
              category:     drillConfig.metric,
              is_completed: true
            },
            { onConflict: 'user_id,session_id,drill_type' }
          );

        if (error) {
          console.error("MICRODRILL SAVE FAILED: Supabase upsert error", error);
        } else {
          console.log("Microdrill saved to DB");
        }
      }
    }
  }

  showDrillResult(evaluation, drillId, drillConfig, overlay);

  if (submitBtn) {
    submitBtn.textContent   = 'Submit Early';
    submitBtn.style.opacity = '';
  }
  if (recordBtn) recordBtn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════════
   PART 4 — RESULT DISPLAY
   Shows: Previous / Current / Distance / Improvement Status
═══════════════════════════════════════════════════════════════ */

function showDrillResult(evaluation, drillId, drillConfig, overlay) {
  const resultArea       = document.getElementById('drillResultArea');
  const badge            = document.getElementById('drillResultBadge');
  const badgeIcon        = document.getElementById('drillResultIcon');
  const badgeText        = document.getElementById('drillResultText');
  const comparison       = document.getElementById('drillResultComparison');
  const improvementRow   = document.getElementById('drillResultImprovement');
  const improvementLabel = document.getElementById('drillImprovementLabel');
  const tryAgainBtn      = document.getElementById('drillTryAgainBtn');
  const doneBtn          = document.getElementById('drillDoneBtn');
  const submitBtn        = document.getElementById('drillSubmitBtn');
  const controlsArea     = document.getElementById('drillControlsArea');
  const helpSection      = document.getElementById('drillHelpSection');

  if (!resultArea) return;

  // Update metric display with final values
  const metricValueEl  = document.getElementById('drillMetricValue');
  const metricStatusEl = document.getElementById('drillMetricStatus');
  const metricLabelEl  = document.getElementById('drillMetricLabel');
  if (metricValueEl)  metricValueEl.textContent  = evaluation.metricValue;
  if (metricStatusEl) metricStatusEl.textContent = evaluation.detail;
  if (metricLabelEl)  metricLabelEl.textContent  = evaluation.metricLabel;

  // Consecutive pass check
  const consecutivePassed = checkConsecutivePasses(drillId);

  // Badge
  if (evaluation.passed) {
    badge.className       = 'drill-result-badge drill-result-badge--pass';
    badgeIcon.textContent = '✓';
    badgeText.textContent = consecutivePassed
      ? '🎉 Drill Complete — 2 Consecutive Passes!'
      : 'Passed! One more pass to complete drill.';
  } else {
    badge.className       = 'drill-result-badge drill-result-badge--fail';
    badgeIcon.textContent = '✗';
    badgeText.textContent = 'Not Passed — Try Again';
  }

  // Load history for comparison
  const history = getDrillHistory(drillId);
  const curr    = history.length >= 1 ? history[history.length - 1] : null;
  const prev    = history.length >= 2 ? history[history.length - 2] : null;

  // Compute improvement status
  const previousDistance  = prev ? prev.distance : null;
  const currentDistance   = curr ? curr.distance : evaluation.distance;
  const improvementStatus = computeImprovement(previousDistance, currentDistance);

  // PART 4 — Result comparison display
  if (prev && curr) {
    const metricDelta = curr.metricValue - prev.metricValue;
    const deltaSign   = metricDelta >= 0 ? '+' : '';
    const deltaColor  = (drillConfig.type === 'range')
      ? (Math.abs(metricDelta) < 10 ? '#22c55e' : '#fbbf24')
      : (currentDistance < previousDistance ? '#22c55e' : '#f87171');

    comparison.innerHTML = `
      <div class="drill-comparison-row">
        <div class="drill-comparison-item">
          <span class="drill-comparison-label">Previous</span>
          <span class="drill-comparison-val">${prev.metricValue}</span>
          <span style="font-size:10px;color:#4b5563;margin-top:2px">dist: ${prev.distance}</span>
        </div>
        <div class="drill-comparison-arrow">→</div>
        <div class="drill-comparison-item">
          <span class="drill-comparison-label">Now</span>
          <span class="drill-comparison-val">${curr.metricValue}</span>
          <span style="font-size:10px;color:#4b5563;margin-top:2px">dist: ${curr.distance}</span>
        </div>
        <div class="drill-comparison-delta" style="color:${deltaColor}">${deltaSign}${metricDelta}</div>
      </div>
      <div style="text-align:center;margin-top:6px;font-size:11px;color:#6b7280">
        Distance to target: <strong style="color:#818cf8">${currentDistance}</strong>
      </div>
    `;
  } else if (curr) {
    comparison.innerHTML = `
      <p style="font-size:12px;color:#4b5563;text-align:center;margin:0">
        First attempt · ${evaluation.metricLabel}: <strong style="color:#e5e7eb">${curr.metricValue}</strong>
        · Distance: <strong style="color:#818cf8">${curr.distance}</strong>
      </p>
    `;
  }

  // Improvement status pill
  if (improvementRow && improvementLabel) {
    improvementRow.style.display = 'block';

    const statusStyles = {
      'Perfect':   { bg: 'rgba(34,197,94,0.14)',  border: 'rgba(34,197,94,0.35)',  color: '#86efac', icon: '🎯' },
      'Improving': { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.35)', color: '#818cf8', icon: '📈' },
      'Worsened':  { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)', color: '#f87171', icon: '📉' },
      'No Change': { bg: 'rgba(75,85,99,0.12)',   border: 'rgba(75,85,99,0.3)',    color: '#9ca3af', icon: '➖' }
    };

    const st = statusStyles[improvementStatus] || statusStyles['No Change'];
    improvementRow.style.cssText = `
      display:block;
      text-align:center;
      padding:10px 14px;
      margin:10px 0;
      border-radius:10px;
      background:${st.bg};
      border:1px solid ${st.border};
    `;
    improvementLabel.innerHTML = `
      <span style="font-size:16px">${st.icon}</span>
      <span style="font-size:13px;font-weight:700;color:${st.color};margin-left:6px">${improvementStatus}</span>
      ${prev ? `<span style="font-size:11px;color:#6b7280;margin-left:8px">vs previous attempt</span>` : ''}
    `;
  }

  // Wire buttons
  tryAgainBtn.addEventListener('click', () => {
    resultArea.style.display = 'none';
    if (improvementRow) improvementRow.style.display = 'none';
    if (controlsArea)   controlsArea.style.display   = '';
    if (helpSection)    helpSection.style.display    = '';
    if (submitBtn) {
      submitBtn.style.display = 'none';
      submitBtn.disabled      = true;
    }
    resetDrillState();

    const recordLabel = document.getElementById('drillRecordLabel');
    const recordIcon  = document.getElementById('drillRecordIcon');
    const recordBtn   = document.getElementById('drillRecordBtn');
    if (recordLabel) recordLabel.textContent = 'Tap to record again';
    if (recordIcon)  recordIcon.textContent  = '🎙️';
    if (recordBtn)   { recordBtn.classList.remove('drill-record-btn--recording'); recordBtn.disabled = false; }

    const display = document.getElementById('drillTimerDisplay');
    if (display)  display.textContent = (drillConfig.duration || 45) + 's';
    const ringFg = document.getElementById('drillTimerRingFg');
    if (ringFg)   ringFg.style.strokeDashoffset = '0';

    const metricValue  = document.getElementById('drillMetricValue');
    const metricStatus = document.getElementById('drillMetricStatus');
    if (metricValue)  metricValue.textContent  = '—';
    if (metricStatus) metricStatus.textContent = 'Start recording to measure';
  });

  doneBtn.addEventListener('click', () => closeDrillOverlay(overlay));

  if (controlsArea) controlsArea.style.display = 'none';
  if (helpSection)  helpSection.style.display  = 'none';
  resultArea.style.display = 'block';

  requestAnimationFrame(() => {
    resultArea.style.opacity   = '0';
    resultArea.style.transform = 'translateY(12px)';
    requestAnimationFrame(() => {
      resultArea.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      resultArea.style.opacity    = '1';
      resultArea.style.transform  = 'translateY(0)';
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   MARK DRILL CARD COMPLETE
═══════════════════════════════════════════════════════════════ */

function markDrillCardComplete(drillId) {

  const badge = document.getElementById('badge-' + drillId);

  if (badge) {
    badge.textContent = '✓ Passed';
    badge.classList.add('drill-completion-badge--done');
  }

  const btn = document.querySelector(`.start-btn[data-drill-id="${drillId}"]`);

  if (btn) {
    btn.textContent = '✓ Redo Drill';
    btn.classList.add('start-btn--done');
  }


}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS BAR
═══════════════════════════════════════════════════════════════ */

function updateSessionProgress() {

  const raw        = localStorage.getItem('bol_drill_completion');
  const completion = raw ? JSON.parse(raw) : {};

  // UI FIX: restrict progress counting
  // Scope the drill query strictly to #dynamicDrills so that any other
  // .drill-group elements that might exist elsewhere on the page (e.g.
  // inside overlays or hidden template containers) are never counted,
  // which would inflate totalDrills and break the percentage display.
  const drillEls    = document.querySelectorAll('#dynamicDrills .drill-group');
  const totalDrills = drillEls.length;

  let completed = 0;

  drillEls.forEach(el => {
    const drillId = el.getAttribute('data-drill-id');
    if (completion[drillId]) completed++;
  });

  // Render progress dots
  renderProgressSegments(totalDrills, completed);

  const pct = totalDrills === 0
    ? 0
    : Math.round((completed / totalDrills) * 100);

  const countEl = document.getElementById('completed-count');
  const pctEl   = document.getElementById('progress-pct');
  const totalEl = document.getElementById('total-drills');

  if (countEl) countEl.textContent = completed;
  if (totalEl) totalEl.textContent = totalDrills;
  if (pctEl)   pctEl.textContent   = pct + '%';
}

function renderProgressSegments(total, completed) {

  const container = document.getElementById('drillProgress');
  if (!container) return;

  container.innerHTML = '';

  for (let i = 0; i < total; i++) {

    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    if (i < completed) dot.classList.add('progress-dot--done');
    container.appendChild(dot);

    if (i < total - 1) {
      const line = document.createElement('div');
      line.className = 'progress-line';
      if (i < completed - 1) line.classList.add('progress-line--done');
      container.appendChild(line);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   STREAK SYSTEM
═══════════════════════════════════════════════════════════════ */

function updateStreak() {

  const today = new Date().toDateString();
  let data    = JSON.parse(localStorage.getItem("bol_streak"));

  if (!data) {
    data = { lastDay: null, streak: 0 };
  }

  // Already counted today
  if (data.lastDay === today) return data.streak;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (data.lastDay === yesterday.toDateString()) {
    data.streak += 1;
  } else {
    data.streak = 1;
  }

  data.lastDay = today;
  localStorage.setItem("bol_streak", JSON.stringify(data));

  return data.streak;
}

function renderStreak() {
  const data   = JSON.parse(localStorage.getItem("bol_streak"));
  const streak = data ? data.streak : 0;
  const el     = document.getElementById("streak-count");
  if (el) el.textContent = streak;
}

/* ═══════════════════════════════════════════════════════════════
   POPULATE IMPROVEMENT FROM SESSION
═══════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────
// FIXED #4, #5, #7 — populateImprovement was split: the function
// closed early, leaving renderFocusAreas / renderDrillsWithRegistry
// / delta logic floating at module scope where `session` and `score`
// are not defined (ReferenceError).
// All logic is now inside the function.
// FIXED #5 — `const diff = expectedScore - session` (wrong variable)
// corrected to `const diff = expectedScore - score`.
// ─────────────────────────────────────────────────────────────────
function populateImprovement(session, score) {

  // UI FIX: prevent duplicate drill rendering
  // Clear both render targets at the top of populateImprovement so that
  // any previous call's DOM output is wiped before new cards are injected.
  // This is the primary guard against duplicate focus-area and drill cards
  // appearing when populateImprovement is called more than once per page load.
  const drillsContainer = document.getElementById("dynamicDrills");
  if (drillsContainer) drillsContainer.innerHTML = "";

  const focusContainer = document.getElementById("dynamicFocusAreas");
  if (focusContainer) focusContainer.innerHTML = "";

  const mistakes = session.mistakes || [];

  const prevScoreEl  = document.getElementById("score-before");
  const afterScoreEl = document.getElementById("score-after");
  const deltaEl      = document.getElementById("improvement-delta");
  const pctEl        = document.querySelector(".improvement-pct");

  const drillCount          = mistakes.length;
  const improvementPerDrill = 4;
  const expectedScore       = Math.min(100, score + (drillCount * improvementPerDrill));

  // ─────────────────────────────────────────────────────────────
  // UPDATED SCORE COMPARISON UI
  // Left card  → "Current Score"  / score         / "Baseline from last attempt"
  // Right card → "Expected Score" / expectedScore / "After completing all drills"
  // Strip      → "+X pts potential improvement" (percentage line hidden)
  // ─────────────────────────────────────────────────────────────

  // Update left card labels
  const scoreBeforeCard = document.querySelector('.score-card--before');
  if (scoreBeforeCard) {
    const labelEl = scoreBeforeCard.querySelector('.score-card-label');
    const subEl   = scoreBeforeCard.querySelector('.score-card-sub');
    if (labelEl) labelEl.textContent = 'Current Score';
    if (subEl)   subEl.textContent   = 'Baseline from last attempt';
  }

  // Update right card labels
  const scoreAfterCard = document.querySelector('.score-card--after');
  if (scoreAfterCard) {
    const labelEl = scoreAfterCard.querySelector('.score-card-label');
    const subEl   = scoreAfterCard.querySelector('.score-card-sub');
    if (labelEl) labelEl.textContent = 'Expected Score';
    if (subEl)   subEl.textContent   = 'After completing all drills';
  }

  // Set score values + data-target attributes (consumed by initScoreAnimation)
  if (prevScoreEl) {
    prevScoreEl.textContent = score;
    prevScoreEl.setAttribute("data-target", score);
  }

  if (afterScoreEl) {
    afterScoreEl.textContent = expectedScore;
    afterScoreEl.setAttribute("data-target", expectedScore);
  }

  // Improvement strip: "+X pts potential improvement"
  if (score !== undefined && score !== null) {
    // FIXED #5 — was `expectedScore - session` (wrong); now `expectedScore - score`
    const diff = expectedScore - score;

    if (deltaEl) {
      deltaEl.textContent = `+${diff} pts potential improvement`;
    }

    // Percentage line suppressed — single delta line is sufficient
    if (pctEl) {
      pctEl.style.display = 'none';
    }
  }

  // FIX: inject fetched score into score comparison UI
  // initScoreAnimation() (inside the IIFE) runs at DOMContentLoaded and captures
  // data-target into a closure before the async Supabase fetch resolves, so its
  // IntersectionObserver fires with target=0 and animates the displayed value back
  // to 0 even after populateImprovement has written the correct score.
  // We re-assert the fetched values after the longest animation duration (1200 ms)
  // to guarantee the final displayed number is always correct.
  setTimeout(function () {
    var _prevEl  = document.getElementById('score-before');
    var _afterEl = document.getElementById('score-after');
    var _deltaEl = document.getElementById('improvement-delta');

    if (_prevEl)  _prevEl.textContent  = score;
    if (_afterEl) _afterEl.textContent = expectedScore;
    if (_deltaEl) _deltaEl.textContent = '+' + (expectedScore - score) + ' pts potential improvement';
  }, 1400); // 1400 ms > longest animateCount duration (1200 ms)

  // END UPDATED SCORE COMPARISON UI
  // ─────────────────────────────────────────────────────────────

  // These were previously floating at module scope (ReferenceError)
  // and are now correctly called inside populateImprovement
  renderFocusAreas(mistakes);
  renderDrillsWithRegistry(mistakes);
  updateSessionProgress();
  renderStreak();
  setTimeout(() => {
  initScoreAnimation();
}, 50);
}

/* ═══════════════════════════════════════════════════════════════
   CSS INJECTION — Drill Overlay Styles
═══════════════════════════════════════════════════════════════ */

(function injectDrillStyles() {
  if (document.getElementById('bol-drill-styles')) return;

  const style = document.createElement('style');
  style.id    = 'bol-drill-styles';

  style.textContent = `
    /* ── Drill Overlay ── */
    .drill-overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.28s ease;
    }

    .drill-overlay--visible { opacity: 1; }

    .drill-overlay__backdrop {
      position: absolute;
      inset: 0;
      background: rgba(2, 6, 23, 0.88);
      backdrop-filter: blur(10px);
    }

    .drill-overlay__panel {
      position: relative;
      z-index: 1;
      width: min(640px, 94vw);
      max-height: 92vh;
      overflow-y: auto;
      background: linear-gradient(180deg, #0f1525, #0b1020);
      border: 1px solid rgba(99,102,241,0.22);
      border-radius: 18px;
      padding: 28px;
      box-shadow:
        0 40px 120px rgba(2,6,23,0.85),
        0 0 60px rgba(99,102,241,0.08),
        inset 0 1px 0 rgba(255,255,255,0.04);
      transform: translateY(16px) scale(0.98);
      transition: transform 0.32s cubic-bezier(.2,.9,.2,1), opacity 0.28s;
    }

    .drill-overlay--visible .drill-overlay__panel {
      transform: translateY(0) scale(1);
    }

    .drill-overlay__panel::-webkit-scrollbar { width: 4px; }
    .drill-overlay__panel::-webkit-scrollbar-track { background: transparent; }
    .drill-overlay__panel::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 2px; }

    .drill-overlay__header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
    }

    .drill-overlay__logo {
      width: 26px;
      height: 26px;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.3px;
      font-family: 'IBM Plex Mono', monospace;
    }

    .drill-overlay__subtitle {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #6366f1;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-overlay__close {
      margin-left: auto;
      background: transparent;
      border: 1px solid rgba(99,102,241,0.2);
      color: #6b7280;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .drill-overlay__close:hover {
      border-color: rgba(99,102,241,0.5);
      color: #e5e7eb;
      background: rgba(99,102,241,0.08);
    }

    .drill-overlay__title-block { margin-bottom: 22px; }

    .drill-overlay__title {
      font-size: 20px;
      font-weight: 700;
      color: #e5e7eb;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-overlay__objective {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 12px;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-overlay__criteria-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: rgba(99,102,241,0.1);
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      color: #818cf8;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-overlay__metric-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      margin-bottom: 18px;
    }

    .drill-metric-card {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(99,102,241,0.18);
      border-radius: 12px;
      padding: 16px 18px;
      transition: border-color 0.2s;
    }

    .drill-metric-card__label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #4b5563;
      margin-bottom: 8px;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-metric-card__value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      color: #e5e7eb;
      line-height: 1;
      margin-bottom: 6px;
    }

    .drill-metric-card__status {
      font-size: 12px;
      color: #6b7280;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-timer-card {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.04);
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      min-width: 110px;
    }

    .drill-timer-card__label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #4b5563;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-timer-card__value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 22px;
      font-weight: 600;
      color: #e5e7eb;
    }

    .drill-timer-ring-wrap { position: relative; width: 48px; height: 48px; }

    .drill-timer-ring-svg {
      width: 48px;
      height: 48px;
      transform: rotate(-90deg);
      display: block;
    }

    .drill-timer-ring-bg {
      fill: none;
      stroke: rgba(255,255,255,0.06);
      stroke-width: 4;
    }

    .drill-timer-ring-fg {
      fill: none;
      stroke: #6366f1;
      stroke-width: 4;
      stroke-linecap: round;
      transition: stroke-dashoffset 1s linear, stroke 0.3s;
    }

    .drill-overlay__tip {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 14px;
      background: rgba(99,102,241,0.05);
      border: 1px solid rgba(99,102,241,0.12);
      border-radius: 10px;
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 18px;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-overlay__tip-icon { flex-shrink: 0; font-size: 15px; margin-top: 1px; }

    .drill-overlay__waveform {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 4px;
      height: 56px;
      margin-bottom: 20px;
      padding: 6px 0;
    }

    .drill-wave-bar {
      flex: 1;
      max-width: 8px;
      min-height: 6px;
      height: 10px;
      border-radius: 2px;
      background: linear-gradient(to top, #6366f1, #818cf8);
      opacity: 0.22;
      transition: height 0.1s ease, opacity 0.1s ease;
    }

    .drill-overlay__controls {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .drill-record-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 16px;
      background: linear-gradient(180deg, #0d1c3b, #07111f);
      border: 1px solid rgba(59,130,246,0.18);
      border-radius: 12px;
      color: #e5e7eb;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-record-btn:hover:not(:disabled) {
      border-color: rgba(99,102,241,0.4);
      background: linear-gradient(180deg, #101e3e, #09131f);
    }

    .drill-record-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .drill-record-btn--recording {
      border-color: rgba(34,197,94,0.6) !important;
      box-shadow: 0 0 24px rgba(34,197,94,0.15);
      animation: drillRecordPulse 2s ease-in-out infinite;
    }

    @keyframes drillRecordPulse {
      0%, 100% { box-shadow: 0 0 16px rgba(34,197,94,0.12); }
      50%       { box-shadow: 0 0 32px rgba(34,197,94,0.28); }
    }

    .drill-record-btn__icon { font-size: 20px; }

    .drill-submit-btn {
      width: 100%;
      padding: 14px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 12px;
      color: #818cf8;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-submit-btn:hover:not(:disabled) {
      background: rgba(99,102,241,0.25);
      border-color: rgba(99,102,241,0.5);
    }

    .drill-submit-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    /* ── Take Help ── */
    .drill-overlay__help-section {
      margin-top: 16px;
    }

    .drill-help-btn {
      width: 100%;
      padding: 11px 14px;
      background: transparent;
      border: 1px dashed rgba(99,102,241,0.25);
      border-radius: 10px;
      color: #6366f1;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      font-family: 'IBM Plex Sans', sans-serif;
      text-align: left;
    }

    .drill-help-btn:hover {
      background: rgba(99,102,241,0.07);
      border-color: rgba(99,102,241,0.45);
      color: #818cf8;
    }

    .drill-help-container {
      margin-top: 10px;
      padding: 14px 16px;
      background: rgba(99,102,241,0.06);
      border: 1px solid rgba(99,102,241,0.18);
      border-radius: 10px;
      animation: drillHelpFade 0.22s ease;
    }

    @keyframes drillHelpFade {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .drill-help-text {
      font-size: 14px;
      color: #c7d2fe;
      line-height: 1.65;
      font-family: 'IBM Plex Sans', sans-serif;
      font-style: italic;
    }

    /* ── Result area ── */
    .drill-overlay__result {
      margin-top: 20px;
    }

    .drill-result-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 16px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 14px;
      font-family: 'IBM Plex Sans', sans-serif;
      text-align: center;
    }

    .drill-result-badge--pass {
      background: rgba(34,197,94,0.12);
      border: 1px solid rgba(34,197,94,0.3);
      color: #86efac;
    }

    .drill-result-badge--fail {
      background: rgba(248,113,113,0.08);
      border: 1px solid rgba(248,113,113,0.25);
      color: #f87171;
    }

    .drill-result-comparison {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 10px;
    }

    .drill-comparison-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    .drill-comparison-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .drill-comparison-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #4b5563;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-comparison-val {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 22px;
      font-weight: 600;
      color: #e5e7eb;
    }

    .drill-comparison-arrow { font-size: 18px; color: #4b5563; }

    .drill-comparison-delta {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 18px;
      font-weight: 700;
    }

    .drill-result-improvement {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      margin-bottom: 10px;
    }

    .drill-improvement-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .drill-result-actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    .drill-try-again-btn {
      flex: 1;
      padding: 12px;
      background: transparent;
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 10px;
      color: #94a3b8;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-try-again-btn:hover {
      border-color: rgba(99,102,241,0.35);
      color: #818cf8;
      background: rgba(99,102,241,0.06);
    }

    .drill-done-btn {
      flex: 1;
      padding: 12px;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      border: none;
      border-radius: 10px;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      font-family: 'IBM Plex Sans', sans-serif;
    }

    .drill-done-btn:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }

    /* Drill card badges */
    .drill-completion-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      color: #4b5563;
      font-family: 'IBM Plex Sans', sans-serif;
      transition: all 0.2s;
    }

    .drill-completion-badge--done {
      background: rgba(34,197,94,0.1);
      border-color: rgba(34,197,94,0.28);
      color: #86efac;
    }

    .start-btn--done {
      background: rgba(34,197,94,0.08) !important;
      border: 1px solid rgba(34,197,94,0.2) !important;
      color: #86efac !important;
    }

    .drill-row-criteria {
      font-size: 11px;
      color: #6366f1;
      margin-top: 4px;
      font-weight: 600;
      font-family: 'IBM Plex Sans', sans-serif;
    }
  `;

  document.head.appendChild(style);
})();

/* ═══════════════════════════════════════════════════════════════
   IIFE — existing modules (unchanged, preserved exactly)
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── MODULE 1 — COLLAPSIBLE DRILL GROUPS ── */
  function initDrillGroups() {
    const groups = document.querySelectorAll('.drill-group');

    groups.forEach(function (group) {
      const header = group.querySelector('.drill-group-header');
      const body   = group.querySelector('.drill-group-body');
      const arrow  = group.querySelector('.expand-arrow');

      if (!header || !body) return;

      header.addEventListener('click', function () {
        toggleGroup(header, body, arrow);
      });

      header.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleGroup(header, body, arrow);
        }
      });
    });
  }

  function toggleGroup(header, body, arrow) {
    const isOpen = body.classList.contains('is-open');

    if (isOpen) {
      body.classList.remove('is-open');
      arrow && arrow.classList.remove('is-open');
      header.setAttribute('aria-expanded', 'false');
      body.setAttribute('aria-hidden', 'true');
    } else {
      body.classList.add('is-open');
      arrow && arrow.classList.add('is-open');
      header.setAttribute('aria-expanded', 'true');
      body.setAttribute('aria-hidden', 'false');
    }
  }

  function updateGroupCounter(groupIdx) {
    const doneInGroup = state.drillCompletion[groupIdx].filter(Boolean).length;
    const counterEl   = document.querySelector(`.drill-counter[data-group="${groupIdx}"]`);
    if (counterEl) counterEl.textContent = `${doneInGroup} / 3 completed`;
  }

  /* ── MODULE 4 — SCORE ANIMATION ── */
  function animateCount(el, target, duration) {
    const start = performance.now();
    const from  = parseInt(el.textContent, 10) || 0;

    function step(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + (target - from) * eased);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  function initScoreAnimation() {
    const scoreBefore = document.getElementById('score-before');
    const scoreAfter  = document.getElementById('score-after');

    if (!scoreBefore || !scoreAfter) return;

    const targetBefore = parseInt(scoreBefore.getAttribute('data-target'), 10) || 0;
    const targetAfter  = parseInt(scoreAfter.getAttribute('data-target'), 10)  || 0;

    const observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(scoreBefore, targetBefore, 1200);
          setTimeout(function () {
            animateCount(scoreAfter, targetAfter, 1000);
          }, 300);
          obs.disconnect();
        }
      });
    }, { threshold: 0.4 });

    observer.observe(scoreBefore);
  }

  /* ── MODULE 5 — ROADMAP DAY EXPAND ── */
  /* REMOVED — 7-Day Roadmap feature disabled; will be re-added in a future release */
  // function initRoadmap() { ... }
  // function toggleRoadmapDay(body, arrow) { ... }

  /* ── MODULE 6 — CLOSE BUTTON ── */
  function initClose() {
    const closeBtn = document.querySelector('.close-btn');
    if (!closeBtn) return;

    closeBtn.addEventListener('click', function () {
      document.body.style.transition = 'opacity 0.3s ease';
      document.body.style.opacity    = '0';
      setTimeout(function () {
        if (window.history.length > 1) window.history.back();
        else window.close();
      }, 320);
    });
  }

  /* ── MODULE 7 — CTA BUTTON ── */
function initCTA() {

  const ctaBtn = document.querySelector('.section--cta .btn-gradient');
  if (!ctaBtn) return;

  ctaBtn.addEventListener('click', function () {

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');

    if (!sessionId) {
      console.error("Session ID missing");
      return;
    }

    ctaBtn.textContent = "Launching Simulation…";
    ctaBtn.disabled = true;

    // flag set for bol.html auto-start
    sessionStorage.setItem("bol_from_improvement", "true");

    // redirect to bol.html
    window.location.href = `bol.html?session=${sessionId}`;

  });

}

  /* ── INIT ── */
  function init() {
    initDrillGroups();
    //initScoreAnimation();
    // initRoadmap() — REMOVED: 7-Day Roadmap feature disabled
    initClose();
    initCTA();
    updateSessionProgress();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();