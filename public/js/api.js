/* ════════════════════════════════════════════════════════
   SmartExam — Teacher API Client
   Auto-detects server URL: uses window.origin in browser,
   falls back to PRODUCTION_SERVER in Electron / file://
════════════════════════════════════════════════════════ */

// ← Change this to your deployed URL after deploying
const PRODUCTION_SERVER = 'https://copy-exam-production.up.railway.app';

const _base = (
  typeof window !== 'undefined' &&
  window.location &&
  window.location.protocol !== 'file:' &&
  window.location.origin &&
  window.location.origin !== 'null'
) ? window.location.origin : PRODUCTION_SERVER;

const Api = {
  getToken:   () => localStorage.getItem('teacher_token'),
  setToken:   (t) => localStorage.setItem('teacher_token', t),
  clearToken: () => localStorage.removeItem('teacher_token'),

  async request(endpoint, options = {}) {
    const token   = this.getToken();
    const headers = options.headers || {};

    if (token) headers['Authorization'] = `Bearer ${token}`;

    if (!options.isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${_base}/api${endpoint}`, {
      method:  options.method || 'GET',
      headers: headers,
      body:    options.body
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Server error (${res.status})`);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  },

  /* ── Auth ─────────────────────────────────────────── */
  registerTeacher: (d) => Api.request('/auth/teacher/register', { method:'POST', body:JSON.stringify(d) }),
  loginTeacher:    (d) => Api.request('/auth/teacher/login',    { method:'POST', body:JSON.stringify(d) }),

  /* ── Teacher Profile ──────────────────────────────── */
  getProfile:    ()  => Api.request('/teacher/profile'),
  saveProfile:   (d) => Api.request('/teacher/profile', { method:'POST', body:JSON.stringify(d) }),

  /* ── Subjects ─────────────────────────────────────── */
  getSubjects:    ()      => Api.request('/subjects'),
  createSubject:  (d)     => Api.request('/subjects',    { method:'POST',   body:JSON.stringify(d) }),
  updateSubject:  (id, d) => Api.request('/subjects/'+id,{ method:'PUT',    body:JSON.stringify(d) }),
  deleteSubject:  (id)    => Api.request('/subjects/'+id,{ method:'DELETE' }),
  getSubjectBanks:(id)    => Api.request('/subjects/'+id+'/banks'),
  getSubjectExams:(id)    => Api.request('/subjects/'+id+'/exams'),

  /* ── Question Banks ───────────────────────────────── */
  getBanks:        ()        => Api.request('/banks'),
  getBankQuestions:(id)      => Api.request(`/banks/${id}/questions`),
  uploadBank:      (formData)=> Api.request('/banks/upload', { method:'POST', body:formData, isFormData:true }),
  deleteBank:      (id)      => Api.request('/banks/'+id, { method:'DELETE' }),

  /* ── Exams ────────────────────────────────────────── */
  getExams:      ()      => Api.request('/exams'),
  createExam:    (d)     => Api.request('/exams/create',        { method:'POST',  body:JSON.stringify(d) }),
  toggleExam:    (id)    => Api.request('/exams/'+id+'/toggle', { method:'PATCH' }),
  getExamBanks:  (id)    => Api.request('/exams/'+id+'/banks'),
  sendAnnouncement:(d)   => Api.request('/exams/announce',      { method:'POST',  body:JSON.stringify(d) }),
  getAnnouncements:(examId) => Api.request('/exams/'+examId+'/announcements'),

  /* ── Teacher dashboard ────────────────────────────── */
  getTeacherExams:    ()      => Api.request('/teacher/exams'),
  getStudents:        ()      => Api.request('/teacher/students'),
  registerStudent:    (d)     => Api.request('/teacher/students/register', { method:'POST', body:JSON.stringify(d) }),
  getResults:         ()      => Api.request('/teacher/results'),
  getExamResults:     (examId)=> Api.request('/teacher/results/'+examId),
  getSubjectResults:  ()      => Api.request('/teacher/subject-results'),

  /* ── Proctoring ───────────────────────────────────── */
  getLiveSessions:(examId) => Api.request('/proctor/live/'+examId),
  getProctoLogs:  (examId) => Api.request('/proctor/logs/'+examId),
};
