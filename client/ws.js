import { state } from './state.js';
import { els } from './dom.js';
import { WS_URL } from './config.js';
import { sendJson, requestSubjectStats } from './api.js';
import { setAuthStatus, setConnection, renderAuthFields, renderProfileInfo } from './ui.js';
import {
  renderCalled,
  renderClassOptions,
  renderCourseCatalog,
  renderFeedbackInbox,
  renderHomework,
  renderLog,
  renderPoll,
  renderRooms,
  renderStats,
  renderSubjectStats,
  renderQuestionnaire,
  renderThoughtState,
  renderTimer,
  renderAssignment,
  renderGrade,
} from './render.js';

function courseKey(subject, teacherId) {
  return `${subject || 'default'}::${teacherId || ''}`;
}

function handleMessage(msg) {
  if (msg.type === 'profile' && msg.user) {
    state.profile.userId = msg.user.id;
    state.profile.email = msg.user.email || state.profile.email;
    state.profile.firstName = msg.user.firstName || state.profile.firstName;
    state.profile.lastName = msg.user.lastName || state.profile.lastName;
    state.profile.className = msg.user.className || state.profile.className;
    state.profile.courses = Array.isArray(msg.user.courses) ? msg.user.courses : state.profile.courses;
    state.selectedCourses = (state.profile.courses || []).map((c) => courseKey(c.subject, c.teacherId));
    state.authMode = 'login';
    setAuthStatus('');
    renderProfileInfo();
    renderCourseCatalog();
    if (state.lastAuth?.email && state.lastAuth?.password) {
      localStorage.setItem('meldelisteRemember', JSON.stringify(state.lastAuth));
    }
    localStorage.setItem('meldelisteProfile', JSON.stringify(state.profile));
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendJson({ type: 'homeworkListRequest' });
      requestSubjectStats();
      sendJson({ type: 'feedbackInboxRequest' });
    }
    renderRooms();
  }
  if (msg.type === 'catalogs') {
    state.classCatalog = msg.classes || [];
    renderClassOptions();
  }
  if (msg.type === 'questionnaire' && msg.role === 'student') {
    const slot = msg.slot || 'default';
    if ((state.questionnaire.slot || 'default') !== slot) return;
    state.questionnaire.data = msg.data || null;
    state.questionnaire.loading = false;
    renderQuestionnaire();
  }
  if (msg.type === 'feedbackInbox' && msg.role === 'student') {
    state.feedbackInbox = msg.items || [];
    renderFeedbackInbox();
  }
  if (msg.type === 'questionnaireActive') {
    if (msg.roomId && state.currentRoom && msg.roomId !== state.currentRoom) return;
    if (msg.active) {
      state.activeQuestionnaire = msg;
      state.questionnaire.open = true;
      state.questionnaire.subject = msg.subject || state.questionnaire.subject || 'Fach';
      state.questionnaire.teacherId = msg.teacherId || '';
      state.questionnaire.slot = msg.slot || 'default';
      state.questionnaire.data = null;
      state.questionnaire.answers = {};
      state.questionnaire.loading = false;
      renderQuestionnaire();
    } else {
      state.activeQuestionnaire = null;
      if (state.questionnaire.slot !== 'default') {
        state.questionnaire.open = false;
        state.questionnaire.data = null;
        state.questionnaire.answers = {};
        state.questionnaire.loading = false;
        state.questionnaire.slot = 'default';
        renderQuestionnaire();
      }
    }
  }
  if (msg.type === 'courseCatalog') {
    state.courseCatalog = msg.courses || [];
    renderCourseCatalog();
    renderRooms();
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
      setAuthStatus('Code gesendet. Bitte prüfen.');
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
      setAuthStatus('E-Mail bereits bestätigt.');
    }
  }
  if (msg.type === 'authError') {
    const reason = msg.reason || 'Anmeldung fehlgeschlagen';
    const messages = {
      missing_fields: 'Bitte alle Felder ausfüllen.',
      email_exists: 'E-Mail existiert bereits.',
      not_found: 'Account nicht gefunden.',
      wrong_password: 'Passwort falsch.',
      email_unverified: 'E-Mail noch nicht bestätigt.',
      code_invalid: 'Code ungültig.',
      code_expired: 'Code abgelaufen.',
      class_invalid: 'Klasse ungültig.',
      wrong_role: 'Falsche Rolle für diesen Account.',
      banned: 'Account gesperrt.',
    };
    setAuthStatus(messages[reason] || `Fehler: ${reason}`);
    if (reason === 'email_unverified') {
      state.authMode = 'verify';
      renderAuthFields();
    }
  }
  if (msg.type === 'joinDenied') {
    setAuthStatus('Du bist für diesen Kurs nicht freigeschaltet.');
    state.currentRoom = null;
    if (els.roomSelect) els.roomSelect.value = '';
    renderRooms();
  }
  if (msg.type === 'roomKicked') {
    if (msg.roomId && state.currentRoom === msg.roomId) {
      state.currentRoom = null;
      if (els.roomSelect) els.roomSelect.value = '';
      renderRooms();
    }
  }
  if (msg.type === 'courseReport') {
    const teacher = msg.teacherName || 'Lehrer';
    const subject = msg.subject || 'Fach';
    setAuthStatus(`Meldung vom Kurs ${subject} (${teacher}).`);
  }
  if (msg.type === 'courseKicked') {
    const teacher = msg.teacherName || 'Lehrer';
    const subject = msg.subject || 'Fach';
    setAuthStatus(`Aus Kurs ${subject} (${teacher}) entfernt.`);
  }
  if (msg.type === 'banned') {
    localStorage.removeItem('meldelisteProfile');
    localStorage.removeItem('meldelisteRemember');
    setAuthStatus('Account gesperrt.');
    if (state.ws) state.ws.close();
  }
  if (msg.type === 'timer' && msg.roomId === state.currentRoom) {
    state.timer = msg.timer || null;
    renderTimer();
  }
  if (msg.type === 'assignment' && msg.roomId === state.currentRoom) {
    state.assignment = msg.assignment || null;
    renderAssignment();
  }
  if (msg.type === 'gradeSent') {
    state.grade = msg;
    renderGrade();
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
    sendJson({ type: 'courseCatalogRequest' });
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
  state.ws.onerror = () => {
    setConnection(false);
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
