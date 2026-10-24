// Migration safety (launch readiness; ADR deployment gate §1 and §5). PURE: no I/O, no database.
//
// The rollback plan for a release is "return traffic to the previous deployment" (deployment-readiness-gate.md §5). That is only safe if every migration the new release
// applies is BACKWARD-COMPATIBLE with the previous code (expand-then-contract): the old code must keep working on the new schema. This module reads a migration's SQL
// and says whether it is: ADDITIVE (new tables, nullable columns, new indexes, enum values, foreign keys) or whether it contains a statement that destroys data or
// breaks the previous version. It is deliberately conservative and textual. It is a safety net for a human, not a proof:
//
//   BLOCKING  loses data or breaks previous code: DROP TABLE / COLUMN / TYPE / SCHEMA, TRUNCATE, DELETE, RENAME, ALTER COLUMN ... TYPE, SET NOT NULL,
//             ADD COLUMN ... NOT NULL without a DEFAULT. A release containing one cannot be rolled back by redeploying the old code; it needs an explicit owner
//             acknowledgement and a restore-point rollback plan.
//   REVIEW    additive in shape but worth a look: UPDATE (a data rewrite), a new CHECK / UNIQUE constraint or unique index on an existing table (it can reject writes
//             the previous code makes), DROP INDEX / CONSTRAINT / DEFAULT.
//   (silent)  CREATE TABLE / TYPE / INDEX, ADD COLUMN (nullable, or with a DEFAULT), ADD FOREIGN KEY, ALTER TYPE ... ADD VALUE.

export type FindingSeverity = "BLOCKING" | "REVIEW";

export interface MigrationFinding {
  severity: FindingSeverity;
  reason: string;
  /** The statement, collapsed to one line and shortened: for the operator to find it, never a place a value could hide (migrations hold schema, not data). */
  statement: string;
}

