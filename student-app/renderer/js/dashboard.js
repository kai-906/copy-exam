/* ════════════════════════════════════════════════════════
   SmartExam — Student Dashboard
   Handles: overview stats, subject progress cards,
            score trend chart, subject-wise bar chart,
            full results table, profile, enter-exam modal,
            live announcements via socket.io
════════════════════════════════════════════════════════ */

let allResults  = [];
let allSubjects = [];  // from /student/subject-progress
let profile     = {};
let trendChart  = null;
let subjChart   = null;
let socket      = null;

/* ── KaTeX helper ─────────────────────────────────────
   Call after inserting math-containing HTML into DOM.
   Safe to call before KaTeX loads — queues and flushes.
════════════════════════════════════════════════════════ */
window.__katexPending = [];
function renderMathInEl(el) {
  if (!el) return;
  const OPTS = {
    delimiters: [
      { left:'$$', right:'$$', display:true  },
      { left:'$',  right:'$',  display:false },
      { left:'\\(', right:'\\)', display:false },
      { left:'\\[', right:'\\]', display:true  }
    ],
    throwOnError: false,
    strict: false
  };
  if (window.__katexReady && typeof renderMathInElement !== 'undefined') {
    try { renderMathInElement(el, OPTS); } catch(e) {}
  } else {
    window.__katexPending.push(el);
  }
}

/* ════════════════════════════════════════
   BOOT
════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  const token = Api.getToken();
  if (!token) { window.location.href = 'index.html'; return; }

  initTheme();
  initNav();
  initExamModal();
  tryInitSocket();

  // Hydrate from cache immediately (prevents flash)
  const cached = localStorage.getItem('student_user');
  if (cached) { try { hydrate(JSON.parse(cached)); } catch(e) {} }

  await loadAll();
});

/* ════════════════════════════════════════
   THEME
════════════════════════════════════════ */
function initTheme() {
  const t = localStorage.getItem('student_theme') || 'dark';
  applyTheme(t);
  document.querySelectorAll('.th-dot').forEach(d =>
    d.addEventListener('click', () => applyTheme(d.dataset.t)));
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('student_theme', t);
  document.querySelectorAll('.th-dot').forEach(d =>
    d.classList.toggle('on', d.dataset.t === t));
}

/* ════════════════════════════════════════
   NAV
════════════════════════════════════════ */
const TITLES = { dashboard:'Dashboard', subjects:'My Subjects', results:'Results', profile:'Profile' };
function initNav() {
  document.querySelectorAll('.nb[data-tab]').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.getElementById('btn-logout').addEventListener('click', () => {
    Api.clearToken();
    localStorage.removeItem('student_user');
    localStorage.removeItem('active_exam_id');
    window.location.href = 'index.html';
  });
}
function switchTab(tab) {
  document.querySelectorAll('.tp').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nb[data-tab]').forEach(b => b.classList.remove('active'));
  const p = document.getElementById('tp-' + tab);
  const b = document.querySelector(`.nb[data-tab="${tab}"]`);
  if (p) p.classList.add('on');
  if (b) b.classList.add('active');
  document.getElementById('pg-title').textContent = TITLES[tab] || tab;
}

/* ════════════════════════════════════════
   DATA LOAD
════════════════════════════════════════ */
async function loadAll() {
  try {
    // Fire both requests in parallel
    const [resData, subjData] = await Promise.all([
      Api.request('/student/my-results'),
      Api.request('/student/subject-progress').catch(() => ({ subjects: [] }))
    ]);

    profile    = resData.studentProfile || {};
    allResults = resData.results || [];
    allSubjects = subjData.subjects || [];

    // Cache profile
    const merged = { ...profile };
    localStorage.setItem('student_user', JSON.stringify(merged));
    hydrate(merged);

    renderStats();
    renderSubjectCards();
    renderSubjectDetailCards();
    renderSubjectChart();
    renderTrendChart();
    renderRecentTable();
    renderResultsFilter();
    renderResults();
    renderProfile();
  } catch(err) {
    console.error('Dashboard load error:', err);
  }
}

