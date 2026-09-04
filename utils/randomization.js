const crypto = require('crypto');

function generateSeed(studentId, examId) {
  const hash = crypto.createHash('sha256').update(`${studentId}:${examId}`).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

function seededRandom(seed) {
  let state = seed;
  return function () {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function shuffleArray(array, rng) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

exports.generateStudentPaper = (allQuestions, requiredCount, studentId, examId, shuffleOptions = true) => {
  const seed = generateSeed(studentId, examId);
  const rng = seededRandom(seed);

  const shuffledQuestions = shuffleArray(allQuestions, rng);
  const selectedQuestions = shuffledQuestions.slice(0, Math.min(requiredCount, shuffledQuestions.length));

  return selectedQuestions.map((q, index) => {
    let options = [];
    try {
      options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    } catch (e) {
      options = [];
    }

    if (shuffleOptions && Array.isArray(options) && options.length > 0) {
      options = shuffleArray(options, rng);
    }

    return {
      ...q,
      sequence_order: index + 1,
      shuffled_options: JSON.stringify(options)
    };
  });
};