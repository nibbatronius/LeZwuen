const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

class Pool {
  constructor(options = {}) {
    const fallbackPath = path.join(process.cwd(), "lezwuen.sqlite");
    const dbPath =
      options.connectionString ||
      options.database ||
      process.env.LEZWUEN_DB_PATH ||
      fallbackPath;

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  query(text, params = []) {
    const cleaned = String(text || "").trim();
    if (!cleaned) {
      return { rows: [] };
    }

    if (/ALTER TABLE\s+\w+\s+ALTER COLUMN\s+\w+\s+DROP DEFAULT/i.test(cleaned)) {
      return { rows: [] };
    }

    const addColumnMatch = cleaned.match(
      /ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)\s+(.+)/i
    );
    if (addColumnMatch) {
      const [, table, column, definition] = addColumnMatch;
      const existing = this.db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === column);
      if (existing) {
        return { rows: [] };
      }
      const statement = `ALTER TABLE ${table} ADD COLUMN ${column} ${definition.replace(
        /;$/,
        ""
      )}`;
      this.db.exec(statement);
      return { rows: [] };
    }

    const normalized = normalizeSql(cleaned, params);
    if (normalized.exec) {
      this.db.exec(normalized.sql);
      return { rows: [] };
    }

    const stmt = this.db.prepare(normalized.sql);
    if (normalized.returnsRows) {
      const rows = stmt.all(normalized.params);
      return { rows };
    }

    const info = stmt.run(normalized.params);
    return { rows: [], rowCount: info.changes };
  }
}

function normalizeSql(sql, params) {
  let nextSql = sql
    .replace(/SERIAL PRIMARY KEY/gi, "INTEGER PRIMARY KEY AUTOINCREMENT")
    .replace(/TIMESTAMPTZ/gi, "TEXT")
    .replace(/NOW\(\)/gi, "CURRENT_TIMESTAMP");

  const hasParams = Array.isArray(params) && params.length > 0;
  const transformed = replaceParams(nextSql, params);
  nextSql = transformed.sql;
  const trimmed = nextSql.trim();

  const baseCommand = detectBaseCommand(nextSql);
  const isSelectLike = baseCommand === "SELECT";

  if (
    !hasParams &&
    nextSql.includes(";") &&
    !/RETURNING/i.test(nextSql) &&
    !isSelectLike &&
    baseCommand !== "WITH"
  ) {
    return {
      exec: true,
      sql: nextSql
    };
  }

  return {
    exec: false,
    sql: nextSql,
    params: transformed.params,
    returnsRows: isSelectLike || /RETURNING/i.test(nextSql)
  };
}

function detectBaseCommand(sql) {
  const trimmed = sql.trim();
  if (!trimmed) {
    return "";
  }
  const simpleMatch = trimmed.match(
    /^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|TRUNCATE|REPLACE|BEGIN|COMMIT|ROLLBACK)\b/i
  );
  if (simpleMatch) {
    return simpleMatch[1].toUpperCase();
  }
  if (!/^WITH\b/i.test(trimmed)) {
    const fallback = trimmed.split(/\s+/)[0];
    return fallback ? fallback.toUpperCase() : "";
  }
  let depth = 0;
  for (let i = 4; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth = Math.max(depth - 1, 0);
      if (depth === 0) {
        let j = i + 1;
        while (j < trimmed.length && /\s/.test(trimmed[j])) {
          j += 1;
        }
        if (trimmed[j] === ",") {
          i = j;
          continue;
        }
        const rest = trimmed.slice(j);
        const nextMatch = rest.match(
          /^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|TRUNCATE|REPLACE|BEGIN|COMMIT|ROLLBACK)\b/i
        );
        if (nextMatch) {
          return nextMatch[1].toUpperCase();
        }
        break;
      }
    }
  }
  return "";
}

function replaceParams(sql, params) {
  if (!Array.isArray(params) || !params.length) {
    return { sql, params: [] };
  }

  const values = [];
  const nextSql = sql.replace(/\$(\d+)/g, (match, index) => {
    const value = params[Number.parseInt(index, 10) - 1];
    values.push(value);
    return "?";
  });

  return { sql: nextSql, params: values };
}

module.exports = { Pool };
