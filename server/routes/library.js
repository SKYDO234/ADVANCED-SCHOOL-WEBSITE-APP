import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId, getSetting } from '../db/index.js';
import { validateBody, pagination, searchTerm, sorting } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sendTable } from '../lib/export.js';

const router = Router();

/* ------------------------------- categories ------------------------------- */

router.get('/categories', requirePermission('library.view'), asyncHandler(async (req, res) => {
  const items = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM books b WHERE b.category_id = c.id) books
     FROM book_categories c WHERE c.school_id = ? ORDER BY c.name`,
  ).all(req.user.school_id);
  res.json({ items });
}));

router.post('/categories', requirePermission('library.manage'), validateBody(z.object({ name: z.string().min(2).max(60) })), asyncHandler(async (req, res) => {
  const exists = db.prepare('SELECT id FROM book_categories WHERE school_id = ? AND lower(name) = lower(?)').get(req.user.school_id, req.data.name);
  if (exists) throw conflict('Category already exists');
  const id = newId('bct');
  db.prepare('INSERT INTO book_categories (id, school_id, name) VALUES (?,?,?)').run(id, req.user.school_id, req.data.name);
  res.status(201).json({ id });
}));

router.delete('/categories/:id', requirePermission('library.manage'), asyncHandler(async (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM books WHERE category_id = ?').get(req.params.id).c;
  if (used) throw conflict('Category has books assigned');
  db.prepare('DELETE FROM book_categories WHERE id = ? AND school_id = ?').run(req.params.id, req.user.school_id);
  res.json({ ok: true });
}));

/* ---------------------------------- books --------------------------------- */

router.get('/books', requirePermission('library.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const q = searchTerm(req);
  const { clause } = sorting(req, ['title', 'author', 'created_at', 'available_copies'], 'title');
  const where = ['b.school_id = ?'];
  const params = [req.user.school_id];
  if (q) {
    where.push('(b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ? OR b.publisher LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.categoryId && req.query.categoryId !== 'all') { where.push('b.category_id = ?'); params.push(req.query.categoryId); }
  if (req.query.availability === 'available') where.push('b.available_copies > 0');
  if (req.query.availability === 'out') where.push('b.available_copies = 0');
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM books b ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT b.*, c.name AS category_name,
       (SELECT COUNT(*) FROM book_issues bi WHERE bi.book_id = b.id AND bi.status IN ('issued','overdue')) issued_count
     FROM books b LEFT JOIN book_categories c ON c.id = b.category_id
     ${whereSql} ORDER BY b.${clause} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

const bookSchema = z.object({
  title: z.string().min(1).max(200),
  author: z.string().max(120).optional().default(''),
  isbn: z.string().max(30).optional().default(''),
  publisher: z.string().max(120).optional().default(''),
  category_id: z.string().nullish(),
  edition: z.string().max(40).optional().default(''),
  rack: z.string().max(30).optional().default(''),
  total_copies: z.coerce.number().int().min(1).max(9999).optional().default(1),
  price: z.coerce.number().min(0).optional().default(0),
});

router.post('/books', requirePermission('library.manage'), validateBody(bookSchema), asyncHandler(async (req, res) => {
  const id = newId('bok');
  const at = nowIso();
  db.prepare(
    `INSERT INTO books (id, school_id, title, author, isbn, publisher, category_id, edition, rack, total_copies,
      available_copies, price, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, req.data.title, req.data.author, req.data.isbn, req.data.publisher,
    req.data.category_id || null, req.data.edition, req.data.rack, req.data.total_copies, req.data.total_copies,
    req.data.price, at, at);
  audit(req, { action: 'create', module: 'library', entityType: 'book', entityId: id, summary: `Added book "${req.data.title}"` });
  res.status(201).json({ id });
}));

router.patch('/books/:id', requirePermission('library.manage'), validateBody(bookSchema.partial()), asyncHandler(async (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!book) throw notFound('Book not found');
  const issued = db.prepare("SELECT COUNT(*) c FROM book_issues WHERE book_id = ? AND status IN ('issued','overdue')").get(book.id).c;
  const totalCopies = req.data.total_copies ?? book.total_copies;
  if (totalCopies < issued) throw badRequest(`${issued} copies are currently issued`);
  db.prepare(
    `UPDATE books SET title = ?, author = ?, isbn = ?, publisher = ?, category_id = ?, edition = ?, rack = ?,
      total_copies = ?, available_copies = ?, price = ?, updated_at = ? WHERE id = ?`,
  ).run(req.data.title ?? book.title, req.data.author ?? book.author, req.data.isbn ?? book.isbn,
    req.data.publisher ?? book.publisher, req.data.category_id === undefined ? book.category_id : req.data.category_id,
    req.data.edition ?? book.edition, req.data.rack ?? book.rack, totalCopies, totalCopies - issued,
    req.data.price ?? book.price, nowIso(), book.id);
  audit(req, { action: 'update', module: 'library', entityType: 'book', entityId: book.id, summary: `Updated book "${req.data.title || book.title}"` });
  res.json({ ok: true });
}));

