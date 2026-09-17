import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import * as Book from '../models/book.js';
import * as User from '../models/user.js';
import * as Review from '../models/review.js';
import * as Shelf from '../models/shelf.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation helpers
//
// Hand-rolled on purpose: this project does not take a validation dependency.
// Every helper either returns a normalised value or pushes a message onto an
// `errors` array, so a handler can report every problem with a payload at once.
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

const MIN_PUBLISHED_YEAR = 1000;
const MAX_PUBLISHED_YEAR = new Date().getFullYear() + 1;

function isPlainObject(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerces an id (route param or body field) to a positive integer, or null. */
function toId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/** Coerces an integer, accepting the numeric strings a form body produces. */
function toInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function badRequest(res: Response, details: string[]): Response {
  return res.status(400).json({ error: 'Validation failed', details });
}

/** Validates a route param; responds 400 and returns null when it is malformed. */
function requireIdParam(res: Response, value: unknown, name: string): number | null {
  const id = toId(value);
  if (id === null) {
    badRequest(res, [`${name} must be a positive integer`]);
    return null;
  }
  return id;
}

/** Ensures a JSON object body; responds 400 and returns null otherwise. */
function requireBody(req: Request, res: Response): Body | null {
  if (!isPlainObject(req.body)) {
    badRequest(res, ['Request body must be a JSON object']);
    return null;
  }
  return req.body;
}

function rejectUnknownFields(body: Body, allowed: string[], errors: string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.push(`Unknown field: ${key} (allowed: ${allowed.join(', ')})`);
    }
  }
}

function isPresent(body: Body, field: string): boolean {
  return field in body && body[field] !== undefined;
}

/** Required non-empty string. Returns the trimmed value. */
function readRequiredString(body: Body, field: string, errors: string[]): string | undefined {
  if (!isPresent(body, field) || body[field] === null) {
    errors.push(`${field} is required`);
    return undefined;
  }
  const value = body[field];
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  if (value.trim() === '') {
    errors.push(`${field} must not be empty`);
    return undefined;
  }
  return value.trim();
}

/**
 * Optional string for a nullable column. Absent stays `undefined` (leave alone);
 * an explicit null or a blank string becomes `null` so blanks never masquerade
 * as values in a UNIQUE column.
 */
function readOptionalText(body: Body, field: string, errors: string[]): string | null | undefined {
  if (!isPresent(body, field)) return undefined;
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string or null`);
    return undefined;
  }
  return value.trim() === '' ? null : value.trim();
}

/** Optional string for a NOT NULL column: may be omitted, but not blanked. */
function readOptionalString(body: Body, field: string, errors: string[]): string | undefined {
  if (!isPresent(body, field)) return undefined;
  return readRequiredString(body, field, errors);
}

function readRequiredId(body: Body, field: string, errors: string[]): number | undefined {
  if (!isPresent(body, field) || body[field] === null) {
    errors.push(`${field} is required`);
    return undefined;
  }
  const id = toId(body[field]);
  if (id === null) {
    errors.push(`${field} must be a positive integer`);
    return undefined;
  }
  return id;
}

function readRequiredIntegerInRange(
  body: Body,
  field: string,
  errors: string[],
  min: number,
  max: number
): number | undefined {
  if (!isPresent(body, field)) {
    errors.push(`${field} is required`);
    return undefined;
  }
  const value = toInteger(body[field]);
  if (value === null || value < min || value > max) {
    errors.push(`${field} must be an integer between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function readOptionalIntegerInRange(
  body: Body,
  field: string,
  errors: string[],
  min: number,
  max: number
): number | null | undefined {
  if (!isPresent(body, field)) return undefined;
  if (body[field] === null) return null;
  return readRequiredIntegerInRange(body, field, errors, min, max);
}

function isSqliteError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

// ---------------------------------------------------------------------------
// Books API
// ---------------------------------------------------------------------------

router.get('/books', (req: Request, res: Response) => {
  const db = getDb();
  const { q } = req.query;

  if (q === undefined) {
    return res.json(Book.getAllBooks(db));
  }

  if (typeof q !== 'string') {
    return badRequest(res, ['q must be a single string value']);
  }
  if (q.trim() === '') {
    return badRequest(res, ['q must not be empty']);
  }

  res.json(Book.searchBooks(db, q.trim()));
});

router.get('/books/:id', (req: Request, res: Response) => {
  const db = getDb();
  const bookId = requireIdParam(res, req.params.id, 'id');
  if (bookId === null) return;

  const book = Book.getBookById(db, bookId);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }

  res.json(book);
});

