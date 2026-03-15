import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createScopedDatabase,
  ScopedDatabaseError,
} from "./scoped-database.js";
import type { ScopedDatabase } from "./scoped-database.js";

describe("ScopedDatabase", () => {
  let rawDb: InstanceType<typeof Database>;
  let scoped: ScopedDatabase;

  const EXTENSION_NAME = "myext";
  const PROJECT_ID = "proj-abc-123";

  beforeEach(() => {
    rawDb = new Database(":memory:");
    rawDb.pragma("journal_mode = WAL");
    scoped = createScopedDatabase(rawDb, EXTENSION_NAME, PROJECT_ID);
  });

  // ---------------------------------------------------------------------------
  // 1. Properties
  // ---------------------------------------------------------------------------
  describe("properties", () => {
    it("tablePrefix is ext_{name}_", () => {
      expect(scoped.tablePrefix).toBe("ext_myext_");
    });

    it("projectId returns the provided project ID", () => {
      expect(scoped.projectId).toBe(PROJECT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. CREATE TABLE with correct prefix
  // ---------------------------------------------------------------------------
  describe("CREATE TABLE with correct prefix", () => {
    it("allows creating a table with the correct prefix via exec", () => {
      expect(() => {
        scoped.exec(
          "CREATE TABLE ext_myext_items (id INTEGER PRIMARY KEY, name TEXT, project_id TEXT)",
        );
      }).not.toThrow();

      // Verify the table actually exists by querying it through raw db
      const info = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ext_myext_items'",
        )
        .get() as { name: string } | undefined;
      expect(info).toBeDefined();
      expect(info!.name).toBe("ext_myext_items");
    });

    it("allows CREATE TABLE IF NOT EXISTS", () => {
      expect(() => {
        scoped.exec(
          "CREATE TABLE IF NOT EXISTS ext_myext_logs (id INTEGER PRIMARY KEY, message TEXT)",
        );
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. CREATE INDEX with correct prefix
  // ---------------------------------------------------------------------------
  describe("CREATE INDEX with correct prefix", () => {
    it("allows creating an index on a correctly prefixed table", () => {
      scoped.exec(
        "CREATE TABLE ext_myext_items (id INTEGER PRIMARY KEY, name TEXT)",
      );

      expect(() => {
        scoped.exec("CREATE INDEX ext_myext_items_name ON ext_myext_items (name)");
      }).not.toThrow();

      // Verify index exists
      const idx = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='ext_myext_items_name'",
        )
        .get() as { name: string } | undefined;
      expect(idx).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ALTER TABLE ADD COLUMN with correct prefix
  // ---------------------------------------------------------------------------
  describe("ALTER TABLE ADD COLUMN with correct prefix", () => {
    it("allows adding a column to a correctly prefixed table", () => {
      scoped.exec(
        "CREATE TABLE ext_myext_items (id INTEGER PRIMARY KEY, name TEXT)",
      );

      expect(() => {
        scoped.exec("ALTER TABLE ext_myext_items ADD COLUMN description TEXT");
      }).not.toThrow();

      // Verify column exists by inserting a row with description
      rawDb
        .prepare(
          "INSERT INTO ext_myext_items (id, name, description) VALUES (1, 'test', 'a description')",
        )
        .run();
      const row = rawDb
        .prepare("SELECT description FROM ext_myext_items WHERE id = 1")
        .get() as { description: string };
      expect(row.description).toBe("a description");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. DROP TABLE blocked
  // ---------------------------------------------------------------------------
  describe("DROP TABLE blocked", () => {
    it("throws ScopedDatabaseError when attempting DROP TABLE", () => {
      scoped.exec(
        "CREATE TABLE ext_myext_items (id INTEGER PRIMARY KEY, name TEXT)",
      );

      expect(() => {
        scoped.exec("DROP TABLE ext_myext_items");
      }).toThrow(ScopedDatabaseError);
    });

    it("error message mentions DROP", () => {
      expect(() => {
        scoped.exec("DROP TABLE ext_myext_items");
      }).toThrow(/DROP/);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. ALTER TABLE DROP blocked
  // ---------------------------------------------------------------------------
  describe("ALTER TABLE DROP blocked", () => {
    it("throws ScopedDatabaseError when attempting ALTER TABLE DROP COLUMN", () => {
      expect(() => {
        scoped.exec("ALTER TABLE ext_myext_items DROP COLUMN name");
      }).toThrow(ScopedDatabaseError);
    });

    it("error message mentions DROP", () => {
      expect(() => {
        scoped.exec("ALTER TABLE ext_myext_items DROP COLUMN name");
      }).toThrow(/DROP/);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Core table access blocked
  // ---------------------------------------------------------------------------
  describe("core table access blocked", () => {
    it("blocks SELECT from _sessions", () => {
      expect(() => {
        scoped.prepare("SELECT * FROM _sessions");
      }).toThrow(ScopedDatabaseError);
      expect(() => {
        scoped.prepare("SELECT * FROM _sessions");
      }).toThrow(/core table "_sessions"/);
    });

    it("blocks SELECT from _vault", () => {
      expect(() => {
        scoped.prepare("SELECT * FROM _vault");
      }).toThrow(ScopedDatabaseError);
    });

    it("blocks SELECT from _migrations", () => {
      expect(() => {
        scoped.prepare("SELECT * FROM _migrations");
      }).toThrow(ScopedDatabaseError);
    });

    it("blocks INSERT into _tool_audit", () => {
      expect(() => {
        scoped.prepare("INSERT INTO _tool_audit (id) VALUES (?)");
      }).toThrow(ScopedDatabaseError);
    });

    it("blocks SELECT from _observations", () => {
      expect(() => {
        scoped.prepare("SELECT * FROM _observations WHERE id = ?");
      }).toThrow(ScopedDatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Wrong prefix blocked
  // ---------------------------------------------------------------------------
  describe("wrong prefix blocked", () => {
    it("blocks access to tables with a different extension prefix", () => {
      expect(() => {
        scoped.prepare("SELECT * FROM ext_other_items");
      }).toThrow(ScopedDatabaseError);
      expect(() => {
        scoped.prepare("SELECT * FROM ext_other_items");
      }).toThrow(/prefix "ext_myext_"/);
    });

    it("blocks INSERT into tables with wrong prefix", () => {
      expect(() => {
        scoped.prepare(
          "INSERT INTO ext_other_items (name) VALUES (?)",
        );
      }).toThrow(ScopedDatabaseError);
    });

    it("blocks UPDATE on tables with wrong prefix", () => {
      expect(() => {
        scoped.prepare("UPDATE ext_other_items SET name = ? WHERE id = ?");
      }).toThrow(ScopedDatabaseError);
    });

    it("blocks DELETE on tables with wrong prefix", () => {
      expect(() => {
        scoped.prepare("DELETE FROM ext_other_items WHERE id = ?");
      }).toThrow(ScopedDatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. CRUD operations with correct prefix work
  // ---------------------------------------------------------------------------
  describe("CRUD operations with correct prefix", () => {
    beforeEach(() => {
      scoped.exec(
        "CREATE TABLE ext_myext_items (id INTEGER PRIMARY KEY, name TEXT, project_id TEXT)",
      );
    });

    it("INSERT works via prepare().run()", () => {
      const stmt = scoped.prepare(
        "INSERT INTO ext_myext_items (name, project_id) VALUES (?, ?)",
      );
      const result = stmt.run("item1");
      expect(result.changes).toBe(1);
    });

    it("SELECT works via prepare().all()", () => {
      // Insert directly with raw db so we control the data
      rawDb
        .prepare(
          "INSERT INTO ext_myext_items (name, project_id) VALUES (?, ?)",
        )
        .run("alpha", PROJECT_ID);
      rawDb
        .prepare(
          "INSERT INTO ext_myext_items (name, project_id) VALUES (?, ?)",
        )
        .run("beta", PROJECT_ID);

      const stmt = scoped.prepare(
        "SELECT * FROM ext_myext_items WHERE project_id = ?",
      );
      const rows = stmt.all() as Array<{ name: string; project_id: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.project_id).toBe(PROJECT_ID);
      expect(rows[1]!.project_id).toBe(PROJECT_ID);
    });

    it("SELECT with get() returns a single row", () => {
      rawDb
        .prepare(
          "INSERT INTO ext_myext_items (id, name, project_id) VALUES (?, ?, ?)",
        )
        .run(1, "sole-item", PROJECT_ID);

      const stmt = scoped.prepare(
        "SELECT * FROM ext_myext_items WHERE project_id = ? AND id = ?",
      );
      const row = stmt.get(1) as { id: number; name: string; project_id: string };
      expect(row).toBeDefined();
      expect(row.name).toBe("sole-item");
      expect(row.project_id).toBe(PROJECT_ID);
    });

    it("UPDATE works via prepare().run()", () => {
      rawDb
        .prepare(
          "INSERT INTO ext_myext_items (id, name, project_id) VALUES (?, ?, ?)",
        )
        .run(1, "old-name", PROJECT_ID);

      // When auto-injection prepends project_id, the SQL must have project_id = ?
      // as the first positional placeholder for the prepend to align correctly.
      const stmt = scoped.prepare(
        "UPDATE ext_myext_items SET name = 'new-name' WHERE project_id = ? AND id = ?",
      );
      const result = stmt.run(1);
      expect(result.changes).toBe(1);

      const row = rawDb
        .prepare("SELECT name FROM ext_myext_items WHERE id = 1")
        .get() as { name: string };
      expect(row.name).toBe("new-name");
    });

    it("DELETE works via prepare().run()", () => {
      rawDb
        .prepare(
          "INSERT INTO ext_myext_items (id, name, project_id) VALUES (?, ?, ?)",
        )
        .run(1, "to-delete", PROJECT_ID);

      const stmt = scoped.prepare(
        "DELETE FROM ext_myext_items WHERE project_id = ? AND id = ?",
      );
      const result = stmt.run(1);
      expect(result.changes).toBe(1);

      const row = rawDb
        .prepare("SELECT * FROM ext_myext_items WHERE id = 1")
        .get();
      expect(row).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 10. project_id auto-injection for SELECT
  // ---------------------------------------------------------------------------
  describe("project_id auto-injection", () => {
    beforeEach(() => {
      scoped.exec(
        "CREATE TABLE ext_myext_tasks (id INTEGER PRIMARY KEY, title TEXT, project_id TEXT)",
      );
      // Seed data for two different projects
      rawDb
        .prepare(
          "INSERT INTO ext_myext_tasks (id, title, project_id) VALUES (?, ?, ?)",
        )
        .run(1, "task-a", PROJECT_ID);
      rawDb
        .prepare(
          "INSERT INTO ext_myext_tasks (id, title, project_id) VALUES (?, ?, ?)",
        )
        .run(2, "task-b", "proj-other");
    });

    it("SELECT with WHERE project_id = ? auto-injects projectId", () => {
      const stmt = scoped.prepare(
        "SELECT * FROM ext_myext_tasks WHERE project_id = ?",
      );
      // No need to pass projectId — it should be auto-injected
      const rows = stmt.all() as Array<{ id: number; title: string; project_id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toBe("task-a");
      expect(rows[0]!.project_id).toBe(PROJECT_ID);
    });

    it("INSERT with project_id column auto-injects projectId", () => {
      // project_id is detected in column list; the auto-injector splices projectId
      // at position 0 (since project_id appears in the column list before any ? in the SQL).
      // So the column list should put project_id first for correct alignment.
      const stmt = scoped.prepare(
        "INSERT INTO ext_myext_tasks (project_id, title) VALUES (?, ?)",
      );
      // Only pass title — project_id should be auto-injected at position 0
      stmt.run("task-c");

      const row = rawDb
        .prepare(
          "SELECT * FROM ext_myext_tasks WHERE title = 'task-c'",
        )
        .get() as { title: string; project_id: string };
      expect(row).toBeDefined();
      expect(row.project_id).toBe(PROJECT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. project_id auto-injection for INSERT
  // ---------------------------------------------------------------------------
  describe("project_id injection position for INSERT", () => {
    beforeEach(() => {
      scoped.exec(
        "CREATE TABLE ext_myext_records (id INTEGER PRIMARY KEY, project_id TEXT, value TEXT)",
      );
    });

    it("injects project_id at the correct position when it is not the last column", () => {
      const stmt = scoped.prepare(
        "INSERT INTO ext_myext_records (project_id, value) VALUES (?, ?)",
      );
      // project_id is the first placeholder, so auto-inject fills it;
      // only the value param needs to be provided
      stmt.run("hello");

      const row = rawDb
        .prepare("SELECT * FROM ext_myext_records WHERE value = 'hello'")
        .get() as { project_id: string; value: string };
      expect(row).toBeDefined();
      expect(row.project_id).toBe(PROJECT_ID);
      expect(row.value).toBe("hello");
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Transactions work
  // ---------------------------------------------------------------------------
  describe("transactions", () => {
    beforeEach(() => {
      scoped.exec(
        "CREATE TABLE ext_myext_accounts (id INTEGER PRIMARY KEY, balance INTEGER, project_id TEXT)",
      );
      rawDb
        .prepare(
          "INSERT INTO ext_myext_accounts (id, balance, project_id) VALUES (?, ?, ?)",
        )
        .run(1, 100, PROJECT_ID);
      rawDb
        .prepare(
          "INSERT INTO ext_myext_accounts (id, balance, project_id) VALUES (?, ?, ?)",
        )
        .run(2, 50, PROJECT_ID);
    });

    it("commits multiple operations atomically", () => {
      // Use literal amounts so project_id = ? is the first positional placeholder
      // (auto-injection prepends projectId to params)
      const debit = scoped.prepare(
        "UPDATE ext_myext_accounts SET balance = balance - 30 WHERE project_id = ? AND id = ?",
      );
      const credit = scoped.prepare(
        "UPDATE ext_myext_accounts SET balance = balance + 30 WHERE project_id = ? AND id = ?",
      );

      scoped.transaction(() => {
        debit.run(1);
        credit.run(2);
      });

      const row1 = rawDb
        .prepare("SELECT balance FROM ext_myext_accounts WHERE id = 1")
        .get() as { balance: number };
      const row2 = rawDb
        .prepare("SELECT balance FROM ext_myext_accounts WHERE id = 2")
        .get() as { balance: number };

      expect(row1.balance).toBe(70);
      expect(row2.balance).toBe(80);
    });

    it("rolls back on error", () => {
      const debit = scoped.prepare(
        "UPDATE ext_myext_accounts SET balance = balance - 30 WHERE project_id = ? AND id = ?",
      );

      expect(() => {
        scoped.transaction(() => {
          debit.run(1);
          throw new Error("Simulated failure");
        });
      }).toThrow("Simulated failure");

      // Balance should be unchanged
      const row1 = rawDb
        .prepare("SELECT balance FROM ext_myext_accounts WHERE id = 1")
        .get() as { balance: number };
      expect(row1.balance).toBe(100);
    });
  });
});
