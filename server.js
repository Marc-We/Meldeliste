const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const CLASSES_FILE = path.join(DATA_DIR, 'classes.json');
const SUBJECTS_FILE = path.join(DATA_DIR, 'subjects.json');
const HOMEWORK_FILE = path.join(DATA_DIR, 'homework.json');
const POLL_TEMPLATES_FILE = path.join(DATA_DIR, 'polls.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

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
let pollTemplates = new Map(Object.entries(loadJson(POLL_TEMPLATES_FILE, {}))); // userId -> [{id,question,options,multiple}]
ensureDir(UPLOAD_DIR);

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
function savePollTemplates() {
  saveJson(POLL_TEMPLATES_FILE, Object.fromEntries(pollTemplates));
}
function saveHomework() {
  const plain = Object.fromEntries(homework);
  saveJson(HOMEWORK_FILE, plain);
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
const rosterCache = new Map(); // className -> [{userId,name}]
const uploadsMap = new Map(); // roomId -> [{userId,name,fileName,url,ts}]

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

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  const payload = JSON.stringify({
    type: 'poll',
    roomId,
    poll: {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      multiple: poll.multiple,
    },
  });
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    client.send(payload);
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

function sendRoster(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const cls = room.className;
  if (!cls) return;
  let roster = rosterCache.get(cls);
  if (!roster) {
    roster = Array.from(users.values())
      .filter((u) => u.className === cls)
      .map((u) => ({ userId: u.id, name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() }));
    rosterCache.set(cls, roster);
  }
  const members = roomMembers.get(roomId) || new Set();
  const payload = JSON.stringify({
    type: 'roster',
    roomId,
    className: cls,
    roster: roster.map((r) => ({ ...r, inRoom: members.has(r.userId) })),
  });
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    client.send(payload);
  });
}

function sendRoomSettings(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify({ type: 'roomSettings', roomId, allowSelfCall: Boolean(room.allowSelfCall) });
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
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
  if (!entry.id) entry.id = genId('log');
  if (!logs.has(roomId)) logs.set(roomId, { entries: [] });
  logs.get(roomId).entries.push(entry);
  saveLogs();
  sendLogUpdates(roomId);
}

