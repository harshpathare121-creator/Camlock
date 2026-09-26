const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false });

async function db(sql, params=[]) { return pool.query(sql, params); }
async function initDb() {
  if (!process.env.DATABASE_URL) console.warn('DATABASE_URL is not set. Connect PostgreSQL before running the app.');
  await db(`CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, student_id VARCHAR(50) UNIQUE NOT NULL,
    locality VARCHAR(120) NOT NULL, distance_km NUMERIC(8,2) DEFAULT 0, password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS travel_groups (
    id SERIAL PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    locality VARCHAR(120) NOT NULL, meeting_point VARCHAR(180), departure_time VARCHAR(30),
    max_passengers INTEGER NOT NULL DEFAULT 4, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS join_requests (
    id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES travel_groups(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending', created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, student_id)
  )`);
  await db(`CREATE TABLE IF NOT EXISTS resource_requests (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    resource VARCHAR(120) NOT NULL, purpose TEXT NOT NULL, request_date DATE NOT NULL,
    students_count INTEGER NOT NULL DEFAULT 1, start_time VARCHAR(20), end_time VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'Pending', admin_note TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS lockers (
    id SERIAL PRIMARY KEY, locker_no VARCHAR(30) UNIQUE NOT NULL, size VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Available', student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    start_date DATE, expiry_date DATE
  )`);
  const count = await db('SELECT COUNT(*)::int AS n FROM lockers');
  if (count.rows[0].n === 0) {
    await db(`INSERT INTO lockers(locker_no,size) VALUES ('L-101','Small'),('L-102','Medium'),('L-103','Medium'),('L-104','Large'),('L-105','Large')`);
  }
}

