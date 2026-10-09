// Starts the app and switches between screens using the address (#/...).
import { api } from './api.js';
import { state } from './state.js';
import { toast, mount, html } from './ui.js';
import * as mapMod from './map.js';
import { renderHome, refresh, openArea, showHome, setSnap } from './home.js';
import { openDetail } from './detail.js';
import { openReport, leaveReport } from './report.js';
import { openModerate } from './moderate.js';

const page = document.getElementById('page');
let lastRoute = '';

async function start() {
  try {
    state.config = await api.config();
  } catch {
    state.config = { siteName: 'CitizensWatch', mapStyle: 'https://tiles.openfreemap.org/styles/positron', maxDaysBack: 30, maxPhotos: 3 };
  }
  if (state.config.configured === false) {
    toast('This site is not fully set up yet. Follow the launch guide to finish it.', 8000);
  }

  renderHome();
  mapMod.onArea((ids) => openArea(ids));
  mapMod.onFailed(() => setSnap('full'));
  mapMod.initMap('map', state.config.mapStyle);

  window.addEventListener('hashchange', route);
  route();
  refresh({ quiet: true });

  // Keep the map fresh while someone is looking at it.
  setInterval(() => {
    if (document.visibilityState === 'visible' && !location.hash.startsWith('#/report') && !location.hash.startsWith('#/moderate')) {
      refresh({ quiet: true });
    }
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.loadedAt && Date.now() - state.loadedAt > 30000) refresh({ quiet: true });
  });
}

function route() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (lastRoute.startsWith('#/report') && !hash.startsWith('#/report')) {
    leaveReport();
    showHome(true);
    setSnap('half');
  }
  lastRoute = hash;

  if (parts[0] === 'r' && parts[1]) return openDetail(parts[1]);
  if (parts[0] === 'report') return openReport(parts[1] || '1');
  if (parts[0] === 'moderate') { showHome(false); return openModerate(); }

  showHome(true);
  mount(page, html``);
}

start().catch((err) => {
  console.error(err);
  toast('Something went wrong while starting. Reload the page.');
});
