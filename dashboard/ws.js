import { state } from './state.js';
import { els } from './dom.js';
import { WS_URL } from './config.js';
import { sendJson } from './api.js';
import { renderAuthFields, renderProfileInfo, setAuthStatus, setConnection, updateLayout } from './ui.js';
import {
  renderCatalogs,
  renderCodes,
  renderClassStats,
  renderClassStudentStats,
  renderCurrentRoom,
  renderFeedbackForm,
  renderTeacherInbox,
  renderHomework,
  renderLog,
  renderMembers,
  renderPoll,
  renderGroups,
  renderAmpel,
  renderSeatView,
  renderPrepGroups,
  renderQuestions,
  renderRooms,
  renderStats,
  renderTeachings,
  renderThoughts,
  renderAdminPanel,
  renderQuestionnaireEditor,
  renderQuestionnaireBroadcast,
  renderTimer,
  renderAssignment,
  renderAssignmentTemplates,
  renderGradeSheet,
  renderGradeClassOptions,
} from './render.js';

function handleMessage(msg) {
  if (msg.type === 'profile' && msg.user) {
    state.profile.userId = msg.user.id;
    state.profile.email = msg.user.email || state.profile.email;
    state.profile.salutation = msg.user.salutation || state.profile.salutation;
    state.profile.lastName = msg.user.lastName || state.profile.lastName;
    state.profile.role = msg.user.role || state.profile.role;
    state.profile.teachings = msg.user.teachings || state.profile.teachings;
    state.authMode = 'login';
    setAuthStatus('');
    renderProfileInfo();
    renderTeachings();
    renderCodes();
    renderAdminPanel();
    renderFeedbackForm();
    renderTeacherInbox();
    renderQuestionnaireBroadcast();
    renderGradeClassOptions();
    updateLayout();
    localStorage.setItem('meldelisteProfileTeacher', JSON.stringify(state.profile));
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendJson({ type: 'homeworkListRequest' });
      sendJson({ type: 'feedbackInboxRequest' });
      sendJson({ type: 'assignmentListRequest' });
      sendJson({ type: 'gradeSheetListRequest' });
      sendJson({ type: 'qFormListRequest', kind: 'student' });
      sendJson({ type: 'qFormListRequest', kind: 'feedback' });
      sendJson({ type: 'questionnaireRequest', role: 'student' });
      sendJson({ type: 'questionnaireRequest', role: 'teacher' });
      if (state.profile.role === 'admin') {
        sendJson({ type: 'pendingTeachersRequest' });
        sendJson({ type: 'teacherCodeRequest' });
        sendJson({ type: 'adminStudentsRequest' });
        sendJson({ type: 'bansRequest' });
        sendJson({ type: 'reportsRequest' });
      }
    }
  }
  if (msg.type === 'roomList') {
    state.rooms = msg.rooms || [];
    renderRooms();
    renderCurrentRoom();
  }
  if (msg.type === 'presence' && msg.roomId === state.currentRoom) {
    state.presence = new Map();
    (msg.members || []).forEach((m) => state.presence.set(m.userId, m));
    renderMembers();
  }
  if (msg.type === 'ready' && msg.roomId === state.currentRoom) {
    if (!state.presence.has(msg.userId)) state.presence.set(msg.userId, { userId: msg.userId, name: msg.name || 'Unbekannt', ready: true, online: true });
    const p = state.presence.get(msg.userId);
    p.ready = true;
    p.online = true;
    renderMembers();
  }
  if (msg.type === 'reset' && msg.roomId === state.currentRoom) {
    if (state.presence.has(msg.userId)) {
      state.presence.get(msg.userId).ready = false;
      renderMembers();
    }
  }
  if (msg.type === 'resetAll' && msg.roomId === state.currentRoom) {
    state.presence.forEach((value) => { value.ready = false; });
    renderMembers();
  }
  if (msg.type === 'roomClosed' && msg.roomId === state.currentRoom) {
    state.currentRoom = null;
    renderCurrentRoom();
  }
  if (msg.type === 'log' && msg.roomId === state.currentRoom) {
    state.logEntries = msg.entries || [];
    renderLog();
  }
  if (msg.type === 'stats' && msg.roomId === state.currentRoom) {
    state.stats = msg.stats || [];
    renderStats();
  }
  if (msg.type === 'classStats') {
    state.classStats = { className: msg.className || '', classNames: msg.classNames || [], subject: msg.subject || '', students: msg.students || [] };
    state.classStudentStats = { className: msg.className || '', classNames: msg.classNames || [], subject: msg.subject || '', student: null, sessions: [] };
    state.studentNotes = {};
    (msg.students || []).forEach((s) => {
      if (s && s.userId) state.studentNotes[s.userId] = s.note || '';
    });
    renderClassStats();
    renderFeedbackForm();
    updateLayout();
  }
  if (msg.type === 'classStudentStats') {
    state.classStudentStats = { className: msg.className || '', classNames: msg.classNames || [], subject: msg.subject || '', student: msg.student || null, sessions: msg.sessions || [] };
    renderClassStudentStats();
    updateLayout();
  }
  if (msg.type === 'authStatus') {
    if (msg.status === 'teacher_pending') {
      state.authMode = 'login';
      setAuthStatus('Registrierung gespeichert. Admin muss freigeben.');
      renderAuthFields();
    } else if (msg.status === 'verify_required') {
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
      teacher_unapproved: 'Admin muss den Account freigeben.',
      banned: 'Account gesperrt.',
    };
    setAuthStatus(messages[reason] || `Fehler: ${reason}`);
    if (reason === 'email_unverified') {
      state.authMode = 'verify';
      renderAuthFields();
    }
  }
  if (msg.type === 'catalogs') {
    state.classCatalog = msg.classes || [];
    state.subjectCatalog = msg.subjects || [];
    renderCatalogs();
    renderAdminPanel();
  }
  if (msg.type === 'classCode') {
    state.classCode = msg.entry || null;
    renderCodes();
  }
  if (msg.type === 'teacherCode') {
    state.teacherCode = msg.entry || null;
    renderAdminPanel();
  }
  if (msg.type === 'pendingTeachers') {
    state.pendingTeachers = msg.teachers || [];
    renderAdminPanel();
  }
  if (msg.type === 'adminStudents') {
    state.adminStudents = msg.students || [];
    renderAdminPanel();
  }
  if (msg.type === 'bans') {
    state.bans = { emails: msg.emails || [] };
    renderAdminPanel();
  }
  if (msg.type === 'reportList') {
    state.reports = msg.reports || [];
    renderAdminPanel();
  }
  if (msg.type === 'questionnaire') {
    if (msg.role === 'student') {
      const slot = msg.slot || 'default';
      state.questionnaireStudent = msg.data || null;
    } else if (msg.role === 'teacher') {
      state.questionnaireTeacher = msg.data || null;
      state.feedbackAnswers = {};
      renderFeedbackForm();
    }
    renderQuestionnaireEditor();
  }
  if (msg.type === 'questionnaireActive') {
    state.activeQuestionnaire = msg.active ? msg : null;
    renderQuestionnaireBroadcast();
  }
  if (msg.type === 'feedbackInbox' && msg.role === 'teacher') {
    state.teacherInbox = msg.items || [];
    renderTeacherInbox();
  }
  if (msg.type === 'note') {
    const userId = msg.userId;
    if (!userId) return;
    const current = typeof msg.note === 'string' ? msg.note : (state.studentNotes[userId] || '');
    const name = state.presence.get(userId)?.name
      || state.classStats.students.find((s) => s.userId === userId)?.name
      || 'Schüler';
    const result = prompt(`Notizen für ${name}:`, current);
    state.pendingNoteUserId = '';
    if (result === null) return;
    sendJson({ type: 'noteSave', userId, note: result });
  }
  if (msg.type === 'noteSaved') {
    const userId = msg.userId;
    if (!userId) return;
    const note = typeof msg.note === 'string' ? msg.note : '';
    state.studentNotes[userId] = note;
    state.classStats.students = (state.classStats.students || []).map((s) => (s.userId === userId ? { ...s, note } : s));
    renderClassStats();
  }
  if (msg.type === 'teacherApproved') {
    setAuthStatus('Admin hat deinen Account freigegeben.');
  }
  if (msg.type === 'teacherDenied') {
    setAuthStatus('Admin hat den Account abgelehnt.');
  }
  if (msg.type === 'questionnaireSaved') {
    if (msg.role === 'student') {
      const slot = msg.slot || 'default';
      state.questionnaireStudent = msg.data || null;
    } else if (msg.role === 'teacher') {
      state.questionnaireTeacher = msg.data || null;
      renderFeedbackForm();
    }
    renderQuestionnaireEditor();
  }
  if (msg.type === 'questionList' && msg.roomId === state.currentRoom) {
    state.questions = msg.questions || [];
    renderQuestions();
  }
  if (msg.type === 'question' && msg.roomId === state.currentRoom) {
    state.questions.push(msg.question);
    renderQuestions();
  }
  if (msg.type === 'timer' && msg.roomId === state.currentRoom) {
    state.timer = msg.timer || null;
    renderTimer();
  }
  if (msg.type === 'assignment' && msg.roomId === state.currentRoom) {
    state.assignment = msg.assignment || null;
    renderAssignment();
  }
  if (msg.type === 'assignmentList') {
    state.assignmentTemplates = msg.assignments || [];
    renderAssignmentTemplates();
  }
  if (msg.type === 'gradeSheetList') {
    state.gradeSheets = msg.sheets || [];
    renderGradeSheet();
  }
  if (msg.type === 'gradeStudentList') {
    state.gradeStudentList = msg.students || [];
    state.gradeClassName = msg.className || '';
    renderGradeSheet();
  }
  if (msg.type === 'ampel' && msg.roomId === state.currentRoom) {
    state.ampel = msg.active ? { active: true, counts: msg.counts || { green: 0, yellow: 0, red: 0 } } : null;
    renderAmpel();
  }
  if (msg.type === 'poll' && msg.roomId === state.currentRoom) {
    state.poll = msg.poll;
    renderPoll();
  }
  if (msg.type === 'groupPreview' && msg.roomId === state.currentRoom) {
    state.groupPreview = Array.isArray(msg.groups) ? msg.groups : [];
    if (typeof msg.autoStart === 'boolean' && els.groupAutoStart) {
      els.groupAutoStart.checked = msg.autoStart;
    }
    renderGroups();
  }
  if (msg.type === 'classRoster') {
    state.prepRoster = Array.isArray(msg.students) ? msg.students : [];
    // Falls noch keine Vorbereitungs-Vorschau existiert, alle Schüler in den Pool legen
    if (!state.prepPreview) {
      state.prepPreview = state.prepRoster.length
        ? [{ number: 0, members: state.prepRoster.map((s) => ({ userId: s.userId, name: s.name })) }]
        : [];
    }
    renderPrepGroups();
  }
  if (msg.type === 'groupLayout') {
    // Gespeichertes Layout als Vorbereitungs-Vorschau übernehmen (ohne Anwesenheit)
    const groups = Array.isArray(msg.groups) ? msg.groups.map((g) => ({
      number: Number(g.number),
      members: (Array.isArray(g.members) ? g.members : []).map((m) => ({ userId: m.userId, name: m.name })),
    })) : [];
    // Roster-Schüler, die in keiner Gruppe sind → Pool
    const assigned = new Set();
    groups.forEach((g) => g.members.forEach((m) => assigned.add(m.userId)));
    const pool = (state.prepRoster || []).filter((s) => !assigned.has(s.userId));
    if (pool.length) groups.push({ number: 0, members: pool.map((s) => ({ userId: s.userId, name: s.name })) });
    state.prepPreview = groups.length ? groups : null;
    if (els.prepAutoStart) els.prepAutoStart.checked = Boolean(msg.autoStart);
    renderPrepGroups();
  }
  if (msg.type === 'groupLayoutSaved') {
    if (els.prepStatus) els.prepStatus.textContent = 'Vorbereitung gespeichert.';
  }
  if (msg.type === 'seatPlan') {
    state.seats = Array.isArray(msg.seats) ? msg.seats.map((s) => ({ id: s.id, x: s.x, y: s.y, userId: s.userId || null })) : [];
    state.seatClassName = msg.className || '';
    state.seatSubject = msg.subject || '';
    renderSeatView();
  }
  if (msg.type === 'seatPlans') {
    state.seatPlans = Array.isArray(msg.plans) ? msg.plans : [];
    if (msg.className) state.seatClassName = msg.className;
    if (msg.subject) state.seatSubject = msg.subject;
    // Aktiven Plan bestimmen: Server-Vorgabe > bisher aktiver (falls noch vorhanden) > Standard > erster
    let activeId = msg.activePlanId || null;
    if (!activeId && state.seatActivePlanId && state.seatPlans.some((p) => p.id === state.seatActivePlanId)) {
      activeId = state.seatActivePlanId;
    }
    if (!activeId) activeId = (state.seatPlans.find((p) => p.isDefault) || state.seatPlans[0] || {}).id || null;
    state.seatActivePlanId = activeId;
    const active = state.seatPlans.find((p) => p.id === activeId);
    state.seats = active && Array.isArray(active.seats)
      ? active.seats.map((s) => ({ id: s.id, x: s.x, y: s.y, userId: s.userId || null }))
      : [];
    renderSeatView();
  }
  if (msg.type === 'seatPlanSaved') {
    if (els.seatStatus) { els.seatStatus.textContent = 'Gespeichert.'; setTimeout(() => { if (els.seatStatus) els.seatStatus.textContent = ''; }, 1500); }
  }
  if (msg.type === 'qFormList') {
    const kind = msg.kind === 'feedback' ? 'feedback' : 'student';
    if (kind === 'feedback') state.qFeedbackForms = Array.isArray(msg.forms) ? msg.forms : [];
    else state.qForms = Array.isArray(msg.forms) ? msg.forms : [];
    const active = kind === 'feedback' ? state.qFeedbackForms : state.qForms;
    // nach dem Speichern den gerade gespeicherten Bogen auswählen
    if (msg.savedId) state.selectedQFormId = msg.savedId;
    // gelöschter/nicht mehr vorhandener Bogen -> Auswahl zurücksetzen
    if (state.selectedQFormId && !active.some((f) => f.id === state.selectedQFormId)) {
      state.selectedQFormId = null;
    }
    renderQuestionnaireEditor();
  }
  if (msg.type === 'thoughtState' && msg.roomId === state.currentRoom) {
    if (msg.active) {
      state.thoughts = [];
      renderThoughts();
    }
  }
  if (msg.type === 'thoughtResults' && msg.roomId === state.currentRoom) {
    state.thoughts = msg.results || [];
    renderThoughts();
  }
  if (msg.type === 'homework') {
    state.homeworkItems = state.homeworkItems.filter((h) => h.className !== msg.className || h.subject !== msg.subject);
    if (msg.homework && msg.homework.text) {
      state.homeworkItems.push({ className: msg.className, subject: msg.subject, homework: msg.homework });
    }
    renderHomework();
  }
  if (msg.type === 'homeworkList') {
    state.homeworkItems = msg.items || [];
    renderHomework();
  }
  if (msg.type === 'toilet' && msg.roomId === state.currentRoom) {
    if (msg.status === 'back') {
      state.toiletStates.delete(msg.userId);
    } else {
      state.toiletStates.set(msg.userId, { status: msg.status, start: msg.start || state.toiletStates.get(msg.userId)?.start || null });
    }
    renderMembers();
  }
  if (msg.type === 'important' && msg.roomId === state.currentRoom) {
    if (msg.status === 'cleared') {
      const m = state.presence.get(msg.userId);
      if (m) m.important = false;
    } else if (msg.status === 'pending') {
      const m = state.presence.get(msg.userId) || {};
      m.important = true;
      state.presence.set(msg.userId, m);
    }
    renderMembers();
  }
}

export function connect() {
  state.ws = new WebSocket(WS_URL);
  setConnection(false);
  state.ws.onopen = () => {
    setConnection(true);
    sendJson({ type: 'catalogsRequest' });
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