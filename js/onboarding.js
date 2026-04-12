// First-visit onboarding modal. Also re-triggerable via a Help link.
//
// Four steps, one with an animated SVG demo. Uses CSS custom properties so
// it themes automatically on light/dark. Call `maybeShowOnboarding()` on
// page load to show on first visit; call `showOnboarding()` to show on demand.
//
// Platform flag: `platform` is 'desktop' or 'mobile'. Controls the
// orientation of the adjust-window demo (horizontal bar on desktop, vertical
// on mobile) to match the actual UI.

const STORAGE_KEY = 'onboarding_seen';

export function maybeShowOnboarding(platform) {
  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch (e) {
    // localStorage unavailable (private mode etc.) — show once per session.
  }
  showOnboarding(platform);
}

export function showOnboarding(platform) {
  // Don't stack multiple modals.
  if (document.querySelector('.onboarding-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'onboarding-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'onboarding-title');

  backdrop.innerHTML = `
    <div class="onboarding-modal">
      <button type="button" class="onboarding-close" aria-label="Close">×</button>

      <h2 id="onboarding-title">Welcome</h2>
      <p class="onboarding-sub">Plan your route through the festival in four steps.</p>

      <ol class="onboarding-steps">
        <li>
          <div class="step-num">1</div>
          <div class="step-body">
            <h3>Pick acts to see</h3>
            <p>
              Click any act to cycle through
              <span class="tag tag-want">want</span>
              <span class="tag tag-must">can't miss</span>
              and skip. Can't-miss acts are prioritized when conflicts exist.
            </p>
          </div>
        </li>

        <li>
          <div class="step-num">2</div>
          <div class="step-body">
            <h3>Walks are calculated automatically</h3>
            <p>
              The planner knows how far each stage is. Set your walking
              pace at the top. Long walks get flagged so you know they're
              coming.
            </p>
          </div>
        </li>

        <li>
          <div class="step-num">3</div>
          <div class="step-body">
            <h3>Tune your watch window</h3>
            <p>
              Drag the edge to shorten your time at a show. Drag the middle
              to slide it earlier or later. The rest of your plan
              re-calculates around it.
            </p>
            ${buildDemoSvg(platform)}
          </div>
        </li>

        <li>
          <div class="step-num">4</div>
          <div class="step-body">
            <h3>Save it or share it</h3>
            <p>
              Tap <strong>Image</strong> to generate a printable schedule
              you can save to your phone — perfect for the festival when
              there's no signal. Tap <strong>Link</strong> to copy a URL
              that opens your exact plan on someone else's device.
            </p>
          </div>
        </li>
      </ol>

      <button type="button" class="onboarding-ok">Okay</button>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Make sure we start at the top of the modal — browsers sometimes preserve
  // a scroll position on dynamically-inserted scrollable elements, which can
  // leave the modal partway down on first open (especially on iOS).
  backdrop.scrollTop = 0;
  requestAnimationFrame(() => { backdrop.scrollTop = 0; });

  // Focus the primary button so keyboard users land somewhere useful.
  // Use preventScroll so focusing doesn't bump the modal down on mobile.
  const okBtn = backdrop.querySelector('.onboarding-ok');
  const closeBtn = backdrop.querySelector('.onboarding-close');
  setTimeout(() => {
    try { okBtn.focus({ preventScroll: true }); } catch (e) { okBtn.focus(); }
  }, 0);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    backdrop.removeEventListener('click', onBackdropClick);
    window.removeEventListener('keydown', onKey);
    backdrop.remove();
  }

  function onBackdropClick(e) {
    // Dismiss when clicking the backdrop itself but not the modal content.
    if (e.target === backdrop) dismiss();
  }

  function onKey(e) {
    if (e.key === 'Escape') dismiss();
  }

  okBtn.addEventListener('click', dismiss);
  closeBtn.addEventListener('click', dismiss);
  backdrop.addEventListener('click', onBackdropClick);
  window.addEventListener('keydown', onKey);
}

// --- Demo SVG ---
//
// CSS-animated mock of an act bar with a watch window that:
//   1. shrinks (edge drag)
//   2. slides earlier
//   3. slides later
//   4. returns to full
// Repeats forever. The keyframes are defined in CSS; this function just
// emits the SVG structure. Desktop version is horizontal, mobile vertical.
function buildDemoSvg(platform) {
  if (platform === 'mobile') {
    return `
      <div class="onboarding-demo demo-mobile">
        <svg viewBox="0 0 120 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <!-- Venue label track -->
          <text x="60" y="14" text-anchor="middle" class="demo-label">Sonora</text>
          <!-- Background act bar -->
          <rect class="demo-bar" x="30" y="24" width="60" height="140" rx="4" />
          <text x="60" y="42" text-anchor="middle" class="demo-bar-name">Act</text>
          <!-- Watch window (animated via CSS) -->
          <rect class="demo-watch" x="32" width="56" rx="3" />
          <!-- Drag handle (bottom edge on mobile) -->
          <rect class="demo-handle" x="36" width="48" height="5" rx="2" />
        </svg>
        <p class="demo-caption">Drag the edge to shorten · drag the middle to slide</p>
      </div>
    `;
  }
  // Desktop: horizontal bar, right-edge drag, horizontal slide.
  return `
    <div class="onboarding-demo demo-desktop">
      <svg viewBox="0 0 240 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- Venue label track -->
        <text x="8" y="18" class="demo-label">Sonora</text>
        <!-- Background act bar -->
        <rect class="demo-bar" x="24" y="24" width="200" height="26" rx="4" />
        <text x="34" y="42" class="demo-bar-name">Act</text>
        <!-- Watch window (animated via CSS) -->
        <rect class="demo-watch" y="26" height="22" rx="3" />
        <!-- Drag handle (right edge on desktop) -->
        <rect class="demo-handle" y="28" width="5" height="18" rx="2" />
      </svg>
      <p class="demo-caption">Drag the edge to shorten · drag the middle to slide</p>
    </div>
  `;
}
