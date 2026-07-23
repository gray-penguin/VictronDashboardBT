export interface Prefs {
  dashboardTileOrder: string[];
  hiddenTiles: string[];
}

const PREFS_KEY = 'victron_dashboard_bt_prefs';

const DEFAULT_PREFS: Prefs = {
  dashboardTileOrder: [],
  hiddenTiles: [],
};

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
