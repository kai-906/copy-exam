// ── SERVER URL CONFIGURATION ──────────────────────────────────────────────────
// Priority:
//  1. localStorage 'server_url'  — user-configurable via ⚙️ Server Settings modal
//  2. window.location.origin     — works when page is served from a real web server
//  3. Fallback production URL    — change this before deploying!
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTION_SERVER_URL = 'https://copy-exam-production.up.railway.app';

function getServerBaseUrl() {
  // 1. User-saved custom server URL (set via Settings modal in the app)
  const saved = (typeof localStorage !== 'undefined') && localStorage.getItem('server_url');
  if (saved && saved.startsWith('http')) return saved.replace(/\/$/, '');

  // 2. Running in a real browser context served from the backend
  const proto = (typeof window !== 'undefined') && window.location && window.location.protocol;
  const origin = (typeof window !== 'undefined') && window.location && window.location.origin;
  if (proto && proto !== 'file:' && origin && origin !== 'null' && !origin.includes('localhost')) {
    return origin;
  }

  // 3. Electron desktop app (file:// protocol, loads pages locally)
  //    Electron sets window.ELECTRON_DISABLE_SECURITY_WARNINGS so we can detect it
  if (typeof require !== 'undefined') {
    // Running in Electron — always hit localhost:5000
    return 'http://localhost:5000';
  }

  // 4. Capacitor Android / iOS — must use the LAN IP or production URL, never localhost
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
    localStorage.removeItem('verified_snapshot');
  },

  // Derive API base from the same logic so inline pages stay consistent
  getApiBase: () => getServerBaseUrl() + '/api',

  request: async (endpoint, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const token = window.Api.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    const base = window.Api.getApiBase();
    const res = await fetch(`${base}${endpoint}`, { ...options, headers });

    // Detect HTML error pages (server misconfiguration / wrong URL)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `Server returned non-JSON response (${res.status}). ` +
        `Check ⚙️ Server Settings — current URL: ${base}`
      );
    }

    if (!res.ok) {
      let errMessage = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        errMessage = err.error || err.message || errMessage;
      } catch (e) {}
      throw new Error(errMessage);
    }
    return res.json();
  }
};