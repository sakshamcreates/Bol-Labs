'use strict';

/* ================================================================
   SUPABASE CLIENT
   NOTE: dashboard.html must load the Supabase CDN before this file:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
   ================================================================ */
const SUPABASE_URL      = "https://muifdxmbtrpbqglyuudx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vD-_br5ry0EDmwkTgPVCHg_a9Bazjcv";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ================================================================
   UTILITY HELPERS
   ================================================================ */
function formatDuration(totalSec) {
  const sec = Number(totalSec) || 0;
  const m   = Math.floor(sec / 60);
  const s   = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function formatTotalTime(totalSec) {
  const sec = Number(totalSec) || 0;
  const m   = Math.floor(sec / 60);
  const s   = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateShort(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreClass(score) {
  if (score >= 75) return "score-high";
  if (score >= 55) return "score-mid";
  return "score-low";
}

/* ================================================================
   COMPUTE SUMMARY STATS
   Real Attempts table columns used:
     confidence_score, total_duration
   ================================================================ */
function computeStats(rows) {
  if (!rows || rows.length === 0) {
    return { total: 0, avg: 0, best: 0, totalTimeSec: 0 };
  }
  const total        = rows.length;
  const scores       = rows.map(r => Number(r.confidence_score) || 0);
  const avg          = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const best         = Math.max(...scores);
  const totalTimeSec = rows.reduce((a, r) => a + (Number(r.total_duration) || 0), 0);
  return { total, avg, best, totalTimeSec };
}

/* ================================================================
   RENDER STAT CARDS
   ================================================================ */
function renderStatCards(stats) {
  const totalEl = document.getElementById("statTotalSessions");
  if (totalEl) totalEl.textContent = stats.total;

  const avgEl = document.getElementById("statAvgConfidence");
  if (avgEl) avgEl.textContent = stats.avg;

  const bestEl = document.getElementById("statBestScore");
  if (bestEl) bestEl.textContent = stats.best;

  const timeEl = document.getElementById("statTotalTime");
  if (timeEl) timeEl.textContent = formatTotalTime(stats.totalTimeSec);

  setTimeout(() => {
    const barSessions = document.getElementById("barSessions");
    const barAvg      = document.getElementById("barAvg");
    const barBest     = document.getElementById("barBest");
    const barTime     = document.getElementById("barTime");

    if (barSessions) barSessions.style.width = `${Math.min(100, (stats.total / 20) * 100)}%`;
    if (barAvg)      barAvg.style.width      = `${stats.avg}%`;
    if (barBest)     barBest.style.width     = `${stats.best}%`;
    if (barTime)     barTime.style.width     = `${Math.min(100, (stats.totalTimeSec / 3600) * 100)}%`;
  }, 120);
}

/* ================================================================
   RENDER CHART.JS CONFIDENCE CHART
   X-axis: created_at (formatted)
   Y-axis: confidence_score

   FIX: replaced `window._bolChart instanceof Chart` with the
   Chart.js v4 canonical API `Chart.getChart(canvas)` which
   reliably finds and destroys any existing instance on the canvas,
   preventing a second chart from being drawn on top of the first.
   ================================================================ */
function renderChart(rows) {
  const canvas = document.getElementById("confidenceChart");
  if (!canvas || typeof Chart === "undefined") return;

  /* ── FIXED: use Chart.getChart() instead of instanceof check ── */
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const sorted = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const labels   = sorted.map(r => formatDateShort(r.created_at));
  const scores   = sorted.map(r => Number(r.confidence_score) || 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const avgLine = scores.map(() => avgScore);

  const COLOR_LINE   = "#818cf8";
  const COLOR_FILL_1 = "rgba(99,102,241,.18)";
  const COLOR_FILL_2 = "rgba(99,102,241,.00)";
  const COLOR_AVG    = "rgba(75,85,99,.55)";
  const COLOR_GRID   = "rgba(30,37,53,.9)";
  const COLOR_TICK   = "rgba(75,85,99,.8)";
  const COLOR_POINT  = "#6366f1";

  const ctx  = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, COLOR_FILL_1);
  grad.addColorStop(1, COLOR_FILL_2);

  window._bolChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label:                "Confidence",
          data:                 scores,
          fill:                 true,
          backgroundColor:      grad,
          borderColor:          COLOR_LINE,
          borderWidth:          2,
          pointBackgroundColor: COLOR_POINT,
          pointBorderColor:     COLOR_POINT,
          pointRadius:          4,
          pointHoverRadius:     6,
          tension:              0.42,
        },
        {
          label:            "Avg Baseline",
          data:             avgLine,
          fill:             false,
          borderColor:      COLOR_AVG,
          borderWidth:      1,
          borderDash:       [5, 5],
          pointRadius:      0,
          pointHoverRadius: 0,
          tension:          0,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0d1117",
          borderColor:     "#1e2535",
          borderWidth:     1,
          titleColor:      "#e5e7eb",
          bodyColor:       "#94a3b8",
          padding:         10,
          titleFont: { family: "'IBM Plex Sans', sans-serif", size: 12, weight: "600" },
          bodyFont:  { family: "'IBM Plex Mono', monospace", size: 12 },
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex === 1) return `  Avg: ${ctx.parsed.y}`;
              return `  Score: ${ctx.parsed.y}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: COLOR_GRID, lineWidth: 1 },
          ticks:  { color: COLOR_TICK, font: { family: "'IBM Plex Mono', monospace", size: 10 }, maxRotation: 0 },
          border: { color: "transparent" },
        },
        y: {
          min:    30,
          max:    100,
          grid:   { color: COLOR_GRID, lineWidth: 1 },
          ticks:  { color: COLOR_TICK, font: { family: "'IBM Plex Mono', monospace", size: 10 }, stepSize: 20, callback: (v) => v },
          border: { color: "transparent" },
        },
      },
    },
  });
}

/* ================================================================
   RENDER SESSION TABLE
   Attempts columns → table columns:
     created_at       → Date
     (no mode col)    → "Practice" hardcoded
     confidence_score → Confidence
     wpm              → WPM
     pauses           → Pauses
     total_duration   → Duration
   ================================================================ */
function renderTable(rows) {
  const tbody   = document.getElementById("sessionTableBody");
  const countEl = document.getElementById("sessionCount");
  if (!tbody) return;

  if (countEl) countEl.textContent = `${rows.length} session${rows.length !== 1 ? "s" : ""}`;

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">No sessions recorded yet. Record your first attempt!</td>
      </tr>`;
    return;
  }

  const sorted = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  tbody.innerHTML = sorted.map(r => {
    const score    = Number(r.confidence_score) || 0;
    const wpm      = Number(r.wpm)              || 0;
    const pauses   = Number(r.pauses)           || 0;
    const duration = Number(r.total_duration)   || 0;

    return `
      <tr>
        <td class="td-date">${formatDate(r.created_at)}</td>
        <td>
          <span class="mode-badge mode-badge--practice">Practice</span>
        </td>
        <td class="td-score ${scoreClass(score)}">${score}</td>
        <td class="td-mono">${wpm > 0 ? wpm : "—"}<span style="color:var(--text-muted);font-size:11px">${wpm > 0 ? " wpm" : ""}</span></td>
        <td class="td-mono">${pauses}</td>
        <td class="td-mono">${formatDuration(duration)}</td>
        <td>
          <button class="view-btn" onclick="handleViewDetails('${r.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            View
          </button>
        </td>
      </tr>`;
  }).join("");
}

/* ================================================================
   FALLBACK — safe empty state on all stat cards if fetch fails
   ================================================================ */
function renderFallback() {
  ["statTotalSessions", "statAvgConfidence", "statBestScore", "statTotalTime"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "—";
  });

  const countEl = document.getElementById("sessionCount");
  if (countEl) countEl.textContent = "0 sessions";

  const tbody = document.getElementById("sessionTableBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">Unable to load sessions. Please try again.</td>
      </tr>`;
  }
}

/* ================================================================
   VIEW DETAILS HANDLER (stub — wire to session page later)
   ================================================================ */
function handleViewDetails(sessionId) {
  window.location.href = `session.html?sessionId=${sessionId}`;
}

/* ================================================================
   MAIN INIT
   ================================================================ */
document.addEventListener("DOMContentLoaded", async () => {

  /* 1. Auth check — redirect if not logged in */
  const { data: authData, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !authData?.user) {
    window.location.href = "index.html";
    return;
  }

  const user = authData.user;

  /* 2. Populate nav user info */
  const emailEl = document.getElementById("userEmail");
  if (emailEl) emailEl.textContent = user.email || "";

  const nameEl = document.getElementById("userNameDisplay");
  if (nameEl) {
    const fullName = user.user_metadata?.full_name;
    nameEl.textContent = fullName ? `Hey, ${fullName}` : "Welcome";
  }

  /* 3. Logout button */
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "index.html";
    });
  }

  /* 4. Fetch all attempts for this user, oldest first */
  const { data: rows, error: fetchError } = await supabaseClient
    .from("Attempts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (fetchError) {
    console.error("[BOL] Failed to fetch attempts:", fetchError.message);
    renderFallback();
    return;
  }

  const sessions = rows || [];

  /* 5. Stats → cards */
  renderStatCards(computeStats(sessions));

  /* 6. Chart */
  const latest30 = sessions.slice(-30);
  renderChart(latest30);

  /* 7. Table */
  renderTable(sessions);

  /* 8. Trend Range Selector */
  (function initRangeSelector() {
    const buttons = document.querySelectorAll(".range-btn");

    function getFiltered(range) {
      if (range === "all") return sessions;
      const n = parseInt(range, 10);
      return sessions.slice(-n);
    }

    function applyRange(range) {
      const filtered = getFiltered(range);

      renderStatCards(computeStats(filtered));
      renderChart(filtered);
      renderTable(filtered);

      buttons.forEach(btn => {
        btn.classList.toggle("range-btn--active", btn.dataset.range === range);
      });
    }

    buttons.forEach(btn => {
      btn.addEventListener("click", () => applyRange(btn.dataset.range));
    });
  })();
});