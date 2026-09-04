// ── SERVER URL CONFIGURATION ──────────────────────────────────
// When running as Electron desktop app (file:// protocol),
// point to your deployed server URL below.
// Change PRODUCTION_SERVER_URL to your Railway / VPS URL.
const PRODUCTION_SERVER_URL = 'http://localhost:5000'; // ← replace with your server URL after deployment

const API_BASE_URL = (typeof window !== 'undefined' && window.location && window.location.protocol !== 'file:' && window.location.origin && window.location.origin !== 'null')
  ? `${window.location.origin}/api`
  : `${PRODUCTION_SERVER_URL}/api`;

window.Api = {
  getToken: () => localStorage.getItem('student_token') || localStorage.getItem('token') || localStorage.getItem('studentToken'),
  setToken: (token) => {
    localStorage.setItem('student_token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('studentToken', token);
  },
  clearToken: () => {
    localStorage.removeItem('student_token');
    localStorage.removeItem('token');
    localStorage.removeItem('studentToken');
  },
  
  request: async (endpoint, options = {}) => {
    const headers = options.headers || {};
    const token = Api.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
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