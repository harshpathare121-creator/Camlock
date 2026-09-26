# CampusLock Full Web App

Root-level Node.js + Express + PostgreSQL project.

## Files
- `index.html` — UI
- `style.css` — styling
- `script.js` — frontend API interaction
- `server.js` — Express API + PostgreSQL schema setup
- `package.json` — dependencies/start command
- `.env.example` — environment variables

## Run locally
1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `JWT_SECRET`.
3. Run `npm install`.
4. Run `npm start`.
5. Open the app at `http://localhost:3000`.

Default demo admin values are `admin` / `admin123` only if `ADMIN_ID` and `ADMIN_PASSWORD` are not changed. Change them before deployment.

## Main flows
- Student registration → student login
- Travel group creation → passenger join request → driver approve/reject
- College resource request → admin approve/reject → student status
- Locker priority and booking with required number of days
