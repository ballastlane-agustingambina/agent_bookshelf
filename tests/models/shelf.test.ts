import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Shelf from '../../src/models/shelf.js';

const TEST_DB_PATH = '/tmp/test-shelf-model.db';

// Seed layout: shelves 1-3 belong to alice (want-to-read, currently-reading, read),
// 4-6 to bob, 7-9 to carol. Shelf 3 holds books 1, 2 and 16.
const ALICE_READ_SHELF = 3;
const BOB_READ_SHELF = 6;

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

describe('Shelf Model', () => {
  describe('getShelvesByUserId', () => {
    it('returns a user\'s shelves ordered by name', () => {
      const shelves = Shelf.getShelvesByUserId(db, 1);

      expect(shelves).toHaveLength(3);
      expect(shelves.map(s => s.name)).toEqual([
        'currently-reading',
        'read',
        'want-to-read'
      ]);
      expect(shelves.every(s => s.user_id === 1)).toBe(true);
    });

    it('does not return another user\'s shelves', () => {
      const shelves = Shelf.getShelvesByUserId(db, 2);

      expect(shelves.map(s => s.id).sort()).toEqual([4, 5, 6]);
    });

    it('returns an empty array for a non-existent user', () => {
      expect(Shelf.getShelvesByUserId(db, 999)).toEqual([]);
    });
  });

  describe('getShelfById', () => {
    it('returns a shelf with snake_case column fields', () => {
      const shelf = Shelf.getShelfById(db, ALICE_READ_SHELF);

      expect(shelf?.name).toBe('read');
      expect(shelf?.user_id).toBe(1);
      expect(shelf?.created_at).toEqual(expect.any(String));
    });

    it('returns undefined for a non-existent id', () => {
      expect(Shelf.getShelfById(db, 999)).toBeUndefined();
    });
  });

  describe('getShelfWithBooks', () => {
    it('returns the shelf, its owner\'s username, and its books ordered by title', () => {
      const shelf = Shelf.getShelfWithBooks(db, ALICE_READ_SHELF);

      expect(shelf?.name).toBe('read');
      expect(shelf?.username).toBe('alice');
      expect(shelf?.books.map(b => b.title)).toEqual([
        'Clean Code',
        'Dune',
        'The Pragmatic Programmer'
      ]);
    });

    it('includes the join-table and book columns for each entry', () => {
      const shelf = Shelf.getShelfWithBooks(db, ALICE_READ_SHELF);
      const cleanCode = shelf!.books[0];

      expect(cleanCode.book_id).toBe(2);
      expect(cleanCode.author).toBe('Robert C. Martin');
      expect(cleanCode.added_at).toEqual(expect.any(String));
    });

    it('returns an empty books array for an empty shelf', () => {
      const empty = Shelf.createShelf(db, 1, 'abandoned');

      const shelf = Shelf.getShelfWithBooks(db, empty.id);

      expect(shelf?.name).toBe('abandoned');
      expect(shelf?.books).toEqual([]);
    });

    it('returns undefined for a non-existent shelf', () => {
      expect(Shelf.getShelfWithBooks(db, 999)).toBeUndefined();
    });
  });

  describe('createShelf', () => {
    it('creates a shelf and returns the persisted row', () => {
      const shelf = Shelf.createShelf(db, 1, 'favorites');

      expect(shelf.id).toBeDefined();
      expect(shelf.user_id).toBe(1);
      expect(shelf.name).toBe('favorites');
      expect(Shelf.getShelfById(db, shelf.id)).toEqual(shelf);
    });

    it('rejects a duplicate shelf name for the same user', () => {
      expect(() => Shelf.createShelf(db, 1, 'read')).toThrow(
        /UNIQUE constraint failed: shelves.user_id, shelves.name/
      );
    });

    it('allows the same shelf name for a different user', () => {
      const alices = Shelf.createShelf(db, 1, 'favorites');
      const bobs = Shelf.createShelf(db, 2, 'favorites');

      expect(alices.id).not.toBe(bobs.id);
      expect(Shelf.getShelvesByUserId(db, 1).map(s => s.name)).toContain('favorites');
      expect(Shelf.getShelvesByUserId(db, 2).map(s => s.name)).toContain('favorites');
    });

    it('rejects a shelf for a non-existent user', () => {
      expect(() => Shelf.createShelf(db, 999, 'orphan')).toThrow(
        /FOREIGN KEY constraint failed/
      );
    });

    it('rejects a missing shelf name', () => {
      expect(() => Shelf.createShelf(db, 1, null as unknown as string)).toThrow(
        /NOT NULL constraint failed: shelves.name/
      );
    });
  });

  describe('deleteShelf', () => {
    it('deletes a shelf and reports success', () => {
      expect(Shelf.deleteShelf(db, ALICE_READ_SHELF)).toBe(true);
      expect(Shelf.getShelfById(db, ALICE_READ_SHELF)).toBeUndefined();
      expect(Shelf.getShelvesByUserId(db, 1)).toHaveLength(2);
    });

    it('returns false for a non-existent id', () => {
      expect(Shelf.deleteShelf(db, 999)).toBe(false);
    });

    it('cascades to its shelf_books rows without deleting the books', () => {
      Shelf.deleteShelf(db, ALICE_READ_SHELF);

      const links = db
        .prepare('SELECT COUNT(*) as count FROM shelf_books WHERE shelf_id = ?')
        .get(ALICE_READ_SHELF) as { count: number };
      const books = db.prepare('SELECT COUNT(*) as count FROM books').get() as {
        count: number;
      };

      expect(links.count).toBe(0);
      expect(books.count).toBe(50);
    });
  });

  describe('addBookToShelf', () => {
    it('adds a book and reports that it was added', () => {
      expect(Shelf.addBookToShelf(db, ALICE_READ_SHELF, 5)).toBe(true);
      expect(
        Shelf.getShelfWithBooks(db, ALICE_READ_SHELF)?.books.map(b => b.book_id)
      ).toContain(5);
    });

    it('reports false without duplicating an existing entry', () => {
      // Book 1 is already on alice's read shelf.
      expect(Shelf.addBookToShelf(db, ALICE_READ_SHELF, 1)).toBe(false);

      const links = db
        .prepare('SELECT COUNT(*) as count FROM shelf_books WHERE shelf_id = ? AND book_id = ?')
        .get(ALICE_READ_SHELF, 1) as { count: number };
      expect(links.count).toBe(1);
    });

    it('allows the same book on two different shelves', () => {
      expect(Shelf.addBookToShelf(db, 1, 1)).toBe(true);
      expect(Shelf.getShelvesForBook(db, 1, 1).map(s => s.name).sort()).toEqual([
        'read',
        'want-to-read'
      ]);
    });

    it('rejects a non-existent book', () => {
      expect(() => Shelf.addBookToShelf(db, ALICE_READ_SHELF, 999)).toThrow(
        /FOREIGN KEY constraint failed/
      );
    });

    it('rejects a non-existent shelf', () => {
      expect(() => Shelf.addBookToShelf(db, 999, 1)).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe('removeBookFromShelf', () => {
    it('removes a book and reports success', () => {
      expect(Shelf.removeBookFromShelf(db, ALICE_READ_SHELF, 1)).toBe(true);
      expect(
        Shelf.getShelfWithBooks(db, ALICE_READ_SHELF)?.books.map(b => b.book_id)
      ).not.toContain(1);
    });

    it('returns false when the book is not on the shelf', () => {
      expect(Shelf.removeBookFromShelf(db, ALICE_READ_SHELF, 5)).toBe(false);
    });

    it('returns false for a non-existent shelf', () => {
      expect(Shelf.removeBookFromShelf(db, 999, 1)).toBe(false);
    });

    it('leaves the book itself and the same book on other shelves alone', () => {
      Shelf.removeBookFromShelf(db, ALICE_READ_SHELF, 1);

      const book = db.prepare('SELECT * FROM books WHERE id = 1').get();
      expect(book).toBeDefined();
      // Book 1 is also on bob's read shelf.
      expect(Shelf.getShelvesForBook(db, 2, 1).map(s => s.id)).toEqual([BOB_READ_SHELF]);
    });
  });

  describe('getShelvesForBook', () => {
    it('returns the shelves of that user holding the book', () => {
      const shelves = Shelf.getShelvesForBook(db, 1, 1);

      expect(shelves).toHaveLength(1);
      expect(shelves[0].id).toBe(ALICE_READ_SHELF);
      expect(shelves[0].name).toBe('read');
    });

    it('is scoped to the given user', () => {
      expect(Shelf.getShelvesForBook(db, 2, 1).map(s => s.id)).toEqual([BOB_READ_SHELF]);
      expect(Shelf.getShelvesForBook(db, 3, 1)).toEqual([]);
    });

    it('orders multiple shelves by name', () => {
      Shelf.addBookToShelf(db, 1, 1);
      Shelf.addBookToShelf(db, 2, 1);

      expect(Shelf.getShelvesForBook(db, 1, 1).map(s => s.name)).toEqual([
        'currently-reading',
        'read',
        'want-to-read'
      ]);
    });

    it('returns an empty array when the book is on no shelf of that user', () => {
      expect(Shelf.getShelvesForBook(db, 1, 50)).toEqual([]);
    });

    it('returns an empty array for a non-existent user or book', () => {
      expect(Shelf.getShelvesForBook(db, 999, 1)).toEqual([]);
      expect(Shelf.getShelvesForBook(db, 1, 999)).toEqual([]);
    });
  });
});
