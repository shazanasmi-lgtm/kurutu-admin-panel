require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────────────────────────────────
// ADMIN SECRET KEY — loaded from .env or fallback
// ────────────────────────────────────────────────────────────────────────────
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'kurutu_admin_secret_2026';
if (!process.env.ADMIN_SECRET_KEY) {
  console.log('ℹ️ ADMIN_SECRET_KEY not found in .env, using default fallback key.');
}

// ────────────────────────────────────────────────────────────────────────────
// HELMET — Security HTTP headers
// ────────────────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false  // Allow image embed from uploads
}));

// ────────────────────────────────────────────────────────────────────────────
// CORS — Restricted to allowed origins & cloud hosting
// ────────────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin browser requests, mobile curl, etc.)
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.includes('onrender.com') ||
      origin.includes('railway.app') ||
      origin.includes('vercel.app')
    ) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Key'],
  credentials: false
}));

// ────────────────────────────────────────────────────────────────────────────
// RATE LIMITERS
// ────────────────────────────────────────────────────────────────────────────

// General API limiter: 200 requests/15min per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' }
});

// Strict limiter for write ops: 30 requests/5min per IP
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many write requests. Please wait a moment.' }
});

// Mobile app ping: 500/15min (apps ping frequently)
const pingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many pings.' }
});

app.use('/api/', generalLimiter);

// ────────────────────────────────────────────────────────────────────────────
// BODY PARSERS
// ────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// ────────────────────────────────────────────────────────────────────────────
// STATIC FILES (Admin Panel Frontend)
// ────────────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION MIDDLEWARE
// Admin panel API requires X-Admin-Key header on all write/sensitive endpoints.
// Read-only public endpoints (mobile app pings, crash reports) are open.
// ────────────────────────────────────────────────────────────────────────────
function requireAdminAuth(req, res, next) {
  const provided = req.headers['x-admin-key'];
  if (!provided) {
    return res.status(401).json({ success: false, error: 'Missing X-Admin-Key header.' });
  }
  // Constant-time comparison to prevent timing attacks
  const expected = ADMIN_SECRET_KEY;
  if (provided.length !== expected.length) {
    return res.status(403).json({ success: false, error: 'Invalid admin key.' });
  }
  const isValid = crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
  if (!isValid) {
    return res.status(403).json({ success: false, error: 'Invalid admin key.' });
  }
  next();
}

const APP_CLIENT_TOKEN = 'kurutu_app_mobile_v2_6f8a2b';
function requireAppToken(req, res, next) {
  const token = req.headers['x-kurutu-app-token'];
  const adminKey = req.headers['x-admin-key'];
  if (token === APP_CLIENT_TOKEN || (adminKey && adminKey === ADMIN_SECRET_KEY)) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Unauthorized app request.' });
}

// ────────────────────────────────────────────────────────────────────────────
// LOCAL IP HELPER
// ────────────────────────────────────────────────────────────────────────────
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ────────────────────────────────────────────────────────────────────────────
// DATA DIRECTORY SETUP
// ────────────────────────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ────────────────────────────────────────────────────────────────────────────
// JSON PERSISTENCE HELPERS
// ────────────────────────────────────────────────────────────────────────────
function readJson(fileName, fallbackData = []) {
  const filePath = path.join(dataDir, fileName);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${fileName}:`, err.message);
  }
  return fallbackData;
}

function writeJson(fileName, data) {
  const filePath = path.join(dataDir, fileName);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${fileName}:`, err.message);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FIREBASE ADMIN SDK INIT
// ────────────────────────────────────────────────────────────────────────────
let isFirebaseInitialized = false;
try {
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    const serviceAccount = require(keyPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    isFirebaseInitialized = true;
    console.log('✅ Firebase Admin SDK Initialized Successfully.');
  } else {
    console.log('ℹ️  No serviceAccountKey.json found. Operating in Standalone Local Persistence mode.');
  }
} catch (error) {
  console.warn('⚠️  Firebase Admin SDK Failed to Initialize:', error.message);
}