/* ════════════════════════════════════════
   PROFILE HYDRATION
════════════════════════════════════════ */
function hydrate(u) {
  const name = u.name || u.full_name || 'Student';
  const roll = u.roll_number || u.rollNumber || '';
  // topbar chip
  document.getElementById('pname').textContent = name;
  const av = document.getElementById('pav');
  if (u.profile_photo || u.photo) {
    av.outerHTML = `<img id="pav" src="${u.profile_photo||u.photo}" class="pchip-av">`;
  } else {
    av.textContent = name.charAt(0).toUpperCase();
  }
  // profile big avatar
  const bigAv = document.getElementById('prof-av-big');
  if (bigAv) {
    if (u.profile_photo || u.photo) {
      bigAv.innerHTML = `<img src="${u.profile_photo||u.photo}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      bigAv.textContent = name.charAt(0).toUpperCase();
    }
  }
}

/* ════════════════════════════════════════
   STATS ROW
════════════════════════════════════════ */
function renderStats() {
  const submitted = allResults.filter(r => r.status === 'SUBMITTED');
  const passed    = submitted.filter(r => (r.total_score||0) >= (r.pass_marks||40)).length;
  const avg = submitted.length
    ? Math.round(submitted.reduce((s,r) => s + (r.total_score||0), 0) / submitted.length * 10) / 10
    : 0;
  const best = submitted.length
    ? Math.max(...submitted.map(r => r.total_score||0))
    : 0;

  setText('s-exams',  allResults.length);
  setText('s-passed', passed);
  setText('s-avg',    submitted.length ? avg + ' pts' : '—');
  setText('s-best',   submitted.length ? best + ' pts' : '—');
}

/* ════════════════════════════════════════
   SUBJECT PROGRESS CARDS (dashboard overview)
════════════════════════════════════════ */
function renderSubjectCards() {
  const grid = document.getElementById('subj-cards');
  if (!allSubjects.length) { grid.innerHTML = ''; return; }

  grid.innerHTML = allSubjects.map(s => {
    const pct = s.avg_score != null
      ? Math.min(100, Math.round((s.avg_score / 100) * 100))
      : 0;
    const passRate = s.submitted > 0
      ? Math.round((s.passed / s.submitted) * 100)
      : 0;
    const color = s.subject_color || '#3b82f6';
    return `
      <div class="subj-card" onclick="switchTab('subjects')">
        <div class="subj-banner" style="background:${color};">
          <span class="subj-ic">${s.subject_icon || '📚'}</span>
          <h3>${esc(s.subject_name)}</h3>
        </div>
        <div class="subj-foot">
          <div class="subj-prog-lbl">
            <span>Avg Score</span>
            <span style="font-weight:700;color:${color};">${s.avg_score ?? '—'} pts</span>
          </div>
          <div class="prog-bg">
            <div class="prog-bar" style="width:${pct}%;background:${color};"></div>
          </div>
          <div class="subj-stats">
            <span class="subj-stat">📝 ${s.total_exams} exams</span>
            <span class="subj-stat">✅ ${passRate}% pass</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════
   SUBJECT DETAIL CARDS (subjects tab — larger)
════════════════════════════════════════ */
function renderSubjectDetailCards() {
  const grid = document.getElementById('subj-detail-cards');
  if (!allSubjects.length) {
    grid.innerHTML = `<div class="emp" style="grid-column:1/-1;"><div class="emp-ic">📚</div><p>No subject data yet. Take an exam to see your progress!</p></div>`;
    return;
  }
  grid.innerHTML = allSubjects.map(s => {
    const pct      = s.avg_score != null ? Math.min(100, Math.round((s.avg_score / 100) * 100)) : 0;
    const passRate = s.submitted > 0 ? Math.round((s.passed / s.submitted) * 100) : 0;
    const color    = s.subject_color || '#3b82f6';
    const gradePill = s.avg_score == null ? '<span class="pill pn">No data</span>'
      : s.avg_score >= 80 ? '<span class="pill pg">A Grade</span>'
      : s.avg_score >= 60 ? '<span class="pill pb">B Grade</span>'
      : s.avg_score >= 40 ? '<span class="pill py">C Grade</span>'
      : '<span class="pill pr">Needs Work</span>';
    return `
      <div class="subj-card">
        <div class="subj-banner" style="background:${color};height:90px;">
          <span class="subj-ic">${s.subject_icon || '📚'}</span>
          <h3>${esc(s.subject_name)}</h3>
        </div>
        <div class="subj-foot" style="padding:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-size:22px;font-weight:800;font-family:'Google Sans';color:${color};">${s.avg_score ?? '—'}</span>
            ${gradePill}
          </div>
          <div class="subj-prog-lbl"><span>Progress</span><span style="font-weight:600;">${pct}%</span></div>
          <div class="prog-bg" style="margin-bottom:10px;"><div class="prog-bar" style="width:${pct}%;background:${color};"></div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text2);">
            <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;">
              <div style="font-size:18px;font-weight:700;color:var(--text);">${s.total_exams}</div>
              <div>Exams</div>
            </div>
            <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;">
              <div style="font-size:18px;font-weight:700;color:var(--text);">${passRate}%</div>
              <div>Pass Rate</div>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════
   SUBJECT BAR CHART
════════════════════════════════════════ */
function renderSubjectChart() {
  const cv = document.getElementById('subj-chart');
  if (!cv || !window.Chart || !allSubjects.length) return;
  if (subjChart) subjChart.destroy();

  subjChart = new Chart(cv, {
    type: 'bar',
    data: {
      labels: allSubjects.map(s => s.subject_name),
      datasets: [
        {
          label: 'Avg Score',
          data: allSubjects.map(s => s.avg_score || 0),
          backgroundColor: allSubjects.map(s => (s.subject_color || '#3b82f6') + 'bb'),
          borderColor:     allSubjects.map(s => s.subject_color || '#3b82f6'),
          borderWidth: 2, borderRadius: 7
        },
        {
          label: 'Pass Rate %',
          data: allSubjects.map(s => s.submitted > 0 ? Math.round((s.passed/s.submitted)*100) : 0),
          backgroundColor: 'rgba(16,185,129,.25)',
          borderColor: '#10b981',
          borderWidth: 2, borderRadius: 7
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: 'var(--text2)', font: { size: 12 } } } },
      scales: {
        y: { beginAtZero: true, max: 110, ticks: { color: 'var(--text2)' }, grid: { color: 'rgba(255,255,255,.05)' } },
        x: { ticks: { color: 'var(--text2)' }, grid: { display: false } }
      }
    }
  });
}

/* ════════════════════════════════════════
   SCORE TREND CHART
════════════════════════════════════════ */
function renderTrendChart() {
  const cv = document.getElementById('trend-chart');
  if (!cv || !window.Chart) return;
  if (trendChart) trendChart.destroy();

  const submitted = allResults.filter(r => r.status === 'SUBMITTED').slice().reverse();
  const labels = submitted.map((r, i) => r.exam_title ? r.exam_title.substring(0, 12) : 'Exam ' + (i+1));
  const data   = submitted.map(r => r.total_score || 0);
  const colors = submitted.map(r => (r.total_score||0) >= (r.pass_marks||40) ? '#10b981' : '#ef4444');

  if (!submitted.length) {
    cv.parentElement.innerHTML += `<div class="emp" style="padding:20px;"><div class="emp-ic" style="font-size:28px;">📈</div><p>No exam data yet.</p></div>`;
    cv.style.display = 'none'; return;
  }

  trendChart = new Chart(cv, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Score',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,.12)',
        pointBackgroundColor: colors,
        pointBorderColor: colors,
        pointRadius: 5,
        pointBorderWidth: 2,
        fill: true, tension: 0.38
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: 'var(--text2)' }, grid: { color: 'rgba(255,255,255,.05)' } },
        x: { ticks: { color: 'var(--text2)', maxRotation: 30 }, grid: { display: false } }
      }
    }
  });
}

/* ════════════════════════════════════════
   RECENT RESULTS TABLE (dashboard, last 5)
════════════════════════════════════════ */
function renderRecentTable() {
  const tbody = document.getElementById('recent-tbody');
  const recent = allResults.slice(0, 5);
  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2);">No exam history yet. Enter an exam to begin!</td></tr>`;
    return;
  }
  tbody.innerHTML = recent.map(r => buildResultRow(r)).join('');
  renderMathInEl(tbody);
}

/* ════════════════════════════════════════
   RESULTS FILTER + FULL TABLE
════════════════════════════════════════ */
function renderResultsFilter() {
  const sel = document.getElementById('res-filter-subj');
  const seen = new Set();
  allResults.forEach(r => { if (r.subject_name && !seen.has(r.subject_name)) { seen.add(r.subject_name); sel.innerHTML += `<option value="${esc(r.subject_name)}">${esc(r.subject_name)}</option>`; } });
}

function renderResults() {
  const tbody   = document.getElementById('all-results-tbody');
  const filterS = document.getElementById('res-filter-subj').value;
  const filterT = document.getElementById('res-filter-status').value;

  let list = allResults;
  if (filterS) list = list.filter(r => (r.subject_name || '') === filterS);
  if (filterT) {
    if (filterT === 'PASS')   list = list.filter(r => r.status === 'SUBMITTED' && (r.total_score||0) >= (r.pass_marks||40));
    if (filterT === 'FAIL')   list = list.filter(r => r.status === 'SUBMITTED' && (r.total_score||0) <  (r.pass_marks||40));
    if (filterT === 'IN_PROGRESS') list = list.filter(r => r.status !== 'SUBMITTED');
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text2);">No results match the filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((r, i) =>
    `<tr><td style="color:var(--text2);font-size:12px;">${i+1}</td>${buildResultRow(r, true)}</tr>`
  ).join('');
  renderMathInEl(tbody);
}

function buildResultRow(r, full = false) {
  const pass    = r.status === 'SUBMITTED' && (r.total_score||0) >= (r.pass_marks||40);
  const pending = r.status !== 'SUBMITTED';
  const pillCls = pending ? 'py' : (pass ? 'pg' : 'pr');
  const pillTxt = pending ? 'In Progress' : (pass ? 'PASS' : 'FAIL');
  const scoreStr = pending ? '—' : `${r.total_score ?? 0}`;
  const dateStr  = r.start_time ? new Date(r.start_time).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
  const subj     = r.subject_name || '—';
  const color    = r.subject_color || 'var(--primary)';
  const icon     = r.subject_icon  || '📚';

  if (full) {
    return `
      <td><strong>${esc(r.exam_title||'CBT Exam')}</strong></td>
      <td><span class="pill" style="background:${color}18;color:${color};">${icon} ${esc(subj)}</span></td>
      <td style="font-family:'Google Sans';font-weight:700;">${scoreStr}</td>
      <td>${r.total_marks ?? 100}</td>
      <td><span class="pill ${pillCls}">${pillTxt}</span></td>
      <td style="font-size:12px;color:var(--text2);">${dateStr}</td>`;
  }

  return `<tr>
    <td><strong style="font-size:13px;">${esc(r.exam_title||'CBT Exam')}</strong></td>
    <td><span class="pill" style="background:${color}18;color:${color};">${icon} ${esc(subj)}</span></td>
    <td style="font-family:'Google Sans';font-weight:700;font-size:14px;">${scoreStr} <span style="font-size:11px;color:var(--text2);">/ ${r.total_marks??100}</span></td>
    <td><span class="pill ${pillCls}">${pillTxt}</span></td>
    <td style="font-size:12px;color:var(--text2);">${dateStr}</td>
  </tr>`;
}

/* ════════════════════════════════════════
   PROFILE TAB
════════════════════════════════════════ */
function renderProfile() {
  const name  = profile.name  || '—';
  const roll  = profile.roll_number || '—';
  const email = profile.email || '—';
  setText('prof-name-big',  name);
  setText('prof-roll-big',  'Roll: ' + roll);
  setText('prof-email',     email);
  setText('prof-branch',    profile.branch || '—');
  setText('prof-year',      profile.year   || '—');
  setText('prof-total',     allResults.length);
}

/* ════════════════════════════════════════
   ENTER EXAM MODAL
════════════════════════════════════════ */
function initExamModal() {
  document.getElementById('enter-exam-btn').addEventListener('click', () => {
    document.getElementById('exam-key-inp').value = '';
    document.getElementById('exam-key-err').textContent = '';
    openModal('exam-modal');
    setTimeout(() => document.getElementById('exam-key-inp').focus(), 80);
  });

  document.getElementById('exam-key-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter') goExam();
  });

  // auto-fill from URL
  const urlKey = new URLSearchParams(window.location.search).get('key');
  if (urlKey) {
    document.getElementById('exam-key-inp').value = urlKey;
    openModal('exam-modal');
  }

  // Electron deep-link
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('auto-fill-key', (_, key) => {
      if (key) { document.getElementById('exam-key-inp').value = key; openModal('exam-modal'); }
    });
  } catch(e) {}
}

