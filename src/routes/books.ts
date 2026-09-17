import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import * as Book from '../models/book.js';
import * as Review from '../models/review.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const books = Book.getAllBooks(db);
  res.render('books/index', { books });
});

router.get('/books/search', (req: Request, res: Response) => {
  const db = getDb();
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  // An empty query means the search box was cleared: show the full list again.
  const books = query ? Book.searchBooks(db, query) : Book.getAllBooks(db);

  res.render('books/search-results', { books, query });
});

router.get('/books/:id', (req: Request, res: Response) => {
  const db = getDb();
  const bookId = parseInt(req.params.id, 10);
  const book = Book.getBookById(db, bookId);

  if (!book) {
    return res.status(404).render('error', { message: 'Book not found' });
  }

  const reviews = Review.getReviewsByBookId(db, bookId);
  const averageRating = Review.getAverageRating(db, bookId);

  res.render('books/show', { book, reviews, averageRating });
});

router.post('/books/:id/reviews', (req: Request, res: Response) => {
  const db = getDb();
  const bookId = parseInt(req.params.id, 10);
  const { userId, rating, reviewText } = req.body;

  if (!userId || !rating) {
    return res.status(400).send('<p class="error">User and rating are required</p>');
  }

  const existing = Review.getReviewByUserAndBook(db, parseInt(userId), bookId);
  if (existing) {
    return res.status(409).send('<p class="error">You have already reviewed this book</p>');
  }

  Review.createReview(db, parseInt(userId), bookId, parseInt(rating), reviewText);
  
  const reviews = Review.getReviewsByBookId(db, bookId);
  res.render('books/reviews-list', { reviews });
});

export default router;
