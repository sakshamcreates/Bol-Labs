/**
 * BOL — Break Your Stage Fear
 * login.js — Scroll-driven animation engine + form validation
 *
 * Architecture:
 *  1. Hero text fade on scroll (rAF-throttled, scroll progress)
 *  2. IntersectionObserver scroll reveal (.js-reveal → .show)
 *  3. Staggered card delays via data-delay attribute
 *  4. Password visibility toggle
 *  5. Frontend form validation
 *  6. Login button loading state
 *  7. Supabase auth — signInWithPassword + signUp
 *  8. Signup modal — open/close, validation, Supabase signUp
 *
 * NOTE: HTML must load Supabase SDK pinned to v2.45+ for
 * sb_publishable_ key support:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
 */

'use strict';

/* ════════════════════════════════════════════════════════════════
   SUPABASE CLIENT INIT
   FIX: guard window.supabase — if SDK fails to load this won't
   throw a ReferenceError that silently kills the whole script.
════════════════════════════════════════════════════════════════ */

const SUPABASE_URL     = "https://muifdxmbtrpbqglyuudx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vD-_br5ry0EDmwkTgPVCHg_a9Bazjcv";

let supabaseClient;

if (window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error('[BOL] Supabase SDK not loaded. Check the <script> tag src and network.');
}

/* ════════════════════════════════════════════════════════════════
   REDIRECT IF ALREADY LOGGED IN
════════════════════════════════════════════════════════════════ */

async function redirectIfLoggedIn() {
  if (!supabaseClient) return;
  try {
    const { data } = await supabaseClient.auth.getUser();
    if (data?.user) {
      window.location.href = "BOL.html";
    }
  } catch (err) {
    console.warn('[BOL] redirectIfLoggedIn failed (network?):', err.message);
  }
}

/* ════════════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════════════ */

const STAGGER_MS       = 120;
const REVEAL_THRESHOLD = 0.12;
const HERO_FADE_START  = 0.05;
const HERO_FADE_END    = 0.55;

/* ════════════════════════════════════════════════════════════════
   DOM CACHE — resolved once on DOMContentLoaded
════════════════════════════════════════════════════════════════ */

let $;

document.addEventListener('DOMContentLoaded', () => {

  $ = {
    hero:          document.getElementById('hero'),
    heroBody:      document.getElementById('heroBody'),
    scrollCue:     document.getElementById('scrollCue'),
    featSection:   document.getElementById('featuresSection'),
    revealTargets: document.querySelectorAll('.js-reveal'),
    loginForm:     document.getElementById('loginForm'),
    emailInput:    document.getElementById('emailInput'),
    passwordInput: document.getElementById('passwordInput'),
    emailGroup:    document.getElementById('emailGroup'),
    passwordGroup: document.getElementById('passwordGroup'),
    emailError:    document.getElementById('emailError'),
    passwordError: document.getElementById('passwordError'),
    formAlert:     document.getElementById('formAlert'),
    alertMsg:      document.getElementById('alertMsg'),
    loginBtn:      document.getElementById('loginBtn'),
    togglePw:      document.getElementById('togglePw'),

    // ── Signup modal refs ──
    openSignupBtn:   document.getElementById('openSignupBtn'),
    signupOverlay:   document.getElementById('signupOverlay'),
    signupCard:      document.getElementById('signupCard'),
    signupCloseBtn:  document.getElementById('signupCloseBtn'),
    closeSignupLink: document.getElementById('closeSignupLink'),
    signupForm:      document.getElementById('signupForm'),
    suNameInput:     document.getElementById('su-nameInput'),
    suEmailInput:    document.getElementById('su-emailInput'),
    suPasswordInput: document.getElementById('su-passwordInput'),
    suConfirmInput:  document.getElementById('su-confirmInput'),
    suNameGroup:     document.getElementById('su-nameGroup'),
    suEmailGroup:    document.getElementById('su-emailGroup'),
    suPasswordGroup: document.getElementById('su-passwordGroup'),
    suConfirmGroup:  document.getElementById('su-confirmGroup'),
    suNameError:     document.getElementById('su-nameError'),
    suEmailError:    document.getElementById('su-emailError'),
    suPasswordError: document.getElementById('su-passwordError'),
    suConfirmError:  document.getElementById('su-confirmError'),
    suFormAlert:     document.getElementById('su-formAlert'),
    suAlertMsg:      document.getElementById('su-alertMsg'),
    signupBtn:       document.getElementById('signupBtn'),
  };

  // Boot all modules
  initScrollReveal();
  initHeroParallax();
  initPasswordToggle();
  initForm();
  initSignupModal();
  redirectIfLoggedIn();
});