function tokenFor(user, role='student') { return jwt.sign({ id: user.id, studentId: user.student_id, name: user.name, role }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req,res,next){
  const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(!token) return res.status(401).json({error:'Login required'});
  try { req.user=jwt.verify(token,JWT_SECRET); next(); } catch { res.status(401).json({error:'Session expired. Login again.'}); }
}
function adminAuth(req,res,next){ if(req.user?.role!=='admin') return res.status(403).json({error:'Admin access required'}); next(); }

app.post('/api/auth/register', async (req,res)=>{
  try {
    const {name,studentId,locality,distanceKm,password}=req.body;
    if(!name||!studentId||!locality||!password) return res.status(400).json({error:'Name, Student ID, locality and password are required.'});
    if(password.length<4) return res.status(400).json({error:'Password must be at least 4 characters.'});
    const hash=await bcrypt.hash(password,10);
    const r=await db(`INSERT INTO students(name,student_id,locality,distance_km,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,name,student_id,locality,distance_km`,[name.trim(),studentId.trim(),locality.trim(),Number(distanceKm)||0,hash]);
    res.status(201).json({message:'Registration successful. Please login.',student:r.rows[0]});
  } catch(e){ if(e.code==='23505') return res.status(409).json({error:'Student ID already registered.'}); console.error(e); res.status(500).json({error:'Registration failed.'}); }
});

app.post('/api/auth/login', async (req,res)=>{
  try {
    const {studentId,password}=req.body;
    const r=await db('SELECT * FROM students WHERE student_id=$1',[studentId?.trim()]);
    const s=r.rows[0];
    if(!s || !(await bcrypt.compare(password||'',s.password_hash))) return res.status(401).json({error:'Invalid Student ID or password.'});
    res.json({token:tokenFor(s),student:{id:s.id,name:s.name,studentId:s.student_id,locality:s.locality,distanceKm:s.distance_km}});
  } catch(e){ console.error(e); res.status(500).json({error:'Login failed.'}); }
});

app.post('/api/admin/login', async (req,res)=>{
  const id=process.env.ADMIN_ID||'admin'; const pass=process.env.ADMIN_PASSWORD||'admin123';
  if(req.body.adminId===id && req.body.password===pass) return res.json({token:jwt.sign({id:0,name:'College Admin',role:'admin'},JWT_SECRET,{expiresIn:'7d'}),admin:{name:'College Admin'}});
  res.status(401).json({error:'Invalid admin credentials.'});
});

app.get('/api/groups',auth,async(req,res)=>{
  try {
    const r=await db(`SELECT g.id,g.locality,g.meeting_point,g.departure_time,g.max_passengers,s.name AS driver,s.student_id AS driver_student_id,
      GREATEST(0,g.max_passengers-COALESCE((SELECT COUNT(*) FROM join_requests j WHERE j.group_id=g.id AND j.status='Approved'),0))::int AS seats
      FROM travel_groups g JOIN students s ON s.id=g.driver_id ORDER BY g.created_at DESC`);
    res.json(r.rows);
  } catch(e){console.error(e);res.status(500).json({error:'Could not load groups.'});}
});

app.post('/api/groups',auth,async(req,res)=>{
  const {locality,meetingPoint,departureTime}=req.body;
  if(!locality) return res.status(400).json({error:'Locality is required.'});
  const r=await db(`INSERT INTO travel_groups(driver_id,locality,meeting_point,departure_time) VALUES($1,$2,$3,$4) RETURNING *`,[req.user.id,locality.trim(),meetingPoint||'Not specified',departureTime||'Not specified']);
  res.status(201).json(r.rows[0]);
});

app.post('/api/groups/:id/join',auth,async(req,res)=>{
  try {
    const g=await db('SELECT * FROM travel_groups WHERE id=$1',[req.params.id]); if(!g.rows[0]) return res.status(404).json({error:'Group not found.'});
    if(g.rows[0].driver_id===req.user.id) return res.status(400).json({error:'You are the driver of this group.'});
    const seats=await db(`SELECT GREATEST(0,max_passengers-COUNT(*) FILTER (WHERE status='Approved'))::int AS seats FROM travel_groups g LEFT JOIN join_requests j ON j.group_id=g.id WHERE g.id=$1 GROUP BY max_passengers`,[req.params.id]);
    if(seats.rows[0].seats<=0) return res.status(400).json({error:'This group is full.'});
    await db('INSERT INTO join_requests(group_id,student_id) VALUES($1,$2)',[req.params.id,req.user.id]);
    res.status(201).json({message:'Join request sent. Wait for driver approval.'});
  } catch(e){ if(e.code==='23505') return res.status(409).json({error:'You already requested to join this group.'}); console.error(e);res.status(500).json({error:'Could not send request.'}); }
});

app.get('/api/groups/my/requests',auth,async(req,res)=>{
  const r=await db(`SELECT j.id,j.status,j.created_at,s.name,s.student_id,s.locality,g.locality AS group_locality
    FROM join_requests j JOIN travel_groups g ON g.id=j.group_id JOIN students s ON s.id=j.student_id WHERE g.driver_id=$1 ORDER BY j.created_at DESC`,[req.user.id]);
  res.json(r.rows);
});

app.post('/api/join-requests/:id/decision',auth,async(req,res)=>{
  const {decision}=req.body;
  if(!['Approved','Rejected'].includes(decision)) return res.status(400).json({error:'Invalid decision.'});
  const r=await db(`SELECT j.*,g.driver_id,g.max_passengers,(SELECT COUNT(*) FROM join_requests x WHERE x.group_id=j.group_id AND x.status='Approved') AS approved_count FROM join_requests j JOIN travel_groups g ON g.id=j.group_id WHERE j.id=$1`,[req.params.id]);
  const row=r.rows[0]; if(!row) return res.status(404).json({error:'Request not found.'});
  if(row.driver_id!==req.user.id) return res.status(403).json({error:'Only the group driver can decide.'});
  if(decision==='Approved' && Number(row.approved_count)>=row.max_passengers) return res.status(400).json({error:'No passenger seats available.'});
  await db('UPDATE join_requests SET status=$1 WHERE id=$2',[decision,req.params.id]);
  res.json({message:`Request ${decision.toLowerCase()}.`});
});

app.get('/api/resources',auth,async(req,res)=>{
  const r=await db(`SELECT id,resource,purpose,request_date,students_count,start_time,end_time,status,admin_note,created_at FROM resource_requests WHERE student_id=$1 ORDER BY created_at DESC`,[req.user.id]);
  res.json(r.rows);
});
app.post('/api/resources',auth,async(req,res)=>{
  const {resource,purpose,requestDate,studentsCount,startTime,endTime}=req.body;
  if(!resource||!purpose||!requestDate) return res.status(400).json({error:'Resource, purpose and date are required.'});
  const r=await db(`INSERT INTO resource_requests(student_id,resource,purpose,request_date,students_count,start_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.user.id,resource,purpose,requestDate,Number(studentsCount)||1,startTime||null,endTime||null]);
  res.status(201).json(r.rows[0]);
});

app.get('/api/admin/resources',auth,adminAuth,async(req,res)=>{
  const r=await db(`SELECT r.*,s.name,s.student_id,s.locality FROM resource_requests r JOIN students s ON s.id=r.student_id ORDER BY r.created_at DESC`); res.json(r.rows);
});
app.post('/api/admin/resources/:id/decision',auth,adminAuth,async(req,res)=>{
  const {decision,note}=req.body; if(!['Approved','Rejected'].includes(decision)) return res.status(400).json({error:'Invalid decision.'});
  await db('UPDATE resource_requests SET status=$1,admin_note=$2 WHERE id=$3',[decision,note||null,req.params.id]); res.json({message:`Request ${decision.toLowerCase()}.`});
});

function priority(km){ if(km>=30)return 'VERY HIGH'; if(km>=15)return 'HIGH'; if(km>=5)return 'MEDIUM'; return 'LOW'; }
app.get('/api/lockers',auth,async(req,res)=>{const r=await db(`SELECT l.id,l.locker_no,l.size,l.status,l.start_date,l.expiry_date,CASE WHEN l.student_id=$1 THEN true ELSE false END AS mine FROM lockers l ORDER BY l.locker_no`,[req.user.id]);res.json({priority:priority(Number(req.user.distanceKm||0)),lockers:r.rows});});
app.post('/api/lockers/:id/book',auth,async(req,res)=>{const days=Math.max(1,Math.min(90,Number(req.body.days)||1));const existing=await db('SELECT id FROM lockers WHERE student_id=$1 AND status=\'Booked\'',[req.user.id]);if(existing.rows.length)return res.status(400).json({error:'You already have a locker booking.'});const r=await db('SELECT * FROM lockers WHERE id=$1 FOR UPDATE',[req.params.id]);if(!r.rows[0]||r.rows[0].status!=='Available')return res.status(400).json({error:'Locker is not available.'});const start=new Date(),expiry=new Date(start);expiry.setDate(expiry.getDate()+days);await db('UPDATE lockers SET status=\'Booked\',student_id=$1,start_date=$2,expiry_date=$3 WHERE id=$4',[req.user.id,start.toISOString().slice(0,10),expiry.toISOString().slice(0,10),req.params.id]);res.json({message:`Locker booked for ${days} days.`});});
app.post('/api/lockers/:id/cancel',auth,async(req,res)=>{await db('UPDATE lockers SET status=\'Available\',student_id=NULL,start_date=NULL,expiry_date=NULL WHERE id=$1 AND student_id=$2',[req.params.id,req.user.id]);res.json({message:'Locker booking cancelled.'});});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
initDb().then(()=>app.listen(PORT,()=>console.log(`CampusLock running on port ${PORT}`))).catch(err=>{console.error('Database startup failed:',err);process.exit(1)});
