const db = require('../db');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');

// Get overall analytics summary for a specific exam
exports.getExamAnalytics = (req, res) => {
  const { examId } = req.params;

  const query = `
    SELECT 
      ea.id AS attempt_id,
      ea.status,
      ea.total_score,
      ea.start_time,
      ea.end_time,
      sp.name AS student_name,
      sp.roll_number,
      sp.branch,
      sp.year
    FROM ExamAttempts ea
    JOIN StudentProfiles sp ON ea.student_id = sp.student_id
    WHERE ea.exam_id = ?
    ORDER BY ea.total_score DESC
  `;

  db.all(query, [examId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const totalAttempts = rows.length;
    const submittedAttempts = rows.filter(r => r.status === 'SUBMITTED');
    const averageScore = submittedAttempts.length > 0 
      ? (submittedAttempts.reduce((acc, curr) => acc + curr.total_score, 0) / submittedAttempts.length).toFixed(2)
      : 0;

    const highestScore = submittedAttempts.length > 0 
      ? Math.max(...submittedAttempts.map(r => r.total_score))
      : 0;

    res.json({
      summary: {
        totalCandidates: totalAttempts,
        completedCount: submittedAttempts.length,
        averageScore: parseFloat(averageScore),
        highestScore
      },
      results: rows
    });
  });
};

// Export exam results in XLSX or CSV format
exports.exportResultsFormat = (req, res) => {
  const { examId } = req.params;
  const format = req.query.format || 'xlsx';

  const query = `
    SELECT 
      sp.roll_number AS "Roll Number",
      sp.name AS "Student Name",
      sp.branch AS "Branch",
      sp.year AS "Year",
      ea.status AS "Attempt Status",
      ea.total_score AS "Total Marks Obtained",
      ea.start_time AS "Start Time",
      ea.end_time AS "Submission Time"
    FROM ExamAttempts ea
    JOIN StudentProfiles sp ON ea.student_id = sp.student_id
    WHERE ea.exam_id = ?
    ORDER BY sp.roll_number ASC
  `;

  db.all(query, [examId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Exam Results");

    if (format.toLowerCase() === 'csv') {
      const csvBuffer = xlsx.write(workbook, { bookType: 'csv', type: 'buffer' });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="Exam_Result_${examId}.csv"`);
      return res.send(csvBuffer);
    } else if (format.toLowerCase() === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Exam_Result_${examId}.pdf"`);

      const doc = new PDFDocument({ margin: 30 });
      doc.pipe(res);

      doc.fontSize(16).text(`Exam Results Report`, { align: 'center' });
      doc.fontSize(10).text(`Exam ID: ${examId}`, { align: 'center' });
      doc.moveDown(2);

      // Table Header
      doc.fontSize(10).font('Helvetica-Bold');
      const startX = 30;
      let y = doc.y;
      
      doc.text('Roll No', startX, y, { width: 70 });
      doc.text('Name', startX + 70, y, { width: 120 });
      doc.text('Branch', startX + 190, y, { width: 80 });
      doc.text('Score', startX + 270, y, { width: 60 });
      doc.text('Status', startX + 330, y, { width: 80 });
      
      doc.moveDown(0.5);
      doc.moveTo(startX, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.5);

      // Table Rows
      doc.font('Helvetica');
      rows.forEach(r => {
        y = doc.y;
        if (y > 700) { doc.addPage(); y = doc.y; }

        doc.text(r['Roll Number'] || 'N/A', startX, y, { width: 70 });
        doc.text(r['Student Name'] || 'N/A', startX + 70, y, { width: 120 });
        doc.text(r['Branch'] || 'N/A', startX + 190, y, { width: 80 });
        doc.text(String(r['Total Marks Obtained'] || 0), startX + 270, y, { width: 60 });
        doc.text(r['Attempt Status'] || 'N/A', startX + 330, y, { width: 80 });
        doc.moveDown(1);
      });

      doc.end();
      return;
    }

    const excelBuffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Exam_Result_${examId}.xlsx"`);
    res.send(excelBuffer);
  });
};