router.delete('/books/:id', requirePermission('library.manage'), asyncHandler(async (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!book) throw notFound('Book not found');
  const issued = db.prepare("SELECT COUNT(*) c FROM book_issues WHERE book_id = ? AND status IN ('issued','overdue')").get(book.id).c;
  if (issued) throw conflict('This book has copies on loan');
  db.prepare('DELETE FROM book_issues WHERE book_id = ?').run(book.id);
  db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
  audit(req, { action: 'delete', module: 'library', entityType: 'book', entityId: book.id, summary: `Deleted book "${book.title}"` });
  res.json({ ok: true });
}));

/* --------------------------------- issues --------------------------------- */

router.get('/issues', requirePermission('library.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const where = ['bi.school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.status && req.query.status !== 'all') {
    if (req.query.status === 'overdue') where.push("bi.status IN ('issued','overdue') AND date(bi.due_date) < date('now')");
    else { where.push('bi.status = ?'); params.push(req.query.status); }
  }
  if (req.query.bookId) { where.push('bi.book_id = ?'); params.push(req.query.bookId); }
  if (req.query.borrowerType) { where.push('bi.borrower_type = ?'); params.push(req.query.borrowerType); }
  const q = searchTerm(req);
  if (q) { where.push('(b.title LIKE ? OR s.full_name LIKE ? OR u.full_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(
    `SELECT COUNT(*) c FROM book_issues bi JOIN books b ON b.id = bi.book_id
     LEFT JOIN students s ON s.id = bi.borrower_id AND bi.borrower_type = 'student'
     LEFT JOIN employees e ON e.id = bi.borrower_id AND bi.borrower_type = 'employee'
     LEFT JOIN users u ON u.id = e.user_id ${whereSql}`,
  ).get(...params).c;

  const items = db.prepare(
    `SELECT bi.*, b.title, b.author, b.isbn,
       CASE WHEN bi.borrower_type = 'student' THEN s.full_name ELSE u.full_name END AS borrower_name,
       CASE WHEN bi.borrower_type = 'student' THEN s.admission_no ELSE e.employee_code END AS borrower_code,
       c.name AS class_name,
       CASE WHEN bi.status IN ('issued','overdue') AND date(bi.due_date) < date('now')
         THEN CAST(julianday('now') - julianday(bi.due_date) AS INTEGER) ELSE 0 END AS days_overdue
     FROM book_issues bi JOIN books b ON b.id = bi.book_id
     LEFT JOIN students s ON s.id = bi.borrower_id AND bi.borrower_type = 'student'
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN employees e ON e.id = bi.borrower_id AND bi.borrower_type = 'employee'
     LEFT JOIN users u ON u.id = e.user_id
     ${whereSql} ORDER BY bi.issue_date DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  const stats = db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM books WHERE school_id = ?) books,
      (SELECT COALESCE(SUM(total_copies),0) FROM books WHERE school_id = ?) copies,
      (SELECT COUNT(*) FROM book_issues WHERE school_id = ? AND status = 'issued') issued,
      (SELECT COUNT(*) FROM book_issues WHERE school_id = ? AND status IN ('issued','overdue') AND date(due_date) < date('now')) overdue,
      (SELECT COALESCE(SUM(fine),0) FROM book_issues WHERE school_id = ? AND fine_paid = 0) unpaid_fines`,
  ).get(req.user.school_id, req.user.school_id, req.user.school_id, req.user.school_id, req.user.school_id);

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, stats });
}));

router.get('/borrowers', requirePermission('library.issue'), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ students: [], employees: [] });
  const like = `%${q}%`;
  res.json({
    students: db.prepare(
      `SELECT s.id, s.full_name, s.admission_no, c.name AS class_name FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = ? AND s.status = 'active' AND (s.full_name LIKE ? OR s.admission_no LIKE ?) LIMIT 8`,
    ).all(req.user.school_id, like, like),
    employees: db.prepare(
      `SELECT e.id, u.full_name, e.employee_code, e.department FROM employees e JOIN users u ON u.id = e.user_id
       WHERE e.school_id = ? AND (u.full_name LIKE ? OR e.employee_code LIKE ?) LIMIT 8`,
    ).all(req.user.school_id, like, like),
  });
}));