function goExam() {
  let raw = document.getElementById('exam-key-inp').value.trim();
  const err = document.getElementById('exam-key-err');
  if (!raw) { err.textContent = 'Please enter an access key or link.'; return; }
  if (raw.includes('key=')) raw = raw.split('key=')[1].split('&')[0];
  raw = raw.trim();
  if (!raw) { err.textContent = 'Could not extract a valid key.'; return; }
  localStorage.setItem('active_exam_id', raw);
  closeModal('exam-modal');
  window.location.href = 'rules.html';
}

/* ════════════════════════════════════════
   LIVE ANNOUNCEMENTS (socket.io)
════════════════════════════════════════ */
function tryInitSocket() {
  const examId = localStorage.getItem('active_exam_id');
  // Only connect if there's an active exam in progress (not on dashboard normally)
  // But we always listen for announcements if a previous exam was joined

  if (typeof io === 'undefined') return;
  const token = Api.getToken();
  if (!token) return;

  try {
    const url = window.location.protocol === 'file:' ? 'http://localhost:5000' : window.location.origin;
    socket = io(url);

    socket.on('connect', () => {
      // Re-join student personal room for announcements
      const stuData = localStorage.getItem('student_user');
      if (stuData) {
        try {
          const u = JSON.parse(stuData);
          if (u.id) socket.emit('student:rejoin', { studentId: u.id });
        } catch(e) {}
      }
    });

    socket.on('announcement', ({ type, message }) => {
      showAnnToast(type, message);
    });

    socket.on('exam:terminated', ({ reason }) => {
      showAnnToast('SYSTEM', reason || 'Your exam session has been ended by the proctor.');
    });
  } catch(e) {}
}

function showAnnToast(type, msg) {
  const toast  = document.getElementById('ann-toast');
  const typeEl = document.getElementById('ann-toast-type');
  const msgEl  = document.getElementById('ann-toast-msg');

  typeEl.textContent = type === 'BROADCAST' ? '📢 Announcement' : type === 'INDIVIDUAL' ? '💬 Message from Teacher' : '🔔 ' + type;
  msgEl.textContent  = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 6000);
}

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-bg').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