const BOOK_FIELDS = ['title', 'author', 'isbn', 'cover_url', 'description', 'published_year'];

router.post('/books', (req: Request, res: Response) => {
  const db = getDb();
  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, BOOK_FIELDS, errors);

  const title = readRequiredString(body, 'title', errors);
  const author = readRequiredString(body, 'author', errors);
  const isbn = readOptionalText(body, 'isbn', errors);
  const coverUrl = readOptionalText(body, 'cover_url', errors);
  const description = readOptionalText(body, 'description', errors);
  const publishedYear = readOptionalIntegerInRange(
    body,
    'published_year',
    errors,
    MIN_PUBLISHED_YEAR,
    MAX_PUBLISHED_YEAR
  );

  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  try {
    const book = Book.createBook(db, {
      title: title!,
      author: author!,
      isbn: isbn ?? null,
      cover_url: coverUrl ?? null,
      description: description ?? null,
      published_year: publishedYear ?? null
    });
    res.status(201).json(book);
  } catch (err) {
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      return res.status(409).json({ error: 'A book with that isbn already exists' });
    }
    throw err;
  }
});

router.patch('/books/:id', (req: Request, res: Response) => {
  const db = getDb();
  const bookId = requireIdParam(res, req.params.id, 'id');
  if (bookId === null) return;

  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, BOOK_FIELDS, errors);

  const updates: Partial<Omit<Book.Book, 'id' | 'created_at'>> = {};
  const title = readOptionalString(body, 'title', errors);
  if (title !== undefined) updates.title = title;
  const author = readOptionalString(body, 'author', errors);
  if (author !== undefined) updates.author = author;
  const isbn = readOptionalText(body, 'isbn', errors);
  if (isPresent(body, 'isbn')) updates.isbn = isbn ?? null;
  const coverUrl = readOptionalText(body, 'cover_url', errors);
  if (isPresent(body, 'cover_url')) updates.cover_url = coverUrl ?? null;
  const description = readOptionalText(body, 'description', errors);
  if (isPresent(body, 'description')) updates.description = description ?? null;
  const publishedYear = readOptionalIntegerInRange(
    body,
    'published_year',
    errors,
    MIN_PUBLISHED_YEAR,
    MAX_PUBLISHED_YEAR
  );
  if (isPresent(body, 'published_year')) updates.published_year = publishedYear ?? null;

  if (errors.length === 0 && Object.keys(updates).length === 0) {
    errors.push(`At least one field must be provided (${BOOK_FIELDS.join(', ')})`);
  }
  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  try {
    const book = Book.updateBook(db, bookId, updates);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(book);
  } catch (err) {
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      return res.status(409).json({ error: 'A book with that isbn already exists' });
    }
    throw err;
  }
});

