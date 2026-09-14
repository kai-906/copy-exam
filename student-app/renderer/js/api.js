// ── SERVER URL CONFIGURATION ──────────────────────────────────────────────────
// Priority:
//  1. localStorage 'server_url'  — user-configurable via ⚙️ Server Settings modal
//  2. window.location.origin     — works when page is served from a real web server
//  3. Fallback production URL    — cloud server for Windows & Android apps
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTION_SERVER_URL = 'https://copy-exam-production.up.railway.app';

function getServerBaseUrl() {
  // 1. User-saved custom server URL (set via Settings modal in the app)
  const saved = (typeof localStorage !== 'undefined') && localStorage.getItem('server_url');
  if (saved && saved.startsWith('http')) return saved.replace(/\/$/, '');

  const proto = (typeof window !== 'undefined') && window.location && window.location.protocol;
  const origin = (typeof window !== 'undefined') && window.location && window.location.origin;
  const isCapacitorNative = (typeof window !== 'undefined') &&
    Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const isElectron = (typeof window !== 'undefined') && (
    (typeof require !== 'undefined') ||
    (window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Electron')) ||
    (proto === 'file:')
  );

  // 2. Mobile App (Capacitor Android / iOS) — internal origin is http://localhost or capacitor://
  if (isCapacitorNative || (origin && (origin.startsWith('capacitor://') || origin === 'http://localhost' || origin === 'https://localhost'))) {
    return PRODUCTION_SERVER_URL;
  }

  // 3. Electron desktop app running locally from file://
  if (isElectron) {
    // In production Electron app, connect to Railway cloud server
    return PRODUCTION_SERVER_URL;
  }

  // 4. Running in standard web browser served from backend (e.g. http://localhost:5000 or custom web domain)
  if (proto && proto !== 'file:' && origin && origin !== 'null') {
    return origin;
  }

  // 5. Default fallback
  return PRODUCTION_SERVER_URL;
}

const API_BASE_URL = getServerBaseUrl() + '/api';

window.Api = {
  getToken: () =>
    localStorage.getItem('student_token') ||
    localStorage.getItem('token') ||
    localStorage.getItem('studentToken'),

  setToken: (token) => {
    localStorage.setItem('student_token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('studentToken', token);
  },

  clearToken: () => {
    localStorage.removeItem('student_token');
    localStorage.removeItem('token');
    localStorage.removeItem('studentToken');
    localStorage.removeItem('student_user');
    localStorage.removeItem('active_exam_id');
    localStorage.removeItem('active_exam_code');
    localStorage.removeItem('active_exam_title');
    localStorage.removeItem('active_exam_duration');
    localStorage.removeItem('verified_snapshot');
  },

  isAppEnvironment: () => {
    const proto = (typeof window !== 'undefined') && window.location && window.location.protocol;
    const origin = (typeof window !== 'undefined') && window.location && window.location.origin;
    const ua = (typeof window !== 'undefined') && window.navigator && window.navigator.userAgent;
    const isElectron = Boolean(
      (typeof require !== 'undefined') ||
      (ua && ua.includes('Electron')) ||
      (proto === 'file:')
    );
    const isCapacitor = Boolean(
      (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
      (proto === 'capacitor:') ||
      (origin && origin.startsWith('capacitor://')) ||
      (ua && (ua.includes('Capacitor') || ua.includes('SmartExamApp')))
    );
    return isElectron || isCapacitor;
  },

  // Derive API base dynamically so inline pages always stay synchronized
  getApiBase: () => getServerBaseUrl() + '/api',
  getServerBaseUrl: () => getServerBaseUrl(),

  request: async (endpoint, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const token = window.Api.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    const base = window.Api.getApiBase();
    let res;
    try {
      res = await fetch(`${base}${endpoint}`, { ...options, headers });
    } catch (netErr) {
      throw new Error(
        `Cannot connect to server (${base}). Please check internet or ⚙️ Server Settings.`
      );
    }

    // Detect HTML error pages (server down / wrong URL)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `Server returned non-JSON response (${res.status}). ` +
        `Check ⚙️ Server Settings — current URL: ${base}`
      );
    }

    let data = {};
    try {
      data = await res.json();
    } catch (jsonErr) {
      throw new Error('Failed to parse server response.');
    }

    if (!res.ok) {
      throw new Error(data.error || data.message || `Server error (${res.status})`);
    }

    return data;
  }
};