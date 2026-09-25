# CampusLock — SQLite3 + Node.js + Express

College Locker Management System.

## Stack
- HTML/CSS/JavaScript frontend
- Node.js + Express backend
- SQLite3 database (`data/campuslock.db`)
- GitHub + Render deployment ready

## Run locally
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

## Demo admin
- Username: `admin`
- Password: `admin123`

## Database
The server automatically creates `data/campuslock.db`, tables, demo lockers, and the admin account on first run.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Add persistent disk/storage for `data/` if using SQLite in production. Without persistent storage, a platform restart/redeploy can reset the database file.