/* ════════════════════════════════════════════════════════════════
   1. SCROLL REVEAL — IntersectionObserver
════════════════════════════════════════════════════════════════ */

function initScrollReveal() {
  if (!$.revealTargets.length) return;

  $.revealTargets.forEach(el => {
    const delay = parseInt(el.dataset.delay || '0', 10);
    el.style.transitionDelay = `${delay * STAGGER_MS}ms`;
  });

  const observer = new IntersectionObserver(onRevealEntry, {
    threshold: REVEAL_THRESHOLD,
    rootMargin: '0px 0px -48px 0px',
  });

  $.revealTargets.forEach(el => observer.observe(el));
}

function onRevealEntry(entries) {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('show');
  });
}

/* ════════════════════════════════════════════════════════════════
   2. HERO PARALLAX — scroll-linked fade + drift
════════════════════════════════════════════════════════════════ */

function initHeroParallax() {
  if (!$.hero || !$.heroBody) return;

  let rafScheduled = false;

  function update() {
    const scrollY    = window.scrollY;
    const heroHeight = $.hero.offsetHeight;
    const progress   = Math.min(scrollY / heroHeight, 1);

    const fadeRange    = HERO_FADE_END - HERO_FADE_START;
    const fadeFraction = Math.max(0, Math.min((progress - HERO_FADE_START) / fadeRange, 1));
    const opacity      = 1 - fadeFraction;
    const drift        = scrollY * 0.32;

    $.heroBody.style.opacity    = opacity;
    $.heroBody.style.transform  = `translateY(${drift}px)`;
    $.heroBody.style.willChange = 'transform, opacity';

    if ($.scrollCue) {
      $.scrollCue.style.opacity = Math.max(0, 1 - progress * 8).toString();
    }

    rafScheduled = false;
  }

  window.addEventListener('scroll', () => {
    if (!rafScheduled) {
      requestAnimationFrame(update);
      rafScheduled = true;
    }
  }, { passive: true });

  update();
}

/* ════════════════════════════════════════════════════════════════
   3. PASSWORD TOGGLE
════════════════════════════════════════════════════════════════ */

function initPasswordToggle() {
  if (!$.togglePw || !$.passwordInput) return;

  const eyeShow = $.togglePw.querySelector('.icon-eye-show');
  const eyeHide = $.togglePw.querySelector('.icon-eye-hide');

  $.togglePw.addEventListener('click', () => {
    const isPassword = $.passwordInput.type === 'password';
    $.passwordInput.type = isPassword ? 'text' : 'password';
    if (eyeShow) eyeShow.style.display = isPassword ? 'none'  : 'block';
    if (eyeHide) eyeHide.style.display = isPassword ? 'block' : 'none';
    $.togglePw.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    $.passwordInput.focus();
  });
}

/* ════════════════════════════════════════════════════════════════
   4. LOGIN FORM — validation + Supabase signInWithPassword
════════════════════════════════════════════════════════════════ */

function initForm() {
  if (!$.loginForm) return;

  $.emailInput    && $.emailInput.addEventListener('input',    () => { clearError('emailGroup', 'emailError');       hideAlert(); });
  $.passwordInput && $.passwordInput.addEventListener('input', () => { clearError('passwordGroup', 'passwordError'); hideAlert(); });

  $.loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    resetAllErrors();

    const email    = $.emailInput.value.trim();
    const password = $.passwordInput.value;

    if (!runValidation(email, password)) return;

    setLoading(true);

    try {
      if (!supabaseClient) throw new Error('Auth service unavailable. Please refresh.');

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) throw new Error(error.message);

      if (data?.user) {
        markSuccess();
        window.location.href = "BOL.html";
      }

    } catch (err) {
      showAlert(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  });
}

/* ── Validation ── */