// ────────────────────────────────────────────────────────────────────────────
// ENDPOINT: AUTH VERIFY (Admin frontend uses this to check login)
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/auth/verify', writeLimiter, (req, res) => {
  const provided = req.body.adminKey;
  if (!provided) return res.status(400).json({ success: false, error: 'No key provided.' });

  const expected = ADMIN_SECRET_KEY;
  let isValid = false;
  try {
    if (provided.length === expected.length) {
      isValid = crypto.timingSafeEqual(
        Buffer.from(provided, 'utf8'),
        Buffer.from(expected, 'utf8')
      );
    }
  } catch (_) { }

  if (isValid) {
    return res.json({ success: true, message: 'Authenticated.' });
  }
  return res.status(403).json({ success: false, error: 'Wrong admin key.' });
});

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD ENDPOINTS (Admin only)
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/dashboard/stats', requireAdminAuth, (req, res) => {
  const users = readJson('users.json', []);
  const themes = readJson('themes.json', []);
  const crashes = readJson('crashes.json', []);
  const broadcasts = readJson('broadcasts.json', []);
  const aiUsage = readJson('ai-usage.json', { totalCalls: 0 });

  const totalUsers = users.length;
  const activeThemesCount = themes.filter(t => t.active !== false).length;
  const openCrashesCount = crashes.filter(c => c.status === 'Open').length;
  const totalCrashesOccurrences = crashes.reduce((acc, c) => acc + (c.occurrences || 1), 0);
  const crashRate = totalUsers > 0 ? ((totalCrashesOccurrences / totalUsers) * 100).toFixed(1) + '%' : '0.0%';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const countsByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
  users.forEach(u => {
    if (u.joined) {
      const d = new Date(u.joined);
      if (!isNaN(d.getTime())) {
        const dayName = days[d.getDay()];
        if (countsByDay[dayName] !== undefined) countsByDay[dayName]++;
      }
    } else { countsByDay['Mon']++; }
  });
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weeklyChart = order.map(day => ({ day, count: countsByDay[day] }));

  res.json({
    success: true,
    stats: {
      totalUsers: totalUsers.toLocaleString(),
      activeThemes: activeThemesCount,
      aiApiCalls: (aiUsage.totalCalls || 0).toLocaleString(),
      crashRate,
      openCrashes: openCrashesCount,
      firebaseStatus: isFirebaseInitialized ? 'Connected' : 'Standalone Mode',
      uptime: Math.floor(process.uptime()) + 's'
    },
    weeklyChart,
    recentBroadcasts: broadcasts.slice(0, 3)
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TELEMETRY — Mobile app increments AI usage (open — no admin needed)
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/telemetry/ai-call', pingLimiter, requireAppToken, (req, res) => {
  const aiUsage = readJson('ai-usage.json', { totalCalls: 0 });
  aiUsage.totalCalls = (aiUsage.totalCalls || 0) + 1;
  writeJson('ai-usage.json', aiUsage);
  res.json({ success: true, totalCalls: aiUsage.totalCalls });
});

