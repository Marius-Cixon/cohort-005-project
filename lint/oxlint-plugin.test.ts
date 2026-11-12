import { RuleTester } from "oxlint/plugins-dev";
import { noDynamicSqlRaw } from "./oxlint-plugin";

const IMPORT = `import { sql } from "drizzle-orm";\n`;
const error = { messageId: "dynamic" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-dynamic-sql-raw", noDynamicSqlRaw, {
  valid: [
    IMPORT + `sql.raw("DESC");`,
    IMPORT + "sql.raw(`created_at DESC`);",
    IMPORT + `const ORDER = "DESC"; sql.raw(ORDER);`,
    IMPORT + `const ORDER = "DESC" as const; sql.raw(ORDER);`,
    IMPORT + `const A = "x"; const B = A; sql.identifier(B);`,
    // Parameterised templates are safe: drizzle binds every `${}`.
    IMPORT + "const q = input(); sql`title LIKE ${q}`;",
    // Not drizzle's sql.
    `import { sql } from "other-lib"; sql.raw(input());`,
    `const sql = { raw: (s) => s }; sql.raw(input());`,
  ],
  invalid: [
    {
      code: IMPORT + "sql.raw(`title LIKE '%${search}%'`);",
      errors: [error],
    },
    { code: IMPORT + `sql.raw("a" + search);`, errors: [error] },
    { code: IMPORT + `sql.raw(search);`, errors: [error] },
    { code: IMPORT + `sql.raw(columns[key]);`, errors: [error] },
    { code: IMPORT + `sql.identifier(getColumn());`, errors: [error] },
    { code: IMPORT + `let order = "DESC"; sql.raw(order);`, errors: [error] },
    {
      code: `import { sql as s } from "drizzle-orm"; s.raw(search);`,
      errors: [error],
    },
    {
      code: `import { sql } from "drizzle-orm/sql"; sql.raw(search);`,
      errors: [error],
    },
  ],
});
