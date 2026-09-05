const PRODUCTION_SERVER = 'https://copy-exam-production.up.railway.app';

const Api = {
  getToken: () => localStorage.getItem('teacher_token'),
  setToken: (token) => localStorage.setItem('teacher_token', token),
  clearToken: () => localStorage.removeItem('teacher_token'),

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = options.headers || {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!options.isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      method: options.method || 'GET',
      headers: headers,
      body: options.body
    };

    // Updated to use the Railway URL
    const response = await fetch(`${PRODUCTION_SERVER}/api${endpoint}`, config);

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Server returned non-JSON error (${response.status})`);
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'API Request failed');
    }
    return data;
  },

  // Auth Functions
  registerTeacher: (data) => Api.request('/auth/teacher/register', { method: 'POST', body: JSON.stringify(data) }),
  loginTeacher: (data) => Api.request('/auth/teacher/login', { method: 'POST', body: JSON.stringify(data) }),

  // Question Banks
  getBanks: () => Api.request('/banks'),
  getBankQuestions: (id) => Api.request(`/banks/${id}/questions`),
  uploadBank: (formData) => Api.request('/banks/upload', { method: 'POST', body: formData, isFormData: true }),
  
  // Exam Management
  createExam: (examData) => Api.request('/exams/create', { method: 'POST', body: JSON.stringify(examData) })
};