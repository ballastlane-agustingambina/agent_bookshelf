import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { unlinkSync } from 'fs';
import app from '../../src/server.js';
import { initDb, closeDb, getDb } from '../../src/db/index.js';

const TEST_DB_PATH = '/tmp/test-books-routes.db';

beforeEach(() => {
  initDb(TEST_DB_PATH);
});

afterEach(() => {
  closeDb();
  try {
    unlinkSync(TEST_DB_PATH);
  } catch (e) {
    // ignore
  }
});

function countBookCards(html: string): number {
  return (html.match(/class="book-card"/g) || []).length;
}

describe('GET /books/search', () => {
  it('finds books by a partial title match', async () => {
    const res = await request(app).get('/books/search').query({ q: 'Pragmatic' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('The Pragmatic Programmer');
    expect(countBookCards(res.text)).toBe(1);
  });

  it('finds books by author', async () => {
    const res = await request(app).get('/books/search').query({ q: 'Tolkien' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('The Hobbit');
    expect(res.text).toContain('The Lord of the Rings');
    expect(countBookCards(res.text)).toBe(2);
  });

  it('matches regardless of case', async () => {
    const res = await request(app).get('/books/search').query({ q: 'clean code' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Clean Code');
    expect(countBookCards(res.text)).toBe(1);
  });

  it('links each result to its book page and shows the author', async () => {
    const res = await request(app).get('/books/search').query({ q: 'Pragmatic' });

    expect(res.text).toContain('href="/books/1"');
    expect(res.text).toContain('by Andrew Hunt and David Thomas');
  });

  it('returns a message when nothing matches', async () => {
    const res = await request(app).get('/books/search').query({ q: 'zzzznotabook' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('No books found');
    expect(countBookCards(res.text)).toBe(0);
  });

  it('returns all books when the query is missing', async () => {
    const res = await request(app).get('/books/search');

    expect(res.status).toBe(200);
    expect(countBookCards(res.text)).toBe(50);
  });

  it('returns all books when the query is empty', async () => {
    const res = await request(app).get('/books/search').query({ q: '' });

    expect(res.status).toBe(200);
    expect(countBookCards(res.text)).toBe(50);
  });

  it('treats a whitespace-only query as empty', async () => {
    const res = await request(app).get('/books/search').query({ q: '   ' });

    expect(res.status).toBe(200);
    expect(countBookCards(res.text)).toBe(50);
  });

  it('trims surrounding whitespace before searching', async () => {
    const res = await request(app).get('/books/search').query({ q: '  Dune  ' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Dune');
    expect(countBookCards(res.text)).toBe(1);
  });

  it('returns an HTMX fragment without the page header or footer', async () => {
    const res = await request(app).get('/books/search').query({ q: 'Dune' });

    expect(res.text).not.toContain('<!DOCTYPE html>');
    expect(res.text).not.toContain('<nav>');
  });

  it('says the library is empty rather than blaming the query', async () => {
    getDb().prepare('DELETE FROM books').run();

    const res = await request(app).get('/books/search');

    expect(res.status).toBe(200);
    expect(res.text).toContain('No books yet');
    expect(res.text).not.toContain('No books found');
  });

  it('escapes the query when echoing it back', async () => {
    const res = await request(app)
      .get('/books/search')
      .query({ q: '<script>alert(1)</script>' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('GET /', () => {
  it('renders the full page with the book grid', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('id="search-results"');
    expect(countBookCards(res.text)).toBe(50);
  });

  it('renders a book card identically on the page and in a search result', async () => {
    const page = await request(app).get('/');
    const fragment = await request(app).get('/books/search').query({ q: 'Dune' });

    const duneCard = [
      '<div class="book-card">',
      '<h2><a href="/books/16">Dune</a></h2>',
      '<p class="author">by Frank Herbert</p>',
    ];

    duneCard.forEach(line => {
      expect(page.text).toContain(line);
      expect(fragment.text).toContain(line);
    });
  });
});
