import { Router } from 'express';
import { uploader, publicUrl } from '../lib/upload.js';
import { badRequest, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const router = Router();

const BUCKETS = new Set(['branding', 'documents', 'materials', 'homework', 'submissions', 'imports', 'avatars', 'website', 'expenses']);

/** Generic single-file upload. Field name: file. */
router.post('/', (req, res, next) => {
  const bucket = BUCKETS.has(String(req.query.bucket)) ? String(req.query.bucket) : 'documents';
  req.uploadBucket = bucket;
  uploader(bucket, { maxMb: Number(req.query.maxMb) || 10 })(req, res, next);
}, asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  const url = publicUrl(req.file);
  audit(req, { action: 'upload', module: 'files', entityType: 'file', entityId: url, summary: `Uploaded ${req.file.originalname}`, meta: { bucket: req.uploadBucket, size: req.file.size } });
  res.status(201).json({
    url,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  });
}));

export default router;
