const video          = document.getElementById('regWebcam');
const photoPreview   = document.getElementById('regPhotoPreview');
const photoDataInput = document.getElementById('regPhotoData');
const snapBtn        = document.getElementById('btnSnapPhoto');
const form           = document.getElementById('registrationForm');
let cameraStream     = null;
let isPhotoCaptured  = false;

// ─── Initialize Camera ──────────────────────────────────────────────
async function initCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (snapBtn) {
      snapBtn.disabled = true;
      snapBtn.textContent = '📷 Camera Not Supported';
    }
    showAlert('Camera not supported on this browser/device. Please use a camera-enabled device.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    cameraStream = stream;
    if (video) video.srcObject = stream;
  } catch (err) {
    console.error('Camera Access Failed:', err);
    if (snapBtn) {
      snapBtn.textContent = '📷 Camera Access Denied';
      snapBtn.disabled = true;
    }
    showAlert('⚠️ Camera permission is required to capture your verification photo. Please allow camera access.');
  }
}

initCamera();

// ─── Snap / Retake Live Photo ───────────────────────────────────────
if (snapBtn) {
  snapBtn.addEventListener('click', () => {
    if (!isPhotoCaptured) {
      // Capture Photo
      if (!cameraStream || !video) {
        showAlert('Camera feed not ready. Please wait or check camera permissions.');
        return;
      }

      const canvas = document.createElement('canvas');
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      canvas.width = Math.min(w, 640);
      canvas.height = Math.round((canvas.width / w) * h);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64Image = canvas.toDataURL('image/jpeg', 0.85);
      photoDataInput.value = base64Image;
      photoPreview.src = base64Image;

      video.classList.add('hidden');
      photoPreview.classList.remove('hidden');

      snapBtn.textContent = '🔄 Retake Photo';
      snapBtn.classList.remove('btn-purple');
      snapBtn.classList.add('btn-sec');
      isPhotoCaptured = true;
      hideAlert();
    } else {
      // Retake Photo
      photoDataInput.value = '';
      photoPreview.src = '';
      photoPreview.classList.add('hidden');
      video.classList.remove('hidden');

      snapBtn.textContent = '📸 Capture Photo';
      snapBtn.classList.remove('btn-sec');
      snapBtn.classList.add('btn-purple');
      isPhotoCaptured = false;
    }
  });
}

// ─── Alert helper ───────────────────────────────────────────────────
function showAlert(msg, isError = true) {
  const el = document.getElementById('reg-alert');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.className = isError ? 'reg-alert error' : 'reg-alert success';
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert() {
  const el = document.getElementById('reg-alert');
  if (el) el.style.display = 'none';
}

// ─── Form Submit Handler ────────────────────────────────────────────
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    // Mandatory live photo validation
    if (!photoDataInput.value || !isPhotoCaptured) {
      showAlert('📸 Please capture your live profile verification photo before submitting!');
      return;
    }

    const submitBtn = document.getElementById('submitRegBtn') || form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Registering Account…';
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

    const apiBase = (window.Api && window.Api.getApiBase)
      ? window.Api.getApiBase()
      : 'https://copy-exam-production.up.railway.app/api';

    try {
      let res;
      try {
        res = await fetch(`${apiBase}/auth/student/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (netErr) {
        throw new Error(
          `Unable to reach exam server (${apiBase}). Check your internet connection or ⚙️ Server Settings.`
        );
      }

      // Check content-type
      const ct = res.headers.get('content-type') || '';
      let data = {};
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned unexpected response (${res.status}). Server URL: ${apiBase}`);
      }

      if (res.ok) {
        showAlert('✅ Registration successful! Redirecting to login…', false);

        // Stop camera tracks before navigating
        if (cameraStream) {
          try {
            cameraStream.getTracks().forEach(t => t.stop());
          } catch(e) {}
        }

        // Forward exam key if candidate was in an exam entry flow
        const urlParams = new URLSearchParams(window.location.search);
        const examKey = urlParams.get('key') || urlParams.get('code') || '';
        const targetUrl = examKey ? `index.html?key=${encodeURIComponent(examKey)}` : 'index.html';

        setTimeout(() => {
          window.location.href = targetUrl;
        }, 1200);
      } else {
        const err = data.error || data.message || 'Registration failed. Please check your details.';
        showAlert(`Registration Error: ${err}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Complete Registration →';
        }
      }
    } catch (err) {
      console.error('Registration Exception:', err);
      showAlert(`Error: ${err.message || 'Network request failed.'}`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Complete Registration →';
      }
    }
  });
}