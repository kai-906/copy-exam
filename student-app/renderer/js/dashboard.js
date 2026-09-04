document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth guard ───────────────────────────────────────────────
  const token = (window.Api && window.Api.getToken)
    ? window.Api.getToken()
    : (localStorage.getItem('student_token') || localStorage.getItem('token'));

  if (!token) { window.location.href = 'index.html'; return; }

  // ── Hydrate sidebar immediately from cache ───────────────────
  const cached = localStorage.getItem('student_user');
  let cachedUser = {};
  if (cached) {
    try { cachedUser = JSON.parse(cached); } catch(e) {}
    applyProfileUI(cachedUser);
  }

  // ── Tab navigation ───────────────────────────────────────────
  const pageTitles = {
    'tab-dashboard': ['Dashboard',          'Welcome back! Here\'s your exam performance overview.'],
    'tab-results':   ['Results & History',  'All your past exam attempts and scores.'],
    'tab-profile':   ['My Profile',         'Your account information and statistics.'],
  };

  document.querySelectorAll('.nav-item[data-tab]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      link.classList.add('active');
      document.getElementById(link.dataset.tab).classList.add('active');
      const [title, sub] = pageTitles[link.dataset.tab] || ['Dashboard', ''];
      document.getElementById('pageTitle').textContent    = title;
      document.getElementById('pageSubtitle').textContent = sub;
    });
  });

  // ── Logout ───────────────────────────────────────────────────
  document.getElementById('btnLogout').addEventListener('click', () => {
    if (window.Api && window.Api.clearToken) window.Api.clearToken();
    else { localStorage.removeItem('student_token'); localStorage.removeItem('token'); }
    localStorage.removeItem('student_user');
    localStorage.removeItem('active_exam_id');
    window.location.href = 'index.html';
  });

  // ── Enter Exam modal ─────────────────────────────────────────
  const examModal    = document.getElementById('examModal');
  const examKeyInput = document.getElementById('examKeyInput');
  const examModalErr = document.getElementById('examModalError');

  document.getElementById('btnEnterExam').addEventListener('click', () => {
    examKeyInput.value  = '';
    examModalErr.textContent = '';
    examModal.classList.add('open');
    setTimeout(() => examKeyInput.focus(), 80);
  });

  document.getElementById('btnCancelModal').addEventListener('click', () => {
    examModal.classList.remove('open');
  });

  // Close on backdrop click
  examModal.addEventListener('click', e => {
    if (e.target === examModal) examModal.classList.remove('open');
  });

  // Auto-fill key from URL param (teacher sends link with ?key=XXXX)
  const urlKey = new URLSearchParams(window.location.search).get('key');
  if (urlKey) {
    examKeyInput.value = urlKey;
    examModal.classList.add('open');
  }

  // Electron: listen for deep-link key injection
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('auto-fill-key', (event, examKey) => {
      if (examKey) {
        examKeyInput.value = examKey;
        examModal.classList.add('open');
      }
    });
  } catch(e) {}

  document.getElementById('btnConfirmExam').addEventListener('click', startExamWithKey);
  examKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') startExamWithKey(); });

  function startExamWithKey() {
    let raw = examKeyInput.value.trim();
    if (!raw) { examModalErr.textContent = 'Please enter a key or link.'; return; }
    // Extract key if full URL was pasted
    if (raw.includes('key=')) raw = raw.split('key=')[1].split('&')[0];
    raw = raw.trim();
    if (!raw) { examModalErr.textContent = 'Could not extract a key from that input.'; return; }
    localStorage.setItem('active_exam_id', raw);
    examModal.classList.remove('open');
    window.location.href = 'rules.html';
  }

  // ── Load data from API ────────────────────────────────────────
  let results = [];
  let profile = {};

  try {
    const data = await Api.request('/student/my-results', { method: 'GET' });
    profile = data.studentProfile || {};
    results = data.results        || [];

    // Merge API profile with cached
    const merged = { ...cachedUser, ...profile };
    localStorage.setItem('student_user', JSON.stringify(merged));
    applyProfileUI(merged);
    renderProfileTab(merged, results.length);
    renderStats(results);
    renderChart(results);
    renderRecentResults(results);
    renderResultsTable(results);

  } catch(err) {
    console.error('Dashboard load error:', err);
    // Still render what we can from cache
    renderProfileTab(cachedUser, '—');
    renderResultsTable([]);
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  function applyProfileUI(u) {
    const name = u.name || u.full_name || 'Student';
    const roll = u.roll_number || u.rollNumber || '—';
    setText('sidebarName', name);
    setText('sidebarRoll', roll);
    if (u.profile_photo || u.photo) {
      ['userAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.src = u.profile_photo || u.photo;
      });
    }
  }

  function renderProfileTab(u, examCount) {
    const name   = u.name   || u.full_name   || '—';
    const roll   = u.roll_number || u.rollNumber || '—';
    const email  = u.email  || '—';
    const branch = u.branch || '—';
    const year   = u.year   || '—';
    const photo  = u.profile_photo || u.photo;

    setText('profileName',      name);
    setText('profileRoll',      'Roll: ' + roll);
    setText('profileEmail',     email);
    setText('profileBranch',    branch);
    setText('profileYear',      year);
    setText('profileExamCount', examCount);

    if (photo) {
      const el = document.getElementById('profileAvatar');
      if (el) el.src = photo;
    }
  }

  function renderStats(results) {
    const submitted = results.filter(r => r.status === 'SUBMITTED');
    const total     = results.length;
    const passed    = submitted.filter(r => (r.total_score || 0) >= (r.pass_marks || 40)).length;
    const avgScore  = submitted.length
      ? Math.round(submitted.reduce((s, r) => s + (r.total_score || 0), 0) / submitted.length * 10) / 10
      : 0;
    const passRate  = submitted.length ? Math.round((passed / submitted.length) * 100) : 0;
    const lastScore = submitted.length ? (submitted[0].total_score || 0) + ' / ' + (submitted[0].total_marks || 100) : '—';

    setText('statTotalExams', total);
    setText('statAvgScore',   submitted.length ? avgScore + ' pts' : '—');
    setText('statPassRate',   submitted.length ? passRate + '%' : '—');
    setText('statLastScore',  lastScore);
  }

  function renderChart(results) {
    const canvas = document.getElementById('performanceChart');
    if (!canvas || !window.Chart) return;

    const sorted = [...results].filter(r => r.status === 'SUBMITTED').reverse();
    const labels = sorted.map((r, i) => r.exam_title ? truncate(r.exam_title, 14) : 'Test ' + (i + 1));
    const scores = sorted.map(r => r.total_score || 0);

    if (labels.length === 0) {
      labels.push('No data yet');
      scores.push(0);
    }

    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Score',
          data: scores,
          borderColor: '#0284c7',
          backgroundColor: 'rgba(2,132,199,0.10)',
          pointBackgroundColor: '#38bdf8',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 2,
          pointRadius: 5,
          fill: true,
          tension: 0.38
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 12 } } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8' } },
          x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8', maxRotation: 30 } }
        }
      }
    });
  }

  function renderRecentResults(results) {
    const container = document.getElementById('recentResultsList');
    if (!container) return;

    const recent = results.slice(0, 5);
    if (!recent.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>No exams attempted yet.<br>Tap <strong>Enter Exam</strong> to begin!</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    recent.forEach(r => {
      const isPass   = r.status === 'SUBMITTED' && (r.total_score || 0) >= (r.pass_marks || 40);
      const isPending = r.status !== 'SUBMITTED';
      const scoreClass = isPending ? 'pending' : (isPass ? 'pass' : 'fail');
      const scoreText  = isPending
        ? 'In Progress'
        : `${r.total_score || 0} / ${r.total_marks || 100}`;
      const dateStr = r.start_time
        ? new Date(r.start_time).toLocaleDateString('en-IN', { day:'2-digit', month:'short' })
        : '—';

      const card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML = `
        <div>
          <div class="rc-title">${escHtml(r.exam_title || 'CBT Exam')}</div>
          <div class="rc-meta">${dateStr}</div>
        </div>
        <div class="rc-score ${scoreClass}">${escHtml(scoreText)}</div>
      `;
      container.appendChild(card);
    });
  }

  function renderResultsTable(results) {
    const tbody = document.getElementById('resultsTableBody');
    const countEl = document.getElementById('resultCount');
    if (!tbody) return;

    if (countEl) countEl.textContent = results.length ? `${results.length} attempt(s)` : '';

    if (!results.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-icon">📭</div>
              <p>No exam history yet. Use <strong>Enter Exam</strong> to start your first exam.</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = '';
    results.forEach((r, idx) => {
      const isPass    = r.status === 'SUBMITTED' && (r.total_score || 0) >= (r.pass_marks || 40);
      const isPending = r.status !== 'SUBMITTED';
      const pillClass = isPending ? 'ongoing' : (isPass ? 'pass' : 'fail');
      const pillText  = isPending ? 'IN PROGRESS' : (isPass ? 'PASSED' : 'FAILED');
      const dateStr   = r.start_time
        ? new Date(r.start_time).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
        : '—';
      const scoreStr  = isPending ? '—' : `${r.total_score || 0} / ${r.total_marks || 100}`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color:#64748b;font-size:0.78rem;">${idx + 1}</td>
        <td><strong style="color:#e2e8f0;">${escHtml(r.exam_title || 'CBT Exam')}</strong></td>
        <td style="color:#94a3b8;">${dateStr}</td>
        <td style="font-family:'Outfit',sans-serif;font-weight:700;">${escHtml(scoreStr)}</td>
        <td><span class="score-pill ${pillClass}">${pillText}</span></td>
        <td>
          <button class="btn btn-sm btn-gray" onclick='showAnalysis(${JSON.stringify({
            title: r.exam_title || 'CBT Exam',
            score: r.total_score || 0,
            total: r.total_marks || 100,
            pass_marks: r.pass_marks || 40,
            status: r.status
          })})'>View</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Utilities ────────────────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }
});

// ── Analysis modal (called from table onclick) ────────────────
function showAnalysis(data) {
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) { return; } }
  const pct   = data.total > 0 ? Math.round((data.score / data.total) * 100) : 0;
  const isPass = data.status === 'SUBMITTED' && data.score >= (data.pass_marks || 40);
  const color  = data.status !== 'SUBMITTED' ? '#fbbf24' : (isPass ? '#34d399' : '#f87171');
  const verdict= data.status !== 'SUBMITTED' ? 'In Progress' : (isPass ? '✅ Passed' : '❌ Failed');

  const body = document.getElementById('analysisBody');
  if (body) {
    body.innerHTML = `
      <p style="font-size:1rem;color:#f1f5f9;margin:0 0 12px;font-weight:600;">${data.title}</p>
      <p style="margin:0 0 6px;">Score: <strong style="color:${color};font-size:1.2rem;">${data.score} / ${data.total}</strong> &nbsp;(${pct}%)</p>
      <p style="margin:0;">Result: <strong style="color:${color};">${verdict}</strong></p>
    `;
  }
  document.getElementById('analysisModal').classList.add('open');
}
