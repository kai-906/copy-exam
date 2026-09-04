const { Server } = require('socket.io');

let io = null;

exports.init = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    // Student joins an exam proctoring room
    socket.on('student:join', ({ examId, studentId, studentName }) => {
      socket.join(`exam:${examId}`);
      socket.examId = examId;
      socket.studentId = studentId;
      socket.studentName = studentName;

      // Notify teacher monitor room
      io.to(`monitor:${examId}`).emit('proctor:student-online', {
        studentId,
        studentName,
        socketId: socket.id,
        timestamp: new Date()
      });
    });

    // Teacher joins the monitoring room for a specific exam
    socket.on('teacher:monitor', ({ examId }) => {
      socket.join(`monitor:${examId}`);
    });

    // Student sends proctoring alert (e.g., focus lost, fullscreen exit)
    socket.on('student:alert', ({ examId, studentId, eventType, details }) => {
      io.to(`monitor:${examId}`).emit('proctor:alert', {
        studentId,
        studentName: socket.studentName || studentId,
        eventType,
        details,
        timestamp: new Date()
      });
    });

    // Teacher sends direct warning to a student
    socket.on('teacher:warn-student', ({ examId, studentId, message }) => {
      io.to(`exam:${examId}`).emit('student:receive-warning', {
        targetStudentId: studentId,
        message
      });
    });

    // Disconnect event
    socket.on('disconnect', () => {
      if (socket.examId && socket.studentId) {
        io.to(`monitor:${socket.examId}`).emit('proctor:student-offline', {
          studentId: socket.studentId,
          timestamp: new Date()
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