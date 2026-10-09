import { store } from './api.js';
import { CAT_KEYS } from './format.js';

const saved = store('cw_filters') || {};

export const state = {
  config: null,
  filters: {
    range: ['1h', '24h', '7d', '30d', 'custom'].includes(saved.range) ? saved.range : '24h',
    from: saved.from || null,
    to: saved.to || null,
    cats: Array.isArray(saved.cats) ? saved.cats.filter((c) => CAT_KEYS.includes(c)) : [],
    corroborated: Boolean(saved.corroborated),
    ended: false,
  },
  reports: [],
  byId: new Map(),
  summary: { total: 0, corroborated: 0, live: 0 },
  loadedAt: null,
  loadError: null,
};

export function saveFilters() {
  // "Choose dates" is not remembered between visits; the default view is always recent.
  const f = state.filters;
  store('cw_filters', { range: f.range === 'custom' ? '24h' : f.range, cats: f.cats, corroborated: f.corroborated });
}

export function setReports(data) {
  state.reports = data.reports || [];
  state.byId = new Map(state.reports.map((r) => [r.id, r]));
  state.summary = data.summary || { total: 0, corroborated: 0, live: 0 };
  state.loadedAt = Date.now();
  state.loadError = null;
}
