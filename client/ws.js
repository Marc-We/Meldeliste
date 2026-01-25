import { state } from './state.js';
import { els } from './dom.js';
import { WS_URL } from './config.js';
import { sendJson, requestSubjectStats } from './api.js';
import { setAuthStatus, setConnection, renderAuthFields, renderProfileInfo } from './ui.js';
import {
  renderCalled,
  renderClassOptions,
  renderHomework,
  renderLog,
  renderPoll,
  renderRooms,
  renderStats,
  renderSubjectStats,
  renderThoughtState,
} from './render.js';

function handleMessage(msg) {
  if (msg.type === 'profile' && msg.user) {
    state.profile.userId = msg.user.id;
    state.profile.email = msg.user.email || state.profile.email;
    state.profile.firstName = msg.user.firstName || state.profile.firstName;
    state.profile.lastName = msg.user.lastName || state.profile.lastName;
    state.profile.className = msg.user.className || state.profile.className;
    state.authMode = 'login';
    setAuthStatus('');
    renderProfileInfo();
    if (state.lastAuth?.email && state.lastAuth?.password) {
      localStorage.setItem('meldelisteRemember', JSON.stringify(state.lastAuth));
    }
    localStorage.setItem('meldelisteProfile', JSON.stringify(state.profile));
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendJson({ type: 'homeworkListRequest' });
      requestSubjectStats();
    }
  }
  if (msg.type === 'catalogs') {
    state.classCatalog = msg.classes || [];
    renderClassOptions();
  }
  if (msg.type === 'roomList') {
    state.rooms = msg.rooms || [];
    renderRooms();
  }
  if (msg.type === 'called') {
    renderCalled(true);
    els.readyBtn.disabled = false;
    els.withdrawBtn.disabled = true;
  }
  if (msg.type === 'reset' && msg.userId === state.profile.userId) {
    renderCalled(false);
    els.readyBtn.disabled = false;
    els.withdrawBtn.disabled = true;
  }
  if (msg.type === 'resetAll' && msg.roomId === state.currentRoom) {
    renderCalled(false);
    els.readyBtn.disabled = false;
    els.withdrawBtn.disabled = true;
  }
  if (msg.type === 'myLog') {
    state.myLog = msg.entries || [];
    renderLog();
  }
  if (msg.type === 'myStats') {
    state.myStats = { session: msg.session || {}, total: msg.total || {}, daily: msg.daily || {} };
    renderStats();
  }
  if (msg.type === 'studentSubjectStats') {
    state.subjectStats = msg.subjects || [];
    renderSubjectStats();
  }
  if (msg.type === 'authStatus') {
    if (msg.status === 'verify_required') {
      state.pendingEmail = msg.email || els.emailInput.value.trim();
      state.authMode = 'verify';
      setAuthStatus('Code gesendet. Bitte pruefen.');
      renderAuthFields();
    } else if (msg.status === 'reset_sent') {
      state.pendingEmail = msg.email || els.emailInput.value.trim();
      state.authMode = 'reset-confirm';
      setAuthStatus('Reset-Code gesendet.');
      renderAuthFields();
    } else if (msg.status === 'reset_done') {
      state.authMode = 'login';
      setAuthStatus('Passwort aktualisiert. Bitte anmelden.');
      renderAuthFields();
    } else if (msg.status === 'verified') {
      setAuthStatus('E-Mail bereits bestaetigt.');
    }
  }
  if (msg.type === 'authError') {
    const reason = msg.reason || 'Anmeldung fehlgeschlagen';
    const messages = {
      missing_fields: 'Bitte alle Felder ausfuellen.',
      email_exists: 'E-Mail existiert bereits.',
      not_found: 'Account nicht gefunden.',
      wrong_password: 'Passwort falsch.',
      email_unverified: 'E-Mail noch nicht bestaetigt.',
      code_invalid: 'Code ungueltig.',
      code_expired: 'Code abgelaufen.',
      class_invalid: 'Klasse ungueltig.',
      wrong_role: 'Falsche Rolle fuer diesen Account.',
    };
    setAuthStatus(messages[reason] || `Fehler: ${reason}`);
    if (reason === 'email_unverified') {
      state.authMode = 'verify';
      renderAuthFields();
    }
  }
  if (msg.type === 'poll' && msg.roomId === state.currentRoom) {
    state.poll = msg.poll;
    state.pollSelection = [];
    renderPoll();
  }
  if (msg.type === 'thoughtState' && msg.roomId === state.currentRoom) {
    state.thoughtActive = Boolean(msg.active);
    renderThoughtState();
  }
  if (msg.type === 'thoughtResults' && msg.roomId === state.currentRoom) {
    state.thoughtActive = false;
    renderThoughtState();
  }
  if (msg.type === 'homework') {
    if (state.profile.className && msg.className && msg.className !== state.profile.className) return;
    state.homeworkItems = state.homeworkItems.filter((h) => h.className !== msg.className || h.subject !== msg.subject);
    if (msg.homework && msg.homework.current && msg.homework.current.text) {
      state.homeworkItems.push({ className: msg.className, subject: msg.subject, homework: msg.homework });
    }
    renderHomework();
  }
  if (msg.type === 'homeworkList') {
    state.homeworkItems = (msg.items || []).filter((it) => it.homework && it.homework.current && it.homework.current.text);
    renderHomework();
  }
}

export function connect() {
  state.ws = new WebSocket(WS_URL);
  setConnection(false);
  state.ws.onopen = () => {
    setConnection(true);
    sendJson({ type: 'catalogsRequest' });
    const remembered = localStorage.getItem('meldelisteRemember');
    if (remembered && !state.profile.userId) {
      try {
        const auth = JSON.parse(remembered);
        if (auth?.email && auth?.password) {
          sendJson({ type: 'authLogin', role: 'student', email: auth.email, password: auth.password });
        }
      } catch (e) {}
    }
  };
  state.ws.onclose = () => {
    setConnection(false);
    setTimeout(connect, 1200);
  };
  state.ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
}