/** Removes comments and splits on top-level semicolons, ignoring semicolons inside quotes and dollar-quoted bodies. */
export function splitSqlStatements(sql: string): string[] {
  const withoutBlock = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let quote: "'" | '"' | null = null;
  let dollar: string | null = null;
  while (i < withoutBlock.length) {
    const ch = withoutBlock[i];
    const two = withoutBlock.slice(i, i + 2);
    if (dollar) {
      if (withoutBlock.startsWith(dollar, i)) {
        current += dollar;
        i += dollar.length;
        dollar = null;
      } else {
        current += ch;
        i += 1;
      }
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (two === "--") {
      while (i < withoutBlock.length && withoutBlock[i] !== "\n") i += 1;
      continue;
    }
    const dollarOpen = /^\$[A-Za-z_]*\$/.exec(withoutBlock.slice(i));
    if (ch === "$" && dollarOpen) {
      dollar = dollarOpen[0];
      current += dollar;
      i += dollar.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const shorten = (s: string) => (oneLine(s).length > 140 ? `${oneLine(s).slice(0, 137)}...` : oneLine(s));

/** Splits "ALTER TABLE x ADD ..., ADD ..., DROP ..." into its comma-separated actions (top level only). */
function alterActions(statement: string): string[] {
  const body = statement.replace(/^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:"[^"]+"|[\w.]+)\s*/i, "");
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const tableOf = (statement: string): string | null => /^(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX\b[^]*?\sON|CREATE\s+TABLE)\s+(?:ONLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:"([^"]+)"|([\w.]+))/i.exec(statement)?.slice(1).find(Boolean) ?? null;

export function classifyMigrationSql(sql: string): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const add = (severity: FindingSeverity, reason: string, statement: string) => findings.push({ severity, reason, statement: shorten(statement) });
  const statements = splitSqlStatements(sql).map(oneLine);
  // A table created BY this migration has no previous-version writers: constraints and indexes on it cannot reject their writes.
  const createdHere = new Set(statements.filter((s) => /^CREATE\s+TABLE\b/i.test(s)).map((s) => tableOf(s)).filter((t): t is string => t !== null));

  for (const s of statements) {
    const up = s.toUpperCase();
    const table = tableOf(s);
    const isNewTable = table !== null && createdHere.has(table);

    if (/^DROP\s+(TABLE|COLUMN|TYPE|SCHEMA|DATABASE|VIEW|FUNCTION|TRIGGER)\b/.test(up)) add("BLOCKING", "drops a database object the previous version may still use", s);
    else if (/^DROP\s+(INDEX|CONSTRAINT)\b/.test(up)) add("REVIEW", "drops an index or constraint (performance or integrity change)", s);
    else if (/^TRUNCATE\b/.test(up)) add("BLOCKING", "truncates a table (data loss)", s);
    else if (/^DELETE\s+FROM\b/.test(up)) add("BLOCKING", "deletes rows (data loss)", s);
    else if (/^UPDATE\b/.test(up)) add("REVIEW", "rewrites existing rows", s);
    else if (/^CREATE\s+UNIQUE\s+INDEX\b/.test(up)) {
      if (!isNewTable) add("REVIEW", "creates a unique index on an existing table (it can reject writes the previous version makes)", s);
    } else if (/^ALTER\s+TYPE\b/.test(up)) {
      if (/\bRENAME\b/.test(up)) add("BLOCKING", "renames an enum type or value", s);
      else if (!/\bADD\s+VALUE\b/.test(up)) add("REVIEW", "alters an enum type", s);
    } else if (/^ALTER\s+TABLE\b/.test(up)) {
      for (const action of alterActions(s)) {
        const a = action.toUpperCase();
        if (/^DROP\s+CONSTRAINT\b/.test(a)) add("REVIEW", "drops a constraint", action);
        else if (/^DROP\s+DEFAULT\b/.test(a)) add("REVIEW", "removes a column default (the previous version may rely on it)", action);
        else if (/^DROP\s+NOT\s+NULL\b/.test(a)) continue; // loosening is expand-safe
        else if (/^DROP\b/.test(a)) add("BLOCKING", "drops a column", `${s.split(" ").slice(0, 3).join(" ")} ... ${action}`);
        else if (/^RENAME\b/.test(a)) add("BLOCKING", "renames a table or column (the previous version still uses the old name)", `${s.split(" ").slice(0, 3).join(" ")} ... ${action}`);
        else if (/^ALTER\s+(COLUMN\s+)?(?:"[^"]+"|\w+)\s+DROP\s+DEFAULT\b/.test(a)) add("REVIEW", "removes a column default (the previous version may rely on it)", action);
        else if (/^ALTER\s+(COLUMN\s+)?(?:"[^"]+"|\w+)\s+DROP\s+NOT\s+NULL\b/.test(a)) continue; // loosening is expand-safe
        else if (/^ALTER\s+(COLUMN\s+)?(?:"[^"]+"|\w+)\s+(?:SET\s+DATA\s+)?TYPE\b/.test(a)) add("BLOCKING", "changes a column's type (rewrites data; may break the previous version)", action);
        else if (/^ALTER\s+(COLUMN\s+)?(?:"[^"]+"|\w+)\s+SET\s+NOT\s+NULL\b/.test(a)) add("BLOCKING", "makes an existing column NOT NULL (fails on existing nulls; the previous version may write nulls)", action);
        else if (/^ADD\s+(?!CONSTRAINT\b|PRIMARY\b|FOREIGN\b|UNIQUE\b|CHECK\b)/.test(a)) {
          if (/\bNOT\s+NULL\b/.test(a) && !/\bDEFAULT\b/.test(a)) add("BLOCKING", "adds a NOT NULL column with no default (the previous version's inserts would fail)", action);
        } else if (/^ADD\s+(CONSTRAINT\b[\s\S]*\b(CHECK|UNIQUE)\b|CHECK\b|UNIQUE\b|PRIMARY\s+KEY\b)/.test(a)) {
          if (!isNewTable) add("REVIEW", "adds a CHECK, UNIQUE or key constraint to an existing table (it can reject writes the previous version makes)", action);
        }
      }
    }
  }
  return findings;
}
export function isAdditiveOnly(findings: readonly MigrationFinding[]): boolean {
  return findings.every((f) => f.severity !== "BLOCKING");
}

export function summariseFindings(findings: readonly MigrationFinding[]): { blocking: number; review: number } {
  return { blocking: findings.filter((f) => f.severity === "BLOCKING").length, review: findings.filter((f) => f.severity === "REVIEW").length };
}
