'use strict';
// Format response konsisten:
//   sukses: { success: true,  data: ... }
//   gagal : { success: false, error: { code, message } }

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sendOk = (res, data, status = 200) => res.status(status).json({ success: true, data });
const sendError = (res, status, code, message) =>
  res.status(status).json({ success: false, error: { code, message } });

function notFound(req, res) {
  sendError(res, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return;
  if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
  if (err && err.type === 'entity.parse.failed') return sendError(res, 400, 'BAD_JSON', 'Body bukan JSON yang valid');
  if (err && err.type === 'entity.too.large') return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Body terlalu besar');
  console.error('[error]', err);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan internal');
}

module.exports = { HttpError, sendOk, sendError, notFound, errorHandler };
