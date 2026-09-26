const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, 'campuslock.db');
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, err => err ? reject(err) : resolve());
  });
}

async function initDb() {
  await exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      student_id TEXT UNIQUE NOT NULL,
      locality TEXT NOT NULL,
      distance_km REAL DEFAULT 0,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS travel_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      locality TEXT NOT NULL,
      meeting_point TEXT,
      departure_time TEXT,
      max_passengers INTEGER NOT NULL DEFAULT 4,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES travel_groups(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS resource_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      resource TEXT NOT NULL,
      purpose TEXT NOT NULL,
      request_date TEXT NOT NULL,
      students_count INTEGER NOT NULL DEFAULT 1,
      start_time TEXT,
      end_time TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      admin_note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS lockers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      locker_no TEXT UNIQUE NOT NULL,
      size TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Available',
      student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
      start_date TEXT,
      expiry_date TEXT
    );
  `);

  const count = await get('SELECT COUNT(*) AS n FROM lockers');
  if (count.n === 0) {
    await run(`INSERT INTO lockers(locker_no,size) VALUES ('L-101','Small')`);
    await run(`INSERT INTO lockers(locker_no,size) VALUES ('L-102','Medium')`);
    await run(`INSERT INTO lockers(locker_no,size) VALUES ('L-103','Medium')`);
    await run(`INSERT INTO lockers(locker_no,size) VALUES ('L-104','Large')`);
    await run(`INSERT INTO lockers(locker_no,size) VALUES ('L-105','Large')`);
  }
  console.log(`SQLite database ready: ${DB_PATH}`);
}

function tokenFor(user, role = 'student') {
  return jwt.sign({ id: user.id, studentId: user.student_id, name: user.name, role }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expired. Login again.' }); }
}
function adminAuth(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, studentId, locality, distanceKm, password } = req.body;
    if (!name || !studentId || !locality || !password) return res.status(400).json({ error: 'Name, Student ID, locality and password are required.' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO students(name,student_id,locality,distance_km,password_hash) VALUES(?,?,?,?,?)`,
      [name.trim(), studentId.trim(), locality.trim(), Number(distanceKm) || 0, hash]
    );
    const student = await get(`SELECT id,name,student_id,locality,distance_km FROM students WHERE id=?`, [result.id]);
    res.status(201).json({ message: 'Registration successful. Please login.', student });
  } catch (e) {
    if (String(e.message).includes('UNIQUE constraint failed: students.student_id')) return res.status(409).json({ error: 'Student ID already registered.' });
    console.error(e); res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { studentId, password } = req.body;
    const s = await get('SELECT * FROM students WHERE student_id=?', [studentId?.trim()]);
    if (!s || !(await bcrypt.compare(password || '', s.password_hash))) return res.status(401).json({ error: 'Invalid Student ID or password.' });
    res.json({ token: tokenFor(s), student: { id: s.id, name: s.name, studentId: s.student_id, locality: s.locality, distanceKm: s.distance_km } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed.' }); }
});

app.post('/api/admin/login', async (req, res) => {
  const id = process.env.ADMIN_ID || 'admin';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';
  if (req.body.adminId === id && req.body.password === pass) return res.json({ token: jwt.sign({ id: 0, name: 'College Admin', role: 'admin' }, JWT_SECRET, { expiresIn: '7d' }), admin: { name: 'College Admin' } });
  res.status(401).json({ error: 'Invalid admin credentials.' });
});

app.get('/api/groups', auth, async (req, res) => {
  try {
    const rows = await all(`SELECT g.id,g.locality,g.meeting_point,g.departure_time,g.max_passengers,s.name AS driver,s.student_id AS driver_student_id,
      MAX(0, g.max_passengers - COALESCE((SELECT COUNT(*) FROM join_requests j WHERE j.group_id=g.id AND j.status='Approved'),0)) AS seats
      FROM travel_groups g JOIN students s ON s.id=g.driver_id ORDER BY g.created_at DESC`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load groups.' }); }
});

app.post('/api/groups', auth, async (req, res) => {
  const { locality, meetingPoint, departureTime } = req.body;
  if (!locality) return res.status(400).json({ error: 'Locality is required.' });
  try {
    const r = await run(`INSERT INTO travel_groups(driver_id,locality,meeting_point,departure_time) VALUES(?,?,?,?)`, [req.user.id, locality.trim(), meetingPoint || 'Not specified', departureTime || 'Not specified']);
    res.status(201).json(await get('SELECT * FROM travel_groups WHERE id=?', [r.id]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not create group.' }); }
});

app.post('/api/groups/:id/join', auth, async (req, res) => {
  try {
    const g = await get('SELECT * FROM travel_groups WHERE id=?', [req.params.id]);
    if (!g) return res.status(404).json({ error: 'Group not found.' });
    if (g.driver_id === req.user.id) return res.status(400).json({ error: 'You are the driver of this group.' });
    const seats = await get(`SELECT MAX(0, ? - (SELECT COUNT(*) FROM join_requests WHERE group_id=? AND status='Approved')) AS seats`, [g.max_passengers, g.id]);
    if (seats.seats <= 0) return res.status(400).json({ error: 'This group is full.' });
    await run('INSERT INTO join_requests(group_id,student_id) VALUES(?,?)', [g.id, req.user.id]);
    res.status(201).json({ message: 'Join request sent. Wait for driver approval.' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'You already requested to join this group.' });
    console.error(e); res.status(500).json({ error: 'Could not send request.' });
  }
});

app.get('/api/groups/my/requests', auth, async (req, res) => {
  const rows = await all(`SELECT j.id,j.status,j.created_at,s.name,s.student_id,s.locality,g.locality AS group_locality
    FROM join_requests j JOIN travel_groups g ON g.id=j.group_id JOIN students s ON s.id=j.student_id WHERE g.driver_id=? ORDER BY j.created_at DESC`, [req.user.id]);
  res.json(rows);
});

app.post('/api/join-requests/:id/decision', auth, async (req, res) => {
  const { decision } = req.body;
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  const row = await get(`SELECT j.*,g.driver_id,g.max_passengers,(SELECT COUNT(*) FROM join_requests x WHERE x.group_id=j.group_id AND x.status='Approved') AS approved_count FROM join_requests j JOIN travel_groups g ON g.id=j.group_id WHERE j.id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Request not found.' });
  if (row.driver_id !== req.user.id) return res.status(403).json({ error: 'Only the group driver can decide.' });
  if (decision === 'Approved' && Number(row.approved_count) >= row.max_passengers) return res.status(400).json({ error: 'No passenger seats available.' });
  await run('UPDATE join_requests SET status=? WHERE id=?', [decision, req.params.id]);
  res.json({ message: `Request ${decision.toLowerCase()}.` });
});

app.get('/api/resources', auth, async (req, res) => {
  res.json(await all(`SELECT id,resource,purpose,request_date,students_count,start_time,end_time,status,admin_note,created_at FROM resource_requests WHERE student_id=? ORDER BY created_at DESC`, [req.user.id]));
});
app.post('/api/resources', auth, async (req, res) => {
  const { resource, purpose, requestDate, studentsCount, startTime, endTime } = req.body;
  if (!resource || !purpose || !requestDate) return res.status(400).json({ error: 'Resource, purpose and date are required.' });
  const r = await run(`INSERT INTO resource_requests(student_id,resource,purpose,request_date,students_count,start_time,end_time) VALUES(?,?,?,?,?,?,?)`, [req.user.id, resource, purpose, requestDate, Number(studentsCount) || 1, startTime || null, endTime || null]);
  res.status(201).json(await get('SELECT * FROM resource_requests WHERE id=?', [r.id]));
});

app.get('/api/admin/resources', auth, adminAuth, async (req, res) => {
  res.json(await all(`SELECT r.*,s.name,s.student_id,s.locality FROM resource_requests r JOIN students s ON s.id=r.student_id ORDER BY r.created_at DESC`));
});
app.post('/api/admin/resources/:id/decision', auth, adminAuth, async (req, res) => {
  const { decision, note } = req.body;
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  await run('UPDATE resource_requests SET status=?,admin_note=? WHERE id=?', [decision, note || null, req.params.id]);
  res.json({ message: `Request ${decision.toLowerCase()}.` });
});

function priority(km) { if (km >= 30) return 'VERY HIGH'; if (km >= 15) return 'HIGH'; if (km >= 5) return 'MEDIUM'; return 'LOW'; }
app.get('/api/lockers', auth, async (req, res) => {
  const rows = await all(`SELECT id,locker_no,size,status,start_date,expiry_date,CASE WHEN student_id=? THEN 1 ELSE 0 END AS mine FROM lockers ORDER BY locker_no`, [req.user.id]);
  res.json({ priority: priority(Number(req.user.distanceKm || 0)), lockers: rows });
});
app.post('/api/lockers/:id/book', auth, async (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.body.days) || 1));
  const existing = await get("SELECT id FROM lockers WHERE student_id=? AND status='Booked'", [req.user.id]);
  if (existing) return res.status(400).json({ error: 'You already have a locker booking.' });
  const locker = await get('SELECT * FROM lockers WHERE id=?', [req.params.id]);
  if (!locker || locker.status !== 'Available') return res.status(400).json({ error: 'Locker is not available.' });
  const start = new Date(), expiry = new Date(start); expiry.setDate(expiry.getDate() + days);
  await run("UPDATE lockers SET status='Booked',student_id=?,start_date=?,expiry_date=? WHERE id=? AND status='Available'", [req.user.id, start.toISOString().slice(0, 10), expiry.toISOString().slice(0, 10), req.params.id]);
  res.json({ message: `Locker booked for ${days} days.` });
});
app.post('/api/lockers/:id/cancel', auth, async (req, res) => {
  await run("UPDATE lockers SET status='Available',student_id=NULL,start_date=NULL,expiry_date=NULL WHERE id=? AND student_id=?", [req.params.id, req.user.id]);
  res.json({ message: 'Locker booking cancelled.' });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

initDb()
  .then(() => app.listen(PORT, () => console.log(`CampusLock running on port ${PORT}`)))
  .catch(err => { console.error('Database startup failed:', err); process.exit(1); });
