import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Book from '../../src/models/book.js';
import Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = initDb('/tmp/test-book-model.db');
});

afterEach(() => {
  closeDb();
  const fs = require('fs');
  try {
    fs.unlinkSync('/tmp/test-book-model.db');
  } catch (e) {
    // ignore
  }
});

describe('Book Model', () => {
  describe('getAllBooks', () => {
    it('returns all books ordered by title', () => {
      const books = Book.getAllBooks(db);
      expect(books).toHaveLength(50);
      expect(books[0].title).toBe('1984');
    });
  });

  describe('getBookById', () => {
    it('returns a book by id', () => {
      const book = Book.getBookById(db, 1);
      expect(book).toBeDefined();
      expect(book?.title).toBe('The Pragmatic Programmer');
      expect(book?.author).toBe('Andrew Hunt and David Thomas');
    });

    it('returns undefined for non-existent id', () => {
      const book = Book.getBookById(db, 999);
      expect(book).toBeUndefined();
    });
  });

  describe('createBook', () => {
    it('creates a new book', () => {
      const book = Book.createBook(db, {
        title: 'Test Book',
        author: 'Test Author',
        isbn: '978-1234567890',
        cover_url: null,
        description: 'A test book',
        published_year: 2024
      });

      expect(book.id).toBeDefined();
      expect(book.title).toBe('Test Book');
      expect(book.author).toBe('Test Author');
    });

    it('persists every column it is given', () => {
      const book = Book.createBook(db, {
        title: 'Full Record',
        author: 'Some Author',
        isbn: '978-0000000001',
        cover_url: 'https://example.com/cover.png',
        description: 'Every field populated.',
        published_year: 2024
      });

      expect(Book.getBookById(db, book.id)).toEqual({
        id: book.id,
        title: 'Full Record',
        author: 'Some Author',
        isbn: '978-0000000001',
        cover_url: 'https://example.com/cover.png',
        description: 'Every field populated.',
        published_year: 2024,
        created_at: expect.any(String)
      });
    });

    it('rejects a duplicate isbn', () => {
      expect(() =>
        Book.createBook(db, {
          title: 'Impostor',
          author: 'Nobody',
          isbn: '978-0201616224', // The Pragmatic Programmer
          cover_url: null,
          description: null,
          published_year: null
        })
      ).toThrow(/UNIQUE constraint failed: books.isbn/);
    });

    it('allows several books without an isbn', () => {
      const first = Book.createBook(db, {
        title: 'No ISBN One',
        author: 'A',
        isbn: null,
        cover_url: null,
        description: null,
        published_year: null
      });
      const second = Book.createBook(db, {
        title: 'No ISBN Two',
        author: 'B',
        isbn: null,
        cover_url: null,
        description: null,
        published_year: null
      });

      expect(first.id).not.toBe(second.id);
    });

    it('rejects a missing title', () => {
      expect(() =>
        Book.createBook(db, {
          title: null as unknown as string,
          author: 'Nobody',
          isbn: null,
          cover_url: null,
          description: null,
          published_year: null
        })
      ).toThrow(/NOT NULL constraint failed: books.title/);
    });

    it('rejects a missing author', () => {
      expect(() =>
        Book.createBook(db, {
          title: 'Authorless',
          author: null as unknown as string,
          isbn: null,
          cover_url: null,
          description: null,
          published_year: null
        })
      ).toThrow(/NOT NULL constraint failed: books.author/);
    });
  });

  describe('updateBook', () => {
    it('updates a single field and leaves the rest alone', () => {
      const updated = Book.updateBook(db, 1, { title: 'The Pragmatic Programmer, 2nd ed.' });

      expect(updated?.title).toBe('The Pragmatic Programmer, 2nd ed.');
      expect(updated?.author).toBe('Andrew Hunt and David Thomas');
      expect(updated?.published_year).toBe(1999);
    });

    it('updates several fields at once', () => {
      const updated = Book.updateBook(db, 1, {
        author: 'Hunt & Thomas',
        published_year: 2019,
        description: 'The 20th anniversary edition.'
      });

      expect(updated?.author).toBe('Hunt & Thomas');
      expect(updated?.published_year).toBe(2019);
      expect(updated?.description).toBe('The 20th anniversary edition.');
    });

    it('clears a nullable field when given null', () => {
      const updated = Book.updateBook(db, 1, { isbn: null, description: null });

      expect(updated?.isbn).toBeNull();
      expect(updated?.description).toBeNull();
    });

    it('returns the untouched book when no fields are given', () => {
      const before = Book.getBookById(db, 1);

      expect(Book.updateBook(db, 1, {})).toEqual(before);
    });

    it('returns undefined for a non-existent id', () => {
      expect(Book.updateBook(db, 999, { title: 'Ghost' })).toBeUndefined();
    });

    it('rejects an isbn that belongs to another book', () => {
      expect(() => Book.updateBook(db, 2, { isbn: '978-0201616224' })).toThrow(
        /UNIQUE constraint failed: books.isbn/
      );
      expect(Book.getBookById(db, 2)?.isbn).toBe('978-0132350884');
    });
  });

  describe('deleteBook', () => {
    it('deletes a book and reports success', () => {
      expect(Book.deleteBook(db, 50)).toBe(true);
      expect(Book.getBookById(db, 50)).toBeUndefined();
      expect(Book.getAllBooks(db)).toHaveLength(49);
    });

    it('returns false for a non-existent id', () => {
      expect(Book.deleteBook(db, 999)).toBe(false);
      expect(Book.getAllBooks(db)).toHaveLength(50);
    });

    it('cascades to its reviews and shelf entries', () => {
      const countFor = (table: string, column: string) =>
        (
          db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE ${column} = 1`).get() as {
            count: number;
          }
        ).count;

      expect(countFor('reviews', 'book_id')).toBe(2);
      expect(countFor('shelf_books', 'book_id')).toBe(2);

      Book.deleteBook(db, 1);

      expect(countFor('reviews', 'book_id')).toBe(0);
      expect(countFor('shelf_books', 'book_id')).toBe(0);
    });

    it('leaves the shelves and users that referenced it intact', () => {
      Book.deleteBook(db, 1);

      const shelves = db.prepare('SELECT COUNT(*) as count FROM shelves').get() as {
        count: number;
      };
      const users = db.prepare('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      };

      expect(shelves.count).toBe(9);
      expect(users.count).toBe(3);
    });

    it('frees the isbn for reuse', () => {
      Book.deleteBook(db, 1);

      expect(() =>
        Book.createBook(db, {
          title: 'Reissue',
          author: 'Hunt & Thomas',
          isbn: '978-0201616224',
          cover_url: null,
          description: null,
          published_year: 2024
        })
      ).not.toThrow();
    });
  });

  describe('searchBooks', () => {
    it('matches a partial title', () => {
      const books = Book.searchBooks(db, 'Pragmatic');

      expect(books).toHaveLength(1);
      expect(books[0].title).toBe('The Pragmatic Programmer');
    });

    it('matches an author', () => {
      const books = Book.searchBooks(db, 'Tolkien');

      expect(books.map(b => b.title)).toEqual(['The Hobbit', 'The Lord of the Rings']);
    });

    it('matches regardless of case', () => {
      expect(Book.searchBooks(db, 'clean code')).toHaveLength(1);
      expect(Book.searchBooks(db, 'CLEAN CODE')).toHaveLength(1);
    });

    it('returns results ordered by title', () => {
      const titles = Book.searchBooks(db, 'the').map(b => b.title);

      expect(titles).toEqual([...titles].sort());
    });

    it('matches authors whose names only share a prefix', () => {
      // "Martin" appears in four author names and in no title.
      const books = Book.searchBooks(db, 'Martin');

      expect(books.map(b => b.title)).toEqual([
        'A Game of Thrones', // George R.R. Martin
        'A Memory Called Empire', // Arkady Martine
        'Clean Code', // Robert C. Martin
        'Refactoring' // Martin Fowler
      ]);
      // "The Martian" is by Andy Weir and does not contain "Martin".
      expect(books.map(b => b.title)).not.toContain('The Martian');
    });

    it('does not search the description', () => {
      // Book 3's description mentions "Gang of Four"; no title or author does.
      expect(Book.searchBooks(db, 'Gang of Four')).toEqual([]);
    });

    it('returns an empty array when nothing matches', () => {
      expect(Book.searchBooks(db, 'zzzznotabook')).toEqual([]);
    });

    it('returns every book for an empty query', () => {
      expect(Book.searchBooks(db, '')).toHaveLength(50);
    });

    it('treats an apostrophe as a literal character', () => {
      const books = Book.searchBooks(db, "Ender's");

      expect(books.map(b => b.title)).toEqual(["Ender's Game"]);
    });
  });
});
