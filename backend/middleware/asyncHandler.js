/**
 * Wraps an async/sync route handler so that any thrown error
 * is forwarded to Express's global error middleware instead of
 * crashing the process or leaking raw stack traces.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