function runValidation(email, password) {
  let ok = true;

  if (!email) {
    showError('emailGroup', 'emailError', 'Email address is required.');
    ok = false;
  } else if (!isEmailValid(email)) {
    showError('emailGroup', 'emailError', 'Please enter a valid email address.');
    ok = false;
  }

  if (!password) {
    showError('passwordGroup', 'passwordError', 'Password is required.');
    ok = false;
  } else if (password.length < 6) {
    showError('passwordGroup', 'passwordError', 'Password must be at least 6 characters.');
    ok = false;
  }

  return ok;
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/* ── Error display helpers ── */

function showError(groupId, errorId, msg) {
  const group = document.getElementById(groupId);
  const span  = document.getElementById(errorId);
  if (group) group.classList.add('has-error');
  if (span) {
    span.textContent = msg;
    requestAnimationFrame(() => span.classList.add('visible'));
  }
}

function clearError(groupId, errorId) {
  const group = document.getElementById(groupId);
  const span  = document.getElementById(errorId);
  if (group) group.classList.remove('has-error');
  if (span) {
    span.classList.remove('visible');
    setTimeout(() => { if (!span.classList.contains('visible')) span.textContent = ''; }, 200);
  }
}

function resetAllErrors() {
  clearError('emailGroup',    'emailError');
  clearError('passwordGroup', 'passwordError');
  hideAlert();
}

/* ── Global alert ── */

function showAlert(msg) {
  if (!$.formAlert || !$.alertMsg) return;
  $.alertMsg.textContent = msg;
  $.formAlert.style.display = 'flex';
}

function hideAlert() {
  if ($.formAlert) $.formAlert.style.display = 'none';
}

/* ── Login button states ── */

function setLoading(isLoading) {
  if (!$.loginBtn) return;
  $.loginBtn.classList.toggle('loading', isLoading);
  $.loginBtn.disabled = isLoading;
}

function markSuccess() {
  if (!$.loginBtn) return;
  const label = $.loginBtn.querySelector('.login-btn__label');
  if (label) label.textContent = '✓ Signed in — redirecting…';
  $.loginBtn.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
  $.loginBtn.style.boxShadow  = '0 12px 32px rgba(34,197,94,0.3)';
}

/* ════════════════════════════════════════════════════════════════
   5. SIMULATED AUTH — REMOVE IN PRODUCTION
════════════════════════════════════════════════════════════════ */

function simulateAuth(email, _password) {
  return new Promise(resolve => {
    setTimeout(() => resolve({ user: { email } }), 1400);
  });
}

/* ════════════════════════════════════════════════════════════════
   6. BLOB MOUSE PARALLAX (desktop only)
════════════════════════════════════════════════════════════════ */

(function initBlobParallax() {
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const orbs = document.querySelectorAll('.orb');
  if (!orbs.length) return;

  const strengths = [20, -15, 12];
  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;
  let animId;

  window.addEventListener('mousemove', e => {
    targetX = e.clientX / window.innerWidth  - 0.5;
    targetY = e.clientY / window.innerHeight - 0.5;
  });

  function lerpTick() {
    currentX += (targetX - currentX) * 0.05;
    currentY += (targetY - currentY) * 0.05;

    orbs.forEach((orb, i) => {
      const s  = strengths[i] || 10;
      orb.style.transform = `translate(${currentX * s}px, ${currentY * s}px)`;
    });

    animId = requestAnimationFrame(lerpTick);
  }

  lerpTick();
  window.addEventListener('beforeunload', () => cancelAnimationFrame(animId));
})();

/* ════════════════════════════════════════════════════════════════
   8. SIGNUP MODAL
   ─────────────────────────────────────────────────────────────
   FIX: removed duplicate dead-code block that was re-running
   markSignupSuccess() and a second setTimeout redirect after the
   signInWithPassword block had already handled success.
   Flow is now: signUp → signInWithPassword → redirect. Clean.
════════════════════════════════════════════════════════════════ */

function initSignupModal() {
  if (!$.signupOverlay) return;

  // ── Open modal ──
  function openSignupModal(e) {
    if (e) e.preventDefault();
    $.signupOverlay.classList.add('open');
    setTimeout(() => {
      if ($.suNameInput) $.suNameInput.focus();
    }, 120);
  }

  // ── Close modal ──
  function closeSignupModal() {
    $.signupOverlay.classList.remove('open');
    resetSignupForm();
  }

  if ($.openSignupBtn)   $.openSignupBtn.addEventListener('click', openSignupModal);
  if ($.signupCloseBtn)  $.signupCloseBtn.addEventListener('click', closeSignupModal);
  if ($.closeSignupLink) $.closeSignupLink.addEventListener('click', closeSignupModal);

  $.signupOverlay.addEventListener('click', e => {
    if (e.target === $.signupOverlay) closeSignupModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $.signupOverlay.classList.contains('open')) {
      closeSignupModal();
    }
  });

  // ── Clear inline errors on input ──
  if ($.suNameInput)     $.suNameInput.addEventListener('input',     () => { clearError('su-nameGroup',     'su-nameError');     hideSignupAlert(); });
  if ($.suEmailInput)    $.suEmailInput.addEventListener('input',    () => { clearError('su-emailGroup',    'su-emailError');    hideSignupAlert(); });
  if ($.suPasswordInput) $.suPasswordInput.addEventListener('input', () => { clearError('su-passwordGroup', 'su-passwordError'); hideSignupAlert(); });
  if ($.suConfirmInput)  $.suConfirmInput.addEventListener('input',  () => { clearError('su-confirmGroup',  'su-confirmError');  hideSignupAlert(); });

  // ── Form submit ──
  if (!$.signupForm) return;

  $.signupForm.addEventListener('submit', async e => {
    e.preventDefault();
    resetSignupErrors();

    const name     = $.suNameInput     ? $.suNameInput.value.trim()  : '';
    const email    = $.suEmailInput    ? $.suEmailInput.value.trim() : '';
    const password = $.suPasswordInput ? $.suPasswordInput.value     : '';
    const confirm  = $.suConfirmInput  ? $.suConfirmInput.value      : '';

    if (!runSignupValidation(name, email, password, confirm)) return;

    setSignupLoading(true);

    try {
      if (!supabaseClient) throw new Error('Auth service unavailable. Please refresh.');

      // ── Step 1: Create the account ──
      const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name }
        }
      });

      if (signUpError) throw new Error(signUpError.message);

      // ── Step 2: Sign in immediately (email confirm is disabled) ──
      // This ensures a valid session cookie exists before redirecting.
      const { data: loginData, error: loginError } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (loginError) throw new Error(loginError.message);

      if (loginData?.user) {
        markSignupSuccess();
        setTimeout(() => {
          window.location.href = "BOL.html";
        }, 800);
      }

    } catch (err) {
      showSignupAlert(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSignupLoading(false);
    }
  });
}