function sendLogUpdates(roomId) {
  const log = logs.get(roomId)?.entries || [];
  // send to each socket in the room with role-based visibility
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.roomId !== roomId) return;
    const isTeacher = client.role === 'teacher';
    const filtered = log
      .filter((e) => {
        if (!isTeacher && e.userId !== client.userId) return false;
        if (e.action === 'signal' || e.action === 'withdraw') return false; // Meldungen nicht im Log anzeigen
        if (!isTeacher && e.action === 'rating') return false; // Schüler sieht keine Bewertungen
        return true;
      })
      .map((e) => ({
        ...e,
        name: users.get(e.userId)?.name || 'Unbekannt',
        rating: isTeacher ? e.rating : undefined,
        selfCall: e.selfCall || false,
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
wss.on('connection', (ws) => {
  ws.userId = null;
  ws.role = null;
  ws.roomId = null;

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
      ws.send(JSON.stringify({ type: 'profile', user }));
      sendRoomList(ws);
      sendCatalogs(ws);
      return;
    }

    // Require authenticated profile afterwards
    if (!ws.userId) return;
    const user = users.get(ws.userId);
    if (!user) return;

    if (type === 'roomCreate' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const name = String(msg.name || '').trim() || 'Raum';
      const subject = String(msg.subject || '').trim() || 'default';
      const className = String(msg.className || '').trim();
      if (!className) return;
      const id = genId('room');
      const room = {
        id,
        name,
        subject,
        className,
        teacherId: ws.userId,
        active: true,
        allowSelfCall: false,
        createdAt: Date.now(),
      };
      rooms.set(id, room);
      saveRooms();
      // Hausaufgabe der vorherigen Stunde sichern als previous, current leeren
      const hwKey = `${className}|${subject}`;
      const hwEntry = normalizeHomework(homeworkMap.get(hwKey));
      if (hwEntry.current) {
        hwEntry.previous = hwEntry.current;
        hwEntry.current = null;
        homeworkMap.set(hwKey, hwEntry);
        saveHomework();
        broadcastHomework(className, subject, hwEntry);
      }
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

    if (type === 'addTeaching' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const className = String(msg.className || '').trim();
      const subject = String(msg.subject || '').trim();
      if (!className || !subject) return;
      const user = users.get(ws.userId);
      if (!user) return;
      if (!Array.isArray(user.teachings)) user.teachings = [];
      const exists = user.teachings.some((t) => t.className === className && t.subject === subject);
      if (!exists) user.teachings.push({ className, subject });
      users.set(ws.userId, user);
      saveUsers();
      ws.send(JSON.stringify({ type: 'profile', user }));
      return;
    }

    if (type === 'join') {
      const roomId = msg.roomId;
      const room = rooms.get(roomId);
      if (!room || room.active === false) return;

       // Schüler dürfen nur eigene Klasse betreten
      const user = users.get(ws.userId);
      if (user?.role === 'student' && room.className && user.className && user.className !== room.className) {
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
      updatePresence(roomId);
      sendLogUpdates(roomId);
      sendStats(roomId);
      sendRoster(roomId);
      sendRoomSettings(roomId);
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
      sendRoster(roomId);
      return;
    }

    if (type === 'toggleSelfCall' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      room.allowSelfCall = Boolean(msg.allow);
      rooms.set(roomId, room);
      saveRooms();
      wss.clients.forEach((client) => sendRoomList(client));
      sendRoomSettings(roomId);
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
      if (actor?.role === 'student' && room.className && actor.className && actor.className !== room.className) return;
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
    if (type === 'importantWithdraw') {
      const roomId = msg.roomId || ws.roomId;
      if (!roomId) return;
      const set = importantMap.get(roomId);
      if (set) set.delete(ws.userId);
      broadcastRoom(roomId, { type: 'important', roomId, userId: ws.userId, status: 'cleared' });
      updatePresence(roomId);
      return;
    }

    if (type === 'questionSubmit') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const text = String(msg.text || '').trim();
      if (!text) return;
      if (!questionsMap.has(roomId)) questionsMap.set(roomId, []);
      const entry = { id: genId('q'), text, ts: Date.now() };
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
      if (!question || options.length < 2) return;
      const poll = {
        id: genId('poll'),
        question,
        options: options.map((t, idx) => ({ id: `opt-${idx}`, text: t, count: 0 })),
        multiple,
        votes: new Map(),
      };
      pollsMap.set(roomId, poll);
      broadcastPoll(roomId);
      return;
    }

    if (type === 'pollTemplateCreate' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const question = String(msg.question || '').trim();
      const options = Array.isArray(msg.options) ? msg.options.map((t) => String(t || '').trim()).filter(Boolean) : [];
      const multiple = Boolean(msg.multiple);
      if (!question || options.length < 2) return;
      const tmpl = { id: genId('tmpl'), question, options, multiple };
      const list = pollTemplates.get(ws.userId) || [];
      list.push(tmpl);
      pollTemplates.set(ws.userId, list);
      savePollTemplates();
      ws.send(JSON.stringify({ type: 'pollTemplates', templates: list }));
      return;
    }

    if (type === 'pollTemplateList') {
      const list = pollTemplates.get(ws.userId) || [];
      ws.send(JSON.stringify({ type: 'pollTemplates', templates: list }));
      return;
    }

    if (type === 'pollTemplateActivate' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const tmplId = String(msg.templateId || '').trim();
      const list = pollTemplates.get(ws.userId) || [];
      const tmpl = list.find((t) => t.id === tmplId);
      if (!tmpl) return;
      const poll = {
        id: genId('poll'),
        question: tmpl.question,
        options: tmpl.options.map((t, idx) => ({ id: `opt-${idx}`, text: t, count: 0 })),
        multiple: tmpl.multiple,
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

    if (type === 'homeworkSet' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const className = String(msg.className || '').trim();
      const subject = String(msg.subject || '').trim() || 'default';
      const text = String(msg.text || '').trim();
      if (!className || !text) return;
      const key = `${className}|${subject}`;
      const entry = normalizeHomework(homeworkMap.get(key));
      if (entry.current) entry.previous = entry.current;
      entry.current = { text, ts: Date.now() };
      homeworkMap.set(key, entry);
      saveHomework();
      broadcastHomework(className, subject, entry);
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

    if (type === 'homeworkUpload') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const user = users.get(ws.userId);
      if (!user || user.role !== 'student') return;
      const file = msg.file || {};
      const name = String(file.name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const data = file.data || '';
      if (!name || !data) return;
      // simple base64 -> buffer
      const buffer = Buffer.from(data, 'base64');
      const dir = path.join(UPLOAD_DIR, room.className || 'unknown', room.subject || 'default');
      ensureDir(dir);
      const ts = Date.now();
      const filePath = path.join(dir, `${ts}-${name}`);
      fs.writeFileSync(filePath, buffer);
      const urlPath = filePath.replace(__dirname, '').replace(/\\/g, '/');
      const entry = { userId: ws.userId, name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(), fileName: name, url: urlPath, ts };
      if (!uploadsMap.has(roomId)) uploadsMap.set(roomId, []);
      uploadsMap.get(roomId).push(entry);
      // notify teachers/admins
      const payload = JSON.stringify({ type: 'homeworkUpload', roomId, entry });
      wss.clients.forEach((client) => {
        if (client.readyState !== client.OPEN) return;
        if (client.roomId !== roomId) return;
        if (client.role === 'teacher' || client.role === 'admin') client.send(payload);
      });
      // ack to student
      ws.send(JSON.stringify({ type: 'homeworkUploadAck', fileName: name }));
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
      if (actor?.role === 'student' && room.className && actor.className && actor.className !== room.className) return;
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

      broadcastRoom(roomId, { type: 'toilet', roomId, userId: ws.userId, status: 'back', durationSec });
      updatePresence(roomId);
      sendStats(roomId);
      return;
    }

    if (type === 'selfCall') {
      const roomId = msg.roomId || ws.roomId;
      const room = rooms.get(roomId);
      if (!room || !room.allowSelfCall) return;
      const actor = users.get(ws.userId);
      if (!actor || actor.role !== 'student') return;
      if (room.className && actor.className && actor.className !== room.className) return;
      ws.roomId = roomId;
      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      roomMembers.get(roomId).add(ws.userId);
      if (!roomCounters.has(roomId)) roomCounters.set(roomId, new Map());
      const counter = roomCounters.get(roomId);
      const current = counter.get(ws.userId) || { signals: 0, calls: 0, toiletSeconds: 0 };
      current.calls = Math.max(0, (current.calls || 0) + 1);
      counter.set(ws.userId, current);

      const subject = room.subject || 'default';
      const s = ensureStats(actor, subject);
      s.calls = Math.max(0, (s.calls || 0) + 1);
      const today = new Date().toISOString().slice(0, 10);
      const d = ensureDaily(actor, subject, today);
      d.calls = Math.max(0, (d.calls || 0) + 1);
      saveUsers();

      // remove raised hand of this user (if any)
      const readySet = readyMap.get(roomId);
      if (readySet) readySet.delete(ws.userId);

      const ts = Date.now();
      appendLog(roomId, { ts, userId: ws.userId, action: 'called', selfCall: true });
      sendToUser(ws.userId, { type: 'called', roomId });
      broadcastRoom(roomId, { type: 'reset', roomId, userId: ws.userId });
      broadcastRoom(roomId, { type: 'selfCallNotice', roomId, userId: ws.userId, name: actor.name || 'Schüler', ts });
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
      appendLog(roomId, { ts: Date.now(), userId: targetUserId, action: 'rating', rating });
      sendStats(roomId);
      return;
    }

    if (type === 'logDelete' && (ws.role === 'teacher' || ws.role === 'admin')) {
      const roomId = msg.roomId || ws.roomId;
      const entryId = msg.entryId;
      if (!roomId || !entryId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const logObj = logs.get(roomId);
      if (!logObj || !Array.isArray(logObj.entries)) return;
      const idx = logObj.entries.findIndex((e) => e.id === entryId);
      if (idx === -1) return;
      const removed = logObj.entries.splice(idx, 1)[0];
      logs.set(roomId, logObj);
      // adjust stats if needed
      if (removed && removed.userId) {
        const subject = room.subject || 'default';
        const user = users.get(removed.userId);
        if (removed.action === 'called') {
          if (user) {
            const s = ensureStats(user, subject);
            s.calls = Math.max(0, (s.calls || 0) - 1);
            const today = new Date().toISOString().slice(0, 10);
            const d = ensureDaily(user, subject, today);
            d.calls = Math.max(0, (d.calls || 0) - 1);
            saveUsers();
          }
          if (!roomCounters.has(roomId)) roomCounters.set(roomId, new Map());
          const counter = roomCounters.get(roomId);
          const current = counter.get(removed.userId) || { signals: 0, calls: 0, toiletSeconds: 0 };
          current.calls = Math.max(0, (current.calls || 0) - 1);
          counter.set(removed.userId, current);
        }
        if (removed.action === 'rating' && removed.rating) {
          if (user) {
            const s = ensureStats(user, subject);
            s.ratings[removed.rating] = Math.max(0, (s.ratings[removed.rating] || 0) - 1);
            saveUsers();
          }
        }
      }
      saveLogs();
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
const HOST = process.env.HOST || '0.0.0.0'; // bind to all interfaces for LAN access

function listLocalIps() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const ips = [];
  Object.values(ifaces).forEach(list => {
    (list || []).forEach(addr => {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    });
  });
  return ips;
}

server.listen(PORT, HOST, () => {
  const ips = listLocalIps();
  console.log(`WebSocket server listening on ws://${HOST}:${PORT}`);
  if (ips.length) {
    console.log(`LAN reachability: http://${ips[0]}:${PORT} (or any of: ${ips.join(', ')})`);
  } else {
    console.log('No LAN IPv4 address detected; check your network connection.');
  }
});
