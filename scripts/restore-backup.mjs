import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

// Restore into memory first, so a bad archive never leaves a partial output.
// The generated SQL is for a new, isolated D1 database, never an in-place overwrite.
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error(
    'Usage: node scripts/restore-backup.mjs backup.json new-database.sql'
  );
  process.exit(1);
}

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const archive = JSON.parse(readFileSync(inputPath, 'utf8'));
const MAX_SQL_STATEMENT_BYTES = 64 * 1024;
const TEXT_CHUNK_BYTES = 24 * 1024;
const TEXT_STAGE_TABLE = '__tossa_restore_text_stage';
if (
  archive.metadata?.version !== 2 ||
  !archive.data ||
  !archive.metadata.tableCounts
)
  throw new Error('A complete version 2 backup is required');
const db = new DatabaseSync(':memory:');
db.exec(schema);
db.exec('PRAGMA foreign_keys = ON; BEGIN; PRAGMA defer_foreign_keys = ON;');
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  )
  .all()
  .map((row) => row.name);
if (Object.keys(archive.data).some((table) => !tables.includes(table)))
  throw new Error('Archive contains an unknown table');
const orderedTables = [];
const visiting = new Set();
function visit(table) {
  if (orderedTables.includes(table)) return;
  if (visiting.has(table))
    throw new Error('Schema contains cyclic foreign keys');
  visiting.add(table);
  for (const foreign of db.prepare(`PRAGMA foreign_key_list("${table}")`).all())
    visit(foreign.table);
  visiting.delete(table);
  orderedTables.push(table);
}
for (const table of tables) visit(table);
const inserts = [];
const stagedText = [];
let nextStageId = 1;
let total = 0;
for (const table of orderedTables) {
  const rows = archive.data[table];
  if (
    !Array.isArray(rows) ||
    archive.metadata.tableCounts[table] !== rows.length
  )
    throw new Error(`Missing table or incorrect count: ${table}`);
  const allowedColumns = db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((row) => row.name);
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error(`Invalid row: ${table}`);
    const columns = Object.keys(row);
    if (
      !columns.length ||
      columns.some((column) => !allowedColumns.includes(column))
    )
      throw new Error(`Invalid columns: ${table}`);
    const values = columns.map((column) => row[column]);
    if (
      values.some(
        (value) =>
          value !== null &&
          typeof value !== 'string' &&
          !(typeof value === 'number' && Number.isFinite(value))
      )
    )
      throw new Error(`Invalid value: ${table}`);
    const names = columns.map((column) => `"${column}"`).join(',');
    db.prepare(
      `INSERT INTO "${table}" (${names}) VALUES (${columns.map(() => '?').join(',')})`
    ).run(...values);
    const literals = values.map((value) =>
      typeof value === 'string'
        ? `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`
        : db.prepare('SELECT quote(?) AS literal').get(value).literal
    );
    const insertFor = () =>
      `INSERT INTO "${table}" (${names}) VALUES (${literals.join(',')});`;

    // Hex literals double UTF-8 payload size. Stage selected text values as
    // BLOB chunks so the final INSERT remains one complete, constraint-safe row.
    if (Buffer.byteLength(insertFor(), 'utf8') > MAX_SQL_STATEMENT_BYTES) {
      const candidates = values
        .map((value, index) => ({
          value,
          index,
          bytes: typeof value === 'string' ? Buffer.byteLength(value) : 0,
        }))
        .filter(({ bytes }) => bytes > 0)
        .sort((left, right) => right.bytes - left.bytes);
      for (const candidate of candidates) {
        if (Buffer.byteLength(insertFor(), 'utf8') <= MAX_SQL_STATEMENT_BYTES)
          break;
        const bytes = Buffer.from(candidate.value);
        const id = nextStageId++;
        literals[candidate.index] =
          `(SELECT CAST(value AS TEXT) FROM "${TEXT_STAGE_TABLE}" WHERE id = ${id})`;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += TEXT_CHUNK_BYTES
        ) {
          const chunk = bytes.subarray(offset, offset + TEXT_CHUNK_BYTES);
          const hex = chunk.toString('hex');
          stagedText.push(
            offset === 0
              ? `INSERT INTO "${TEXT_STAGE_TABLE}" (id, value) VALUES (${id}, X'${hex}');`
              : `UPDATE "${TEXT_STAGE_TABLE}" SET value = CAST(value || X'${hex}' AS BLOB) WHERE id = ${id};`
          );
        }
      }
    }
    const insert = insertFor();
    if (Buffer.byteLength(insert, 'utf8') > MAX_SQL_STATEMENT_BYTES)
      throw new Error(
        `Recovery INSERT exceeds the safe statement size: ${table}`
      );
    inserts.push(insert);
    total++;
  }
}
if (total !== archive.metadata.totalRecords)
  throw new Error('Archive total count does not match');
const violations = db.prepare('PRAGMA foreign_key_check').all();
if (violations.length)
  throw new Error('Archive has broken foreign key references');
db.exec('COMMIT');
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
if (integrity !== 'ok')
  throw new Error('Restored database integrity check failed');
const stageSql = stagedText.length
  ? `CREATE TABLE "${TEXT_STAGE_TABLE}" (id INTEGER PRIMARY KEY, value BLOB NOT NULL);\n${stagedText.join('\n')}\n`
  : '';
if (tables.includes(TEXT_STAGE_TABLE))
  throw new Error('Schema uses a reserved recovery staging table name');
const sql = `${schema}\n${stageSql}PRAGMA defer_foreign_keys = ON;\n${inserts.join('\n')}\n${stagedText.length ? `DROP TABLE "${TEXT_STAGE_TABLE}";\n` : ''}`;
for (const statement of sql.split(';')) {
  if (Buffer.byteLength(statement, 'utf8') > MAX_SQL_STATEMENT_BYTES)
    throw new Error(
      'Recovery SQL contains a statement above the safe size limit'
    );
}
writeFileSync(outputPath, sql, { flag: 'wx', mode: 0o600 });
db.close();
console.log(
  `Validated ${tables.length} tables and ${total} records. Recovery SQL created for a new database.`
);
