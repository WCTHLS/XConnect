/**
 * Checks that device rows are not rewritten on every sensor batch.
 *
 *   pnpm exec tsx src/test_persistence.ts
 *
 * upsertDevice runs once per batch from every device, and each write holds a database connection
 * for a full round trip. With the database far from the API the pool cannot send them as fast as
 * they arrive and the unsent writes pile up in memory (see docs/LOAD_TEST_RESULTS.md). The engine's
 * persistence manager is driven here against a fake database that only counts the writes it gets.
 */
import { EnginePersistenceManager } from "./engine/persistence.js";

type Write = { deviceId: string; displayName?: string };

function fakeDb(options: { failNext?: () => boolean } = {}) {
  const writes: Write[] = [];
  const db = {
    insert: () => ({
      values: (row: Write) => ({
        onConflictDoUpdate: () => {
          if (options.failNext?.()) return Promise.reject(new Error("connection reset"));
          writes.push({ deviceId: row.deviceId, displayName: row.displayName });
          return Promise.resolve();
        }
      })
    })
  };
  return { db: db as never, writes };
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const REFRESH = EnginePersistenceManager.DEVICE_REFRESH_MS;
const T0 = 1_000_000_000_000;

async function main() {
  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    p.upsertDevice("d1", "Alice", T0);
    await settle();
    check("a device's first appearance is written", writes.length === 1);

    for (let i = 1; i <= 50; i++) p.upsertDevice("d1", "Alice", T0 + i * 10_000);
    await settle();
    check("fifty more batches with the same name write nothing", writes.length === 1, `got ${writes.length}`);
  }

  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    p.upsertDevice("d1", "Alice", T0);
    p.upsertDevice("d1", "Alice B.", T0 + 10_000);
    await settle();
    check("a changed name is written", writes.length === 2 && writes[1].displayName === "Alice B.");
    p.upsertDevice("d1", "Alice B.", T0 + 20_000);
    await settle();
    check("and then not again", writes.length === 2);
  }

  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    p.upsertDevice("d1", "Alice", T0);
    p.upsertDevice("d1", undefined, T0 + 10_000);
    await settle();
    check("a batch with no name is not a name change", writes.length === 1);
  }

  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    p.upsertDevice("d1", "Alice", T0);
    p.upsertDevice("d1", "Alice", T0 + REFRESH - 1);
    await settle();
    check("just inside the refresh interval writes nothing", writes.length === 1);
    p.upsertDevice("d1", "Alice", T0 + REFRESH);
    await settle();
    check("after the refresh interval it writes once to keep last_seen_at current", writes.length === 2);
    p.upsertDevice("d1", "Alice", T0 + REFRESH + 10_000);
    await settle();
    check("and the interval restarts from that write", writes.length === 2);
  }

  {
    let failures = 1;
    const { db, writes } = fakeDb({ failNext: () => failures-- > 0 });
    const originalError = console.error;
    console.error = () => {};
    const p = new EnginePersistenceManager(db);
    p.upsertDevice("d1", "Alice", T0);
    await settle();
    console.error = originalError;
    check("a failed write lands nothing", writes.length === 0);
    p.upsertDevice("d1", "Alice", T0 + 10_000);
    await settle();
    check("the next batch retries it", writes.length === 1);
  }

  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    for (let batch = 0; batch < 20; batch++) {
      for (let d = 0; d < 1000; d++) p.upsertDevice(`device-${d}`, `Person ${d}`, T0 + batch * 10_000);
    }
    await settle();
    check("1000 devices over 20 batches: one write each, not 20,000", writes.length === 1000, `got ${writes.length}`);
  }

  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    p.upsertDevice("d1", "Alice", T0);
    p.upsertDevice("d1", "Alice", T0 + 1);
    check("the in-flight write is tracked for state changes that reference the row", p.pendingDeviceCreation.has("d1"));
    await settle();
    check("and cleared once it lands", !p.pendingDeviceCreation.has("d1") && writes.length === 1);
  }

  {
    const p = new EnginePersistenceManager(undefined);
    let threw = false;
    try {
      p.upsertDevice("d1", "Alice", T0);
    } catch {
      threw = true;
    }
    check("with no database configured it does nothing and does not throw", !threw);
  }

  {
    const { db, writes } = fakeDb();
    const p = new EnginePersistenceManager(db);
    const max = EnginePersistenceManager.DEVICE_CACHE_MAX;
    for (let d = 0; d < max + 5; d++) p.upsertDevice(`device-${d}`, "x", T0);
    await settle();
    check("the memory of written devices is bounded", writes.length === max + 5);
    p.upsertDevice("device-0", "x", T0 + 1);
    await settle();
    check(
      "past the bound it forgets and rewrites a device once, rather than growing",
      writes.length === max + 6,
      `got ${writes.length}, wanted ${max + 6}`
    );
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✅ All persistence checks passed.");
}

void main();
