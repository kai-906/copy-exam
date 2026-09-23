document.addEventListener('DOMContentLoaded', async () => {
  // 1. Authentication Check
  if (!Api.getToken()) {
    window.location.href = '/teacher/login.html';
    return;
  }

  // DOM Element Bindings
  const logoutBtn = document.getElementById('logout-btn');
  const uploadForm = document.getElementById('upload-form');
  const examForm = document.getElementById('exam-form');
  const bankSelect = document.getElementById('exam-bank-select');

  let currentExamResults = [];
  let allStudentsDirectory = [];

  // 2. Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      Api.clearToken();
      window.location.href = '/teacher/login.html';
    });
  }

  // 3. Load Question Banks (Form Dropdown)
  async function loadQuestionBanks() {
    if (!bankSelect) return;
    try {
      const data = await Api.getBanks();
      bankSelect.innerHTML = '<option value="">-- Select Bank --</option>';
      data.banks.forEach(bank => {
        const opt = document.createElement('option');
        opt.value = bank.id;
        opt.textContent = `${bank.title} (${bank.subject})`;
        bankSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Failed to load banks:', err);
    }
  }

  // 4. Question Bank Upload Handler
  if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusBox = document.getElementById('upload-status');
      if (statusBox) statusBox.textContent = 'Parsing file... Please wait.';

      const formData = new FormData();
      formData.append('title', document.getElementById('bank-title').value);
      formData.append('subject', document.getElementById('bank-subject').value);
      formData.append('file', document.getElementById('bank-file').files[0]);

      try {
        const res = await Api.uploadBank(formData);
        if (statusBox) statusBox.textContent = `Success! Created bank with ${res.totalQuestions} questions.`;
        uploadForm.reset();
        loadQuestionBanks();
      } catch (err) {
        if (statusBox) statusBox.textContent = `Error: ${err.message}`;
      }
    });
  }

  // 5. Create Exam & Generate Deep Link Handler
  if (examForm) {
    examForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusBox = document.getElementById('exam-status');
      if (statusBox) statusBox.textContent = 'Generating exam...';

      const examData = {
        title: document.getElementById('exam-title').value,
        bank_id: bankSelect.value,
        duration_minutes: parseInt(document.getElementById('exam-duration').value),
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 86400000).toISOString(),
        pool_size: 50,
        required_attempts_count: parseInt(document.getElementById('exam-questions-count').value),
        shuffle_questions: true,
        shuffle_options: true,
        proctoring_level: 'STRICT'
      };

      try {
        const res = await Api.createExam(examData);
        if (statusBox) {
          statusBox.innerHTML = `Exam Created!<br><strong>Deep Link:</strong> <a class="text-blue-400 underline" href="${res.accessLink}">${res.accessLink}</a>`;
        }
        examForm.reset();
        loadExamsGrid(); // Refresh exam list
      } catch (err) {
        if (statusBox) statusBox.textContent = `Error: ${err.message}`;
      }
    });
  }

  // -------------------------------------------------------------
  // PHASE 4 ENHANCEMENTS: EXAMS LIST, RESULTS & EXPORTS
  // -------------------------------------------------------------

  // 6. Fetch & Render Exams List Grid
  async function loadExamsGrid() {
    const grid = document.getElementById('examsGrid');
    if (!grid) return;

    try {
      const res = await fetch('/api/teacher/exams', {
        headers: { 'Authorization': `Bearer ${Api.getToken()}` }
      });
      const exams = await res.json();

      grid.innerHTML = exams.map(e => `
        <div class="stat-card cursor-pointer hover:border-blue-500" onclick="viewExamDetails('${e.id}', '${e.title}')">
          <h4 class="text-xs text-gray-400">${e.code || 'CBT EXAM'}</h4>
          <p class="stat-number text-lg font-bold">${e.title}</p>
          <small class="text-blue-400 mt-2 block">Click to view results & export</small>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to fetch exams list:', err);
    }
  }

  // 7. View Selected Exam Student Scores
  window.viewExamDetails = async function(examId, title) {
    const titleEl = document.getElementById('selectedExamTitle');
    const listView = document.getElementById('examListView');
    const detailView = document.getElementById('examDetailView');

    if (titleEl) titleEl.innerText = title;
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');

    try {
      const res = await fetch(`/api/teacher/exam-results/${examId}`, {
        headers: { 'Authorization': `Bearer ${Api.getToken()}` }
      });
      currentExamResults = await res.json();

      const tbody = document.getElementById('resultsTableBody');
      if (tbody) {
        tbody.innerHTML = currentExamResults.map(r => `
          <tr>
            <td class="px-4 py-2">${r.roll_number}</td>
            <td class="px-4 py-2">${r.name}</td>
            <td class="px-4 py-2">${r.branch}</td>
            <td class="px-4 py-2">${r.year}</td>
            <td class="px-4 py-2">${r.score} / ${r.total_marks}</td>
            <td class="px-4 py-2">
              <span class="status-badge ${r.score >= r.pass_marks ? 'pass' : 'fail'}">
                ${r.score >= r.pass_marks ? 'PASSED' : 'FAILED'}
              </span>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Failed to load exam results:', err);
    }
  };

  window.backToExamList = function() {
    document.getElementById('examDetailView').classList.add('hidden');
    document.getElementById('examListView').classList.remove('hidden');
  };

  // 8. Multi-Format Data Export Handler (Excel / PDF / Doc)
  window.exportResults = function(format) {
    if (!currentExamResults || !currentExamResults.length) {
      alert("No student results available to export!");
      return;
    }

    const title = document.getElementById('selectedExamTitle')?.innerText || 'Exam_Results';

    if (format === 'excel') {
      const ws = XLSX.utils.json_to_sheet(currentExamResults);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Results");
      XLSX.writeFile(wb, `${title}_Results.xlsx`);
    } 
    else if (format === 'pdf') {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.text(`Exam Results: ${title}`, 10, 10);
      
      let y = 20;
      currentExamResults.forEach((r, idx) => {
        doc.text(`${idx + 1}. ${r.roll_number} - ${r.name} (${r.branch}) : ${r.score} Marks`, 10, y);
        y += 8;
      });
      doc.save(`${title}_Results.pdf`);
    }
    else if (format === 'doc') {
      let html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><title>Export</title></head><body><h2>Results: ${title}</h2><table border='1'><tr><th>Roll No</th><th>Name</th><th>Branch</th><th>Year</th><th>Score</th></tr>`;
      currentExamResults.forEach(r => {
        html += `<tr><td>${r.roll_number}</td><td>${r.name}</td><td>${r.branch}</td><td>${r.year}</td><td>${r.score}</td></tr>`;
      });
      html += "</table></body></html>";

      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}_Results.doc`;
      a.click();
    }
  };

  // -------------------------------------------------------------
  // STUDENT DIRECTORY & PHOTO MODAL HANDLERS
  // -------------------------------------------------------------

  // 9. Fetch Registered Students Directory
  async function loadStudentsDirectory() {
    try {
      const res = await fetch('/api/teacher/students', {
        headers: { 'Authorization': `Bearer ${Api.getToken()}` }
      });
      allStudentsDirectory = await res.json();
      renderStudentsDirectory(allStudentsDirectory);
    } catch (err) {
      console.error('Failed to load students directory:', err);
    }
  }

  function renderStudentsDirectory(data) {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;

    tbody.innerHTML = data.map(s => `
      <tr>
        <td class="px-4 py-2">${s.roll_number}</td>
        <td class="px-4 py-2">${s.name}</td>
        <td class="px-4 py-2">${s.branch}</td>
        <td class="px-4 py-2">${s.year}</td>
        <td class="px-4 py-2">${s.email}</td>
        <td class="px-4 py-2">
          <button class="btn btn-purple btn-sm" onclick="showStudentPhoto('${s.name}', '${s.profile_photo}')">
            📷 View Photo
          </button>
        </td>
      </tr>
    `).join('');
  }

  // 10. Filter Students by Branch and Year
  window.filterStudents = function() {
    const branchFilter = document.getElementById('filterBranch')?.value.toLowerCase() || '';
    const yearFilter = document.getElementById('filterYear')?.value.toLowerCase() || '';

    const filtered = allStudentsDirectory.filter(s => 
      (s.branch || '').toLowerCase().includes(branchFilter) &&
      (s.year || '').toString().includes(yearFilter)
    );
    renderStudentsDirectory(filtered);
  };

  // 11. Modal Window Photo Viewer
  window.showStudentPhoto = function(name, photoBase64) {
    const modal = document.getElementById('photoModal');
    const modalName = document.getElementById('modalStudentName');
    const modalImg = document.getElementById('modalStudentPhoto');

    if (modalName) modalName.innerText = name;
    if (modalImg) modalImg.src = photoBase64 || 'assets/default-avatar.png';
    if (modal) modal.classList.remove('hidden');
  };

  window.closePhotoModal = function() {
    const modal = document.getElementById('photoModal');
    if (modal) modal.classList.add('hidden');
  };

  // Initial Load Actions
  loadQuestionBanks();
  loadExamsGrid();
  loadStudentsDirectory();
});