router.post('/issues', requirePermission('library.issue'), validateBody(z.object({
  book_id: z.string().min(1),
  borrower_type: z.enum(['student', 'employee']),
  borrower_id: z.string().min(1),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remarks: z.string().max(200).optional().default(''),
})), asyncHandler(async (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND school_id = ?').get(req.data.book_id, req.user.school_id);
  if (!book) throw notFound('Book not found');
  if (book.available_copies < 1) throw conflict('No copies of this book are available');

  const openLoans = db.prepare(
    "SELECT COUNT(*) c FROM book_issues WHERE borrower_type = ? AND borrower_id = ? AND status IN ('issued','overdue')",
  ).get(req.data.borrower_type, req.data.borrower_id).c;
  const limit = Number(getSetting(req.user.school_id, 'library', 'maxBooksPerBorrower', 3));
  if (openLoans >= limit) throw conflict(`This borrower already has ${openLoans} book(s). Limit is ${limit}.`);

  const id = newId('bis');
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO book_issues (id, school_id, book_id, borrower_type, borrower_id, issue_date, due_date, status, issued_by, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, req.user.school_id, book.id, req.data.borrower_type, req.data.borrower_id,
      new Date().toISOString().slice(0, 10), req.data.due_date, 'issued', req.user.id, req.data.remarks || null);
    db.prepare('UPDATE books SET available_copies = available_copies - 1, updated_at = ? WHERE id = ?').run(nowIso(), book.id);
  });
  run();
  audit(req, { action: 'issue', module: 'library', entityType: 'book_issue', entityId: id, summary: `Issued "${book.title}"`, meta: { due_date: req.data.due_date } });
  res.status(201).json({ id });
}));

router.post('/issues/:id/return', requirePermission('library.issue'), validateBody(z.object({
  fine: z.coerce.number().min(0).optional().default(0),
  fine_paid: z.boolean().optional().default(false),
  condition: z.string().max(60).optional().default('good'),
})), asyncHandler(async (req, res) => {
  const issue = db.prepare('SELECT * FROM book_issues WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!issue) throw notFound('Issue record not found');
  if (issue.status === 'returned') throw conflict('This book is already returned');

  const daysLate = Math.max(0, Math.floor((Date.now() - new Date(issue.due_date)) / 86_400_000));
  const perDay = Number(getSetting(req.user.school_id, 'library', 'finePerDay', 2));
  const suggested = Math.round(daysLate * perDay * 100) / 100;
  const fine = req.data.fine || suggested;

  const run = db.transaction(() => {
    db.prepare("UPDATE book_issues SET status = 'returned', return_date = ?, fine = ?, fine_paid = ?, returned_to = ?, remarks = ? WHERE id = ?")
      .run(new Date().toISOString().slice(0, 10), fine, req.data.fine_paid ? 1 : 0, req.user.id, req.data.condition, issue.id);
    db.prepare('UPDATE books SET available_copies = available_copies + 1, updated_at = ? WHERE id = ?').run(nowIso(), issue.book_id);
  });
  run();
  audit(req, {
    action: 'return', module: 'library', entityType: 'book_issue', entityId: issue.id,
    summary: `Book returned${fine ? ` with fine ${fine}` : ''}`, meta: { daysLate, fine },
  });
  res.json({ ok: true, daysLate, fine });
}));

router.post('/issues/:id/fine', requirePermission('library.fine'), validateBody(z.object({
  fine_paid: z.boolean(),
})), asyncHandler(async (req, res) => {
  const issue = db.prepare('SELECT * FROM book_issues WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!issue) throw notFound('Issue record not found');
  db.prepare('UPDATE book_issues SET fine_paid = ? WHERE id = ?').run(req.data.fine_paid ? 1 : 0, issue.id);
  audit(req, { action: 'fine', module: 'library', entityType: 'book_issue', entityId: issue.id, summary: `Fine ${req.data.fine_paid ? 'collected' : 'marked unpaid'} (${issue.fine})` });
  res.json({ ok: true });
}));

router.get('/export/books', requirePermission('library.view'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT b.*, c.name AS category_name FROM books b LEFT JOIN book_categories c ON c.id = b.category_id
     WHERE b.school_id = ? ORDER BY b.title`,
  ).all(req.user.school_id);
  await sendTable(req, res, {
    filename: 'library-books', title: 'Library Catalogue',
    columns: [
      { label: 'Title', key: 'title' }, { label: 'Author', key: 'author' }, { label: 'ISBN', key: 'isbn' },
      { label: 'Category', key: 'category_name' }, { label: 'Publisher', key: 'publisher' },
      { label: 'Edition', key: 'edition' }, { label: 'Rack', key: 'rack' },
      { label: 'Total Copies', key: 'total_copies' }, { label: 'Available', key: 'available_copies' },
      { label: 'Price', key: 'price' },
    ],
    rows,
  });
}));

export default router;
