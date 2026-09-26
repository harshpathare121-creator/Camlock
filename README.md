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

## App navigation flow

CampusLock uses an app-style screen flow rather than one long scrolling page:

- Before login: only the Student Registration / Student Login screen is shown.
- After student login: the authentication screen is hidden completely.
- The Dashboard opens first.
- Dashboard, Travel Groups, College Resources, and My Locker are separate app screens; selecting one hides the others.
- Travel Groups shows the driver's pending join requests and Approve/Reject controls.
- Logout returns to the login screen.
- Refreshing while logged in restores the current app screen from the URL hash/session.

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
