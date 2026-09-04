document.addEventListener('DOMContentLoaded', async () => {

  // ============================================================
  // RENDERER-SIDE LOCKDOWN
  // All keyboard/mouse protections run in the renderer process
  // independently of Electron main — so they work in the web
  // build (Capacitor/Android) as well.
  // ============================================================

  // Block right-click context menu
  document.addEventListener('contextmenu', e => e.preventDefault(), true);

  // Block keyboard shortcuts: copy, paste, cut, select-all, print,
  // screenshot (PrintScreen key), F12 devtools, browser shortcuts
  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const blocked =
      (ctrl && ['c','v','x','a','p','s','u','r'].includes(e.key.toLowerCase())) ||
      ['PrintScreen', 'F12', 'F11', 'F5', 'Tab'].includes(e.key) ||
      (e.altKey && e.key === 'Tab') ||
      (e.altKey && e.key === 'F4') ||
      (ctrl && e.shiftKey && ['i','j','c'].includes(e.key.toLowerCase()));
    if (blocked) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Block all text selection via pointer
  document.addEventListener('selectstart', e => e.preventDefault(), true);
  document.addEventListener('dragstart',   e => e.preventDefault(), true);

  // ──────────────────────────────────────────────────────────────
  // Electron IPC helpers (no-op when running outside Electron)
  // ──────────────────────────────────────────────────────────────
  let ipcRenderer = null;
  try {
    ipcRenderer = require('electron').ipcRenderer;
  } catch(e) { /* running in browser / Capacitor */ }

  function ipcSend(channel) {
    if (ipcRenderer) ipcRenderer.send(channel);
  }

  // ──────────────────────────────────────────────────────────────
  // Utility
  // ──────────────────────────────────────────────────────────────
  const getEl = (...ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  };

  // ──────────────────────────────────────────────────────────────
  // Auth / exam guards
  // ──────────────────────────────────────────────────────────────
  const examId = localStorage.getItem('active_exam_id');
  const token  = (window.Api && window.Api.getToken)
    ? window.Api.getToken()
    : (localStorage.getItem('student_token') || localStorage.getItem('token'));

  if (!examId || !token) {
    window.location.href = 'index.html';
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // 🔒 ENTER KIOSK LOCKDOWN immediately when exam page loads
  // ──────────────────────────────────────────────────────────────
  ipcSend('enter-kiosk-mode');

  // Also request fullscreen from the browser side as a fallback
  // (covers Capacitor / web mode where Electron IPC isn't available)
  try {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch(e) {}

  // ──────────────────────────────────────────────────────────────
  // Violation counter & tab-switch / window-blur detection
  // ──────────────────────────────────────────────────────────────
  let violationCount = 0;
  const MAX_VIOLATIONS = 3;

  function handleViolation(type, detail) {
    violationCount++;
    logProctoringViolation(type, detail);

    if (violationCount >= MAX_VIOLATIONS) {
      alert('❌ Maximum proctoring violations exceeded. Your exam will be auto-submitted.');
      autoSubmitExam();
      return;
    }

    const remaining = MAX_VIOLATIONS - violationCount;
    // Show a non-blocking overlay warning instead of alert so we
    // don't freeze the timer
    showWarningOverlay(`⚠️ Warning ${violationCount}/${MAX_VIOLATIONS}: ${detail}\n${remaining} violation(s) remaining before auto-submit.`);
  }

  // Window blur → tab switch detected
  window.addEventListener('blur', () => {
    handleViolation('TAB_SWITCH', 'Candidate navigated away from exam window.');
  });

  // Main-process blur event (sent from main.js on window blur)
  if (ipcRenderer) {
    ipcRenderer.on('proctor:window-blur', () => {
      handleViolation('WINDOW_BLUR', 'Exam window lost focus.');
    });
  }

  // Visibility change (mobile / Android tab switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      handleViolation('VISIBILITY_HIDDEN', 'Screen hidden or app moved to background.');
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Warning overlay (non-blocking)
  // ──────────────────────────────────────────────────────────────
  const warningOverlay = document.createElement('div');
  warningOverlay.id = 'violation-overlay';
  warningOverlay.style.cssText = `
    display:none; position:fixed; top:16px; left:50%; transform:translateX(-50%);
    background:rgba(239,68,68,0.96); color:#fff; padding:12px 24px;
    border-radius:10px; font-size:0.85rem; font-weight:700; z-index:9999;
    box-shadow:0 8px 24px rgba(0,0,0,0.5); max-width:480px; text-align:center;
    line-height:1.5;
  `;
  document.body.appendChild(warningOverlay);

  let warningTimer = null;
  function showWarningOverlay(msg) {
    warningOverlay.textContent = msg;
    warningOverlay.style.display = 'block';
    if (warningTimer) clearTimeout(warningTimer);
    warningTimer = setTimeout(() => { warningOverlay.style.display = 'none'; }, 4000);
  }

  // ──────────────────────────────────────────────────────────────
  // Violation logger (backend)
  // ──────────────────────────────────────────────────────────────
  async function logProctoringViolation(type, details) {
    try {
      await fetch(`${getExamApiBase()}/proctor/log-violation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ violationType: type, details, timestamp: new Date() })
      });
    } catch(e) { /* best-effort */ }
  }

  function getExamApiBase() {
    return (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null')
      ? 'http://localhost:5000/api'
      : `${window.location.origin}/api`;
  }

  // ──────────────────────────────────────────────────────────────
  // Student profile display
  // ──────────────────────────────────────────────────────────────
  try {
    const rawUser = localStorage.getItem('student_user');
    if (rawUser) {
      const user = JSON.parse(rawUser);
      const nameEl = getEl('studentName');
      const rollEl = getEl('studentRoll');
      if (nameEl) nameEl.textContent = user.name || 'Candidate';
      if (rollEl) rollEl.textContent = `Roll: ${user.roll_number || user.rollNumber || '—'}`;
    }
  } catch(e) {}

  // ──────────────────────────────────────────────────────────────
  // Proctoring camera feed
  // ──────────────────────────────────────────────────────────────
  const camVideo = getEl('proctorCamera');
  if (camVideo && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(stream => { camVideo.srcObject = stream; })
      .catch(err => console.warn('Proctor camera unavailable:', err.message));
  }

  // ──────────────────────────────────────────────────────────────
  // CBT State
  // ──────────────────────────────────────────────────────────────
  let questions      = [];
  let currentIndex   = 0;
  let attemptId      = null;
  let timerInterval  = null;
  let timeRemaining  = 0;
  let examSubmitted  = false;

  // Per-question status: UNVISITED | NOT_ANSWERED | ANSWERED | MARKED_REVIEW
  const state = {};

  // ──────────────────────────────────────────────────────────────
  // Socket.io — real-time proctoring
  // ──────────────────────────────────────────────────────────────
  let socket = null;
  try {
    if (typeof io !== 'undefined') {
      const socketUrl = (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null')
        ? 'http://localhost:5000'
        : window.location.origin;
      socket = io(socketUrl);
      socket.emit('student:join', {
        examId,
        studentId: token,
        studentName: (getEl('studentName') && getEl('studentName').textContent) || 'Candidate'
      });
      socket.on('student:receive-warning', ({ message }) => {
        showWarningOverlay(`⚠️ PROCTOR: ${message}`);
      });
    }
  } catch(e) {}

  // ──────────────────────────────────────────────────────────────
  // Load exam from server
  // ──────────────────────────────────────────────────────────────
  try {
    const res = await Api.request('/attempts/start', {
      method: 'POST',
      body: JSON.stringify({ exam_id: examId })
    });

    attemptId     = res.attemptId;
    questions     = res.questions || [];
    timeRemaining = (res.duration_minutes || 30) * 60;

    const titleEl = getEl('examTitle', 'exam-title-display');
    if (titleEl) titleEl.textContent = res.title || 'Examination';

    questions.forEach((q, idx) => {
      state[q.id] = {
        status: idx === 0 ? 'NOT_ANSWERED' : 'UNVISITED',
        selectedOption: null
      };
    });

    initTimer();
    renderPalette();
    loadQuestion(0);
    updateCounters();

  } catch(err) {
    alert(`Failed to start exam: ${err.message}`);
    exitExam();
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // Timer
  // ──────────────────────────────────────────────────────────────
  function initTimer() {
    const display = getEl('timeDisplay', 'timer-display');
    if (!display) return;

    timerInterval = setInterval(() => {
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        autoSubmitExam();
        return;
      }
      timeRemaining--;

      const hrs  = String(Math.floor(timeRemaining / 3600)).padStart(2, '0');
      const mins = String(Math.floor((timeRemaining % 3600) / 60)).padStart(2, '0');
      const secs = String(timeRemaining % 60).padStart(2, '0');
      display.textContent = `${hrs}:${mins}:${secs}`;

      // Turn timer red in last 5 minutes
      if (timeRemaining <= 300) display.style.color = '#f87171';
    }, 1000);
  }

  // ──────────────────────────────────────────────────────────────
  // Question rendering
  // ──────────────────────────────────────────────────────────────
  function loadQuestion(index) {
    if (index < 0 || index >= questions.length) return;
    currentIndex = index;
    const q = questions[index];

    if (state[q.id].status === 'UNVISITED') state[q.id].status = 'NOT_ANSWERED';

    const numLabel = getEl('questionNumberLabel', 'question-number-header');
    if (numLabel) numLabel.textContent = `Question No. ${index + 1} of ${questions.length}`;

    const textBox = getEl('questionText', 'question-text-box');
    if (textBox) textBox.textContent = q.question_text || '';

    const imgEl = getEl('questionImage');
    if (imgEl) {
      if (q.image_url) { imgEl.src = q.image_url; imgEl.style.display = 'block'; }
      else imgEl.style.display = 'none';
    }

    const optBox = getEl('optionsContainer', 'options-container');
    if (optBox) {
      optBox.innerHTML = '';
      const opts = Array.isArray(q.options) ? q.options : [];
      opts.forEach(optText => {
        const label  = document.createElement('label');
        label.className = 'option-card';

        const radio  = document.createElement('input');
        radio.type   = 'radio';
        radio.name   = 'examOption';
        radio.value  = optText;
        radio.checked = state[q.id].selectedOption === optText;
        radio.addEventListener('change', () => { state[q.id].selectedOption = optText; });

        const span   = document.createElement('span');
        span.className = 'option-text';
        span.textContent = optText;

        label.appendChild(radio);
        label.appendChild(span);
        optBox.appendChild(label);
      });
    }

    renderPalette();
    updateCounters();
  }

  // ──────────────────────────────────────────────────────────────
  // Palette & counters
  // ──────────────────────────────────────────────────────────────
  function renderPalette() {
    const grid = getEl('questionPalette', 'palette-grid');
    if (!grid) return;
    grid.innerHTML = '';

    questions.forEach((q, idx) => {
      const btn    = document.createElement('button');
      btn.type     = 'button';
      btn.textContent = idx + 1;

      const status = state[q.id].status;
      let colorClass = 'bg-gray-400 text-white';
      if (status === 'ANSWERED')      colorClass = 'bg-green-600 text-white';
      else if (status === 'MARKED_REVIEW') colorClass = 'bg-purple-600 text-white';
      else if (status === 'NOT_ANSWERED')  colorClass = 'bg-red-500 text-white';

      btn.className = `w-8 h-8 rounded text-xs font-bold transition ${colorClass} ${currentIndex === idx ? 'ring-2 ring-blue-400' : ''}`;
      btn.addEventListener('click', () => loadQuestion(idx));
      grid.appendChild(btn);
    });
  }

  function updateCounters() {
    let answered = 0, notAnswered = 0, notVisited = 0, marked = 0;
    questions.forEach(q => {
      const s = state[q.id].status;
      if (s === 'ANSWERED')      answered++;
      else if (s === 'MARKED_REVIEW') marked++;
      else if (s === 'NOT_ANSWERED')  notAnswered++;
      else notVisited++;
    });
    const set = (id, v) => { const el = getEl(id); if (el) el.textContent = v; };
    set('cntAnswered', answered);
    set('cntNotAnswered', notAnswered);
    set('cntNotVisited', notVisited);
    set('cntMarked', marked);
  }

  // ──────────────────────────────────────────────────────────────
  // Answer saving
  // ──────────────────────────────────────────────────────────────
  async function saveCurrentAnswer(isMarkedForReview = false) {
    if (!questions.length) return;
    const q = questions[currentIndex];
    const selected = document.querySelector('input[name="examOption"]:checked');
    const responseValue = selected ? selected.value : state[q.id].selectedOption;

    state[q.id].selectedOption = responseValue;
    state[q.id].status = isMarkedForReview
      ? 'MARKED_REVIEW'
      : (responseValue ? 'ANSWERED' : 'NOT_ANSWERED');

    try {
      await Api.request('/attempts/save-answer', {
        method: 'POST',
        body: JSON.stringify({
          attempt_id: attemptId,
          question_id: q.id,
          response: responseValue,
          is_marked_for_review: isMarkedForReview
        })
      });
    } catch(e) { /* best-effort sync */ }
  }

  // ──────────────────────────────────────────────────────────────
  // Button wiring
  // ──────────────────────────────────────────────────────────────
  const saveNextBtn = getEl('btnSaveNext', 'save-next-btn');
  if (saveNextBtn) {
    saveNextBtn.addEventListener('click', async () => {
      await saveCurrentAnswer(false);
      if (currentIndex < questions.length - 1) loadQuestion(currentIndex + 1);
      else { renderPalette(); updateCounters(); }
    });
  }

  const markReviewBtn = getEl('btnMarkReview', 'mark-review-btn');
  if (markReviewBtn) {
    markReviewBtn.addEventListener('click', async () => {
      await saveCurrentAnswer(true);
      if (currentIndex < questions.length - 1) loadQuestion(currentIndex + 1);
      else { renderPalette(); updateCounters(); }
    });
  }

  const clearBtn = getEl('btnClear', 'clear-response-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const q = questions[currentIndex];
      state[q.id].selectedOption = null;
      state[q.id].status = 'NOT_ANSWERED';
      document.querySelectorAll('input[name="examOption"]').forEach(r => r.checked = false);
      renderPalette();
      updateCounters();
    });
  }

  const submitBtn = getEl('btnSubmitExam', 'submit-exam-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const unanswered = Object.values(state).filter(s => s.status !== 'ANSWERED').length;
      const confirmMsg = unanswered > 0
        ? `You have ${unanswered} unanswered question(s).\nAre you sure you want to submit?`
        : 'Are you sure you want to submit your examination?';
      if (confirm(confirmMsg)) autoSubmitExam();
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Exam submission & 🔓 LOCKDOWN RELEASE
  // ──────────────────────────────────────────────────────────────
  async function autoSubmitExam() {
    if (examSubmitted) return;   // prevent double-submit
    examSubmitted = true;

    if (timerInterval) clearInterval(timerInterval);

    // Stop proctoring camera
    if (camVideo && camVideo.srcObject) {
      camVideo.srcObject.getTracks().forEach(t => t.stop());
    }

    let scoreMsg = '';
    try {
      const res = await Api.request('/attempts/submit', {
        method: 'POST',
        body: JSON.stringify({ attempt_id: attemptId })
      });
      scoreMsg = `Your Score: ${res.score !== undefined ? res.score : '—'}`;
    } catch(err) {
      scoreMsg = `Submission note: ${err.message}`;
    }

    // 🔓 Release kiosk lockdown BEFORE navigating away
    ipcSend('exit-kiosk-mode');

    // Also exit browser fullscreen
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch(e) {}

    // Clean up exam session data
    localStorage.removeItem('active_exam_id');
    localStorage.removeItem('verified_snapshot');

    alert(`✅ Exam submitted successfully!\n${scoreMsg}`);

    window.location.href = 'dashboard.html';
  }

  // Used by exam.js Android handler
  window.autoSubmitTest = autoSubmitExam;

});
