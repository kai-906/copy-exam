const video = document.getElementById('regWebcam');
const photoPreview = document.getElementById('regPhotoPreview');
const photoDataInput = document.getElementById('regPhotoData');
const snapBtn = document.getElementById('btnSnapPhoto');
let cameraStream = null;

// Initialize Camera
navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then((stream) => {
    cameraStream = stream;
    video.srcObject = stream;
  })
  .catch((err) => {
    console.error('Camera Access Failed:', err);
    if (snapBtn) snapBtn.textContent = '📷 Camera Unavailable';
  });

// Snap Live Photo
if (snapBtn) {
  snapBtn.addEventListener('click', () => {
    if (!cameraStream) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const base64Image = canvas.toDataURL('image/jpeg', 0.82);
    photoDataInput.value = base64Image;
    photoPreview.src = base64Image;

    video.classList.add('hidden');
    photoPreview.classList.remove('hidden');
    snapBtn.innerText = '🔄 Retake Photo';
    snapBtn.addEventListener('click', () => {
      video.classList.remove('hidden');
      photoPreview.classList.add('hidden');
      photoDataInput.value = '';
    }, { once: true });
  });
}

// Alert helper
function showAlert(msg, isError = true) {
  const el = document.getElementById('reg-alert');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.className = isError
    ? 'reg-alert error'
    : 'reg-alert success';
  el.style.display = 'block';
}

// Form Submit Handler
const form = document.getElementById('registrationForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!photoDataInput.value) {
      showAlert('📸 Please capture your live verification photo before submitting!');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Registering…';
    }

    const rollVal = document.getElementById('regRollNo').value.trim();
    const payload = {
      name:         document.getElementById('regName').value.trim(),
      roll_number:  rollVal,
      rollNo:       rollVal,
      branch:       document.getElementById('regBranch').value.trim(),
      year:         document.getElementById('regYear').value.trim(),
      email:        document.getElementById('regEmail').value.trim(),
      password:     document.getElementById('regPassword').value,
      photo:        photoDataInput.value
    };

    // Use unified Api helper (correctly resolves LAN IP on Android)
    const apiBase = (window.Api && window.Api.getApiBase)
      ? window.Api.getApiBase()
      : (() => {
          const saved = localStorage.getItem('server_url');
          if (saved && saved.startsWith('http')) return saved.replace(/\/$/, '') + '/api';
          if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol !== 'file:' && window.location.origin !== 'null') {
            return `${window.location.origin}/api`;
          }
          return 'http://localhost:5000/api';
        })();

    try {
      const res = await fetch(`${apiBase}/auth/student/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Detect HTML responses (wrong server URL)
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error(
          `Cannot reach the exam server. Check your Server Settings (⚙️). Current API: ${apiBase}`
        );
      }

      const data = await res.json();
      if (res.ok) {
        showAlert('✅ Registration Successful! Redirecting to login…', false);
        // Stop camera before leaving
        if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
      } else {
        showAlert('Registration Error: ' + (data.error || data.message || 'Unknown error'));
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Complete Registration →'; }
      }
    } catch (err) {
      showAlert('Network Error: ' + err.message);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Complete Registration →'; }
    }
  });
}