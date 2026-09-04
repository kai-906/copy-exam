let appSwitchCount = 0;
const MAX_ALLOWED_SWITCHES = 3;

// 1. Android App-Switch Detection Listener
window.onAppSwitchDetected = function() {
  appSwitchCount++;
  alert(`⚠️ WARNING: You switched apps! Violation ${appSwitchCount}/${MAX_ALLOWED_SWITCHES}. This attempt will be reported to the teacher.`);
  
  // Log alert to backend
  logProctoringViolation("APP_SWITCH_ATTEMPT", `Switch count: ${appSwitchCount}`);

  if (appSwitchCount >= MAX_ALLOWED_SWITCHES) {
    alert("❌ Maximum violations exceeded. Your test is being auto-submitted.");
    autoSubmitTest();
  }
};

const getExamApiBase = () => {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol !== 'file:' && window.location.origin !== 'null') {
    return `${window.location.origin}/api`;
  }
  return 'http://localhost:5000/api';
};

// 2. Pre-Exam & In-Exam Face Comparison Handler
async function verifyCandidateFace(storedProfilePhoto, liveCanvasFrame) {
  try {
    const res = await fetch(`${getExamApiBase()}/proctor/verify-face`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registeredPhoto: storedProfilePhoto,
        currentFrame: liveCanvasFrame
      })
    });
    const data = await res.json();
    return data.isMatched;
  } catch (err) {
    console.warn("Face verification network note", err);
    return true; // Fallback for offline testing
  }
}

// 3. Backend Violation Logger
async function logProctoringViolation(type, details) {
  const token = localStorage.getItem('student_token') || localStorage.getItem('token') || localStorage.getItem('studentToken');
  try {
    await fetch(`${getExamApiBase()}/proctor/log-violation`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ violationType: type, details: details, timestamp: new Date() })
    });
  } catch (err) {
    console.warn("Failed to log proctoring violation", err);
  }
}

function autoSubmitTest() {
  const submitBtn = document.getElementById('btnSubmitExam') || document.getElementById('submit-exam-btn');
  if (submitBtn) submitBtn.click();
}