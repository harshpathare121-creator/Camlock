# CampusLock — SQLite3 Web App

CampusLock is a student utility platform with:
- Student registration and login
- Locker booking with distance priority and duration
- Travel groups with driver approval of join requests
- College resource requests with admin approval/rejection

## Stack
- HTML/CSS/JavaScript
- Node.js + Express
- SQLite3
- bcryptjs
- JWT

## Run locally
```bash
npm install
npm start
```
Then open `http://localhost:3000`.

The SQLite database file `campuslock.db` is created automatically on first startup.

## Default admin demo credentials
- ID: `admin`
- Password: `admin123`

Set `ADMIN_ID`, `ADMIN_PASSWORD`, and `JWT_SECRET` as environment variables before deployment.

## Render
SQLite needs persistent storage if you want database records to survive service restarts/redeploys. Without a persistent disk, the SQLite file can be reset when the service filesystem is replaced.

For a Render demo, either accept that limitation or attach a persistent disk and set:
`SQLITE_DB_PATH=/var/data/campuslock.db`
