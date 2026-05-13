import { ensureContext, refresh } from './state.js';
import { renderToday } from './views/today.js';
import { renderLog } from './views/log.js';
import { renderCoach } from './views/coach.js';
import { renderTrends } from './views/trends.js';
import { renderSettings } from './views/settings.js';

const VIEWS = {
  today: renderToday,
  log: renderLog,
  coach: renderCoach,
  trends: renderTrends,
  settings: renderSettings
};

let activeTab = 'today';

async function go(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const root = document.getElementById('view');
  // Clear FAB if leaving a view that uses one
  const f = document.getElementById('fab-add');
  if (f) f.remove();
  try {
    await VIEWS[tab](root);
  } catch (e) {
    console.error(e);
    root.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'card';
    div.textContent = 'Error rendering view: ' + (e.message || e);
    root.appendChild(div);
  }
}

async function bootstrap() {
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => go(b.dataset.tab));
  });

  await ensureContext();
  await go('today');

  // PWA: register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('SW register failed', e);
    }
  }

  // Add-to-home-screen hint (iOS Safari only, first launch)
  showIOSInstallHintIfNeeded();
}

function showIOSInstallHintIfNeeded() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (!isIOS || isStandalone) return;
  if (localStorage.getItem('ios_install_dismissed')) return;

  const banner = document.createElement('div');
  banner.className = 'install-banner';
  banner.style.position = 'fixed';
  banner.style.left = '12px';
  banner.style.right = '12px';
  banner.style.bottom = 'calc(80px + env(safe-area-inset-bottom))';
  banner.style.zIndex = '60';
  banner.innerHTML = `
    <div><b>Install FitCoach:</b> tap the Share icon, then "Add to Home Screen".</div>
    <div style="text-align:right;margin-top:6px;">
      <button class="btn btn-sm">Got it</button>
    </div>
  `;
  banner.querySelector('button').onclick = () => {
    localStorage.setItem('ios_install_dismissed', '1');
    banner.remove();
  };
  document.body.appendChild(banner);
}

bootstrap();
