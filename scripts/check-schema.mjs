import Database from 'better-sqlite3';
const db = new Database('server/database/signage.db');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name='sessions'").get());
console.log(db.prepare('PRAGMA table_info(sessions)').all());