/* ── Signup validation ── */

function runSignupValidation(name, email, password, confirm) {
  let ok = true;

  if (!name) {
    showError('su-nameGroup', 'su-nameError', 'Name is required.');
    ok = false;
  }

  if (!email) {
    showError('su-emailGroup', 'su-emailError', 'Email address is required.');
    ok = false;
  } else if (!isEmailValid(email)) {
    showError('su-emailGroup', 'su-emailError', 'Please enter a valid email address.');
    ok = false;
  }

  if (!password) {
    showError('su-passwordGroup', 'su-passwordError', 'Password is required.');
    ok = false;
  } else if (password.length < 6) {
    showError('su-passwordGroup', 'su-passwordError', 'Password must be at least 6 characters.');
    ok = false;
  }

  if (!confirm) {
    showError('su-confirmGroup', 'su-confirmError', 'Please confirm your password.');
    ok = false;
  } else if (password && confirm !== password) {
    showError('su-confirmGroup', 'su-confirmError', 'Passwords do not match.');
    ok = false;
  }

  return ok;
}

/* ── Signup alert helpers ── */

function showSignupAlert(msg) {
  if (!$.suFormAlert || !$.suAlertMsg) return;
  $.suAlertMsg.textContent = msg;
  $.suFormAlert.style.display = 'flex';
}

function hideSignupAlert() {
  if ($.suFormAlert) $.suFormAlert.style.display = 'none';
}

/* ── Signup button states ── */

function setSignupLoading(isLoading) {
  if (!$.signupBtn) return;
  $.signupBtn.classList.toggle('loading', isLoading);
  $.signupBtn.disabled = isLoading;
}

function markSignupSuccess() {
  if (!$.signupBtn) return;
  const label = $.signupBtn.querySelector('.signup-btn__label');
  if (label) label.textContent = '✓ Account created — redirecting…';
  $.signupBtn.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
  $.signupBtn.style.boxShadow  = '0 12px 32px rgba(34,197,94,0.3)';
}

/* ── Signup form reset ── */

function resetSignupErrors() {
  clearError('su-nameGroup',     'su-nameError');
  clearError('su-emailGroup',    'su-emailError');
  clearError('su-passwordGroup', 'su-passwordError');
  clearError('su-confirmGroup',  'su-confirmError');
  hideSignupAlert();
}

function resetSignupForm() {
  resetSignupErrors();
  if ($.suNameInput)     $.suNameInput.value     = '';
  if ($.suEmailInput)    $.suEmailInput.value    = '';
  if ($.suPasswordInput) $.suPasswordInput.value = '';
  if ($.suConfirmInput)  $.suConfirmInput.value  = '';
  if ($.signupBtn) {
    $.signupBtn.disabled             = false;
    $.signupBtn.style.background     = '';
    $.signupBtn.style.boxShadow      = '';
    $.signupBtn.classList.remove('loading');
    const label = $.signupBtn.querySelector('.signup-btn__label');
    if (label) label.textContent = 'Create Account';
  }
}