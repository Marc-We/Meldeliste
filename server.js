const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (err) {
  nodemailer = null;
}

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const CLASSES_FILE = path.join(DATA_DIR, 'classes.json');
const SUBJECTS_FILE = path.join(DATA_DIR, 'subjects.json');
const HOMEWORK_FILE = path.join(DATA_DIR, 'homework.json');
const ROOM_STATS_FILE = path.join(DATA_DIR, 'room_stats.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const BANS_FILE = path.join(DATA_DIR, 'bans.json');

// --- Helpers for persistence -------------------------------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Failed to load ${file}`, err);
    return fallback;
  }
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Failed to save ${file}`, err);
  }
}

ensureDir(DATA_DIR);

// --- In-memory state ---------------------------------------------------------
let users = new Map(Object.entries(loadJson(USERS_FILE, {})));
let rooms = new Map(Object.entries(loadJson(ROOMS_FILE, {})));
let logs = new Map(Object.entries(loadJson(LOGS_FILE, {})));
let classes = new Set(loadJson(CLASSES_FILE, []));
let subjects = new Set(loadJson(SUBJECTS_FILE, []));
let homework = new Map(Object.entries(loadJson(HOMEWORK_FILE, {}))); // key `${class}|${subject}` -> {text, ts}
let roomStats = new Map(Object.entries(loadJson(ROOM_STATS_FILE, {})));
let codes = new Map(Object.entries(loadJson(CODES_FILE, {}))); // key role:class -> {code, role, className, createdAt, expiresAt}
let bans = loadJson(BANS_FILE, { emails: [], ips: [] });

// Seeds for demo if empty
if (users.size === 0) {
  const teacherId = 't-1';
  users.set(teacherId, {
    id: teacherId,
    role: 'teacher',
    name: 'Lehrer*in',
    subjects: ['default'],
    stats: {},
  });
  saveUsers();
}

function saveUsers() {
  const plain = Object.fromEntries(users);
  saveJson(USERS_FILE, plain);
}
function saveRooms() {
  const plain = Object.fromEntries(rooms);
  saveJson(ROOMS_FILE, plain);
}
function saveLogs() {
  const plain = Object.fromEntries(logs);
  saveJson(LOGS_FILE, plain);
}
function saveClasses() {
  saveJson(CLASSES_FILE, Array.from(classes));
}
function saveSubjects() {
  saveJson(SUBJECTS_FILE, Array.from(subjects));
}
function saveHomework() {
  saveJson(HOMEWORK_FILE, Object.fromEntries(homework));
}
function saveHomework() {
  const plain = Object.fromEntries(homework);
  saveJson(HOMEWORK_FILE, plain);
}
function saveRoomStats() {
  const plain = Object.fromEntries(roomStats);
  saveJson(ROOM_STATS_FILE, plain);
}
function saveCodes() {
  saveJson(CODES_FILE, Object.fromEntries(codes));
}
function saveBans() {
  saveJson(BANS_FILE, bans);
}

// socket tracking
const userSockets = new Map(); // userId -> Set<ws>

// per-room membership & ready status
const roomMembers = new Map(); // roomId -> Set<userId>
const readyMap = new Map(); // roomId -> Set<userId>
const roomCounters = new Map(); // roomId -> Map<userId, {signals, calls, toiletSeconds}>
const toiletMap = new Map(); // roomId -> Map<userId, {status: 'pending'|'allowed'|'back', start: number|null}>
const importantMap = new Map(); // roomId -> Set<userId>
const questionsMap = new Map(); // roomId -> [{id,text,ts}]
const pollsMap = new Map(); // roomId -> {id, question, options:[{id,text,count}], multiple, votes: Map<userId, string[]>}
const thoughtsMap = new Map(); // roomId -> {active:boolean, entries:string[]}
const homeworkMap = homework; // alias for clarity

function normalizeHomework(entry) {
  if (!entry) return { current: null, previous: null };
  if (entry.text) return { current: { text: entry.text, ts: entry.ts || Date.now() }, previous: null };
  return {
    current: entry.current || null,
    previous: entry.previous || null,
  };
}
homeworkMap.forEach((v, k) => homeworkMap.set(k, normalizeHomework(v)));

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end();
  }
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(__dirname, safePath.replace(/^\/+/, ''));

  // prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

// --- Utility functions -------------------------------------------------------
const ratingKeys = ['--', '-', '0', '+', '++'];
const CODE_TTL_MS = 15 * 60 * 1000;
const CLASS_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(secret), salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

function verifySecret(secret, stored) {
  if (!stored) return false;
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const [salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(String(secret), salt, 64);
  const hashBuf = Buffer.from(hashHex, 'hex');
  if (hashBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(hashBuf, derived);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

let mailTransport = null;
function getMailer() {
  if (!nodemailer) return null;
  if (mailTransport) return mailTransport;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
  mailTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return mailTransport;
}

function sendEmail(to, subject, text) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
  const transport = getMailer();
  if (!transport) {
    console.log(`[MAIL DEBUG] To: ${to}\n${subject}\n${text}`);
    return;
  }
  transport.sendMail({ from, to, subject, text }, (err) => {
    if (err) {
      console.error('Failed to send email', err);
    }
  });
}

function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  for (const u of users.values()) {
    if (normalizeEmail(u.email) === normalized) return u;
  }
  return null;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    salutation: user.salutation,
    className: user.className,
    name: user.name,
    teachings: user.teachings || [],
    courses: user.courses || [],
  };
}

function ensureStats(user, subject) {
  if (!user) {
    return {
      signals: 0,
      calls: 0,
      ratings: { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 },
      toiletSeconds: 0,
      daily: {},
    };
  }
  if (!user.stats) user.stats = {};
  if (!user.stats[subject]) {
    user.stats[subject] = {
      signals: 0,
      calls: 0,
      ratings: { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 },
      toiletSeconds: 0,
      daily: {},
    };
  }
  return user.stats[subject];
}

function getSubjectTotals(user, subject) {
  const s = ensureStats(user, subject);
  return {
    signals: s.signals || 0,
    calls: s.calls || 0,
    toiletSeconds: s.toiletSeconds || 0,
    ratings: s.ratings || { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 },
  };
}

function ensureRoomStatsEntry(roomId, room) {
  let entry = roomStats.get(roomId);
  const classNames = Array.isArray(room?.classNames) ? room.classNames.filter(Boolean) : [];
  const legacyClass = room?.className ? [room.className] : [];
  const mergedClasses = classNames.length ? classNames : legacyClass;
  if (!entry) {
    entry = {
      roomId,
      name: room?.name || '',
      className: room?.className || '',
      classNames: mergedClasses,
      subject: room?.subject || 'default',
      createdAt: room?.createdAt || Date.now(),
      closedAt: room?.closedAt || null,
      students: {},
    };
  } else {
    entry.name = entry.name || room?.name || '';
    entry.className = entry.className || room?.className || '';
    if (!Array.isArray(entry.classNames) || !entry.classNames.length) {
      entry.classNames = entry.className ? [entry.className] : mergedClasses;
    }
    entry.subject = entry.subject || room?.subject || 'default';
    entry.createdAt = entry.createdAt || room?.createdAt || Date.now();
    if (room?.closedAt) entry.closedAt = room.closedAt;
    if (!entry.students) entry.students = {};
  }
  roomStats.set(roomId, entry);
  return entry;
}

function getRoomClassNames(room) {
  if (Array.isArray(room?.classNames) && room.classNames.length) {
    return room.classNames.filter(Boolean);
  }
  if (room?.className) return [room.className];
  return [];
}

function courseKey(subject, teacherId) {
  return `${subject || 'default'}::${teacherId || ''}`;
}

function listAvailableCoursesForClass(className) {
  if (!className) return [];
  const list = [];
  users.forEach((u) => {
    if (!u || (u.role !== 'teacher' && u.role !== 'admin')) return;
    const teachings = Array.isArray(u.teachings) ? u.teachings : [];
    teachings.forEach((t) => {
      if (!t || !t.subject) return;
      const classes = Array.isArray(t.classNames) && t.classNames.length ? t.classNames : (t.className ? [t.className] : []);
      if (classes.length && !classes.includes(className)) return;
      list.push({ subject: t.subject, teacherId: u.id, teacherName: u.name || u.email || 'Lehrer' });
    });
  });
  const map = new Map();
  list.forEach((c) => {
    const key = courseKey(c.subject, c.teacherId);
    if (!map.has(key)) map.set(key, c);
  });
  return Array.from(map.values());
}

function normalizeCourseList(courses, allowedCourses) {
  const allowedKeys = new Set((allowedCourses || []).map((c) => courseKey(c.subject, c.teacherId)));
  const list = Array.isArray(courses) ? courses : [];
  return list
    .map((c) => ({
      subject: String(c?.subject || '').trim(),
      teacherId: String(c?.teacherId || '').trim(),
    }))
    .filter((c) => c.subject && c.teacherId && allowedKeys.has(courseKey(c.subject, c.teacherId)));
}

function sendCourseCatalog(ws, user) {
  if (!ws || !user || user.role !== 'student') return;
  const courses = listAvailableCoursesForClass(user.className);
  ws.send(JSON.stringify({ type: 'courseCatalog', courses }));
}

function sendProfileToUser(userId) {
  const u = users.get(userId);
  if (!u) return;
  const payload = JSON.stringify({ type: 'profile', user: publicUser(u) });
  const sockets = userSockets.get(userId);
  if (sockets) sockets.forEach((client) => client.send(payload));
}

function sendCourseCatalogToUser(userId) {
  const u = users.get(userId);
  if (!u || u.role !== 'student') return;
  const courses = listAvailableCoursesForClass(u.className);
  const payload = JSON.stringify({ type: 'courseCatalog', courses });
  const sockets = userSockets.get(userId);
  if (sockets) sockets.forEach((client) => client.send(payload));
}

function broadcastCourseCatalogs() {
  userSockets.forEach((_, userId) => {
    sendCourseCatalogToUser(userId);
  });
}

function codeKey(role, className) {
  return `${role}:${className || ''}`;
}

function isCodeExpired(entry) {
  return !entry || !entry.expiresAt || entry.expiresAt < Date.now();
}

function generateUniqueCode() {
  let code = generateCode();
  const existing = new Set(Array.from(codes.values()).map((c) => c.code));
  let guard = 0;
  while (existing.has(code) && guard < 20) {
    code = generateCode();
    guard += 1;
  }
  return code;
}

function getOrRotateCode(role, className, force = false) {
  const key = codeKey(role, className);
  const existing = codes.get(key);
  if (existing && !force && !isCodeExpired(existing)) return existing;
  const now = Date.now();
  const entry = {
    role,
    className: className || '',
    code: generateUniqueCode(),
    createdAt: now,
    expiresAt: now + CLASS_CODE_TTL_MS,
  };
  codes.set(key, entry);
  saveCodes();
  return entry;
}

function findCodeByValue(role, codeValue) {
  if (!codeValue) return null;
  const code = String(codeValue || '').trim();
  let found = null;
  codes.forEach((entry) => {
    if (!entry || entry.role !== role) return;
    if (entry.code === code && !isCodeExpired(entry)) {
      found = entry;
    }
  });
  return found;
}

function isBanned(email, ip) {
  const e = normalizeEmail(email || '');
  const emails = Array.isArray(bans.emails) ? bans.emails : [];
  const ips = Array.isArray(bans.ips) ? bans.ips : [];
  if (e && emails.includes(e)) return true;
  if (ip && ips.includes(ip)) return true;
  return false;
}

function isStudentAllowedInRoom(user, room) {
  if (!user || user.role !== 'student') return true;
  const roomClasses = getRoomClassNames(room);
  if (roomClasses.length && user.className && !roomClasses.includes(user.className)) return false;
  const subject = room?.subject || 'default';
  const teacherId = room?.teacherId;
  if (!teacherId) return true;
  const courses = Array.isArray(user.courses) ? user.courses : [];
  if (!courses.length) return false;
  return courses.some((c) => c && c.subject === subject && c.teacherId === teacherId);
}

function teachingMatchesClass(teaching, className) {
  if (!teaching) return false;
  const classes = Array.isArray(teaching.classNames) && teaching.classNames.length
    ? teaching.classNames
    : (teaching.className ? [teaching.className] : []);
  if (!classes.length) return false;
  return classes.includes(className);
}

function teacherCanAccessClass(user, className) {
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) return false;
  if (user.role === 'admin') return true;
  const teachings = Array.isArray(user.teachings) ? user.teachings : [];
  return teachings.some((t) => teachingMatchesClass(t, className));
}

function forceLeaveRoom(userId, roomId) {
  const set = roomMembers.get(roomId);
  if (set) set.delete(userId);
  resetReady(roomId, userId);
  const imp = importantMap.get(roomId);
  if (imp) imp.delete(userId);
  const toilet = toiletMap.get(roomId);
  if (toilet) toilet.delete(userId);
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.forEach((client) => {
      if (client.roomId === roomId) client.roomId = null;
      client.send(JSON.stringify({ type: 'roomKicked', roomId }));
    });
  }
  updatePresence(roomId);
}

function ensureRoomStudentStats(entry, userId) {
  if (!entry.students) entry.students = {};
  if (!entry.students[userId]) {
    entry.students[userId] = {
      signals: 0,
      calls: 0,
      toiletSeconds: 0,
      ratings: { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 },
    };
  }
  return entry.students[userId];
}

function aggregateTotalStats(user) {
  const total = {
    signals: 0,
    calls: 0,
    toiletSeconds: 0,
    ratings: { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 },
  };
  const stats = user?.stats || {};
  Object.values(stats).forEach((s) => {
    total.signals += s?.signals || 0;
    total.calls += s?.calls || 0;
    total.toiletSeconds += s?.toiletSeconds || 0;
    const ratings = s?.ratings || {};
    ratingKeys.forEach((key) => {
      total.ratings[key] = (total.ratings[key] || 0) + (ratings[key] || 0);
    });
  });
  return total;
}

function ensureDaily(user, subject, date) {
  const s = ensureStats(user, subject);
  if (!s.daily) s.daily = {};
  if (!s.daily[date]) s.daily[date] = { signals: 0, calls: 0, toiletSeconds: 0 };
  return s.daily[date];
}

function findUserByCredentials({ role, firstName, lastName, className, salutation, password }) {
  for (const u of users.values()) {
    if (u.role !== role) continue;
    if (role === 'teacher') {
      if ((u.salutation || '') !== (salutation || '')) continue;
      if ((u.lastName || '').toLowerCase() !== (lastName || '').toLowerCase()) continue;
    } else {
      if ((u.firstName || '').toLowerCase() !== (firstName || '').toLowerCase()) continue;
      if ((u.lastName || '').toLowerCase() !== (lastName || '').toLowerCase()) continue;
      if (className) {
        if ((u.className || '') !== className) continue;
      }
    }
    // password check
    if (u.password && password && u.password !== password) continue;
    return u;
  }
  return null;
}

function attachSocket(userId, ws) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(ws);
}

function detachSocket(userId, ws) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) userSockets.delete(userId);
}

function broadcastRoom(roomId, msg, exclude) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    if (exclude && client === exclude) return;
    client.send(payload);
  });
}

function sendToUser(userId, msg) {
  const payload = JSON.stringify(msg);
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

function sendRoomList(ws) {
  const activeRooms = Array.from(rooms.values()).filter((r) => r.active !== false);
  ws.send(
    JSON.stringify({
      type: 'roomList',
      rooms: activeRooms,
    })
  );
}

function sendCatalogs(ws) {
  ws.send(JSON.stringify({ type: 'catalogs', classes: Array.from(classes), subjects: Array.from(subjects) }));
}

function broadcastCatalogs() {
  const payload = JSON.stringify({ type: 'catalogs', classes: Array.from(classes), subjects: Array.from(subjects) });
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

function getToiletState(roomId, userId) {
  const map = toiletMap.get(roomId);
  if (!map) return null;
  return map.get(userId) || null;
}

function isImportant(roomId, userId) {
  const set = importantMap.get(roomId);
  return Boolean(set && set.has(userId));
}

function broadcastPoll(roomId) {
  const poll = pollsMap.get(roomId);
  if (!poll) return;
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    const isTeacher = client.role === 'teacher' || client.role === 'admin';
    const voted = poll.votes.has(client.userId);
    const payload = {
      type: 'poll',
      roomId,
      poll: {
        id: poll.id,
        question: poll.question,
        options: poll.options,
        multiple: poll.multiple,
        open: poll.open !== false,
        anonymous: poll.anonymous !== false ? true : false,
        voted,
      },
    };
    if (isTeacher && poll.anonymous === false) {
      payload.poll.votesList = Array.from(poll.votes.entries()).map(([userId, options]) => ({
        userId,
        name: users.get(userId)?.name || 'Unbekannt',
        options,
      }));
    }
    client.send(JSON.stringify(payload));
  });
}

function broadcastThoughts(roomId, payload) {
  const json = JSON.stringify({ ...payload, roomId });
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    client.send(json);
  });
}

function broadcastHomework(className, subject, entry) {
  const payload = JSON.stringify({ type: 'homework', className, subject, homework: entry || homeworkMap.get(`${className}|${subject}`) || null });
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    client.send(payload);
  });
}

function broadcastQuestions(roomId) {
  const list = questionsMap.get(roomId) || [];
  const payload = JSON.stringify({ type: 'questionList', roomId, questions: list });
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    if (client.role === 'teacher' || client.role === 'admin') {
      client.send(payload);
    }
  });
}

function updatePresence(roomId) {
  const members = roomMembers.get(roomId) || new Set();
  const ready = readyMap.get(roomId) || new Set();
  const payload = {
    type: 'presence',
    roomId,
    members: Array.from(members).map((userId) => {
      const user = users.get(userId);
      const sockets = userSockets.get(userId);
      return {
        userId,
        name: user?.name || 'Unbekannt',
        role: user?.role || 'student',
        ready: ready.has(userId),
        online: Boolean(sockets && sockets.size > 0),
        important: isImportant(roomId, userId),
      };
    }),
  };
  broadcastRoom(roomId, payload);
}

function appendLog(roomId, entry) {
  if (!logs.has(roomId)) logs.set(roomId, { entries: [] });
  const logEntry = { id: entry.id || genId('log'), ...entry };
  logs.get(roomId).entries.push(logEntry);
  saveLogs();
  sendLogUpdates(roomId);
}

function sendLogUpdates(roomId) {
  const roomLog = logs.get(roomId);
  const log = roomLog?.entries || [];
  let touched = false;
  log.forEach((e) => {
    if (!e.id) {
      e.id = genId('log');
      touched = true;
    }
  });
  if (touched) {
    logs.set(roomId, { entries: log });
    saveLogs();
  }
  // send to each socket in the room with role-based visibility
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    const isTeacher = client.role === 'teacher';
    const filtered = log
      .filter((e) => {
        if (!isTeacher && e.userId !== client.userId) return false;
        if (e.action === 'signal' || e.action === 'withdraw') return false; // Meldungen nicht im Log anzeigen
        return true;
      })
      .map((e) => ({
        id: e.id,
        ts: e.ts,
        userId: e.userId,
        name: e.name || 'Unbekannt',
        action: e.action,
        rating: isTeacher ? e.rating : undefined,
      }));
    client.send(JSON.stringify({ type: isTeacher ? 'log' : 'myLog', roomId, entries: filtered }));
  });
}

function sendStats(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const members = roomMembers.get(roomId) || new Set();
  const subject = room.subject || 'default';

  const counters = roomCounters.get(roomId) || new Map();

  const stats = Array.from(members)
    .map((userId) => users.get(userId))
    .filter((u) => u && u.role !== 'teacher' && u.role !== 'admin')
    .map((user) => {
      const s = ensureStats(user, subject);
      const daily = s.daily || {};
      const roomCounter = counters.get(user.id) || { signals: 0, calls: 0, toiletSeconds: 0 };
      return {
        userId: user.id,
        name: user.name || 'Unbekannt',
        session: { signals: roomCounter.signals || 0, calls: roomCounter.calls || 0, toiletSeconds: roomCounter.toiletSeconds || 0 },
        total: { signals: s.signals, calls: s.calls, ratings: s.ratings, toiletSeconds: s.toiletSeconds || 0 },
        daily,
      };
    });

  // send teacher view
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    if (client.role !== 'teacher') return;
    client.send(JSON.stringify({ type: 'stats', roomId, stats }));
  });

  // send each student their own stats
  stats.forEach((item) => {
    sendToUser(item.userId, {
      type: 'myStats',
      roomId,
      subject,
      session: item.session,
      total: item.total,
      daily: item.daily,
    });
  });
}

function resetReady(roomId, userId) {
  const set = readyMap.get(roomId);
  if (set) set.delete(userId);
}

// --- Message handling --------------------------------------------------------
wss.on('connection', (ws, req) => {
  ws.userId = null;
  ws.role = null;
  ws.roomId = null;
  ws.ip = req?.socket?.remoteAddress || '';

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      return;
    }
    const { type } = msg || {};

    // Profile init / creation
    if (type === 'initProfile') {
      const mode = msg.mode === 'login' ? 'login' : 'register';
      const incomingId = msg.userId;
      const role = ['teacher', 'student', 'admin'].includes(msg.role) ? msg.role : 'student';
      const firstName = role === 'student' ? String(msg.firstName || '').trim() : '';
      const lastName = String(msg.lastName || '').trim();
      const salutation = role === 'teacher' ? (msg.salutation === 'Frau' ? 'Frau' : 'Herr') : '';
      const className = role === 'student' ? String(msg.className || '').trim() : String(msg.className || '').trim();
      const password = String(msg.password || '').trim();

      let user = incomingId ? users.get(incomingId) : null;
      if (user) {
        if (user.password && password && user.password !== password) {
          ws.send(JSON.stringify({ type: 'authError', reason: 'wrong_password' }));
          return;
        }
      } else {
        // Try to find existing by credentials on login
        if (mode === 'login') {
          const found = findUserByCredentials({ role, firstName, lastName, className, salutation, password });
          if (!found) {
            ws.send(JSON.stringify({ type: 'authError', reason: 'not_found' }));
            return;
          }
          user = found;
        } else {
          // register
          if (!password || !lastName || (role === 'student' && !firstName)) {
            ws.send(JSON.stringify({ type: 'authError', reason: 'missing_fields' }));
            return;
          }
          // prevent duplicate for same identity
          const existing = findUserByCredentials({ role, firstName, lastName, className, salutation, password });
          if (existing) {
            ws.send(JSON.stringify({ type: 'authError', reason: 'already_exists', userId: existing.id }));
            return;
          }
          const id = genId(role === 'teacher' ? 't' : 's');
          const name = role === 'teacher' || role === 'admin' ? `${salutation} ${lastName}` : `${firstName} ${lastName}`;
          user = {
            id,
            role,
            firstName,
            lastName,
            salutation,
            className,
            password,
            name,
            stats: {},
            teachings: [],
            courses: role === 'student' ? [] : undefined,
          };
          users.set(id, user);
          saveUsers();
        }
      }

      // update display name / class if provided
      if ((role === 'teacher' || role === 'admin') && salutation && lastName) {
        user.salutation = salutation;
        user.lastName = lastName;
        user.name = `${salutation} ${lastName}`;
      }
      if (role === 'student') {
        if (firstName) user.firstName = firstName;
        if (lastName) user.lastName = lastName;
        if (className) user.className = className;
        user.name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      }
      if (password) user.password = password;
      users.set(user.id, user);
      saveUsers();

      ws.userId = user.id;
      ws.role = user.role;
      attachSocket(user.id, ws);

      // send profile back and room list
      ws.send(JSON.stringify({ type: 'profile', user: publicUser(user) }));
      sendRoomList(ws);
      sendCatalogs(ws);
      if (user.role === 'student') sendCourseCatalog(ws, user);
      return;
    }

    if (type === 'catalogsRequest') {
      sendCatalogs(ws);
      if (ws.userId) {
        const user = users.get(ws.userId);
        if (user?.role === 'student') sendCourseCatalog(ws, user);
      }
      return;
    }

    if (type === 'courseCatalogRequest') {
      if (ws.userId) {
        const user = users.get(ws.userId);
        if (user?.role === 'student') sendCourseCatalog(ws, user);
      }
      return;
    }

    if (type === 'authRegister') {
      const role = msg.role === 'teacher' || msg.role === 'student' ? msg.role : 'student';
      const email = normalizeEmail(msg.email);
      const firstName = role === 'student' ? String(msg.firstName || '').trim() : '';
      const lastName = String(msg.lastName || '').trim();
      const className = role === 'student' ? String(msg.className || '').trim() : '';
      const salutation = role === 'teacher' ? (msg.salutation === 'Frau' ? 'Frau' : 'Herr') : '';
      const password = String(msg.password || '');
      const code = String(msg.code || '').trim();

      if (!email || !isEmailValid(email) || !password) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'missing_fields' }));
        return;
      }
      if (isBanned(email, ws.ip)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'banned' }));
        return;
      }
      if (role === 'student' && (!firstName || !lastName)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'missing_fields' }));
        return;
      }
      if (role === 'teacher' && !lastName) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'missing_fields' }));
        return;
      }
      if (role === 'student') {
        const entry = findCodeByValue('student', code);
        if (!entry || !entry.className) {
          ws.send(JSON.stringify({ type: 'authError', reason: 'code_invalid' }));
          return;
        }
        if (classes.size > 0 && !classes.has(entry.className)) {
          ws.send(JSON.stringify({ type: 'authError', reason: 'class_invalid' }));
          return;
        }
      }
      if (role === 'teacher') {
        const entry = findCodeByValue('teacher', code);
        if (!entry) {
          ws.send(JSON.stringify({ type: 'authError', reason: 'code_invalid' }));
          return;
        }
      }

      const existing = findUserByEmail(email);
      if (existing) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'email_exists' }));
        return;
      }

      const id = genId(role === 'teacher' ? 't' : 's');
      const finalClassName = role === 'student' ? (findCodeByValue('student', code)?.className || className) : className;
      const name = role === 'teacher' ? `${salutation} ${lastName}`.trim() : `${firstName} ${lastName}`.trim();
      const user = {
        id,
        role,
        email,
        emailVerified: true,
        firstName,
        lastName,
        salutation,
        className: finalClassName,
        name,
        passwordHash: hashSecret(password),
        stats: {},
        teachings: [],
        courses: role === 'student' ? [] : undefined,
        teacherApproved: role === 'teacher' ? false : undefined,
      };
      if (role === 'teacher') {
        user.lastIp = ws.ip || user.lastIp;
        users.set(id, user);
        saveUsers();
        ws.send(JSON.stringify({ type: 'authStatus', status: 'teacher_pending' }));
        return;
      }
      user.emailVerified = true;
      users.set(id, user);
      saveUsers();
      user.lastIp = ws.ip || user.lastIp;
      users.set(id, user);
      saveUsers();
      ws.userId = user.id;
      ws.role = user.role;
      attachSocket(user.id, ws);
      ws.send(JSON.stringify({ type: 'profile', user: publicUser(user) }));
      sendRoomList(ws);
      sendCatalogs(ws);
      if (user.role === 'student') sendCourseCatalog(ws, user);
      return;
    }

    if (type === 'authVerify') {
      const email = normalizeEmail(msg.email);
      const code = String(msg.code || '').trim();
      const user = findUserByEmail(email);
      if (!user || !code) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'not_found' }));
        return;
      }
      if (user.emailVerified) {
        ws.send(JSON.stringify({ type: 'authStatus', status: 'verified' }));
        return;
      }
      const verify = user.verification || {};
      if (!verify.codeHash || !verify.expiresAt || verify.expiresAt < Date.now()) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'code_expired' }));
        return;
      }
      if (!verifySecret(code, verify.codeHash)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'code_invalid' }));
        return;
      }
      user.emailVerified = true;
      delete user.verification;
      user.lastIp = ws.ip || user.lastIp;
      users.set(user.id, user);
      saveUsers();

      ws.userId = user.id;
      ws.role = user.role;
      attachSocket(user.id, ws);
      ws.send(JSON.stringify({ type: 'profile', user: publicUser(user) }));
      sendRoomList(ws);
      sendCatalogs(ws);
      if (user.role === 'student') sendCourseCatalog(ws, user);
      return;
    }

    if (type === 'authLogin') {
      const email = normalizeEmail(msg.email);
      const password = String(msg.password || '');
      const requestedRole = msg.role === 'teacher' || msg.role === 'student' || msg.role === 'admin' ? msg.role : null;
      if (!email || !password) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'missing_fields' }));
        return;
      }
      if (isBanned(email, ws.ip)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'banned' }));
        return;
      }
      const user = findUserByEmail(email);
      if (!user) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'not_found' }));
        return;
      }
      if (requestedRole && !(user.role === requestedRole || (requestedRole === 'teacher' && user.role === 'admin'))) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'wrong_role' }));
        return;
      }
      if (user.role === 'teacher' && user.teacherApproved === false) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'teacher_unapproved' }));
        return;
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
        delete user.verification;
        users.set(user.id, user);
        saveUsers();
      }
      if (!verifySecret(password, user.passwordHash)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'wrong_password' }));
        return;
      }
      user.lastIp = ws.ip || user.lastIp;
      users.set(user.id, user);
      saveUsers();
      ws.userId = user.id;
      ws.role = user.role;
      attachSocket(user.id, ws);
      ws.send(JSON.stringify({ type: 'profile', user: publicUser(user) }));
      sendRoomList(ws);
      sendCatalogs(ws);
      if (user.role === 'student') sendCourseCatalog(ws, user);
      return;
    }

    if (type === 'authResetRequest') {
      const email = normalizeEmail(msg.email);
      if (isBanned(email, ws.ip)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'banned' }));
        return;
      }
      const user = findUserByEmail(email);
      if (!user) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'not_found' }));
        return;
      }
      const code = generateCode();
      user.reset = { codeHash: hashSecret(code), expiresAt: Date.now() + CODE_TTL_MS };
      users.set(user.id, user);
      saveUsers();
      sendEmail(email, 'Meldeliste: Passwort zuruecksetzen', `Dein Code: ${code}`);
      ws.send(JSON.stringify({ type: 'authStatus', status: 'reset_sent', email }));
      return;
    }

    if (type === 'authResetConfirm') {
      const email = normalizeEmail(msg.email);
      const code = String(msg.code || '').trim();
      const password = String(msg.password || '');
      if (isBanned(email, ws.ip)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'banned' }));
        return;
      }
      const user = findUserByEmail(email);
      if (!user || !code || !password) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'missing_fields' }));
        return;
      }
      const reset = user.reset || {};
      if (!reset.codeHash || !reset.expiresAt || reset.expiresAt < Date.now()) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'code_expired' }));
        return;
      }
      if (!verifySecret(code, reset.codeHash)) {
        ws.send(JSON.stringify({ type: 'authError', reason: 'code_invalid' }));
        return;
      }
      user.passwordHash = hashSecret(password);
      delete user.reset;
      users.set(user.id, user);
      saveUsers();
      ws.send(JSON.stringify({ type: 'authStatus', status: 'reset_done' }));
      return;
    }

    // Require authenticated profile afterwards
    if (!ws.userId) return;
    const user = users.get(ws.userId);
    if (!user) return;

    if (type === 'courseUpdate' && user.role === 'student') {
      const available = listAvailableCoursesForClass(user.className);
      const normalized = normalizeCourseList(msg.courses, available);
      user.courses = normalized;
      users.set(user.id, user);
      saveUsers();
      rooms.forEach((room, roomId) => {
        const members = roomMembers.get(roomId);
        if (!members || !members.has(user.id)) return;
        if (!isStudentAllowedInRoom(user, room)) {
          forceLeaveRoom(user.id, roomId);
        }
      });
      sendProfileToUser(user.id);
      sendCourseCatalogToUser(user.id);
      return;
    }

    if (type === 'roomCreate' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const name = String(msg.name || '').trim() || 'Raum';
      const subject = String(msg.subject || '').trim() || 'default';
      const classNames = Array.isArray(msg.classNames) ? msg.classNames.map((c) => String(c || '').trim()).filter(Boolean) : [];
      const className = String(msg.className || '').trim();
      const classes = classNames.length ? classNames : (className ? [className] : []);
      if (!classes.length) return;
      const id = genId('room');
      const room = {
        id,
        name,
        subject,
        className: classes[0] || '',
        classNames: classes,
        teacherId: ws.userId,
        active: true,
        createdAt: Date.now(),
      };
      rooms.set(id, room);
      saveRooms();
      ensureRoomStatsEntry(id, room);
      saveRoomStats();
      // Hausaufgabe der vorherigen Stunde sichern als previous, current leeren
      classes.forEach((cls) => {
        const hwKey = `${cls}|${subject}`;
        const hwEntry = normalizeHomework(homeworkMap.get(hwKey));
        if (hwEntry.current) {
          hwEntry.previous = hwEntry.current;
          hwEntry.current = null;
          homeworkMap.set(hwKey, hwEntry);
          saveHomework();
          broadcastHomework(cls, subject, hwEntry);
        }
      });
      // ensure empty containers
      roomMembers.set(id, new Set());
      readyMap.set(id, new Set());
      roomCounters.set(id, new Map());
      wss.clients.forEach((client) => sendRoomList(client));
      return;
    }

    if (type === 'roomClose' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      room.active = false;
      room.closedAt = Date.now();
      rooms.set(roomId, room);
      saveRooms();
      const statsEntry = ensureRoomStatsEntry(roomId, room);
      statsEntry.closedAt = room.closedAt;
      roomStats.set(roomId, statsEntry);
      saveRoomStats();
      broadcastRoom(roomId, { type: 'roomClosed', roomId });
      wss.clients.forEach((client) => sendRoomList(client));
      return;
    }

    if (type === 'createClass' && ws.role === 'admin') {
      const className = String(msg.className || '').trim();
      if (!className) return;
      classes.add(className);
      saveClasses();
      broadcastCatalogs();
      return;
    }

    if (type === 'createSubject' && ws.role === 'admin') {
      const subj = String(msg.subject || '').trim();
      if (!subj) return;
      subjects.add(subj);
      saveSubjects();
      broadcastCatalogs();
      return;
    }

    if (type === 'classCodeRequest' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const className = String(msg.className || '').trim();
      if (!className) return;
      if (classes.size > 0 && !classes.has(className)) return;
      if (!teacherCanAccessClass(user, className)) return;
      const entry = getOrRotateCode('student', className, false);
      ws.send(JSON.stringify({ type: 'classCode', entry }));
      return;
    }

    if (type === 'classCodeRotate' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const className = String(msg.className || '').trim();
      if (!className) return;
      if (classes.size > 0 && !classes.has(className)) return;
      if (!teacherCanAccessClass(user, className)) return;
      const entry = getOrRotateCode('student', className, true);
      ws.send(JSON.stringify({ type: 'classCode', entry }));
      return;
    }

    if (type === 'teacherCodeRequest' && ws.role === 'admin') {
      const entry = getOrRotateCode('teacher', '', false);
      ws.send(JSON.stringify({ type: 'teacherCode', entry }));
      return;
    }

    if (type === 'teacherCodeRotate' && ws.role === 'admin') {
      const entry = getOrRotateCode('teacher', '', true);
      ws.send(JSON.stringify({ type: 'teacherCode', entry }));
      return;
    }

    if (type === 'pendingTeachersRequest' && ws.role === 'admin') {
      const pending = Array.from(users.values())
        .filter((u) => u && u.role === 'teacher' && u.teacherApproved === false)
        .map((u) => ({ id: u.id, email: u.email, name: u.name || u.lastName || 'Lehrer' }));
      ws.send(JSON.stringify({ type: 'pendingTeachers', teachers: pending }));
      return;
    }

    if (type === 'teacherApprove' && ws.role === 'admin') {
      const userId = String(msg.userId || '').trim();
      const target = users.get(userId);
      if (!target || target.role !== 'teacher') return;
      target.teacherApproved = true;
      users.set(target.id, target);
      saveUsers();
      const pending = Array.from(users.values())
        .filter((u) => u && u.role === 'teacher' && u.teacherApproved === false)
        .map((u) => ({ id: u.id, email: u.email, name: u.name || u.lastName || 'Lehrer' }));
      ws.send(JSON.stringify({ type: 'pendingTeachers', teachers: pending }));
      return;
    }

    if (type === 'addTeaching' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const classNames = Array.isArray(msg.classNames) ? msg.classNames.map((c) => String(c || '').trim()).filter(Boolean) : [];
      const className = String(msg.className || '').trim();
      const subject = String(msg.subject || '').trim();
      const classesToAdd = classNames.length ? classNames : (className ? [className] : []);
      if (!classesToAdd.length || !subject) return;
      const user = users.get(ws.userId);
      if (!user) return;
      if (!Array.isArray(user.teachings)) user.teachings = [];
      const normalized = classesToAdd.filter(Boolean);
      if (!normalized.length) return;
      const exists = user.teachings.some((t) => {
        if (t.subject !== subject) return false;
        if (Array.isArray(t.classNames)) {
          const a = [...t.classNames].sort().join('|');
          const b = [...normalized].sort().join('|');
          return a === b;
        }
        return normalized.length === 1 && t.className === normalized[0];
      });
      if (!exists) {
        const entry = normalized.length === 1 ? { className: normalized[0], subject } : { classNames: normalized, subject };
        user.teachings.push(entry);
      }
      users.set(ws.userId, user);
      saveUsers();
      ws.send(JSON.stringify({ type: 'profile', user: publicUser(user) }));
      broadcastCourseCatalogs();
      return;
    }

    if (type === 'classStats' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const classNames = Array.isArray(msg.classNames) ? msg.classNames.map((c) => String(c || '').trim()).filter(Boolean) : [];
      const className = String(msg.className || '').trim();
      const subject = String(msg.subject || '').trim();
      const classes = classNames.length ? classNames : (className ? [className] : []);
      if (!classes.length) return;
      if (ws.role === 'teacher') {
        const teaches = Array.isArray(user?.teachings) ? user.teachings : [];
        const allowed = (cls) => teaches.some((t) => {
          if (subject && t.subject !== subject) return false;
          if (Array.isArray(t.classNames)) return t.classNames.includes(cls);
          return t.className === cls;
        });
        if (!classes.every((cls) => allowed(cls))) return;
      }
      const students = Array.from(users.values())
        .filter((u) => u && u.role === 'student' && classes.includes(u.className || ''))
        .map((u) => ({
          userId: u.id,
          name: u.name || 'Unbekannt',
          total: subject ? getSubjectTotals(u, subject) : aggregateTotalStats(u),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      ws.send(JSON.stringify({ type: 'classStats', className: classes.join(', '), classNames: classes, subject, students }));
      return;
    }

    if (type === 'classStudentStats' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const classNames = Array.isArray(msg.classNames) ? msg.classNames.map((c) => String(c || '').trim()).filter(Boolean) : [];
      const className = String(msg.className || '').trim();
      const subject = String(msg.subject || '').trim();
      const userId = String(msg.userId || '').trim();
      const classes = classNames.length ? classNames : (className ? [className] : []);
      if (!classes.length || !userId) return;
      if (ws.role === 'teacher') {
        const teaches = Array.isArray(user?.teachings) ? user.teachings : [];
        const allowed = (cls) => teaches.some((t) => {
          if (subject && t.subject !== subject) return false;
          if (Array.isArray(t.classNames)) return t.classNames.includes(cls);
          return t.className === cls;
        });
        if (!classes.every((cls) => allowed(cls))) return;
      }
      const target = users.get(userId);
      if (!target || target.role !== 'student' || !classes.includes(target.className || '')) return;
      const sessions = Array.from(roomStats.values())
        .filter((entry) => {
          if (!entry) return false;
          const entryClasses = Array.isArray(entry.classNames) && entry.classNames.length ? entry.classNames : (entry.className ? [entry.className] : []);
          if (!entryClasses.some((cls) => classes.includes(cls))) return false;
          if (subject && entry.subject !== subject) return false;
          return Boolean(entry.students && entry.students[userId]);
        })
        .map((entry) => ({
          roomId: entry.roomId,
          name: entry.name || 'Raum',
          subject: entry.subject || 'default',
          createdAt: entry.createdAt || null,
          closedAt: entry.closedAt || null,
          stats: entry.students[userId] || {},
        }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      ws.send(JSON.stringify({
        type: 'classStudentStats',
        className: classes.join(', '),
        classNames: classes,
        subject,
        student: { userId: target.id, name: target.name || 'Unbekannt' },
        sessions,
      }));
      return;
    }

    if (type === 'courseKick' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const targetUserId = String(msg.userId || '').trim();
      const subject = String(msg.subject || '').trim() || 'default';
      const teacherId = ws.role === 'admin' ? String(msg.teacherId || ws.userId || '').trim() : ws.userId;
      if (!targetUserId || !subject || !teacherId) return;
      const target = users.get(targetUserId);
      if (!target || target.role !== 'student') return;
      if (ws.role === 'teacher') {
        const teaches = Array.isArray(user?.teachings) ? user.teachings : [];
        const allowed = teaches.some((t) => t.subject === subject && teachingMatchesClass(t, target.className));
        if (!allowed) return;
      }
      const courses = Array.isArray(target.courses) ? target.courses : [];
      const filtered = courses.filter((c) => !(c.subject === subject && c.teacherId === teacherId));
      if (filtered.length === courses.length) return;
      target.courses = filtered;
      users.set(target.id, target);
      saveUsers();
      sendProfileToUser(target.id);
      sendCourseCatalogToUser(target.id);
      sendToUser(target.id, { type: 'courseKicked', subject, teacherName: user.name || user.email || 'Lehrer' });
      rooms.forEach((room, roomId) => {
        if (room.teacherId !== teacherId) return;
        const roomSubject = room.subject || 'default';
        if (roomSubject !== subject) return;
        forceLeaveRoom(target.id, roomId);
      });
      return;
    }

    if (type === 'courseReport' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const targetUserId = String(msg.userId || '').trim();
      const subject = String(msg.subject || '').trim() || 'default';
      if (!targetUserId || !subject) return;
      const target = users.get(targetUserId);
      if (!target || target.role !== 'student') return;
      if (ws.role === 'teacher') {
        const teaches = Array.isArray(user?.teachings) ? user.teachings : [];
        const allowed = teaches.some((t) => t.subject === subject && teachingMatchesClass(t, target.className));
        if (!allowed) return;
      }
      sendToUser(target.id, { type: 'courseReport', subject, teacherName: user.name || user.email || 'Lehrer' });
      return;
    }

    if (type === 'banStudent' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const targetUserId = String(msg.userId || '').trim();
      const subject = String(msg.subject || '').trim() || 'default';
      if (!targetUserId) return;
      const target = users.get(targetUserId);
      if (!target || target.role !== 'student') return;
      if (ws.role === 'teacher') {
        const teaches = Array.isArray(user?.teachings) ? user.teachings : [];
        const allowed = teaches.some((t) => t.subject === subject && teachingMatchesClass(t, target.className));
        if (!allowed) return;
      }
      const email = normalizeEmail(target.email || '');
      if (email) {
        if (!Array.isArray(bans.emails)) bans.emails = [];
        if (!bans.emails.includes(email)) bans.emails.push(email);
      }
      const ip = target.lastIp || '';
      if (ip) {
        if (!Array.isArray(bans.ips)) bans.ips = [];
        if (!bans.ips.includes(ip)) bans.ips.push(ip);
      }
      target.bannedAt = Date.now();
      users.set(target.id, target);
      saveUsers();
      saveBans();
      rooms.forEach((_, roomId) => forceLeaveRoom(target.id, roomId));
      const sockets = userSockets.get(target.id);
      if (sockets) {
        sockets.forEach((client) => {
          client.send(JSON.stringify({ type: 'banned' }));
          client.close();
        });
      }
      return;
    }

    if (type === 'studentSubjectStats' && ws.role === 'student') {
      const userId = ws.userId;
      const grouped = new Map();
      Array.from(roomStats.values())
        .filter((entry) => entry && entry.students && entry.students[userId])
        .forEach((entry) => {
          const subject = entry.subject || 'default';
          if (!grouped.has(subject)) grouped.set(subject, []);
          grouped.get(subject).push({
            roomId: entry.roomId,
            name: entry.name || 'Raum',
            className: entry.className || '',
            createdAt: entry.createdAt || null,
            closedAt: entry.closedAt || null,
            stats: entry.students[userId] || {},
          });
        });
      const subjectsList = Array.from(grouped.entries()).map(([subject, sessions]) => {
        const total = sessions.reduce((acc, s) => {
          acc.signals += s.stats?.signals || 0;
          acc.calls += s.stats?.calls || 0;
          acc.toiletSeconds += s.stats?.toiletSeconds || 0;
          return acc;
        }, { signals: 0, calls: 0, toiletSeconds: 0 });
        sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return { subject, total, sessions };
      }).sort((a, b) => a.subject.localeCompare(b.subject, 'de'));
      ws.send(JSON.stringify({ type: 'studentSubjectStats', subjects: subjectsList }));
      return;
    }

    if (type === 'join') {
      const roomId = msg.roomId;
      const room = rooms.get(roomId);
      if (!room || room.active === false) return;

      const user = users.get(ws.userId);
      if (user?.role === 'student' && !isStudentAllowedInRoom(user, room)) {
        ws.send(JSON.stringify({ type: 'joinDenied', reason: 'course' }));
        return;
      }

      // remove from previous room
      if (ws.roomId && ws.roomId !== roomId) {
        const prevSet = roomMembers.get(ws.roomId);
        const prevToilet = getToiletState(ws.roomId, ws.userId);
        if (!prevToilet || prevToilet.status === 'back') {
          if (prevSet) prevSet.delete(ws.userId);
        }
        const prevImp = importantMap.get(ws.roomId);
        if (prevImp) prevImp.delete(ws.userId);
        resetReady(ws.roomId, ws.userId);
        updatePresence(ws.roomId);
      }

      ws.roomId = roomId;
      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      roomMembers.get(roomId).add(ws.userId);
      if (!readyMap.has(roomId)) readyMap.set(roomId, new Set());
      if (!importantMap.has(roomId)) importantMap.set(roomId, new Set());
      if (!questionsMap.has(roomId)) questionsMap.set(roomId, []);
      if (!pollsMap.has(roomId)) pollsMap.set(roomId, null);
      if (!thoughtsMap.has(roomId)) thoughtsMap.set(roomId, { active: false, entries: [] });
      ensureRoomStatsEntry(roomId, room);
      updatePresence(roomId);
      sendLogUpdates(roomId);
      sendStats(roomId);
      // falls Toilettenstatus existiert, erneut an alle senden, damit Lampen sichtbar bleiben
      const tState = getToiletState(roomId, ws.userId);
      if (tState && tState.status !== 'back') {
        broadcastRoom(roomId, { type: 'toilet', roomId, userId: ws.userId, status: tState.status, start: tState.start || undefined });
      }
      if (isImportant(roomId, ws.userId)) {
        broadcastRoom(roomId, { type: 'important', roomId, userId: ws.userId, status: 'pending' });
      }
      if (ws.role === 'teacher' || ws.role === 'admin') {
        broadcastQuestions(roomId);
        broadcastPoll(roomId);
      }
      return;
    }

    if (type === 'leave') {
      const roomId = ws.roomId;
      if (!roomId) return;
      const set = roomMembers.get(roomId);
      if (set) set.delete(ws.userId);
      resetReady(roomId, ws.userId);
      const imp = importantMap.get(roomId);
      if (imp) imp.delete(ws.userId);
      ws.roomId = null;
      updatePresence(roomId);
      return;
    }

    if (type === 'withdraw') {
      const roomId = msg.roomId || ws.roomId;
      if (!roomId) return;
      if (!readyMap.has(roomId)) return;
      readyMap.get(roomId).delete(ws.userId);

      const room = rooms.get(roomId);
      if (room) {
        const subject = room.subject || 'default';
        const userStats = ensureStats(user, subject);
        userStats.signals = Math.max(0, (userStats.signals || 0) - 1);
        const today = new Date().toISOString().slice(0, 10);
        const d = ensureDaily(user, subject, today);
        d.signals = Math.max(0, (d.signals || 0) - 1);
        saveUsers();
      }

      if (roomCounters.has(roomId)) {
        const counter = roomCounters.get(roomId);
        const current = counter.get(ws.userId) || { signals: 0, calls: 0, toiletSeconds: 0 };
        current.signals = Math.max(0, current.signals - 1);
        counter.set(ws.userId, current);
      }
      if (room) {
        const entry = ensureRoomStatsEntry(roomId, room);
        const s = ensureRoomStudentStats(entry, ws.userId);
        s.signals = Math.max(0, (s.signals || 0) - 1);
        roomStats.set(roomId, entry);
        saveRoomStats();
      }

      broadcastRoom(roomId, { type: 'reset', roomId, userId: ws.userId });
      const impSet = importantMap.get(roomId);
      if (impSet) impSet.delete(ws.userId);
      updatePresence(roomId);
      sendStats(roomId);
      return;
    }

    if (type === 'ready') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const actor = users.get(ws.userId);
      if (actor?.role === 'teacher') return; // Lehrer melden sich nicht
      if (actor?.role === 'student' && !isStudentAllowedInRoom(actor, room)) {
        ws.send(JSON.stringify({ type: 'joinDenied', reason: 'course' }));
        return;
      }
      ws.roomId = roomId;
      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      roomMembers.get(roomId).add(ws.userId);
      if (!readyMap.has(roomId)) readyMap.set(roomId, new Set());
      readyMap.get(roomId).add(ws.userId);

      if (!roomCounters.has(roomId)) roomCounters.set(roomId, new Map());
      const counter = roomCounters.get(roomId);
      const current = counter.get(ws.userId) || { signals: 0, calls: 0, toiletSeconds: 0 };
      current.signals += 1;
      counter.set(ws.userId, current);

      const subject = room.subject || 'default';
      const s = ensureStats(user, subject);
      s.signals = Math.max(0, (s.signals || 0) + 1);
      const today = new Date().toISOString().slice(0, 10);
      const d = ensureDaily(user, subject, today);
      d.signals = Math.max(0, (d.signals || 0) + 1);
      saveUsers();
      const entry = ensureRoomStatsEntry(roomId, room);
      const roomStat = ensureRoomStudentStats(entry, ws.userId);
      roomStat.signals = Math.max(0, (roomStat.signals || 0) + 1);
      roomStats.set(roomId, entry);
      saveRoomStats();
      broadcastRoom(roomId, { type: 'ready', roomId, userId: ws.userId, name: user.name });
      updatePresence(roomId);
      sendStats(roomId);
      return;
    }

    if (type === 'important') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const actor = users.get(ws.userId);
      if (actor?.role === 'teacher' || actor?.role === 'admin') return;
      ws.roomId = roomId;
      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      roomMembers.get(roomId).add(ws.userId);
      if (!importantMap.has(roomId)) importantMap.set(roomId, new Set());
      importantMap.get(roomId).add(ws.userId);
      broadcastRoom(roomId, { type: 'important', roomId, userId: ws.userId, status: 'pending' });
      updatePresence(roomId);
      return;
    }

    if (type === 'importantClear' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const targetUserId = msg.userId;
      if (!roomId || !targetUserId) return;
      const set = importantMap.get(roomId);
      if (set) set.delete(targetUserId);
      broadcastRoom(roomId, { type: 'important', roomId, userId: targetUserId, status: 'cleared' });
      updatePresence(roomId);
      return;
    }

    if (type === 'questionSubmit') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const text = String(msg.text || '').trim();
      const anonymous = msg.anonymous !== false;
      if (!text) return;
      if (!questionsMap.has(roomId)) questionsMap.set(roomId, []);
      const entry = {
        id: genId('q'),
        text,
        ts: Date.now(),
        anonymous,
        userId: anonymous ? undefined : ws.userId,
        name: anonymous ? undefined : (user?.name || 'Unbekannt'),
      };
      questionsMap.get(roomId).push(entry);
      // broadcast only to teacher/admin in the room
      const payload = JSON.stringify({ type: 'question', roomId, question: entry });
      wss.clients.forEach((client) => {
        if (client.readyState !== client.OPEN) return;
        if (client.roomId !== roomId) return;
        if (client.role === 'teacher' || client.role === 'admin') client.send(payload);
      });
      return;
    }

    if (type === 'pollCreate' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const question = String(msg.question || '').trim();
      const options = Array.isArray(msg.options) ? msg.options.map((t) => String(t || '').trim()).filter(Boolean) : [];
      const multiple = Boolean(msg.multiple);
      const anonymous = msg.anonymous !== false;
      if (!question || options.length < 2) return;
      const poll = {
        id: genId('poll'),
        question,
        options: options.map((t, idx) => ({ id: `opt-${idx}`, text: t, count: 0 })),
        multiple,
        anonymous,
        open: true,
        votes: new Map(),
      };
      pollsMap.set(roomId, poll);
      broadcastPoll(roomId);
      return;
    }

    if (type === 'pollVote') {
      const roomId = msg.roomId || ws.roomId;
      const poll = pollsMap.get(roomId);
      if (!poll) return;
      if (poll.open === false) return;
      if (poll.votes.has(ws.userId)) return;
      const selected = Array.isArray(msg.options) ? msg.options.map(String) : [];
      if (selected.length === 0) return;
      const allowed = poll.multiple ? selected : [selected[0]];
      poll.votes.set(ws.userId, allowed);
      // recompute counts
      poll.options.forEach((opt) => (opt.count = 0));
      poll.votes.forEach((vals) => {
        vals.forEach((optId) => {
          const opt = poll.options.find((o) => o.id === optId);
          if (opt) opt.count += 1;
        });
      });
      pollsMap.set(roomId, poll);
      broadcastPoll(roomId);
      return;
    }

    if (type === 'pollEnd' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const poll = pollsMap.get(roomId);
      if (!poll) return;
      poll.open = false;
      pollsMap.set(roomId, poll);
      broadcastPoll(roomId);
      return;
    }

    if (type === 'homeworkSet' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const classNames = Array.isArray(msg.classNames) ? msg.classNames.map((c) => String(c || '').trim()).filter(Boolean) : [];
      const className = String(msg.className || '').trim();
      const subject = String(msg.subject || '').trim() || 'default';
      const text = String(msg.text || '').trim();
      const classesToSet = classNames.length ? classNames : (className ? [className] : []);
      if (!classesToSet.length || !text) return;
      classesToSet.forEach((cls) => {
        const key = `${cls}|${subject}`;
        const entry = normalizeHomework(homeworkMap.get(key));
        if (entry.current) entry.previous = entry.current;
        entry.current = { text, ts: Date.now() };
        homeworkMap.set(key, entry);
        saveHomework();
        broadcastHomework(cls, subject, entry);
      });
      return;
    }

    if (type === 'homeworkListRequest') {
      const user = users.get(ws.userId);
      if (!user) return;
      const payload = { type: 'homeworkList', items: [] };
      homeworkMap.forEach((value, key) => {
        const [cls, subj] = key.split('|');
        if (user.role === 'student') {
          if (user.className && user.className !== cls) return;
          const entry = normalizeHomework(value);
          if (entry.current) payload.items.push({ className: cls, subject: subj, homework: { current: entry.current } });
        } else if (user.role === 'teacher' || user.role === 'admin') {
          const entry = normalizeHomework(value);
          if (entry.current || entry.previous) payload.items.push({ className: cls, subject: subj, homework: entry });
        }
      });
      ws.send(JSON.stringify(payload));
      return;
    }

    if (type === 'thoughtStart' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      if (!thoughtsMap.has(roomId)) thoughtsMap.set(roomId, { active: true, entries: [] });
      thoughtsMap.set(roomId, { active: true, entries: [] });
      broadcastThoughts(roomId, { type: 'thoughtState', active: true });
      return;
    }

    if (type === 'thoughtEnd' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const state = thoughtsMap.get(roomId);
      if (!state) return;
      const counts = {};
      (state.entries || []).forEach((txt) => {
        counts[txt] = (counts[txt] || 0) + 1;
      });
      const results = Object.entries(counts)
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count);
      thoughtsMap.set(roomId, { active: false, entries: [] });
      broadcastThoughts(roomId, { type: 'thoughtResults', results });
      return;
    }

    if (type === 'thoughtSubmit') {
      const roomId = msg.roomId || ws.roomId;
      const state = thoughtsMap.get(roomId);
      if (!state || !state.active) return;
      const text = String(msg.text || '').trim();
      if (!text) return;
      state.entries.push(text.toLowerCase());
      thoughtsMap.set(roomId, state);
      return;
    }

    if (type === 'toilet') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const actor = users.get(ws.userId);
      if (actor?.role === 'teacher') return;
      if (actor?.role === 'student' && !isStudentAllowedInRoom(actor, room)) {
        ws.send(JSON.stringify({ type: 'joinDenied', reason: 'course' }));
        return;
      }
      ws.roomId = roomId;
      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      roomMembers.get(roomId).add(ws.userId);
      if (!toiletMap.has(roomId)) toiletMap.set(roomId, new Map());
      toiletMap.get(roomId).set(ws.userId, { status: 'pending', start: null });
      broadcastRoom(roomId, { type: 'toilet', roomId, userId: ws.userId, status: 'pending' });
      updatePresence(roomId);
      return;
    }

    if (type === 'toiletAllow' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const targetUserId = msg.userId;
      if (!roomId || !targetUserId) return;
      if (!toiletMap.has(roomId)) toiletMap.set(roomId, new Map());
      const stateMap = toiletMap.get(roomId);
      const now = Date.now();
      stateMap.set(targetUserId, { status: 'allowed', start: now });
      broadcastRoom(roomId, { type: 'toilet', roomId, userId: targetUserId, status: 'allowed', start: now });
      sendToUser(targetUserId, { type: 'toiletAllowed', roomId, start: now });
      return;
    }

    if (type === 'toiletBack') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const stateMap = toiletMap.get(roomId);
      const state = stateMap ? stateMap.get(ws.userId) : null;
      const now = Date.now();
      let durationSec = 0;
      if (state && state.start) {
        const ms = Math.max(0, now - state.start);
        durationSec = Math.max(0, Math.round(ms / 10000) * 10);
      }
      if (stateMap) stateMap.delete(ws.userId);

      const subject = room.subject || 'default';
      const user = users.get(ws.userId);
      if (user) {
        const s = ensureStats(user, subject);
        s.toiletSeconds = Math.max(0, (s.toiletSeconds || 0) + durationSec);
        const today = new Date().toISOString().slice(0, 10);
        const d = ensureDaily(user, subject, today);
        d.toiletSeconds = Math.max(0, (d.toiletSeconds || 0) + durationSec);
        saveUsers();
      }

      if (!roomCounters.has(roomId)) roomCounters.set(roomId, new Map());
      const counter = roomCounters.get(roomId);
      const current = counter.get(ws.userId) || { signals: 0, calls: 0, toiletSeconds: 0 };
      current.toiletSeconds = Math.max(0, (current.toiletSeconds || 0) + durationSec);
      counter.set(ws.userId, current);
      const entry = ensureRoomStatsEntry(roomId, room);
      const s = ensureRoomStudentStats(entry, ws.userId);
      s.toiletSeconds = Math.max(0, (s.toiletSeconds || 0) + durationSec);
      roomStats.set(roomId, entry);
      saveRoomStats();

      broadcastRoom(roomId, { type: 'toilet', roomId, userId: ws.userId, status: 'back', durationSec });
      updatePresence(roomId);
      sendStats(roomId);
      return;
    }

    if (type === 'ack' && ws.role === 'teacher') {
      // unchanged logic...
      const roomId = msg.roomId || ws.roomId;
      const targetUserId = msg.userId;
      if (!roomId || !targetUserId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      // update call counters
      const targetUser = users.get(targetUserId);
      const subject = room.subject || 'default';
      if (targetUser) {
        const s = ensureStats(targetUser, subject);
        s.calls = Math.max(0, (s.calls || 0) + 1);
        const today = new Date().toISOString().slice(0, 10);
        const d = ensureDaily(targetUser, subject, today);
        d.calls = Math.max(0, (d.calls || 0) + 1);
        saveUsers();
      }

      if (!roomCounters.has(roomId)) roomCounters.set(roomId, new Map());
      const counter = roomCounters.get(roomId);
      const current = counter.get(targetUserId) || { signals: 0, calls: 0, toiletSeconds: 0 };
      current.calls = Math.max(0, (current.calls || 0) + 1);
      counter.set(targetUserId, current);
      const entry = ensureRoomStatsEntry(roomId, room);
      const s = ensureRoomStudentStats(entry, targetUserId);
      s.calls = Math.max(0, (s.calls || 0) + 1);
      roomStats.set(roomId, entry);
      saveRoomStats();

      // clear all raised hands in room
      readyMap.set(roomId, new Set());
      broadcastRoom(roomId, { type: 'resetAll', roomId });

      sendToUser(targetUserId, { type: 'called', roomId });

      appendLog(roomId, { ts: Date.now(), userId: targetUserId, action: 'called' });
      updatePresence(roomId);
      sendStats(roomId);
      return;
    }

    if (type === 'rate' && ws.role === 'teacher') {
      // unchanged rating logic
      const roomId = msg.roomId || ws.roomId;
      const targetUserId = msg.userId;
      const rating = ratingKeys.includes(msg.rating) ? msg.rating : null;
      if (!roomId || !targetUserId || !rating) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const targetUser = users.get(targetUserId);
      if (targetUser) {
        const s = ensureStats(targetUser, room.subject || 'default');
        s.ratings[rating] = Math.max(0, (s.ratings[rating] || 0) + 1);
        saveUsers();
      }
      const entry = ensureRoomStatsEntry(roomId, room);
      const s = ensureRoomStudentStats(entry, targetUserId);
      s.ratings[rating] = Math.max(0, (s.ratings[rating] || 0) + 1);
      roomStats.set(roomId, entry);
      saveRoomStats();
      appendLog(roomId, { ts: Date.now(), userId: targetUserId, action: 'rating', rating });
      sendStats(roomId);
      return;
    }

    if (type === 'logDelete' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const logId = String(msg.logId || '').trim();
      if (!roomId || !logId) return;
      const roomLog = logs.get(roomId);
      if (!roomLog || !Array.isArray(roomLog.entries)) return;
      const idx = roomLog.entries.findIndex((e) => e.id === logId);
      if (idx === -1) return;
      const entry = roomLog.entries[idx];
      roomLog.entries.splice(idx, 1);
      logs.set(roomId, roomLog);
      saveLogs();

      const room = rooms.get(roomId);
      if (room) {
        const subject = room.subject || 'default';
        const targetUser = users.get(entry.userId);
        if (entry.action === 'called' && targetUser) {
          const s = ensureStats(targetUser, subject);
          s.calls = Math.max(0, (s.calls || 0) - 1);
          const dateKey = new Date(entry.ts || Date.now()).toISOString().slice(0, 10);
          const d = ensureDaily(targetUser, subject, dateKey);
          d.calls = Math.max(0, (d.calls || 0) - 1);
          saveUsers();
          const counter = roomCounters.get(roomId);
          if (counter) {
            const current = counter.get(entry.userId) || { signals: 0, calls: 0, toiletSeconds: 0 };
            current.calls = Math.max(0, (current.calls || 0) - 1);
            counter.set(entry.userId, current);
          }
          const statsEntry = ensureRoomStatsEntry(roomId, room);
          const roomStat = ensureRoomStudentStats(statsEntry, entry.userId);
          roomStat.calls = Math.max(0, (roomStat.calls || 0) - 1);
          roomStats.set(roomId, statsEntry);
          saveRoomStats();
        }
        if (entry.action === 'rating' && entry.rating && targetUser) {
          const s = ensureStats(targetUser, subject);
          s.ratings[entry.rating] = Math.max(0, (s.ratings[entry.rating] || 0) - 1);
          saveUsers();
          const statsEntry = ensureRoomStatsEntry(roomId, room);
          const rs = ensureRoomStudentStats(statsEntry, entry.userId);
          rs.ratings[entry.rating] = Math.max(0, (rs.ratings[entry.rating] || 0) - 1);
          roomStats.set(roomId, statsEntry);
          saveRoomStats();
        }
      }

      sendLogUpdates(roomId);
      sendStats(roomId);
      return;
    }

    if (type === 'roomListRequest') {
      sendRoomList(ws);
      return;
    }
  });

  ws.on('close', () => {
    if (ws.userId) {
      detachSocket(ws.userId, ws);
      if (ws.roomId) {
        const tState = getToiletState(ws.roomId, ws.userId);
        const keepMember = tState && tState.status !== 'back';
        if (!keepMember) {
          const set = roomMembers.get(ws.roomId);
          if (set) set.delete(ws.userId);
          resetReady(ws.roomId, ws.userId);
        }
        updatePresence(ws.roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  if (ip) console.log(`LAN: http://${ip}:${PORT}`);
});

