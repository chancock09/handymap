import { HISTORY_LIMIT, type HistoryPage, type Ping } from "../protocol";
import { RequestError } from "./http";

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function readHistoryQuery(url: URL) {
  const invalid = (): never => {
    throw new RequestError(
      400,
      "invalid_query",
      "Use q (up to 240 characters), limit (1–200), and before (a positive integer cursor).",
    );
  };
  for (const key of url.searchParams.keys()) {
    if (
      !["q", "limit", "before"].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      invalid();
  }
  const q = url.searchParams.get("q") ?? "";
  if ([...q].length > 240) invalid();
  const integer = (key: string, fallback: number, max: number) => {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    const parsed = Number(value);
    if (
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(parsed) ||
      parsed > max
    )
      invalid();
    return parsed;
  };
  return {
    terms: normalize(q).split(" ").filter(Boolean),
    limit: integer("limit", 50, 200),
    before: integer("before", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  };
}

export class PingHistory {
  constructor(private sql: SqlStorage) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS history (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        search TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(
        search, content='history', content_rowid='seq', tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS history_insert AFTER INSERT ON history BEGIN
        INSERT INTO history_search(rowid, search) VALUES (new.seq, new.search);
      END;
      CREATE TRIGGER IF NOT EXISTS history_delete AFTER DELETE ON history BEGIN
        INSERT INTO history_search(history_search, rowid, search) VALUES ('delete', old.seq, old.search);
      END;
    `);
  }

  record(ping: Ping) {
    const { seq } = this.sql
      .exec<{ seq: number }>(
        "INSERT INTO history(payload, search) VALUES (?, ?) RETURNING seq",
        JSON.stringify(ping),
        `${normalize(ping.title)}\n${normalize(ping.message)}`,
      )
      .one();
    this.sql.exec("DELETE FROM history WHERE seq <= ?", seq - HISTORY_LIMIT);
  }

  read(query: ReturnType<typeof readHistoryQuery>): HistoryPage {
    const indexed = query.terms.filter(
      (term) => [...term].length >= 3 && !term.includes("\0"),
    );
    const clauses: string[] = [];
    const bindings: (string | number)[] = [];
    if (indexed.length) {
      clauses.push(
        "seq IN (SELECT rowid FROM history_search WHERE history_search MATCH ?)",
      );
      bindings.push(
        indexed.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND "),
      );
    }
    if (query.terms.length) {
      clauses.push(
        "NOT EXISTS (SELECT 1 FROM json_each(?) WHERE instr(history.search, value) = 0)",
      );
      bindings.push(JSON.stringify(query.terms));
    }
    const where = clauses.length ? clauses.join(" AND ") : "1";
    const { total } = this.sql
      .exec<{ total: number }>(
        `SELECT count(*) AS total FROM history WHERE ${where}`,
        ...bindings,
      )
      .one();
    const rows = this.sql
      .exec<{ seq: number; payload: string }>(
        `SELECT seq, payload FROM history WHERE ${where} AND seq < ? ORDER BY seq DESC LIMIT ?`,
        ...bindings,
        query.before,
        query.limit + 1,
      )
      .toArray();
    const more = rows.length > query.limit;
    if (more) rows.pop();
    return {
      pings: rows.map((row) => JSON.parse(row.payload) as Ping),
      total,
      next: more ? rows[rows.length - 1].seq : null,
      serverTime: Date.now(),
    };
  }
}
