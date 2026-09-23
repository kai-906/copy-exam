const { Server } = require('socket.io');

let io = null;

exports.init = (server) => {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 2e6   // 2 MB — allow camera frames
  });

  io.on('connection', (socket) => {

    /* ── Student joins exam room ──────────────────────────────── */
    socket.on('student:join', ({ examId, studentId, studentName }) => {
      socket.join(`exam:${examId}`);
      socket.join(`student:${studentId}`);   // personal room for DMs
      socket.examId      = examId;
      socket.studentId   = studentId;
      socket.studentName = studentName || studentId;

      io.to(`monitor:${examId}`).emit('proctor:student-online', {
        studentId, studentName: socket.studentName,
        socketId: socket.id, timestamp: new Date()
      });
    });

    /* ── Teacher joins monitoring room ───────────────────────── */
    socket.on('teacher:monitor', ({ examId }) => {
      socket.join(`monitor:${examId}`);
      socket.monitorExamId = examId;
    });

    /* ── Student sends proctoring alert ──────────────────────── */
    socket.on('student:alert', ({ examId, studentId, eventType, details }) => {
      io.to(`monitor:${examId}`).emit('proctor:alert', {
        studentId, studentName: socket.studentName || studentId,
        eventType, details, timestamp: new Date()
      });
    });

    /* ── Student streams camera frame (base64 JPEG) ──────────── */
    socket.on('student:camera-frame', ({ examId, studentId, frame }) => {
      io.to(`monitor:${examId}`).emit('proctor:camera-frame', {
        studentId, studentName: socket.studentName || studentId,
        frame, timestamp: new Date()
      });
    });

    /* ── Student sends face-match result ─────────────────────── */
    socket.on('student:face-result', ({ examId, studentId, matched, confidence }) => {
      io.to(`monitor:${examId}`).emit('proctor:face-result', {
        studentId, studentName: socket.studentName || studentId,
        matched, confidence, timestamp: new Date()
      });
    });

    /* ── Teacher broadcasts announcement to whole exam ───────── */
    socket.on('teacher:announce', ({ examId, message }) => {
      io.to(`exam:${examId}`).emit('announcement', {
        type: 'BROADCAST', message, timestamp: new Date()
      });
      /* Echo back to teacher monitor room so teacher sees their own msg */
      io.to(`monitor:${examId}`).emit('announcement:sent', {
        type: 'BROADCAST', message, timestamp: new Date()
      });
    });

    /* ── Teacher sends individual message to one student ─────── */
    socket.on('teacher:dm', ({ examId, studentId, message }) => {
      io.to(`student:${studentId}`).emit('announcement', {
        type: 'INDIVIDUAL', message, timestamp: new Date()
      });
      io.to(`monitor:${examId}`).emit('announcement:sent', {
        type: 'INDIVIDUAL', targetStudentId: studentId, message, timestamp: new Date()
      });
    });

    /* ── Teacher warns a student (old event kept for compat) ──── */
    socket.on('teacher:warn-student', ({ examId, studentId, message }) => {
      io.to(`student:${studentId}`).emit('student:receive-warning', {
        targetStudentId: studentId, message
      });
    });

    /* ── Teacher terminates a student's exam ─────────────────── */
    socket.on('teacher:terminate-student', ({ examId, studentId, reason }) => {
      io.to(`student:${studentId}`).emit('exam:terminated', {
        reason: reason || 'Terminated by proctor.'
      });
      io.to(`monitor:${examId}`).emit('proctor:terminated', {
        studentId, reason, timestamp: new Date()
      });
    });

    /* ── Disconnect ──────────────────────────────────────────── */
    socket.on('disconnect', () => {
      if (socket.examId && socket.studentId) {
        io.to(`monitor:${socket.examId}`).emit('proctor:student-offline', {
          studentId: socket.studentId, timestamp: new Date()
        });
      }
    });
  });

  return io;
};

exports.getIO = () => {
  if (!io) throw new Error('Socket.io not initialized!');
  return io;
};
