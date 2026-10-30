export class ApiError extends Error {
  constructor(status, message, details = null, code = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export const badRequest = (msg, details) => new ApiError(400, msg, details);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, msg);
export const forbidden = (msg = 'You do not have permission to perform this action') => new ApiError(403, msg);
export const notFound = (msg = 'Resource not found') => new ApiError(404, msg);
export const conflict = (msg, details) => new ApiError(409, msg, details);

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code || undefined,
      details: err.details || undefined,
    });
  }
  if (err?.name === 'ZodError') {
    return res.status(422).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (String(err?.code || '').startsWith('SQLITE_CONSTRAINT')) {
    const friendly = /UNIQUE/.test(err.code + err.message)
      ? 'A record with these details already exists'
      : 'This change conflicts with existing data';
    return res.status(409).json({ error: friendly, details: err.message });
  }
  console.error('[error]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: 'Something went wrong on the server' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
}
