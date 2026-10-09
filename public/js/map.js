// The live map. If the map cannot load (very slow data, blocked service),
// the app keeps working as a list.
import { CATS, TONE_COLOR } from './format.js';

const NIGERIA = [[2.6, 4.2], [14.7, 13.95]];
let map = null;
let ready = false;
let failed = false;
let pending = null;
const handlers = { area: null, failed: null };

export function onArea(fn) { handlers.area = fn; }
export function onFailed(fn) { handlers.failed = fn; if (failed) fn(); }
export function getMap() { return ready ? map : null; }
export function mapFailed() { return failed; }

export function initMap(container, styleUrl) {
  if (!window.maplibregl) return fail();
  try {
    map = new window.maplibregl.Map({
      container,
      style: styleUrl,
      bounds: NIGERIA,
      fitBoundsOptions: { padding: { top: 140, bottom: Math.round(window.innerHeight * 0.45), left: 20, right: 20 } },
      maxBounds: [[-2, 1], [19, 17]],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
  } catch (err) {
    console.error(err);
    return fail();
  }
  map.touchZoomRotate.disableRotation();

  const timer = setTimeout(() => { if (!ready) fail(); }, 15000);
  map.on('error', (e) => { if (!ready) console.warn('Map error', e?.error || e); });
  map.on('load', () => {
    clearTimeout(timer);
    addLayers();
    ready = true;
    if (pending) setReports(pending);
    animateLive();
  });
  return map;
}

function fail() {
  if (failed) return;
  failed = true;
  const el = document.getElementById('map');
  if (el) {
    el.innerHTML = '<div class="map-fallback">The map could not load on this connection.<br>Reports are listed below.</div>';
  }
  handlers.failed?.();
}

function addLayers() {
  map.addSource('reports', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 46,
    clusterMaxZoom: 12,
    clusterProperties: {
      live: ['+', ['case', ['get', 'live'], 1, 0]],
      severe: ['+', ['case', ['==', ['get', 'tone'], 'red'], 1, 0]],
    },
  });

  // A soft red glow under busy areas when zoomed out.
  map.addLayer({
    id: 'heat',
    type: 'heatmap',
    source: 'reports',
    maxzoom: 9,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'heatmap-weight': ['case', ['==', ['get', 'tone'], 'red'], 1, 0.5],
      'heatmap-intensity': 0.8,
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 9, 40],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(240,68,56,0)', 0.3, 'rgba(240,127,104,0.35)', 1, 'rgba(200,34,26,0.6)'],
    },
  });

  map.addLayer({
    id: 'live-halo',
    type: 'circle',
    source: 'reports',
    filter: ['any', ['all', ['has', 'point_count'], ['>', ['get', 'live'], 0]], ['==', ['get', 'live'], true]],
    paint: {
      'circle-color': '#D92D20',
      'circle-opacity': 0.25,
      'circle-radius': 24,
    },
  });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'reports',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['case', ['>', ['get', 'severe'], 0],
        ['step', ['get', 'point_count'], '#F07F68', 5, '#E5533D', 15, '#D92D20'],
        '#DC6803'],
      'circle-radius': ['step', ['get', 'point_count'], 15, 5, 18, 15, 22, 50, 27],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#FFFFFF',
    },
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'reports',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#FFFFFF' },
  });

  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'reports',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['match', ['get', 'tone'],
        'red', TONE_COLOR.red, 'amber', TONE_COLOR.amber, 'green', TONE_COLOR.green, TONE_COLOR.grey],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 7, 12, 10, 16, 13],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#FFFFFF',
      'circle-opacity': ['get', 'fade'],
      'circle-stroke-opacity': ['get', 'fade'],
    },
  });

  map.on('click', 'clusters', async (e) => {
    const f = e.features[0];
    const src = map.getSource('reports');
    const id = f.properties.cluster_id;
    try {
      const leaves = await src.getClusterLeaves(id, 200, 0);
      const zoom = await src.getClusterExpansionZoom(id);
      handlers.area?.(leaves.map((l) => l.properties.id), f.geometry.coordinates);
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, 14), padding: sheetPadding() });
    } catch (err) {
      console.error(err);
    }
  });
  map.on('click', 'points', (e) => {
    const f = e.features[0];
    const [lng, lat] = f.geometry.coordinates;
    const ids = map.querySourceFeatures('reports', { filter: ['!', ['has', 'point_count']] })
      .filter((p) => {
        const [x, y] = p.geometry.coordinates;
        return Math.abs(x - lng) < 1e-6 && Math.abs(y - lat) < 1e-6;
      })
      .map((p) => p.properties.id);
    handlers.area?.([...new Set([f.properties.id, ...ids])], f.geometry.coordinates);
    map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 11), padding: sheetPadding() });
  });
  for (const layer of ['clusters', 'points']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

export function sheetPadding() {
  if (window.innerWidth >= 900) return { left: 430, top: 80, right: 40, bottom: 40 };
  return { top: 130, bottom: Math.round(window.innerHeight * 0.45), left: 20, right: 20 };
}

export function setReports(reports) {
  if (!ready) { pending = reports; return; }
  const now = Date.now();
  const features = reports.map((r) => {
    const ageH = (now - Date.parse(r.occurred_at)) / 3600e3;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        live: r.live,
        tone: (CATS[r.category] || CATS.other).tone,
        fade: ageH < 24 ? 1 : ageH < 24 * 7 ? 0.7 : 0.45,
      },
    };
  });
  map.getSource('reports').setData({ type: 'FeatureCollection', features });
}

function animateLive() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const start = performance.now();
  const tick = (t) => {
    if (!map || !map.getLayer('live-halo')) return;
    const p = ((t - start) % 2000) / 2000;
    map.setPaintProperty('live-halo', 'circle-radius', 14 + p * 18);
    map.setPaintProperty('live-halo', 'circle-opacity', 0.35 * (1 - p));
    setTimeout(() => requestAnimationFrame(tick), 50);
  };
  requestAnimationFrame(tick);
}

export function flyTo(lng, lat, zoom = 15, padding = sheetPadding()) {
  if (!ready) return;
  map.flyTo({ center: [lng, lat], zoom, padding, essential: true });
}

// In "pick a place" mode the pin sits in the middle of the screen,
// so the map's centre must be the middle of the screen too.
export function clearPadding() {
  if (ready) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
}

export function onMoveEnd(fn) {
  if (!ready) return () => {};
  map.on('moveend', fn);
  return () => map.off('moveend', fn);
}

export function zoomTo(zoom) {
  if (ready && map.getZoom() < zoom) map.easeTo({ zoom, duration: 600 });
}

export function center() {
  if (!ready) return null;
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
}
