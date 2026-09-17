import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Review from '../../src/models/review.js';

const TEST_DB_PATH = '/tmp/test-review-model.db';

let db: Database.Database;

beforeEach(() => {
  db = initDb(TEST_DB_PATH);
});

afterEach(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkSync(`${TEST_DB_PATH}${suffix}`);
    } catch (e) {
      // ignore
    }
  }
});

/** Seed rows all share a timestamp, so pin one explicitly when order matters. */
function setCreatedAt(id: number, timestamp: string): void {
  db.prepare('UPDATE reviews SET created_at = ? WHERE id = ?').run(timestamp, id);
}

describe('Review Model', () => {
  describe('getReviewsByBookId', () => {
    it('returns every review for a book with joined user and book details', () => {
      // Seed: alice (5) and bob (4) both reviewed book 1.
      const reviews = Review.getReviewsByBookId(db, 1);

      expect(reviews).toHaveLength(2);
      expect(reviews.map(r => r.username).sort()).toEqual(['alice', 'bob']);

      const alice = reviews.find(r => r.username === 'alice')!;
      expect(alice.display_name).toBe('Alice Chen');
      expect(alice.book_title).toBe('The Pragmatic Programmer');
      expect(alice.book_author).toBe('Andrew Hunt and David Thomas');
      expect(alice.rating).toBe(5);
      expect(alice.user_id).toBe(1);
      expect(alice.book_id).toBe(1);
    });

    it('orders reviews newest first', () => {
      const [first, second] = Review.getReviewsByBookId(db, 1);
      setCreatedAt(first.id, '2020-01-01 00:00:00');
      setCreatedAt(second.id, '2024-01-01 00:00:00');

      const reviews = Review.getReviewsByBookId(db, 1);

      expect(reviews.map(r => r.id)).toEqual([second.id, first.id]);
    });

    it('returns an empty array for a book with no reviews', () => {
      expect(Review.getReviewsByBookId(db, 50)).toEqual([]);
    });

    it('returns an empty array for a non-existent book', () => {
      expect(Review.getReviewsByBookId(db, 999)).toEqual([]);
    });
  });

  describe('getReviewsByUserId', () => {
    it("returns a user's reviews with book details", () => {
      const reviews = Review.getReviewsByUserId(db, 1);

      expect(reviews).toHaveLength(3);
      expect(reviews.every(r => r.user_id === 1)).toBe(true);
      expect(reviews.map(r => r.book_title).sort()).toEqual([
        'Clean Code',
        'Dune',
        'The Pragmatic Programmer'
      ]);
    });

    it('returns an empty array for a user with no reviews', () => {
      db.prepare('DELETE FROM reviews WHERE user_id = 1').run();

      expect(Review.getReviewsByUserId(db, 1)).toEqual([]);
    });

    it('returns an empty array for a non-existent user', () => {
      expect(Review.getReviewsByUserId(db, 999)).toEqual([]);
    });
  });

  describe('getReviewById', () => {
    it('returns a single review with its joined details', () => {
      const review = Review.getReviewById(db, 1);

      expect(review?.id).toBe(1);
      expect(review?.username).toBe('alice');
      expect(review?.book_title).toBe('The Pragmatic Programmer');
      expect(review?.review_text).toMatch(/Essential reading/);
      expect(review?.created_at).toEqual(expect.any(String));
    });

    it('returns undefined for a non-existent id', () => {
      expect(Review.getReviewById(db, 999)).toBeUndefined();
    });
  });

  describe('getReviewByUserAndBook', () => {
    it('returns the review a user wrote for a book', () => {
      const review = Review.getReviewByUserAndBook(db, 1, 1);

      expect(review?.user_id).toBe(1);
      expect(review?.book_id).toBe(1);
      expect(review?.rating).toBe(5);
    });

    it('returns undefined when the user has not reviewed that book', () => {
      expect(Review.getReviewByUserAndBook(db, 1, 5)).toBeUndefined();
    });

    it('returns undefined for a non-existent user or book', () => {
      expect(Review.getReviewByUserAndBook(db, 999, 1)).toBeUndefined();
      expect(Review.getReviewByUserAndBook(db, 1, 999)).toBeUndefined();
    });
  });

  describe('createReview', () => {
    it('creates a review and returns it with joined details', () => {
      const review = Review.createReview(db, 1, 5, 4, 'Dense but rewarding.');

      expect(review.id).toBeDefined();
      expect(review.user_id).toBe(1);
      expect(review.book_id).toBe(5);
      expect(review.rating).toBe(4);
      expect(review.review_text).toBe('Dense but rewarding.');
      expect(Review.getReviewByUserAndBook(db, 1, 5)).toBeDefined();
    });

    it('stores null review text when none is given', () => {
      expect(Review.createReview(db, 1, 5, 4).review_text).toBeNull();
    });

    it('stores null review text when an empty string is given', () => {
      expect(Review.createReview(db, 1, 5, 4, '').review_text).toBeNull();
    });

    it('accepts the rating boundaries 1 and 5', () => {
      expect(Review.createReview(db, 1, 5, 1).rating).toBe(1);
      expect(Review.createReview(db, 1, 6, 5).rating).toBe(5);
    });

    it('rejects a rating below 1', () => {
      expect(() => Review.createReview(db, 1, 5, 0)).toThrow(/CHECK constraint failed/);
    });

    it('rejects a rating above 5', () => {
      expect(() => Review.createReview(db, 1, 5, 6)).toThrow(/CHECK constraint failed/);
    });

    // Documents current behaviour, not desired behaviour: `rating` has no NOT NULL,
    // and `CHECK(rating >= 1 AND rating <= 5)` evaluates to NULL — not false — for a
    // NULL rating, so the row is accepted. Adding NOT NULL to the column would make
    // this test fail, which is the point.
    it('accepts a null rating (schema gap)', () => {
      const review = Review.createReview(db, 1, 5, null as unknown as number);

      expect(review.rating).toBeNull();
    });

    it('rejects a second review of the same book by the same user', () => {
      expect(() => Review.createReview(db, 1, 1, 3, 'Again')).toThrow(
        /UNIQUE constraint failed: reviews.user_id, reviews.book_id/
      );
    });

    it('allows different users to review the same book', () => {
      const review = Review.createReview(db, 3, 1, 3);

      expect(review.book_id).toBe(1);
      expect(Review.getReviewsByBookId(db, 1)).toHaveLength(3);
    });

    it('rejects a review for a non-existent user', () => {
      expect(() => Review.createReview(db, 999, 1, 5)).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('rejects a review for a non-existent book', () => {
      expect(() => Review.createReview(db, 1, 999, 5)).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe('updateReview', () => {
    it('updates the rating only', () => {
      const updated = Review.updateReview(db, 1, { rating: 3 });

      expect(updated?.rating).toBe(3);
      expect(updated?.review_text).toMatch(/Essential reading/);
    });

    it('updates the review text only', () => {
      const updated = Review.updateReview(db, 1, { reviewText: 'Changed my mind.' });

      expect(updated?.review_text).toBe('Changed my mind.');
      expect(updated?.rating).toBe(5);
    });

    it('updates both fields together', () => {
      const updated = Review.updateReview(db, 1, { rating: 2, reviewText: 'Not for me.' });

      expect(updated?.rating).toBe(2);
      expect(updated?.review_text).toBe('Not for me.');
    });

    it('returns the untouched review when no fields are given', () => {
      const before = Review.getReviewById(db, 1);

      expect(Review.updateReview(db, 1, {})).toEqual(before);
    });

    it('returns undefined for a non-existent id', () => {
      expect(Review.updateReview(db, 999, { rating: 3 })).toBeUndefined();
    });

    it('rejects an out-of-range rating and leaves the row unchanged', () => {
      expect(() => Review.updateReview(db, 1, { rating: 9 })).toThrow(
        /CHECK constraint failed/
      );
      expect(Review.getReviewById(db, 1)?.rating).toBe(5);
    });
  });

  describe('deleteReview', () => {
    it('deletes a review and reports success', () => {
      expect(Review.deleteReview(db, 1)).toBe(true);
      expect(Review.getReviewById(db, 1)).toBeUndefined();
    });

    it('returns false for a non-existent id', () => {
      expect(Review.deleteReview(db, 999)).toBe(false);
    });

    it('frees the user/book pair for a new review', () => {
      Review.deleteReview(db, 1);

      expect(() => Review.createReview(db, 1, 1, 2, 'Second take')).not.toThrow();
    });

    it('leaves the reviewed book and its author intact', () => {
      Review.deleteReview(db, 1);

      const book = db.prepare('SELECT * FROM books WHERE id = 1').get() as { title: string };
      expect(book.title).toBe('The Pragmatic Programmer');
    });
  });

  describe('getAverageRating', () => {
    it('averages every rating for a book', () => {
      // Seed: alice rated book 1 a 5, bob a 4.
      expect(Review.getAverageRating(db, 1)).toBe(4.5);
    });

    it('returns null for a book with no reviews', () => {
      expect(Review.getAverageRating(db, 50)).toBeNull();
    });

    it('returns null for a non-existent book', () => {
      expect(Review.getAverageRating(db, 999)).toBeNull();
    });

    it('reflects newly created reviews', () => {
      Review.createReview(db, 3, 1, 3);

      expect(Review.getAverageRating(db, 1)).toBe(4);
    });
  });
});
