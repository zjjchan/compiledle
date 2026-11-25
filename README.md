# Compiledle

A Progressive Web App (PWA) for collating, scheduling reminders for, and playing all your daily web puzzles (Wordle, NYT Connections, Krillion, Minute Cryptic, Framed, Worldle, and more) in one place.

---

## Features

- **Accounts & Access Control**: Sign in with **Google** or **Email & Password** via Firebase Authentication, with account settings to update credentials or permanently delete your account and data.
- **Smart Hybrid Game Player**:
  - Automatically inspects added URLs for title, icon, and browser framing headers (`X-Frame-Options` and `Content-Security-Policy: frame-ancestors`).
  - Launches embeddable games directly inside a full-screen `100dvh` in-app player (with a **Back to Dailies** bar and **Played** toggle), and opens iframe-restricted sites cleanly in an external browser view.
- **Organized Daily Hub**:
  - Drag-and-drop card reordering (mouse and touch supported via `@dnd-kit`).
  - Automatic **Played Today** tracking that resets at `12:00 AM` in your local timezone.
  - Responsive layout with a collapsible mobile sidebar, desktop Settings dropdown, and persistent **Light / Dark mode**.
- **Scheduled Web Push Notifications**:
  - Global daily reminder (defaults to `12:00 AM` local time) sending a single summary alert for unplayed games, plus optional per-game custom reminder times in 15-minute increments.

---

## Tech Stack & Structure

- **Frontend (`src/`, `public/`)**: TypeScript, React 19, Vite, Tailwind CSS v4, `@dnd-kit`, Web App Manifest + unified Firebase Cloud Messaging Service Worker (`public/firebase-messaging-sw.js`)
- **Backend (`api/`)**: Python FastAPI (`api/index.py`) running on Vercel Functions, `firebase-admin`, `httpx`
- **Database & Auth**: Firebase Authentication, Cloud Firestore (`firestore.rules`), Firebase Cloud Messaging

```text
├── api/
│   ├── index.py                # FastAPI routes & cron endpoint
│   ├── auth.py                 # Firebase ID token verification
│   ├── firebase_client.py      # Firebase Admin SDK initialization
│   ├── inspector.py            # URL metadata & framing-header inspector
│   └── notifier.py             # Timezone-aware 15m Web Push dispatcher
├── public/
│   ├── firebase-messaging-sw.js
│   ├── manifest.webmanifest
│   └── icons/
├── src/
│   ├── components/             # Dashboard cards, Player, Sidebar, Modals, Account page
│   ├── lib/                    # Typed API client, Firebase Auth/FCM helpers, Theme hook
│   └── App.tsx
├── tests/
│   └── test_backend.py         # Backend unit & API tests
├── firestore.rules             # Locked-down server-only Firestore security rules
├── requirements.txt            # Production Python dependencies (Vercel)
└── vercel.json                 # Unified Vite SPA + FastAPI routing
```

---

## Local Development

1. **Install dependencies**:
   ```powershell
   npm install
   python -m venv .venv
   .\.venv\Scripts\pip install -r requirements-dev.txt
   ```

2. **Configure `.env.local`**:
   Create `.env.local` in the project root:
   ```ini
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_PROJECT_ID=
   VITE_FIREBASE_STORAGE_BUCKET=
   VITE_FIREBASE_MESSAGING_SENDER_ID=
   VITE_FIREBASE_APP_ID=
   VITE_FIREBASE_VAPID_KEY=

   # Full single-line JSON (or base64 JSON) of your Firebase Admin service account key
   FIREBASE_SERVICE_ACCOUNT_JSON=

   # Shared bearer token for /api/cron/notify
   CRON_SECRET=
   ```
   *(For local development, dropping your `*firebase-adminsdk*.json` file in the git-ignored project root is also auto-detected if `FIREBASE_SERVICE_ACCOUNT_JSON` is left blank.)*

3. **Start the dev servers**:
   ```powershell
   # Terminal 1 — Python FastAPI backend on http://127.0.0.1:8000
   .\.venv\Scripts\uvicorn api.index:app --reload --port 8000

   # Terminal 2 — Vite frontend on http://localhost:5173
   npm run dev
   ```

4. **Run tests & production build**:
   ```powershell
   .\.venv\Scripts\pytest -v
   npm run build
   ```

---

## Deploying to Vercel + `cron-job.org`

1. **Deploy on Vercel**:
   - Push this repository to GitHub and import it into **Vercel** (Framework Preset: **Vite**).
   - Add all environment variables from `.env.local` in **Vercel Project → Settings → Environment Variables**.
2. **Authorize Your Vercel Domain in Firebase**:
   - In **Firebase Console → Authentication → Settings → Authorized domains**, add your `<your-project>.vercel.app` hostname (and any custom domain) so Google Sign-In works in production.
3. **Schedule Notifications on [cron-job.org](https://cron-job.org/)**:
   - **URL**: `https://<your-project>.vercel.app/api/cron/notify`
   - **Schedule**: Every **15 minutes** (`*/15 * * * *`)
   - **Request Method**: `POST` (or `GET`)
   - **Header**: `Authorization: Bearer <your-CRON_SECRET>`
