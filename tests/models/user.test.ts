import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, closeDb } from '../../src/db/index.js';
import * as User from '../../src/models/user.js';

const TEST_DB_PATH = '/tmp/test-user-model.db';

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

describe('User Model', () => {
  describe('getAllUsers', () => {
    it('returns all seeded users ordered by display name', () => {
      const users = User.getAllUsers(db);

      expect(users).toHaveLength(3);
      expect(users.map(u => u.display_name)).toEqual([
        'Alice Chen',
        'Bob Martinez',
        'Carol Okafor'
      ]);
    });

    it('returns an empty array when there are no users', () => {
      db.prepare('DELETE FROM users').run();

      expect(User.getAllUsers(db)).toEqual([]);
    });
  });

  describe('getUserById', () => {
    it('returns a user with snake_case column fields', () => {
      const user = User.getUserById(db, 1);

      expect(user).toBeDefined();
      expect(user?.username).toBe('alice');
      expect(user?.display_name).toBe('Alice Chen');
      expect(user?.created_at).toEqual(expect.any(String));
    });

    it('returns undefined for a non-existent id', () => {
      expect(User.getUserById(db, 999)).toBeUndefined();
    });
  });

  describe('getUserByUsername', () => {
    it('returns a user by username', () => {
      const user = User.getUserByUsername(db, 'bob');

      expect(user?.id).toBe(2);
      expect(user?.display_name).toBe('Bob Martinez');
    });

    it('returns undefined for an unknown username', () => {
      expect(User.getUserByUsername(db, 'nobody')).toBeUndefined();
    });

    it('does not match a username by prefix', () => {
      expect(User.getUserByUsername(db, 'ali')).toBeUndefined();
    });
  });

  describe('createUser', () => {
    it('creates a user and returns the persisted row', () => {
      const user = User.createUser(db, 'dave', 'Dave Kim');

      expect(user.id).toBeDefined();
      expect(user.username).toBe('dave');
      expect(user.display_name).toBe('Dave Kim');
      expect(User.getUserById(db, user.id)).toEqual(user);
    });

    it('rejects a duplicate username', () => {
      expect(() => User.createUser(db, 'alice', 'Another Alice')).toThrow(
        /UNIQUE constraint failed: users.username/
      );
    });

    it('rejects a missing display name', () => {
      expect(() => User.createUser(db, 'dave', null as unknown as string)).toThrow(
        /NOT NULL constraint failed: users.display_name/
      );
    });
  });

  describe('updateUser', () => {
    it('updates only the display name', () => {
      const updated = User.updateUser(db, 1, { displayName: 'Alice C.' });

      expect(updated?.display_name).toBe('Alice C.');
      expect(updated?.username).toBe('alice');
    });

    it('updates the username and display name together', () => {
      const updated = User.updateUser(db, 1, {
        username: 'alicec',
        displayName: 'Alice C.'
      });

      expect(updated?.username).toBe('alicec');
      expect(updated?.display_name).toBe('Alice C.');
      expect(User.getUserByUsername(db, 'alice')).toBeUndefined();
    });

    it('returns the untouched user when no fields are given', () => {
      const before = User.getUserById(db, 1);

      expect(User.updateUser(db, 1, {})).toEqual(before);
    });

    it('returns undefined for a non-existent id', () => {
      expect(User.updateUser(db, 999, { displayName: 'Ghost' })).toBeUndefined();
    });

    it('rejects an update that collides with another username', () => {
      expect(() => User.updateUser(db, 1, { username: 'bob' })).toThrow(
        /UNIQUE constraint failed: users.username/
      );
      expect(User.getUserById(db, 1)?.username).toBe('alice');
    });
  });

  describe('deleteUser', () => {
    it('deletes a user and reports success', () => {
      expect(User.deleteUser(db, 3)).toBe(true);
      expect(User.getUserById(db, 3)).toBeUndefined();
      expect(User.getAllUsers(db)).toHaveLength(2);
    });

    it('returns false for a non-existent id', () => {
      expect(User.deleteUser(db, 999)).toBe(false);
      expect(User.getAllUsers(db)).toHaveLength(3);
    });

    it('cascades to the shelves, shelf books, and reviews it owns', () => {
      const countFor = (sql: string) =>
        (db.prepare(sql).get(1) as { count: number }).count;

      expect(countFor('SELECT COUNT(*) as count FROM shelves WHERE user_id = ?')).toBe(3);
      expect(countFor('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?')).toBe(3);

      User.deleteUser(db, 1);

      expect(countFor('SELECT COUNT(*) as count FROM shelves WHERE user_id = ?')).toBe(0);
      expect(countFor('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?')).toBe(0);
      // shelf_books rows cascade through the deleted shelves (ids 1-3)
      const orphans = db
        .prepare('SELECT COUNT(*) as count FROM shelf_books WHERE shelf_id IN (1, 2, 3)')
        .get() as { count: number };
      expect(orphans.count).toBe(0);
    });

    it('leaves other users and their data intact', () => {
      User.deleteUser(db, 1);

      expect(User.getUserByUsername(db, 'bob')).toBeDefined();
      const bobReviews = db
        .prepare('SELECT COUNT(*) as count FROM reviews WHERE user_id = 2')
        .get() as { count: number };
      expect(bobReviews.count).toBe(4);
    });
  });
});
