import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "data.db"));

// ── Pragma performance ──
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT    UNIQUE NOT NULL,
    password TEXT    NOT NULL,
    role     TEXT    NOT NULL DEFAULT 'user',
    created_at TEXT  DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS operaciones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo       TEXT    NOT NULL CHECK(tipo IN ('compra','venta')),
    precio     REAL    NOT NULL,
    fecha      TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Seed admin si no existe ──
const adminExists = db.prepare("SELECT id FROM users WHERE username = ?").get("ernes");
if (!adminExists) {
  const hash = bcrypt.hashSync("adminernes!1", 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(
    "ernes", hash, "admin"
  );
  console.log("✅ Admin 'ernes' creado");
}

export default db;