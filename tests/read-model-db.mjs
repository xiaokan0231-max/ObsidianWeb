import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const calls = [];
  let failure = null;
  const db = {
    prepare(sql) { return { sql, values: [], bind(...values) { return { sql, values }; } }; },
    async batch(statements) {
      calls.push(statements);
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(({ sql, values }) => {
          if (failure && sql.includes(failure)) throw new Error("模拟数据库故障");
          const statement = sqlite.prepare(sql);
          // D1 按编号绑定 ?NNN，Node 22.18 则要求用对象传递这类参数。
          const parameters = /\?\d+/.test(sql)
            ? [Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value]))]
            : values;
          if (statement.columns().length) {
            return { success: true, results: statement.all(...parameters).map((row) => ({ ...row })) };
          }
          statement.run(...parameters);
          return { success: true, results: [] };
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite, calls, failOn(value) { failure = value; } };
}