router.delete('/books/:id', (req: Request, res: Response) => {
  const db = getDb();
  const bookId = requireIdParam(res, req.params.id, 'id');
  if (bookId === null) return;

  const deleted = Book.deleteBook(db, bookId);
  if (!deleted) {
    return res.status(404).json({ error: 'Book not found' });
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Users API
// ---------------------------------------------------------------------------

const USER_FIELDS = ['username', 'displayName'];

router.get('/users', (req: Request, res: Response) => {
  const db = getDb();
  const users = User.getAllUsers(db);
  res.json(users);
});

router.get('/users/:id', (req: Request, res: Response) => {
  const db = getDb();
  const userId = requireIdParam(res, req.params.id, 'id');
  if (userId === null) return;

  const user = User.getUserById(db, userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

router.post('/users', (req: Request, res: Response) => {
  const db = getDb();
  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, USER_FIELDS, errors);

  const username = readRequiredString(body, 'username', errors);
  const displayName = readRequiredString(body, 'displayName', errors);

  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  try {
    const user = User.createUser(db, username!, displayName!);
    res.status(201).json(user);
  } catch (err) {
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    throw err;
  }
});

router.patch('/users/:id', (req: Request, res: Response) => {
  const db = getDb();
  const userId = requireIdParam(res, req.params.id, 'id');
  if (userId === null) return;

  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, USER_FIELDS, errors);

  const updates: { username?: string; displayName?: string } = {};
  const username = readOptionalString(body, 'username', errors);
  if (username !== undefined) updates.username = username;
  const displayName = readOptionalString(body, 'displayName', errors);
  if (displayName !== undefined) updates.displayName = displayName;

  if (errors.length === 0 && Object.keys(updates).length === 0) {
    errors.push(`At least one field must be provided (${USER_FIELDS.join(', ')})`);
  }
  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  try {
    const user = User.updateUser(db, userId, updates);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    throw err;
  }
});

router.delete('/users/:id', (req: Request, res: Response) => {
  const db = getDb();
  const userId = requireIdParam(res, req.params.id, 'id');
  if (userId === null) return;

  const deleted = User.deleteUser(db, userId);
  if (!deleted) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Reviews API
// ---------------------------------------------------------------------------

const MIN_RATING = 1;
const MAX_RATING = 5;
const REVIEW_CREATE_FIELDS = ['userId', 'bookId', 'rating', 'reviewText'];
const REVIEW_UPDATE_FIELDS = ['rating', 'reviewText'];

router.get('/reviews/book/:bookId', (req: Request, res: Response) => {
  const db = getDb();
  const bookId = requireIdParam(res, req.params.bookId, 'bookId');
  if (bookId === null) return;

  res.json(Review.getReviewsByBookId(db, bookId));
});

router.get('/reviews/user/:userId', (req: Request, res: Response) => {
  const db = getDb();
  const userId = requireIdParam(res, req.params.userId, 'userId');
  if (userId === null) return;

  res.json(Review.getReviewsByUserId(db, userId));
});

router.get('/reviews/:id', (req: Request, res: Response) => {
  const db = getDb();
  const reviewId = requireIdParam(res, req.params.id, 'id');
  if (reviewId === null) return;

  const review = Review.getReviewById(db, reviewId);
  if (!review) {
    return res.status(404).json({ error: 'Review not found' });
  }

  res.json(review);
});

router.post('/reviews', (req: Request, res: Response) => {
  const db = getDb();
  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, REVIEW_CREATE_FIELDS, errors);

  const userId = readRequiredId(body, 'userId', errors);
  const bookId = readRequiredId(body, 'bookId', errors);
  const rating = readRequiredIntegerInRange(body, 'rating', errors, MIN_RATING, MAX_RATING);
  const reviewText = readOptionalText(body, 'reviewText', errors);

  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  // Check the references before inserting so a bad id reads as 404, not a
  // foreign-key crash.
  if (!User.getUserById(db, userId!)) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!Book.getBookById(db, bookId!)) {
    return res.status(404).json({ error: 'Book not found' });
  }

  const existing = Review.getReviewByUserAndBook(db, userId!, bookId!);
  if (existing) {
    return res.status(409).json({ error: 'User has already reviewed this book' });
  }

  const review = Review.createReview(db, userId!, bookId!, rating!, reviewText ?? undefined);
  res.status(201).json(review);
});

router.patch('/reviews/:id', (req: Request, res: Response) => {
  const db = getDb();
  const reviewId = requireIdParam(res, req.params.id, 'id');
  if (reviewId === null) return;

  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, REVIEW_UPDATE_FIELDS, errors);

  const updates: { rating?: number; reviewText?: string } = {};
  if (isPresent(body, 'rating')) {
    const rating = readRequiredIntegerInRange(body, 'rating', errors, MIN_RATING, MAX_RATING);
    if (rating !== undefined) updates.rating = rating;
  }
  if (isPresent(body, 'reviewText')) {
    const reviewText = readOptionalText(body, 'reviewText', errors);
    // review_text is nullable even though the model types it as `string`, so a
    // null here clears the text rather than storing an empty string.
    updates.reviewText = (reviewText ?? null) as unknown as string;
  }

  if (errors.length === 0 && Object.keys(updates).length === 0) {
    errors.push(`At least one field must be provided (${REVIEW_UPDATE_FIELDS.join(', ')})`);
  }
  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  const review = Review.updateReview(db, reviewId, updates);
  if (!review) {
    return res.status(404).json({ error: 'Review not found' });
  }

  res.json(review);
});

router.delete('/reviews/:id', (req: Request, res: Response) => {
  const db = getDb();
  const reviewId = requireIdParam(res, req.params.id, 'id');
  if (reviewId === null) return;

  const deleted = Review.deleteReview(db, reviewId);
  if (!deleted) {
    return res.status(404).json({ error: 'Review not found' });
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Shelves API
// ---------------------------------------------------------------------------

const SHELF_FIELDS = ['userId', 'name'];

router.get('/shelves/user/:userId', (req: Request, res: Response) => {
  const db = getDb();
  const userId = requireIdParam(res, req.params.userId, 'userId');
  if (userId === null) return;

  res.json(Shelf.getShelvesByUserId(db, userId));
});

router.get('/shelves/:id', (req: Request, res: Response) => {
  const db = getDb();
  const shelfId = requireIdParam(res, req.params.id, 'id');
  if (shelfId === null) return;

  const shelf = Shelf.getShelfWithBooks(db, shelfId);
  if (!shelf) {
    return res.status(404).json({ error: 'Shelf not found' });
  }

  res.json(shelf);
});

router.post('/shelves', (req: Request, res: Response) => {
  const db = getDb();
  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, SHELF_FIELDS, errors);

  const userId = readRequiredId(body, 'userId', errors);
  const name = readRequiredString(body, 'name', errors);

  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  if (!User.getUserById(db, userId!)) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const shelf = Shelf.createShelf(db, userId!, name!);
    res.status(201).json(shelf);
  } catch (err) {
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      return res.status(409).json({ error: 'That user already has a shelf with that name' });
    }
    throw err;
  }
});

router.delete('/shelves/:id', (req: Request, res: Response) => {
  const db = getDb();
  const shelfId = requireIdParam(res, req.params.id, 'id');
  if (shelfId === null) return;

  const deleted = Shelf.deleteShelf(db, shelfId);
  if (!deleted) {
    return res.status(404).json({ error: 'Shelf not found' });
  }

  res.status(204).send();
});

router.post('/shelves/:id/books', (req: Request, res: Response) => {
  const db = getDb();
  const shelfId = requireIdParam(res, req.params.id, 'id');
  if (shelfId === null) return;

  const body = requireBody(req, res);
  if (!body) return;

  const errors: string[] = [];
  rejectUnknownFields(body, ['bookId'], errors);
  const bookId = readRequiredId(body, 'bookId', errors);

  if (errors.length > 0) {
    return badRequest(res, errors);
  }

  if (!Shelf.getShelfById(db, shelfId)) {
    return res.status(404).json({ error: 'Shelf not found' });
  }
  if (!Book.getBookById(db, bookId!)) {
    return res.status(404).json({ error: 'Book not found' });
  }

  const added = Shelf.addBookToShelf(db, shelfId, bookId!);
  if (!added) {
    return res.status(409).json({ error: 'Book already on shelf' });
  }

  res.status(201).json({ message: 'Book added to shelf' });
});

router.delete('/shelves/:id/books/:bookId', (req: Request, res: Response) => {
  const db = getDb();
  const shelfId = requireIdParam(res, req.params.id, 'id');
  if (shelfId === null) return;
  const bookId = requireIdParam(res, req.params.bookId, 'bookId');
  if (bookId === null) return;

  const removed = Shelf.removeBookFromShelf(db, shelfId, bookId);
  if (!removed) {
    return res.status(404).json({ error: 'Book not found on shelf' });
  }

  res.status(204).send();
});

export default router;