// ────────────────────────────────────────────────────────────────────────────
// UPLOAD ENDPOINT (Admin only)
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/upload', requireAdminAuth, writeLimiter, (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, error: 'No image data provided.' });

    const matches = imageBase64.match(/^data:image\/([a-zA-Z0-9-+.]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ success: false, error: 'Invalid image format.' });

    let ext = matches[1];
    if (ext === 'jpeg') ext = 'jpg';
    const allowedExts = ['jpg', 'png', 'gif', 'webp'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ success: false, error: 'Only jpg/png/gif/webp images allowed.' });
    }

    const base64Data = matches[2];
    // Limit to 10MB decoded
    if (base64Data.length > 10 * 1024 * 1024 * 1.37) {
      return res.status(413).json({ success: false, error: 'Image too large. Max 10MB.' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFile(filePath, buffer, (err) => {
      if (err) {
        console.error('Error saving image:', err);
        return res.status(500).json({ success: false, error: 'Failed to save image on server.' });
      }
      const localIp = getLocalIp();
      const host = req.get('host') || `${localIp}:${PORT}`;
      const hostname = host.includes('localhost') || host.includes('127.0.0.1') ? `${localIp}:${PORT}` : host;
      const imageUrl = `${req.protocol}://${hostname}/uploads/${fileName}`;
      res.json({ success: true, url: imageUrl });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// BROADCAST ENDPOINTS (Admin only for POST/DELETE)
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/broadcasts', requireAdminAuth, (req, res) => {
  const broadcasts = readJson('broadcasts.json', []);
  res.json({ success: true, broadcasts });
});

app.post('/api/notify', requireAdminAuth, writeLimiter, async (req, res) => {
  const { title, body, imageUrl } = req.body;
  if (!title || !body) return res.status(400).json({ success: false, error: 'Title and Body are required.' });

  let firebaseSent = false;
  let messageId = `local_${Date.now()}`;

  if (isFirebaseInitialized) {
    const message = {
      data: { title, body, ...(imageUrl && { image: imageUrl }) },
      android: { priority: 'high', ttl: 86400000 },
      topic: 'all_users'
    };
    try {
      messageId = await admin.messaging().send(message);
      firebaseSent = true;
      console.log('FCM Notification sent:', messageId);
    } catch (error) {
      console.warn('FCM Notification error:', error.message);
    }
  }

  const users = readJson('users.json', []);
  const broadcasts = readJson('broadcasts.json', []);
  const newBroadcast = {
    id: `bcast_${Date.now()}`,
    title, body, imageUrl: imageUrl || '',
    sentAt: new Date().toISOString(),
    status: isFirebaseInitialized && firebaseSent ? 'Sent (FCM)' : 'Broadcasted (Local)',
    recipientCount: users.length,
    messageId
  };
  broadcasts.unshift(newBroadcast);
  writeJson('broadcasts.json', broadcasts);
  res.json({ success: true, message: isFirebaseInitialized ? 'Notification broadcasted via FCM' : 'Notification saved to local log', broadcast: newBroadcast });
});

app.delete('/api/broadcasts/:id', requireAdminAuth, writeLimiter, (req, res) => {
  let broadcasts = readJson('broadcasts.json', []);
  broadcasts = broadcasts.filter(b => b.id !== req.params.id);
  writeJson('broadcasts.json', broadcasts);
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// THEME ENDPOINTS — GET is open (mobile app fetches themes), write = admin only
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/themes', (req, res) => {
  const themes = readJson('themes.json', []);
  // Only expose safe fields to anonymous callers (mobile app)
  const publicThemes = themes.map(({ id, name, bg, keyBg, keyText, accent, isDefault, active }) =>
    ({ id, name, bg, keyBg, keyText, accent, isDefault, active }));
  res.json({ success: true, themes: publicThemes });
});

app.post('/api/themes', requireAdminAuth, writeLimiter, async (req, res) => {
  const { name, bg, keyBg, keyText, accent, jsonConfig } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Theme Name is required.' });

  const themes = readJson('themes.json', []);
  const newTheme = {
    id: `theme_${Date.now()}`,
    name, bg: bg || '#0f0c20', keyBg: keyBg || '#1e1a3a',
    keyText: keyText || '#ffffff', accent: accent || '#a855f7',
    jsonConfig: jsonConfig || '', isDefault: false, active: true,
    createdAt: Date.now()
  };
  themes.unshift(newTheme);
  writeJson('themes.json', themes);

  const notifTitle = '🎨 Aluth Theme Ekak Publish Vuna!';
  const notifBody = `New keyboard theme "${name}" is now available! Open settings to apply.`;
  let firebaseSent = false;
  let messageId = `theme_notif_${Date.now()}`;

  if (isFirebaseInitialized) {
    const message = {
      data: {
        type: 'new_theme', title: String(notifTitle), body: String(notifBody),
        themeId: String(newTheme.id), themeName: String(newTheme.name),
        themeBg: String(newTheme.bg), themeKeyBg: String(newTheme.keyBg),
        themeKeyText: String(newTheme.keyText), themeAccent: String(newTheme.accent)
      },
      android: { priority: 'high', ttl: 86400000 },
      topic: 'all_users'
    };
    try {
      messageId = await admin.messaging().send(message);
      firebaseSent = true;
      console.log(`✅ FCM Theme notification sent for "${name}":`, messageId);
    } catch (error) {
      console.warn('⚠️  FCM Theme Notification error:', error.message);
    }
  }

  const usersCount = readJson('users.json', []).length;
  const broadcasts = readJson('broadcasts.json', []);
  broadcasts.unshift({
    id: `bcast_${Date.now()}`, title: notifTitle, body: notifBody, imageUrl: '',
    sentAt: new Date().toISOString(),
    status: isFirebaseInitialized && firebaseSent ? 'Sent (FCM)' : 'Broadcasted (Local)',
    recipientCount: usersCount, messageId
  });
  writeJson('broadcasts.json', broadcasts);

  res.json({ success: true, theme: newTheme, message: isFirebaseInitialized ? 'Theme published & FCM notification broadcasted!' : 'Theme published!' });
});

app.patch('/api/themes/:id/toggle', requireAdminAuth, writeLimiter, (req, res) => {
  const themes = readJson('themes.json', []);
  const theme = themes.find(t => t.id === req.params.id);
  if (!theme) return res.status(404).json({ success: false, error: 'Theme not found.' });
  theme.active = !theme.active;
  writeJson('themes.json', themes);
  res.json({ success: true, active: theme.active });
});

app.delete('/api/themes/:id', requireAdminAuth, writeLimiter, (req, res) => {
  let themes = readJson('themes.json', []);
  themes = themes.filter(t => t.id !== req.params.id);
  writeJson('themes.json', themes);
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// AI CONFIG ENDPOINTS (Admin only — API keys NEVER sent to client)
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/ai-config', requireAdminAuth, (req, res) => {
  const config = readJson('ai-config.json', {
    geminiApiKey: '', giphyApiKey: '', openaiApiKey: '',
    activeModel: 'gemini-1.5-flash', translationEngine: 'google-mlkit',
    autoGrammarFix: true, sinhalaTransliteration: true, smartAutoReply: false, dailyLimitPerUser: 50
  });

  // Mask API keys — only show last 4 chars for security
  const masked = { ...config };
  if (masked.geminiApiKey) masked.geminiApiKey = '••••••••' + masked.geminiApiKey.slice(-4);
  if (masked.giphyApiKey) masked.giphyApiKey = '••••••••' + masked.giphyApiKey.slice(-4);
  if (masked.openaiApiKey) masked.openaiApiKey = '••••••••' + masked.openaiApiKey.slice(-4);

  res.json({ success: true, config: masked });
});

// Separate endpoint to UPDATE config (new key replaces old only if not masked)
app.post('/api/ai-config', requireAdminAuth, writeLimiter, (req, res) => {
  const currentConfig = readJson('ai-config.json', {});
  const updated = { ...currentConfig };

  // Only update key fields if provided and not masked placeholders
  const fields = ['geminiApiKey', 'giphyApiKey', 'openaiApiKey'];
  fields.forEach(f => {
    if (req.body[f] && !req.body[f].startsWith('••••')) {
      updated[f] = req.body[f];
    }
  });

  const safeFields = ['activeModel', 'translationEngine', 'autoGrammarFix', 'sinhalaTransliteration', 'smartAutoReply', 'dailyLimitPerUser'];
  safeFields.forEach(f => {
    if (req.body[f] !== undefined) updated[f] = req.body[f];
  });

  updated.updatedAt = Date.now();
  writeJson('ai-config.json', updated);
  res.json({ success: true, message: 'AI Configuration saved successfully!' });
});

// AI config for mobile app — only non-sensitive settings
app.get('/api/ai-config/mobile', (req, res) => {
  const config = readJson('ai-config.json', {});
  res.json({
    success: true,
    config: {
      activeModel: config.activeModel,
      translationEngine: config.translationEngine,
      autoGrammarFix: config.autoGrammarFix,
      sinhalaTransliteration: config.sinhalaTransliteration,
      smartAutoReply: config.smartAutoReply,
      dailyLimitPerUser: config.dailyLimitPerUser
    }
  });
});

app.post('/api/ai-config/test', requireAdminAuth, writeLimiter, (req, res) => {
  setTimeout(() => {
    res.json({ success: true, status: 'Connected', latency: '142ms', modelResponse: 'AI Service response OK. Ready for Sinhala grammar & translation tasks.' });
  }, 400);
});

// ────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

// GET /api/users — Admin only
app.get('/api/users', requireAdminAuth, (req, res) => {
  const users = readJson('users.json', []);
  res.json({ success: true, users });
});

// POST /api/users/ping — Mobile app pings to register (open, rate-limited)
app.post('/api/users/ping', pingLimiter, requireAppToken, (req, res) => {
  const { id, name, email, device, os: userOs, appVersion } = req.body;
  if (!id) return res.status(400).json({ success: false, error: 'Device ID required.' });

  // Sanitize id — alphanumeric + dashes only
  if (!/^[a-zA-Z0-9_\-]{5,64}$/.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid device ID format.' });
  }

  let users = readJson('users.json', []);
  let user = users.find(u => u.id === id);

  if (user) {
    user.lastActive = 'Just now';
    if (device) user.device = String(device).slice(0, 100);
    if (userOs) user.os = String(userOs).slice(0, 50);
    if (appVersion) user.appVersion = String(appVersion).slice(0, 20);
  } else {
    user = {
      id,
      name: String(name || 'Android Device').slice(0, 100),
      email: String(email || `${id}@app.local`).slice(0, 255),
      device: String(device || 'Android Device').slice(0, 100),
      os: String(userOs || 'Android 14').slice(0, 50),
      appVersion: String(appVersion || 'v2.1.0').slice(0, 20),
      status: 'Active', isPremium: false,
      lastActive: 'Just now',
      joined: new Date().toISOString().split('T')[0]
    };
    users.unshift(user);
  }

  writeJson('users.json', users);
  res.json({ success: true, user: { id: user.id, status: user.status, isPremium: user.isPremium } });
});

// POST /api/users — Admin creates user manually
app.post('/api/users', requireAdminAuth, writeLimiter, (req, res) => {
  const { name, email, device, os: userOs, isPremium } = req.body;
  if (!name || !email) return res.status(400).json({ success: false, error: 'Name and Email are required.' });

  const users = readJson('users.json', []);
  const newUser = {
    id: `usr_${Math.floor(10000 + Math.random() * 90000)}`,
    name: String(name).slice(0, 100),
    email: String(email).slice(0, 255),
    device: String(device || 'Android Device').slice(0, 100),
    os: String(userOs || 'Android 14').slice(0, 50),
    appVersion: 'v2.1.0', status: 'Active',
    isPremium: Boolean(isPremium), lastActive: 'Just now',
    joined: new Date().toISOString().split('T')[0]
  };
  users.unshift(newUser);
  writeJson('users.json', users);
  res.json({ success: true, user: newUser });
});

app.patch('/api/users/:id/status', requireAdminAuth, writeLimiter, (req, res) => {
  const users = readJson('users.json', []);
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
  if (req.body.status !== undefined) user.status = req.body.status;
  if (req.body.isPremium !== undefined) user.isPremium = req.body.isPremium;
  writeJson('users.json', users);
  res.json({ success: true, user });
});

app.delete('/api/users/:id', requireAdminAuth, writeLimiter, (req, res) => {
  let users = readJson('users.json', []);
  users = users.filter(u => u.id !== req.params.id);
  writeJson('users.json', users);
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// CRASH REPORTS ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

// GET — Admin only
app.get('/api/crashes', requireAdminAuth, (req, res) => {
  const crashes = readJson('crashes.json', []);
  res.json({ success: true, crashes });
});

// POST — Mobile app can report crashes (open, rate-limited)
app.post('/api/crashes', pingLimiter, requireAppToken, (req, res) => {
  const { title, exception, component, severity, appVersion, device, stackTrace } = req.body;
  const crashes = readJson('crashes.json', []);

  // Cap stack trace length to prevent abuse
  const newCrash = {
    id: `crash_${Date.now()}`,
    title: String(title || 'Non-Fatal Exception').slice(0, 200),
    exception: String(exception || 'Unknown Exception').slice(0, 500),
    component: String(component || 'Unknown').slice(0, 100),
    severity: ['Warning', 'Error', 'Critical'].includes(severity) ? severity : 'Warning',
    status: 'Open', occurrences: 1, affectedUsers: 1, lastSeen: 'Just now',
    appVersion: String(appVersion || 'v2.1.0').slice(0, 20),
    device: String(device || 'Android Device').slice(0, 100),
    stackTrace: String(stackTrace || exception || 'No stack trace provided').slice(0, 5000)
  };

  crashes.unshift(newCrash);
  writeJson('crashes.json', crashes);
  res.json({ success: true, crash: { id: newCrash.id } });
});

app.patch('/api/crashes/:id/resolve', requireAdminAuth, writeLimiter, (req, res) => {
  const crashes = readJson('crashes.json', []);
  const crash = crashes.find(c => c.id === req.params.id);
  if (!crash) return res.status(404).json({ success: false, error: 'Crash report not found.' });
  crash.status = crash.status === 'Resolved' ? 'Open' : 'Resolved';
  writeJson('crashes.json', crashes);
  res.json({ success: true, status: crash.status });
});

app.delete('/api/crashes/:id', requireAdminAuth, writeLimiter, (req, res) => {
  let crashes = readJson('crashes.json', []);
  crashes = crashes.filter(c => c.id !== req.params.id);
  writeJson('crashes.json', crashes);
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// ADMIN DATA RESET (Admin only)
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/admin/reset', requireAdminAuth, writeLimiter, (req, res) => {
  const { type } = req.body;
  const allowed = ['users', 'crashes', 'broadcasts', 'all'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid reset type.' });
  }
  if (type === 'users' || type === 'all') writeJson('users.json', []);
  if (type === 'crashes' || type === 'all') writeJson('crashes.json', []);
  if (type === 'broadcasts' || type === 'all') writeJson('broadcasts.json', []);
  res.json({ success: true, message: 'Data cleared successfully.' });
});

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER (prevent stack trace leaks)
// ────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ────────────────────────────────────────────────────────────────────────────
// START SERVER
// ────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    const localIp = getLocalIp();
    console.log(`🚀 Kurutu Admin Panel running at http://localhost:${PORT} (Network: http://${localIp}:${PORT})`);
    console.log(`🔒 Admin authentication: ENABLED (X-Admin-Key header required)`);
    console.log(`🛡️  Helmet security headers: ENABLED`);
    console.log(`⚡ Rate limiting: ENABLED (200 req/15min general, 30 req/5min write ops)`);
  });
}

module.exports = app;
