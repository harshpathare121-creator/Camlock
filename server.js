const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DB_DIR, { recursive: true });
const db = new sqlite3.Database(path.join(DB_DIR, 'campuslock.db'));

app.use(express.json());
app.use(express.static(__dirname));

const run = (sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(err){
  if(err) reject(err); else resolve({id:this.lastID, changes:this.changes});
}));
const all = (sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(err,rows)=>err?reject(err):resolve(rows)));
const get = (sql, params=[]) => new Promise((resolve,reject)=>db.get(sql,params,(err,row)=>err?reject(err):resolve(row)));
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const today = () => new Date().toISOString().slice(0,10);

async function init(){
  await run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    address TEXT,
    distance REAL NOT NULL,
    priority TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS lockers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    locker_number TEXT UNIQUE NOT NULL,
    block TEXT NOT NULL,
    size TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    locker_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    FOREIGN KEY(student_id) REFERENCES students(id),
    FOREIGN KEY(locker_id) REFERENCES lockers(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  )`);
  await run(`INSERT OR IGNORE INTO admins(username,password_hash) VALUES(?,?)`, ['admin',hash('admin123')]);
  const count = await get('SELECT COUNT(*) AS n FROM lockers');
  if(count.n===0){
    const lockers=[['L-101','A','Small'],['L-102','A','Medium'],['L-103','A','Large'],['L-201','B','Small'],['L-202','B','Medium'],['L-203','B','Large']];
    for(const l of lockers) await run('INSERT INTO lockers(locker_number,block,size) VALUES(?,?,?)',l);
  }
  await cleanupExpired();
}
function priority(distance){distance=Number(distance); if(distance>=30)return 'VERY HIGH'; if(distance>=15)return 'HIGH'; if(distance>=5)return 'MEDIUM'; return 'LOW';}
async function cleanupExpired(){ await run('DELETE FROM bookings WHERE expiry_date < ?', [today()]); }

app.post('/api/register', async (req,res)=>{
  try{
    const {studentId,name,email,password,address='',distance}=req.body;
    if(!studentId||!name||!email||!password||distance===undefined) return res.status(400).json({error:'Required fields are missing'});
    const d=Number(distance); if(!Number.isFinite(d)||d<0) return res.status(400).json({error:'Invalid distance'});
    const p=priority(d);
    const result=await run('INSERT INTO students(student_id,name,email,password_hash,address,distance,priority) VALUES(?,?,?,?,?,?,?)',[studentId.trim(),name.trim(),email.trim(),hash(password),String(address).trim(),d,p]);
    res.json({ok:true,studentId:result.id,priority:p});
  }catch(e){ if(String(e.message).includes('UNIQUE')) return res.status(409).json({error:'Student ID already exists'}); res.status(500).json({error:'Registration failed'}); }
});

app.post('/api/login', async (req,res)=>{
  try{
    const {studentId,password}=req.body;
    const s=await get('SELECT id,student_id,name,email,address,distance,priority FROM students WHERE student_id=? AND password_hash=?',[studentId,hash(password)]);
    if(!s) return res.status(401).json({error:'Invalid Student ID or password'});
    res.json({student:s});
  }catch(e){res.status(500).json({error:'Login failed'});}
});

app.post('/api/admin/login', async (req,res)=>{
  const {username,password}=req.body;
  const a=await get('SELECT id,username FROM admins WHERE username=? AND password_hash=?',[username,hash(password)]);
  if(!a) return res.status(401).json({error:'Invalid admin credentials'});
  res.json({admin:a});
});

app.get('/api/lockers', async (req,res)=>{
  try{ await cleanupExpired(); const rows=await all(`SELECT l.id,l.locker_number AS number,l.block,l.size,
    b.id AS booking_id,b.start_date AS startDate,b.expiry_date AS expiryDate,
    s.student_id AS studentId,s.name AS studentName
    FROM lockers l LEFT JOIN bookings b ON b.locker_id=l.id
    LEFT JOIN students s ON s.id=b.student_id ORDER BY l.locker_number`); res.json({lockers:rows}); }
  catch(e){res.status(500).json({error:'Could not load lockers'});}
});

app.get('/api/students/:studentId/dashboard', async (req,res)=>{
  try{ await cleanupExpired(); const s=await get('SELECT id,student_id AS studentId,name,email,address,distance,priority FROM students WHERE student_id=?',[req.params.studentId]);
    if(!s) return res.status(404).json({error:'Student not found'});
    const booking=await get(`SELECT b.id,l.locker_number AS lockerNumber,l.block,l.size,b.start_date AS startDate,b.expiry_date AS expiryDate
      FROM bookings b JOIN lockers l ON l.id=b.locker_id WHERE b.student_id=?`,[s.id]);
    res.json({student:s,booking:booking||null});
  }catch(e){res.status(500).json({error:'Could not load dashboard'});}
});

app.get('/api/students/:studentId/available-lockers', async (req,res)=>{
  try{await cleanupExpired(); const rows=await all(`SELECT l.id,l.locker_number AS number,l.block,l.size FROM lockers l LEFT JOIN bookings b ON b.locker_id=l.id WHERE b.id IS NULL ORDER BY l.locker_number`);res.json({lockers:rows});}
  catch(e){res.status(500).json({error:'Could not load available lockers'});}
});

app.post('/api/bookings', async (req,res)=>{
  try{
    await cleanupExpired(); const {studentId,lockerId,days}=req.body; const d=Number(days);
    if(!studentId||!lockerId||!Number.isInteger(d)||d<1||d>3650) return res.status(400).json({error:'Enter 1 to 3650 days'});
    const s=await get('SELECT id FROM students WHERE student_id=?',[studentId]); if(!s)return res.status(404).json({error:'Student not found'});
    const existing=await get('SELECT id FROM bookings WHERE student_id=?',[s.id]); if(existing)return res.status(409).json({error:'You already have a locker'});
    const l=await get('SELECT id FROM lockers WHERE id=?',[lockerId]); if(!l)return res.status(404).json({error:'Locker not found'});
    const occupied=await get('SELECT id FROM bookings WHERE locker_id=?',[lockerId]); if(occupied)return res.status(409).json({error:'That locker is no longer available'});
    const start=new Date(); const expiry=new Date(start); expiry.setDate(expiry.getDate()+d);
    const iso=x=>x.toISOString().slice(0,10);
    await run('INSERT INTO bookings(student_id,locker_id,start_date,expiry_date) VALUES(?,?,?,?)',[s.id,l.id,iso(start),iso(expiry)]);
    res.json({ok:true,startDate:iso(start),expiryDate:iso(expiry)});
  }catch(e){res.status(500).json({error:'Booking failed'});}
});

app.delete('/api/bookings/student/:studentId', async (req,res)=>{
  try{const s=await get('SELECT id FROM students WHERE student_id=?',[req.params.studentId]);if(!s)return res.status(404).json({error:'Student not found'});await run('DELETE FROM bookings WHERE student_id=?',[s.id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:'Cancellation failed'});}
});

app.get('/api/admin/data', async (req,res)=>{
  try{await cleanupExpired();
    const lockers=await all(`SELECT l.id,l.locker_number AS number,l.block,l.size,b.id AS bookingId,b.start_date AS startDate,b.expiry_date AS expiryDate,s.student_id AS studentId,s.name AS studentName FROM lockers l LEFT JOIN bookings b ON b.locker_id=l.id LEFT JOIN students s ON s.id=b.student_id ORDER BY l.locker_number`);
    const bookings=await all(`SELECT b.id,s.student_id AS studentId,s.name,l.locker_number AS lockerNumber,b.start_date AS startDate,b.expiry_date AS expiryDate FROM bookings b JOIN students s ON s.id=b.student_id JOIN lockers l ON l.id=b.locker_id ORDER BY b.expiry_date`);
    const students=await all(`SELECT s.student_id AS studentId,s.name,s.distance,s.priority,l.locker_number AS lockerNumber FROM students s LEFT JOIN bookings b ON b.student_id=s.id LEFT JOIN lockers l ON l.id=b.locker_id ORDER BY CASE s.priority WHEN 'VERY HIGH' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC,s.distance DESC`);
    res.json({lockers,bookings,students});
  }catch(e){res.status(500).json({error:'Could not load admin data'});}
});

app.post('/api/admin/lockers', async (req,res)=>{
  try{const {number,block,size}=req.body;if(!number||!block||!size)return res.status(400).json({error:'All locker fields are required'});await run('INSERT INTO lockers(locker_number,block,size) VALUES(?,?,?)',[number.trim(),block.trim(),size.trim()]);res.json({ok:true});}
  catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Locker already exists'});res.status(500).json({error:'Could not add locker'});}
});

app.delete('/api/admin/lockers/:id', async (req,res)=>{
  try{const b=await get('SELECT id FROM bookings WHERE locker_id=?',[req.params.id]);if(b)return res.status(409).json({error:'Booked lockers cannot be deleted'});await run('DELETE FROM lockers WHERE id=?',[req.params.id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:'Could not delete locker'});}
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

init().then(()=>app.listen(PORT,()=>console.log(`CampusLock running on port ${PORT}`))).catch(err=>{console.error(err);process.exit(1);});
