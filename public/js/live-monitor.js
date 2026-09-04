document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const urlParams = new URLSearchParams(window.location.search);
  const examId = urlParams.get('examId');

  const studentListEl = document.getElementById('student-list');
  const eventLogEl = document.getElementById('event-log');
  const countEl = document.getElementById('candidate-count');
  const examLabel = document.getElementById('active-exam-label');

  if (examId) {
    examLabel.textContent = `Exam ID: ${examId}`;
    socket.emit('teacher:monitor', { examId });
  }

  const activeStudents = new Map();

  function logEvent(text, isError = false) {
    const div = document.createElement('div');
    div.className = isError ? 'text-red-400 font-bold' : 'text-green-400';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    eventLogEl.appendChild(div);
    eventLogEl.scrollTop = eventLogEl.scrollHeight;
  }

  socket.on('proctor:student-online', ({ studentId, studentName }) => {
    activeStudents.set(studentId, studentName || studentId);
    renderStudents();
    logEvent(`Student Connected: ${studentName || studentId}`);
  });

  socket.on('proctor:student-offline', ({ studentId }) => {
    activeStudents.delete(studentId);
    renderStudents();
    logEvent(`Student Disconnected: ${studentId}`, true);
  });

  socket.on('proctor:alert', ({ studentId, studentName, eventType, details }) => {
    logEvent(`ALERT [${eventType}] - ${studentName}: ${details || 'Potential Violation'}`, true);
  });

  function renderStudents() {
    countEl.textContent = activeStudents.size;
    studentListEl.innerHTML = '';
    activeStudents.forEach((name, id) => {
      const item = document.createElement('div');
      item.className = 'bg-gray-900 p-3 rounded flex justify-between items-center text-xs';
      item.innerHTML = `<div><div class="font-bold text-white">${name}</div><div class="text-gray-500 font-mono">${id}</div></div> <span class="bg-green-900 text-green-300 px-2 py-0.5 rounded">ONLINE</span>`;
      studentListEl.appendChild(item);
    });
  }

  document.getElementById('send-warn-btn').addEventListener('click', () => {
    const targetStudentId = document.getElementById('warn-student-id').value;
    const message = document.getElementById('warn-message').value;

    if (targetStudentId && message && examId) {
      socket.emit('teacher:warn-student', { examId, studentId: targetStudentId, message });
      logEvent(`Warning sent to ${targetStudentId}: "${message}"`);
      document.getElementById('warn-message').value = '';
    }
  });
});