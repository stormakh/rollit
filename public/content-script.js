/**
 * Rollit content script.
 *
 * Responsibilities:
 *  - Picker mode: highlight elements on hover, capture click → return selector
 *  - Lock UI: persistent overlay over the chosen element with pulsing border
 *  - Result UI: fullscreen overlay with "LA SUERTE DECIDIÓ" / "ESTA VEZ NO"
 *  - Execute: programmatic click on lucky success (native click + dispatchEvent fallback)
 */

(() => {
  if (window.__ROLLIT_CS_LOADED__) return;
  window.__ROLLIT_CS_LOADED__ = true;

  // ---------- State ----------
  let pickerActive = false;
  let currentHover = null;
  let lockedSelector = null;
  let lockOverlay = null;
  let lockRafId = null;
  let freezeOverlay = null;
  let freezeRafId = null;
  let freezeKeyHandler = null;

  // ---------- Styles injection ----------
  const STYLE_ID = 'rollit-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .rollit-hover-outline {
        outline: 3px solid #ff3b3b !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.12), 0 0 24px rgba(255,59,59,0.5) !important;
      }
      .rollit-freeze {
        position: fixed; inset: 0; z-index: 2147483640;
        background: rgba(6,4,14,0.82);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        pointer-events: auto;
        cursor: not-allowed;
        animation: rollit-freeze-in 0.45s ease-out;
      }
      .rollit-freeze.rollit-freeze-out { animation: rollit-freeze-out 0.5s ease-in forwards; }
      @keyframes rollit-freeze-in {
        from { opacity: 0; backdrop-filter: blur(0); }
        to   { opacity: 1; backdrop-filter: blur(3px); }
      }
      @keyframes rollit-freeze-out {
        from { opacity: 1; }
        to   { opacity: 0; }
      }
      .rollit-freeze-spotlight {
        position: fixed; pointer-events: none; z-index: 2147483641;
        border-radius: 10px;
        box-shadow:
          0 0 0 2px rgba(214,161,40,0.7),
          0 0 24px rgba(214,161,40,0.6),
          0 0 60px rgba(255,227,138,0.45),
          0 0 120px rgba(214,161,40,0.35);
        animation: rollit-spotlight-pulse 1.8s ease-in-out infinite;
      }
      @keyframes rollit-spotlight-pulse {
        0%, 100% {
          box-shadow:
            0 0 0 2px rgba(214,161,40,0.7),
            0 0 24px rgba(214,161,40,0.55),
            0 0 60px rgba(255,227,138,0.4),
            0 0 120px rgba(214,161,40,0.3);
        }
        50% {
          box-shadow:
            0 0 0 3px rgba(255,227,138,0.9),
            0 0 36px rgba(255,227,138,0.85),
            0 0 80px rgba(255,227,138,0.6),
            0 0 160px rgba(214,161,40,0.5);
        }
      }
      #rollit-picker-banner {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; background: rgba(20,20,20,0.92); color: #fff7df;
        padding: 10px 18px; border-radius: 999px; font: 600 13px/1 system-ui, -apple-system, sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,0.45); border: 1px solid rgba(255,221,128,0.35);
        pointer-events: auto; user-select: none;
        animation: rollit-banner-in 0.3s ease-out;
      }
      #rollit-picker-banner kbd {
        background: rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 4px;
        font-family: ui-monospace, monospace; font-size: 11px; margin: 0 2px;
      }
      @keyframes rollit-banner-in {
        from { opacity: 0; transform: translate(-50%, -10px); }
        to   { opacity: 1; transform: translate(-50%, 0); }
      }
      .rollit-lock-overlay {
        position: fixed; pointer-events: none; z-index: 2147483646;
        border: 3px solid #d6a128; border-radius: 6px;
        box-shadow: 0 0 0 2px rgba(214,161,40,0.25), 0 0 18px rgba(214,161,40,0.55) inset, 0 0 24px rgba(214,161,40,0.5);
        animation: rollit-lock-pulse 1.6s ease-in-out infinite;
      }
      .rollit-lock-overlay::before {
        content: "🔒 LOCKED BY ROLLIT";
        position: absolute; top: -28px; left: 0;
        font: 700 11px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.08em;
        color: #ffe38a; background: rgba(20,12,4,0.92);
        padding: 6px 10px; border-radius: 4px;
        border: 1px solid rgba(214,161,40,0.6);
        white-space: nowrap;
      }
      @keyframes rollit-lock-pulse {
        0%, 100% { box-shadow: 0 0 0 2px rgba(214,161,40,0.25), 0 0 18px rgba(214,161,40,0.45) inset, 0 0 24px rgba(214,161,40,0.4); }
        50%      { box-shadow: 0 0 0 4px rgba(214,161,40,0.55), 0 0 28px rgba(214,161,40,0.85) inset, 0 0 48px rgba(214,161,40,0.85); }
      }
      #rollit-result-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none; backdrop-filter: blur(6px);
        animation: rollit-fade-in 0.6s ease-out;
        overflow: hidden;
      }
      #rollit-result-overlay.rollit-pass {
        background: radial-gradient(ellipse at center, rgba(20,80,40,0.6), rgba(2,18,8,0.94) 70%);
      }
      #rollit-result-overlay.rollit-fail {
        background: radial-gradient(ellipse at center, rgba(60,10,18,0.55), rgba(10,2,4,0.94) 70%);
      }
      /* Flash burst at reveal */
      #rollit-result-overlay .rollit-flash {
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(circle at center, rgba(255,255,255,0.9), transparent 30%);
        opacity: 0;
        animation: rollit-flash-burst 1.2s ease-out forwards;
      }
      @keyframes rollit-flash-burst {
        0%   { opacity: 0; transform: scale(0.4); }
        20%  { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(2.4); }
      }

      /* Magic sigil SVG */
      #rollit-result-overlay .rollit-sigil {
        position: absolute; top: 50%; left: 50%;
        width: min(540px, 78vmin); height: min(540px, 78vmin);
        margin-left: calc(min(540px, 78vmin) / -2);
        margin-top: calc(min(540px, 78vmin) / -2);
        pointer-events: none;
        overflow: visible;
        filter: drop-shadow(0 0 18px currentColor);
      }
      #rollit-result-overlay.rollit-pass .rollit-sigil { color: rgba(140,255,180,0.9); }
      #rollit-result-overlay.rollit-fail .rollit-sigil { color: rgba(255,90,80,0.9); }

      #rollit-result-overlay .sigil-ring {
        fill: none; stroke: currentColor; stroke-width: 1.2;
        stroke-dasharray: 700; stroke-dashoffset: 700;
        animation: rollit-draw 1.2s ease-out forwards;
      }
      #rollit-result-overlay .sigil-ring-inner {
        stroke-width: 0.8; opacity: 0.7;
        animation-delay: 0.2s;
      }
      #rollit-result-overlay .sigil-star {
        fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round;
        stroke-dasharray: var(--len, 2000); stroke-dashoffset: var(--len, 2000);
        animation: rollit-draw 1.8s ease-out 0.3s forwards;
        opacity: 0.85;
      }
      @keyframes rollit-draw {
        to { stroke-dashoffset: 0; }
      }
      #rollit-result-overlay .sigil-orbit {
        transform-origin: 0 0;
        animation: rollit-spin 14s linear infinite;
        opacity: 0;
        animation-name: rollit-spin, rollit-fade-up;
        animation-duration: 14s, 0.8s;
        animation-delay: 0s, 0.4s;
        animation-iteration-count: infinite, 1;
        animation-timing-function: linear, ease-out;
        animation-fill-mode: none, forwards;
      }
      @keyframes rollit-spin { to { transform: rotate(360deg); } }
      @keyframes rollit-fade-up { to { opacity: 1; } }
      #rollit-result-overlay .sigil-rune {
        fill: currentColor;
        filter: drop-shadow(0 0 4px currentColor);
      }
      /* Counter-rotate inner ring for layered motion */
      #rollit-result-overlay .sigil-ring-inner {
        transform-origin: 0 0;
        animation:
          rollit-draw 1.2s ease-out 0.2s forwards,
          rollit-spin-rev 22s linear infinite;
      }
      @keyframes rollit-spin-rev { to { transform: rotate(-360deg); } }
      #rollit-result-overlay .rollit-particles {
        position: absolute; inset: 0; pointer-events: none;
      }
      #rollit-result-overlay .rollit-particles span {
        position: absolute; bottom: -10px; left: var(--x);
        width: 4px; height: 4px; border-radius: 50%;
        animation: rollit-float var(--d) ease-out infinite;
        animation-delay: var(--delay);
        opacity: 0;
      }
      #rollit-result-overlay.rollit-pass .rollit-particles span {
        background: #cdf5d8;
        box-shadow: 0 0 8px #6effa0, 0 0 16px rgba(120,255,170,0.55);
      }
      #rollit-result-overlay.rollit-fail .rollit-particles span {
        background: #ff9a8a;
        box-shadow: 0 0 8px #ff5a4a, 0 0 16px rgba(255,90,74,0.5);
      }
      @keyframes rollit-float {
        0%   { transform: translateY(0) scale(0.6); opacity: 0; }
        20%  { opacity: 1; }
        100% { transform: translateY(-110vh) scale(1.2); opacity: 0; }
      }
      #rollit-result-overlay .rollit-result-card {
        position: relative;
        font: 700 clamp(20px, 3.2vw, 40px)/1.25 Cinzel, Copperplate, 'Copperplate Gothic Light', Georgia, serif;
        text-align: center;
        padding: 20px 28px;
        letter-spacing: 0.12em;
        width: min(620px, 82vw);
        word-spacing: 0.18em;
        margin: 0 auto;
      }
      #rollit-result-overlay .rollit-word {
        display: inline-block;
        white-space: nowrap;
      }
      #rollit-result-overlay .rollit-letter {
        display: inline-block;
        opacity: 0;
        transform: translateY(20px) scale(0.7);
        animation: rollit-letter-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        animation-delay: calc(var(--i) * 0.06s);
      }
      @keyframes rollit-letter-in {
        0%   { opacity: 0; transform: translateY(24px) scale(0.6); filter: blur(8px); }
        60%  { opacity: 1; transform: translateY(-4px) scale(1.08); filter: blur(0); }
        100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
      }
      #rollit-result-overlay.rollit-pass .rollit-letter {
        color: #ecffe8;
        text-shadow:
          0 0 12px rgba(170,255,190,0.95),
          0 0 32px rgba(110,255,150,0.7),
          0 0 64px rgba(40,200,90,0.55);
        animation-name: rollit-letter-in, rollit-letter-breathe;
        animation-duration: 0.6s, 2.4s;
        animation-delay: calc(var(--i) * 0.06s), calc(var(--i) * 0.06s + 0.6s);
        animation-iteration-count: 1, infinite;
        animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1), ease-in-out;
        animation-fill-mode: forwards, none;
      }
      #rollit-result-overlay.rollit-fail .rollit-letter {
        color: #ffe0d8;
        text-shadow:
          0 0 12px rgba(255,140,120,0.9),
          0 0 32px rgba(255,80,60,0.65),
          0 0 64px rgba(180,30,30,0.5);
        animation-name: rollit-letter-in, rollit-letter-breathe;
        animation-duration: 0.6s, 2.4s;
        animation-delay: calc(var(--i) * 0.06s), calc(var(--i) * 0.06s + 0.6s);
        animation-iteration-count: 1, infinite;
        animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1), ease-in-out;
        animation-fill-mode: forwards, none;
      }
      @keyframes rollit-letter-breathe {
        0%, 100% { transform: translateY(0) scale(1); filter: brightness(1); }
        50%      { transform: translateY(-3px) scale(1.03); filter: brightness(1.25); }
      }
      @keyframes rollit-fade-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes rollit-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-8px); }
        40%, 80% { transform: translateX(8px); }
      }
      .rollit-fail-shake { animation: rollit-shake 0.45s ease-in-out; }
    `;
    document.documentElement.appendChild(style);
  }

  // ---------- Selector generation ----------
  function getSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    // Prefer id if unique
    if (el.id) {
      const sel = `#${CSS.escape(el.id)}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    // Prefer data-testid / data-test / aria-label
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${CSS.escape(v)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    // Build path
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part = `#${CSS.escape(cur.id)}`;
        parts.unshift(part);
        break;
      }
      const cls = (typeof cur.className === 'string' ? cur.className : '')
        .trim().split(/\s+/)
        .filter((c) => c && !/[:[\]()]/.test(c) && c.length < 40)
        .slice(0, 2);
      if (cls.length) part += '.' + cls.map(CSS.escape).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) {
          part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function shortLabel(el) {
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 48);
    return text ? `<${tag}> "${text}"` : `<${tag}>`;
  }

  // ---------- Picker mode ----------
  function startPicker() {
    if (pickerActive) return;
    injectStyles();
    pickerActive = true;

    const banner = document.createElement('div');
    banner.id = 'rollit-picker-banner';
    banner.appendChild(document.createTextNode('Click any element to lock it · '));
    const kbd = document.createElement('kbd');
    kbd.textContent = 'Esc';
    banner.appendChild(kbd);
    banner.appendChild(document.createTextNode(' cancel'));
    document.documentElement.appendChild(banner);

    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('mouseout', onHoverOut, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function stopPicker() {
    if (!pickerActive) return;
    pickerActive = false;
    if (currentHover) {
      currentHover.classList.remove('rollit-hover-outline');
      currentHover = null;
    }
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('mouseout', onHoverOut, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    const banner = document.getElementById('rollit-picker-banner');
    if (banner) banner.remove();
  }

  function onHover(e) {
    if (!pickerActive) return;
    const el = e.target;
    if (!el || el.id === 'rollit-picker-banner' || el.closest('#rollit-picker-banner')) return;
    if (currentHover && currentHover !== el) {
      currentHover.classList.remove('rollit-hover-outline');
    }
    currentHover = el;
    el.classList.add('rollit-hover-outline');
  }

  function onHoverOut(e) {
    if (!pickerActive) return;
    if (e.target && e.target.classList) {
      e.target.classList.remove('rollit-hover-outline');
    }
  }

  function onPickClick(e) {
    if (!pickerActive) return;
    if (e.target.closest('#rollit-picker-banner')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = e.target;
    const selector = getSelector(el);
    const label = shortLabel(el);

    if (currentHover) currentHover.classList.remove('rollit-hover-outline');
    stopPicker();

    if (!selector) {
      console.warn('[rollit] could not derive selector for element', el);
      return;
    }

    // Persist + lock visually + freeze the page until the roll happens
    chrome.storage.session.set({
      rollitTarget: { selector, label, url: location.href, ts: Date.now() },
    });
    applyLock(selector);
    startFreeze();

    // Notify popup (if listening) — popup queries storage on open instead
    try {
      chrome.runtime.sendMessage({ type: 'ROLLIT_PICKED', selector, label });
    } catch (_) { /* popup may not be open */ }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      stopPicker();
    }
  }

  // ---------- Lock overlay (sticks to target, follows scroll/resize) ----------
  function applyLock(selector) {
    injectStyles();
    removeLock();
    lockedSelector = selector;

    const el = document.querySelector(selector);
    if (!el) return;

    lockOverlay = document.createElement('div');
    lockOverlay.className = 'rollit-lock-overlay';
    document.documentElement.appendChild(lockOverlay);

    const update = () => {
      const target = document.querySelector(lockedSelector);
      if (!target || !lockOverlay) return;
      const r = target.getBoundingClientRect();
      lockOverlay.style.left = `${r.left}px`;
      lockOverlay.style.top = `${r.top}px`;
      lockOverlay.style.width = `${r.width}px`;
      lockOverlay.style.height = `${r.height}px`;
      lockRafId = requestAnimationFrame(update);
    };
    update();
  }

  function removeLock() {
    if (lockRafId) cancelAnimationFrame(lockRafId);
    lockRafId = null;
    if (lockOverlay) {
      lockOverlay.remove();
      lockOverlay = null;
    }
    lockedSelector = null;
  }

  // ---------- Freeze: dim page + spotlight target + block all clicks ----------
  function startFreeze() {
    if (!lockedSelector) return; // nothing to spotlight
    injectStyles();
    endFreeze(); // ensure clean state

    const freeze = document.createElement('div');
    freeze.className = 'rollit-freeze';
    document.documentElement.appendChild(freeze);

    const spotlight = document.createElement('div');
    spotlight.className = 'rollit-freeze-spotlight';
    document.documentElement.appendChild(spotlight);

    freezeOverlay = { dim: freeze, spotlight };

    // Block keyboard interactions too (Enter, Space, Tab navigation)
    freezeKeyHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', freezeKeyHandler, true);

    // Eat all clicks/wheel/pointer events on dim layer (already pe:auto blocks bubble)
    const eat = (e) => { e.preventDefault(); e.stopPropagation(); };
    freeze.addEventListener('click', eat, true);
    freeze.addEventListener('mousedown', eat, true);
    freeze.addEventListener('contextmenu', eat, true);

    const PAD = 6;
    const update = () => {
      const target = lockedSelector ? document.querySelector(lockedSelector) : null;
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (!target || !freezeOverlay) return;
      const r = target.getBoundingClientRect();
      const L = Math.max(0, r.left - PAD);
      const T = Math.max(0, r.top - PAD);
      const R = Math.min(W, r.right + PAD);
      const B = Math.min(H, r.bottom + PAD);
      // Punch hole via polygon clip-path (outer + inner loop)
      freeze.style.clipPath =
        `polygon(0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ` +
        `${L}px ${T}px, ${L}px ${B}px, ${R}px ${B}px, ${R}px ${T}px, ${L}px ${T}px)`;
      // Spotlight border around the hole
      spotlight.style.left = `${L}px`;
      spotlight.style.top = `${T}px`;
      spotlight.style.width = `${R - L}px`;
      spotlight.style.height = `${B - T}px`;
      freezeRafId = requestAnimationFrame(update);
    };
    update();
  }

  function endFreeze() {
    if (freezeRafId) cancelAnimationFrame(freezeRafId);
    freezeRafId = null;
    if (freezeKeyHandler) {
      document.removeEventListener('keydown', freezeKeyHandler, true);
      freezeKeyHandler = null;
    }
    if (!freezeOverlay) return;
    const { dim, spotlight } = freezeOverlay;
    freezeOverlay = null;
    dim.classList.add('rollit-freeze-out');
    spotlight.style.transition = 'opacity 0.4s';
    spotlight.style.opacity = '0';
    setTimeout(() => {
      dim.remove();
      spotlight.remove();
    }, 500);
  }

  // ---------- D&D-inspired flavor text ----------
  const SUCCESS_LINES = [
    'GOOD ROLL',
    'CRITICAL HIT',
    'NATURAL TWENTY',
    'TYMORA SMILES',
    'FATE BENDS',
    'SAVING THROW PASSED',
    'VORPAL STRIKE',
    'BARDIC INSPIRATION',
    'THE DICE GODS FAVOR YOU',
    'DESTINY CONFIRMED',
  ];
  const FAIL_LINES = [
    'YOU GOT ROLLED',
    'CRITICAL MISS',
    'NATURAL ONE',
    'BESHABA LAUGHS',
    'FATE DENIES YOU',
    'SAVING THROW FAILED',
    'YOU FUMBLED',
    'THE VOID CLAIMS YOU',
    'ROLL THE BONES AGAIN',
    'THE DICE GODS MOCK YOU',
  ];
  function pickResultText(success, value) {
    if (value === 20) return 'CRITICAL HIT';
    if (value === 1) return 'CRITICAL MISS';
    const arr = success ? SUCCESS_LINES : FAIL_LINES;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---------- Result overlay + execute ----------
  function showResult({ success, value, dc }) {
    injectStyles();
    const existing = document.getElementById('rollit-result-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'rollit-result-overlay';
    overlay.className = success ? 'rollit-pass' : 'rollit-fail';

    // White flash burst
    const flash = document.createElement('div');
    flash.className = 'rollit-flash';
    overlay.appendChild(flash);

    // SVG magic circle (sigil) — drawn with stroke-dashoffset
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'rollit-sigil');
    svg.setAttribute('viewBox', '-100 -100 200 200');
    svg.setAttribute('aria-hidden', 'true');
    // Outer ring
    const ringOuter = document.createElementNS(SVG_NS, 'circle');
    ringOuter.setAttribute('cx', '0'); ringOuter.setAttribute('cy', '0');
    ringOuter.setAttribute('r', '90'); ringOuter.setAttribute('class', 'sigil-ring sigil-ring-outer');
    svg.appendChild(ringOuter);
    // Inner ring
    const ringInner = document.createElementNS(SVG_NS, 'circle');
    ringInner.setAttribute('cx', '0'); ringInner.setAttribute('cy', '0');
    ringInner.setAttribute('r', '64'); ringInner.setAttribute('class', 'sigil-ring sigil-ring-inner');
    svg.appendChild(ringInner);
    // Heptagram (7-pointed star — arcane vibe)
    const heptagram = document.createElementNS(SVG_NS, 'polygon');
    const pts = [];
    const N = 7, STEP = 3, R = 78;
    for (let k = 0; k < N; k++) {
      const idx = (k * STEP) % N;
      const a = (idx / N) * Math.PI * 2 - Math.PI / 2;
      pts.push(`${Math.cos(a) * R},${Math.sin(a) * R}`);
    }
    heptagram.setAttribute('points', pts.join(' '));
    heptagram.setAttribute('class', 'sigil-star');
    svg.appendChild(heptagram);
    // Orbiting rune dots
    const orbitGroup = document.createElementNS(SVG_NS, 'g');
    orbitGroup.setAttribute('class', 'sigil-orbit');
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(Math.cos(a) * 90));
      dot.setAttribute('cy', String(Math.sin(a) * 90));
      dot.setAttribute('r', k % 3 === 0 ? '3' : '1.5');
      dot.setAttribute('class', 'sigil-rune');
      orbitGroup.appendChild(dot);
    }
    svg.appendChild(orbitGroup);
    overlay.appendChild(svg);

    // Floating particle field
    const particles = document.createElement('div');
    particles.className = 'rollit-particles';
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('span');
      p.style.setProperty('--i', String(i));
      p.style.setProperty('--x', `${Math.random() * 100}%`);
      p.style.setProperty('--d', `${1.8 + Math.random() * 2.2}s`);
      p.style.setProperty('--delay', `${Math.random() * 1.2}s`);
      particles.appendChild(p);
    }
    overlay.appendChild(particles);

    const card = document.createElement('div');
    card.className = 'rollit-result-card';
    const text = pickResultText(success, Number(value));
    // Letter stagger grouped by word so wrapping never splits a word
    const words = text.split(' ');
    let li = 0;
    words.forEach((word, wi) => {
      const wrap = document.createElement('span');
      wrap.className = 'rollit-word';
      for (const ch of word) {
        const span = document.createElement('span');
        span.className = 'rollit-letter';
        span.style.setProperty('--i', String(li++));
        span.textContent = ch;
        wrap.appendChild(span);
      }
      card.appendChild(wrap);
      if (wi < words.length - 1) card.appendChild(document.createTextNode(' '));
    });
    overlay.appendChild(card);
    document.documentElement.appendChild(overlay);

    // Sync: measure heptagram now that it's in the DOM, BEFORE the 0.3s
    // animation-delay starts so dasharray equals the real path length.
    try {
      const len = heptagram.getTotalLength();
      heptagram.style.setProperty('--len', String(Math.ceil(len)));
    } catch (_) { /* ignore */ }

    if (!success && lockOverlay) {
      lockOverlay.classList.add('rollit-fail-shake');
      setTimeout(() => lockOverlay && lockOverlay.classList.remove('rollit-fail-shake'), 500);
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        overlay.style.transition = 'opacity 0.6s';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 600);
      }, 3400);
    });
  }

  function programmaticClick(el) {
    try { el.click(); } catch (_) { /* ignore */ }
    // Fallback: dispatch full pointer + click sequence (React/Vue/synthetic-handler friendly)
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (_) {}
  }

  async function executeResult({ success, value, dc }) {
    await showResult({ success, value, dc });
    endFreeze();
    if (!success) {
      removeLock();
      chrome.storage.session.remove('rollitTarget');
      return { executed: false, reason: 'fail' };
    }
    if (!lockedSelector) {
      removeLock();
      return { executed: false, reason: 'no-target' };
    }
    const el = document.querySelector(lockedSelector);
    if (!el) {
      removeLock();
      chrome.storage.session.remove('rollitTarget');
      return { executed: false, reason: 'element-gone' };
    }
    programmaticClick(el);
    removeLock();
    chrome.storage.session.remove('rollitTarget');
    return { executed: true };
  }

  // ---------- Restore lock + freeze on page load if same URL ----------
  (async () => {
    try {
      const { rollitTarget } = await chrome.storage.session.get('rollitTarget');
      if (rollitTarget && rollitTarget.url === location.href) {
        applyLock(rollitTarget.selector);
        startFreeze();
      }
    } catch (_) { /* storage unavailable */ }
  })();

  // ---------- Message handlers ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'ROLLIT_PING':
        sendResponse({ ok: true, hasTarget: !!lockedSelector });
        return false;
      case 'ROLLIT_START_PICKER':
        startPicker();
        sendResponse({ ok: true });
        return false;
      case 'ROLLIT_STOP_PICKER':
        stopPicker();
        sendResponse({ ok: true });
        return false;
      case 'ROLLIT_CLEAR_TARGET':
        removeLock();
        endFreeze();
        chrome.storage.session.remove('rollitTarget');
        sendResponse({ ok: true });
        return false;
      case 'ROLLIT_FREEZE_START':
        startFreeze();
        sendResponse({ ok: !!freezeOverlay });
        return false;
      case 'ROLLIT_FREEZE_END':
        endFreeze();
        sendResponse({ ok: true });
        return false;
      case 'ROLLIT_EXECUTE':
        executeResult(msg.payload).then(sendResponse);
        return true; // async
      default:
        return false;
    }
  });
})();
