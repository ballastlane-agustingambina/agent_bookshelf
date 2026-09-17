import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { unlinkSync } from 'fs';
import app from '../../src/server.js';
import { initDb, closeDb } from '../../src/db/index.js';

const TEST_DB_PATH = '/tmp/test-api.db';

beforeEach(() => {
  initDb(TEST_DB_PATH);
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

/** Every validation failure answers with this envelope. */
function expectValidationError(res: request.Response, message: RegExp): void {
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Validation failed');
  expect(res.body.details).toEqual(expect.arrayContaining([expect.stringMatching(message)]));
}

describe('API Routes', () => {
  describe('GET /api/books', () => {
    it('returns all books', async () => {
      const res = await request(app).get('/api/books');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(50);
      expect(res.body[0]).toHaveProperty('title');
      expect(res.body[0]).toHaveProperty('author');
    });

    it('filters by the q query parameter', async () => {
      const res = await request(app).get('/api/books').query({ q: 'Tolkien' });

      expect(res.status).toBe(200);
      expect(res.body.map((b: { title: string }) => b.title)).toEqual([
        'The Hobbit',
        'The Lord of the Rings'
      ]);
    });

    it('rejects an empty q', async () => {
      expectValidationError(await request(app).get('/api/books?q='), /q must not be empty/);
    });

    it('rejects a repeated q', async () => {
      expectValidationError(
        await request(app).get('/api/books?q=dune&q=hobbit'),
        /q must be a single string value/
      );
    });
  });

  describe('GET /api/books/:id', () => {
    it('returns a book by id', async () => {
      const res = await request(app).get('/api/books/1');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('The Pragmatic Programmer');
    });

    it('returns 404 for non-existent book', async () => {
      const res = await request(app).get('/api/books/999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Book not found');
    });

    it('rejects a non-numeric id', async () => {
      expectValidationError(
        await request(app).get('/api/books/abc'),
        /id must be a positive integer/
      );
    });

    it.each(['0', '-1', '1.5'])('rejects the id %s', async id => {
      expectValidationError(
        await request(app).get(`/api/books/${id}`),
        /id must be a positive integer/
      );
    });
  });

  describe('POST /api/books', () => {
    const validBook = {
      title: 'A New Book',
      author: 'A. Writer',
      isbn: '978-1111111111',
      published_year: 2024
    };

    it('creates a book', async () => {
      const res = await request(app).post('/api/books').send(validBook);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('A New Book');
      expect(res.body.published_year).toBe(2024);
    });

    it('reports every missing required field at once', async () => {
      const res = await request(app).post('/api/books').send({});

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining(['title is required', 'author is required'])
      );
    });

    it('rejects a blank title', async () => {
      expectValidationError(
        await request(app).post('/api/books').send({ ...validBook, title: '   ' }),
        /title must not be empty/
      );
    });

    it('rejects a non-string author', async () => {
      expectValidationError(
        await request(app).post('/api/books').send({ ...validBook, author: 42 }),
        /author must be a string/
      );
    });

    it('rejects a non-integer published_year', async () => {
      expectValidationError(
        await request(app).post('/api/books').send({ ...validBook, published_year: 'soon' }),
        /published_year must be an integer/
      );
    });

    it.each([999, 9999])('rejects the out-of-range published_year %i', async year => {
      expectValidationError(
        await request(app).post('/api/books').send({ ...validBook, published_year: year }),
        /published_year must be an integer between/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app).post('/api/books').send({ ...validBook, rating: 5 }),
        /Unknown field: rating/
      );
    });

    it('rejects a body that is not an object', async () => {
      const res = await request(app)
        .post('/api/books')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify([validBook]));

      expectValidationError(res, /Request body must be a JSON object/);
    });

    it('accepts a numeric string for published_year', async () => {
      const res = await request(app)
        .post('/api/books')
        .send({ ...validBook, published_year: '1999' });

      expect(res.status).toBe(201);
      expect(res.body.published_year).toBe(1999);
    });

    it('stores a blank optional field as null', async () => {
      const res = await request(app)
        .post('/api/books')
        .send({ title: 'No Isbn', author: 'A. Writer', isbn: '', description: '  ' });

      expect(res.status).toBe(201);
      expect(res.body.isbn).toBeNull();
      expect(res.body.description).toBeNull();
    });

    it('returns 409 for a duplicate isbn', async () => {
      const res = await request(app)
        .post('/api/books')
        .send({ title: 'Impostor', author: 'Nobody', isbn: '978-0201616224' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/isbn already exists/);
    });
  });

  describe('PATCH /api/books/:id', () => {
    it('updates a single field', async () => {
      const res = await request(app).patch('/api/books/1').send({ published_year: 2019 });

      expect(res.status).toBe(200);
      expect(res.body.published_year).toBe(2019);
      expect(res.body.title).toBe('The Pragmatic Programmer');
    });

    it('clears a nullable field with null', async () => {
      const res = await request(app).patch('/api/books/1').send({ description: null });

      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
    });

    it('rejects an empty body', async () => {
      expectValidationError(
        await request(app).patch('/api/books/1').send({}),
        /At least one field must be provided/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app).patch('/api/books/1').send({ titel: 'Typo' }),
        /Unknown field: titel/
      );
    });

    it('rejects nulling a NOT NULL column', async () => {
      expectValidationError(
        await request(app).patch('/api/books/1').send({ title: null }),
        /title is required/
      );
    });

    it('rejects a bad id', async () => {
      expectValidationError(
        await request(app).patch('/api/books/abc').send({ title: 'X' }),
        /id must be a positive integer/
      );
    });

    it('returns 404 for a non-existent book', async () => {
      const res = await request(app).patch('/api/books/999').send({ title: 'Ghost' });
      expect(res.status).toBe(404);
    });

    it('returns 409 when the isbn belongs to another book', async () => {
      const res = await request(app).patch('/api/books/2').send({ isbn: '978-0201616224' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/books/:id', () => {
    it('deletes a book', async () => {
      expect((await request(app).delete('/api/books/50')).status).toBe(204);
      expect((await request(app).get('/api/books/50')).status).toBe(404);
    });

    it('returns 404 for a non-existent book', async () => {
      expect((await request(app).delete('/api/books/999')).status).toBe(404);
    });

    it('rejects a bad id', async () => {
      expectValidationError(
        await request(app).delete('/api/books/abc'),
        /id must be a positive integer/
      );
    });
  });

  describe('GET /api/users', () => {
    it('returns all users', async () => {
      const res = await request(app).get('/api/users');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].display_name).toBe('Alice Chen');
    });

    it('returns a user by id', async () => {
      const res = await request(app).get('/api/users/1');

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });

    it('returns 404 for a non-existent user', async () => {
      expect((await request(app).get('/api/users/999')).status).toBe(404);
    });

    it('rejects a bad id', async () => {
      expectValidationError(
        await request(app).get('/api/users/abc'),
        /id must be a positive integer/
      );
    });
  });

  describe('POST /api/users', () => {
    it('creates a user', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({ username: 'dave', displayName: 'Dave Kim' });

      expect(res.status).toBe(201);
      expect(res.body.username).toBe('dave');
      expect(res.body.display_name).toBe('Dave Kim');
    });

    it('reports both missing fields', async () => {
      const res = await request(app).post('/api/users').send({});

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining(['username is required', 'displayName is required'])
      );
    });

    it('rejects a whitespace-only username', async () => {
      expectValidationError(
        await request(app).post('/api/users').send({ username: '  ', displayName: 'Blank' }),
        /username must not be empty/
      );
    });

    it('rejects a non-string displayName', async () => {
      expectValidationError(
        await request(app).post('/api/users').send({ username: 'dave', displayName: 7 }),
        /displayName must be a string/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app)
          .post('/api/users')
          .send({ username: 'dave', displayName: 'Dave Kim', admin: true }),
        /Unknown field: admin/
      );
    });

    it('returns 409 for a taken username', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({ username: 'alice', displayName: 'Another Alice' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/username is already taken/);
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('updates the display name', async () => {
      const res = await request(app).patch('/api/users/1').send({ displayName: 'Alice C.' });

      expect(res.status).toBe(200);
      expect(res.body.display_name).toBe('Alice C.');
      expect(res.body.username).toBe('alice');
    });

    it('rejects an empty body', async () => {
      expectValidationError(
        await request(app).patch('/api/users/1').send({}),
        /At least one field must be provided/
      );
    });

    it('rejects a blank username', async () => {
      expectValidationError(
        await request(app).patch('/api/users/1').send({ username: '' }),
        /username must not be empty/
      );
    });

    it('returns 409 when the username is taken', async () => {
      const res = await request(app).patch('/api/users/1').send({ username: 'bob' });
      expect(res.status).toBe(409);
    });

    it('returns 404 for a non-existent user', async () => {
      const res = await request(app).patch('/api/users/999').send({ displayName: 'Ghost' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('deletes a user', async () => {
      expect((await request(app).delete('/api/users/3')).status).toBe(204);
      expect((await request(app).get('/api/users/3')).status).toBe(404);
    });

    it('returns 404 for a non-existent user', async () => {
      expect((await request(app).delete('/api/users/999')).status).toBe(404);
    });

    it('rejects a bad id', async () => {
      expectValidationError(
        await request(app).delete('/api/users/-1'),
        /id must be a positive integer/
      );
    });
  });

  describe('GET /api/reviews', () => {
    it('returns the reviews for a book', async () => {
      const res = await request(app).get('/api/reviews/book/1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].book_title).toBe('The Pragmatic Programmer');
    });

    it('returns the reviews for a user', async () => {
      const res = await request(app).get('/api/reviews/user/1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('returns an empty list for a book nobody reviewed', async () => {
      const res = await request(app).get('/api/reviews/book/50');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('rejects a bad bookId', async () => {
      expectValidationError(
        await request(app).get('/api/reviews/book/abc'),
        /bookId must be a positive integer/
      );
    });

    it('rejects a bad userId', async () => {
      expectValidationError(
        await request(app).get('/api/reviews/user/0'),
        /userId must be a positive integer/
      );
    });

    it('returns a review by id', async () => {
      const res = await request(app).get('/api/reviews/1');

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });

    it('returns 404 for a non-existent review', async () => {
      expect((await request(app).get('/api/reviews/999')).status).toBe(404);
    });
  });

  describe('POST /api/reviews', () => {
    it('creates a new review', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({
          userId: 1,
          bookId: 5,
          rating: 5,
          reviewText: 'Amazing book!'
        });

      expect(res.status).toBe(201);
      expect(res.body.rating).toBe(5);
      expect(res.body.review_text).toBe('Amazing book!');
    });

    it('prevents duplicate reviews', async () => {
      // Alice already reviewed book 1 in seed data
      const res = await request(app)
        .post('/api/reviews')
        .send({
          userId: 1,
          bookId: 1,
          rating: 4,
          reviewText: 'Trying to review again'
        });

      expect(res.status).toBe(409);
    });

    it('validates rating range', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({
          userId: 1,
          bookId: 5,
          rating: 6,
          reviewText: 'Invalid rating'
        });

      expect(res.status).toBe(400);
    });

    it('reports all three missing fields at once', async () => {
      const res = await request(app).post('/api/reviews').send({});

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining(['userId is required', 'bookId is required', 'rating is required'])
      );
    });

    it.each([0, -1, 3.5, '4abc', true, null])('rejects the rating %o', async rating => {
      expectValidationError(
        await request(app).post('/api/reviews').send({ userId: 1, bookId: 5, rating }),
        /rating (is required|must be an integer between 1 and 5)/
      );
    });

    it.each(['abc', 0, -2, 1.5])('rejects the userId %o', async userId => {
      expectValidationError(
        await request(app).post('/api/reviews').send({ userId, bookId: 5, rating: 4 }),
        /userId must be a positive integer/
      );
    });

    it('rejects a non-string reviewText', async () => {
      expectValidationError(
        await request(app)
          .post('/api/reviews')
          .send({ userId: 1, bookId: 5, rating: 4, reviewText: 42 }),
        /reviewText must be a string or null/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app)
          .post('/api/reviews')
          .send({ userId: 1, bookId: 5, rating: 4, spoiler: true }),
        /Unknown field: spoiler/
      );
    });

    it('returns 404 when the user does not exist', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({ userId: 999, bookId: 5, rating: 4 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('returns 404 when the book does not exist', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({ userId: 1, bookId: 999, rating: 4 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Book not found');
    });

    it('stores a blank reviewText as null', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({ userId: 1, bookId: 5, rating: 4, reviewText: '   ' });

      expect(res.status).toBe(201);
      expect(res.body.review_text).toBeNull();
    });

    it('accepts form-style numeric strings', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({ userId: '1', bookId: '5', rating: '4' });

      expect(res.status).toBe(201);
      expect(res.body.rating).toBe(4);
      expect(res.body.user_id).toBe(1);
    });
  });

  describe('PATCH /api/reviews/:id', () => {
    it('updates the rating', async () => {
      const res = await request(app).patch('/api/reviews/1').send({ rating: 3 });

      expect(res.status).toBe(200);
      expect(res.body.rating).toBe(3);
    });

    it('clears the review text with null', async () => {
      const res = await request(app).patch('/api/reviews/1').send({ reviewText: null });

      expect(res.status).toBe(200);
      expect(res.body.review_text).toBeNull();
    });

    it.each([9, 0, null, 'five'])('rejects the rating %o', async rating => {
      expectValidationError(
        await request(app).patch('/api/reviews/1').send({ rating }),
        /rating must be an integer between 1 and 5/
      );
    });

    it('rejects an empty body', async () => {
      expectValidationError(
        await request(app).patch('/api/reviews/1').send({}),
        /At least one field must be provided/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app).patch('/api/reviews/1').send({ userId: 2 }),
        /Unknown field: userId/
      );
    });

    it('returns 404 for a non-existent review', async () => {
      expect((await request(app).patch('/api/reviews/999').send({ rating: 3 })).status).toBe(404);
    });
  });

  describe('DELETE /api/reviews/:id', () => {
    it('deletes a review', async () => {
      expect((await request(app).delete('/api/reviews/1')).status).toBe(204);
      expect((await request(app).get('/api/reviews/1')).status).toBe(404);
    });

    it('returns 404 for a non-existent review', async () => {
      expect((await request(app).delete('/api/reviews/999')).status).toBe(404);
    });

    it('rejects a bad id', async () => {
      expectValidationError(
        await request(app).delete('/api/reviews/abc'),
        /id must be a positive integer/
      );
    });
  });

  describe('GET /api/shelves', () => {
    it("returns a user's shelves", async () => {
      const res = await request(app).get('/api/shelves/user/1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.map((s: { name: string }) => s.name)).toEqual([
        'currently-reading',
        'read',
        'want-to-read'
      ]);
    });

    it('returns a shelf with its books', async () => {
      const res = await request(app).get('/api/shelves/3');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('read');
      expect(res.body.username).toBe('alice');
      expect(res.body.books).toHaveLength(3);
    });

    it('returns 404 for a non-existent shelf', async () => {
      expect((await request(app).get('/api/shelves/999')).status).toBe(404);
    });

    it('rejects a bad userId', async () => {
      expectValidationError(
        await request(app).get('/api/shelves/user/abc'),
        /userId must be a positive integer/
      );
    });

    it('rejects a bad shelf id', async () => {
      expectValidationError(
        await request(app).get('/api/shelves/abc'),
        /id must be a positive integer/
      );
    });
  });

  describe('POST /api/shelves', () => {
    it('creates a shelf', async () => {
      const res = await request(app).post('/api/shelves').send({ userId: 1, name: 'favorites' });

      expect(res.status).toBe(201);
      expect(res.body.user_id).toBe(1);
      expect(res.body.name).toBe('favorites');
    });

    it('reports both missing fields', async () => {
      const res = await request(app).post('/api/shelves').send({});

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining(['userId is required', 'name is required'])
      );
    });

    it('rejects a blank name', async () => {
      expectValidationError(
        await request(app).post('/api/shelves').send({ userId: 1, name: '   ' }),
        /name must not be empty/
      );
    });

    it('rejects a bad userId', async () => {
      expectValidationError(
        await request(app).post('/api/shelves').send({ userId: 'one', name: 'favorites' }),
        /userId must be a positive integer/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app).post('/api/shelves').send({ userId: 1, name: 'favorites', public: true }),
        /Unknown field: public/
      );
    });

    it('returns 404 when the user does not exist', async () => {
      const res = await request(app).post('/api/shelves').send({ userId: 999, name: 'favorites' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('returns 409 for a duplicate shelf name', async () => {
      const res = await request(app).post('/api/shelves').send({ userId: 1, name: 'read' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already has a shelf with that name/);
    });
  });

  describe('DELETE /api/shelves/:id', () => {
    it('deletes a shelf', async () => {
      expect((await request(app).delete('/api/shelves/1')).status).toBe(204);
      expect((await request(app).get('/api/shelves/1')).status).toBe(404);
    });

    it('returns 404 for a non-existent shelf', async () => {
      expect((await request(app).delete('/api/shelves/999')).status).toBe(404);
    });

    it('rejects a bad id', async () => {
      expectValidationError(
        await request(app).delete('/api/shelves/abc'),
        /id must be a positive integer/
      );
    });
  });

  describe('POST /api/shelves/:id/books', () => {
    it('adds a book to a shelf', async () => {
      const res = await request(app).post('/api/shelves/1/books').send({ bookId: 5 });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Book added to shelf');

      const shelf = await request(app).get('/api/shelves/1');
      expect(shelf.body.books.map((b: { book_id: number }) => b.book_id)).toContain(5);
    });

    it('rejects a missing bookId', async () => {
      expectValidationError(
        await request(app).post('/api/shelves/1/books').send({}),
        /bookId is required/
      );
    });

    it('rejects a non-numeric bookId', async () => {
      expectValidationError(
        await request(app).post('/api/shelves/1/books').send({ bookId: 'abc' }),
        /bookId must be a positive integer/
      );
    });

    it('rejects an unknown field', async () => {
      expectValidationError(
        await request(app).post('/api/shelves/1/books').send({ bookId: 5, note: 'later' }),
        /Unknown field: note/
      );
    });

    it('rejects a bad shelf id', async () => {
      expectValidationError(
        await request(app).post('/api/shelves/abc/books').send({ bookId: 5 }),
        /id must be a positive integer/
      );
    });

    it('returns 404 when the shelf does not exist', async () => {
      const res = await request(app).post('/api/shelves/999/books').send({ bookId: 5 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Shelf not found');
    });

    it('returns 404 when the book does not exist', async () => {
      const res = await request(app).post('/api/shelves/1/books').send({ bookId: 999 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Book not found');
    });

    it('returns 409 when the book is already on the shelf', async () => {
      // Book 31 is already on shelf 1 (alice's want-to-read).
      const res = await request(app).post('/api/shelves/1/books').send({ bookId: 31 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Book already on shelf');
    });
  });

  describe('DELETE /api/shelves/:id/books/:bookId', () => {
    it('removes a book from a shelf', async () => {
      expect((await request(app).delete('/api/shelves/1/books/31')).status).toBe(204);

      const shelf = await request(app).get('/api/shelves/1');
      expect(shelf.body.books.map((b: { book_id: number }) => b.book_id)).not.toContain(31);
    });

    it('returns 404 when the book is not on the shelf', async () => {
      expect((await request(app).delete('/api/shelves/1/books/5')).status).toBe(404);
    });

    it('rejects a bad shelf id', async () => {
      expectValidationError(
        await request(app).delete('/api/shelves/abc/books/5'),
        /id must be a positive integer/
      );
    });

    it('rejects a bad bookId', async () => {
      expectValidationError(
        await request(app).delete('/api/shelves/1/books/abc'),
        /bookId must be a positive integer/
      );
    });
  });
});
