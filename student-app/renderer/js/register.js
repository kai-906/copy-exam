const video = document.getElementById('regWebcam');
const photoPreview = document.getElementById('regPhotoPreview');
const photoDataInput = document.getElementById('regPhotoData');
const snapBtn = document.getElementById('btnSnapPhoto');

// Initialize Camera
navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then((stream) => { video.srcObject = stream; })
  .catch((err) => console.error("Camera Access Failed:", err));

// Snap Live Photo
snapBtn.addEventListener('click', () => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const base64Image = canvas.toDataURL('image/jpeg');
  photoDataInput.value = base64Image;
  photoPreview.src = base64Image;
  
  video.classList.add('hidden');
  photoPreview.classList.remove('hidden');
  snapBtn.innerText = "🔄 Retake Photo";
});

// Form Submit Handler
document.getElementById('registrationForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!photoDataInput.value) {
    alert("Please capture your live verification photo before submitting!");
    return;
  }

  const rollVal = document.getElementById('regRollNo').value.trim();
  const payload = {
    name: document.getElementById('regName').value.trim(),
    roll_number: rollVal,
    rollNo: rollVal,
    branch: document.getElementById('regBranch').value.trim(),
    year: document.getElementById('regYear').value.trim(),
    email: document.getElementById('regEmail').value.trim(),
    password: document.getElementById('regPassword').value,
    photo: photoDataInput.value
  };

  const API_BASE = (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null')
    ? 'http://localhost:5000/api'
    : `${window.location.origin}/api`;

  try {
    const res = await fetch(`${API_BASE}/auth/student/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (res.ok) {
      alert("Registration Successful! Please proceed to login.");
      window.location.href = "index.html";
    } else {
      alert("Registration Error: " + (data.error || data.message || 'Unknown error'));
    }
  } catch (err) {
    alert("Network Error during registration: " + err.message);
  }
});