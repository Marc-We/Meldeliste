import { state } from './state.js';
import { els } from './dom.js';
import { sendJson } from './api.js';
import { renderAuthFields, renderProfileInfo, setAuthStatus, updateLayout } from './ui.js';
import { renderClassStats, renderClassStudentStats, renderFeedbackForm, renderThoughts } from './render.js';

export function bindHandlers() {
  els.saveProfileBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const email = els.emailInput.value.trim();
    const password = els.passwordInput.value;
    const passwordConfirm = els.passwordConfirmInput.value;
    const code = els.verifyCodeInput.value.trim();
    const salutation = els.salutationInput.value;
    const lastName = els.lastNameInput.value.trim();

    if (state.authMode === 'register') {
      if (!email || !lastName || !code || !password || !passwordConfirm) {
        setAuthStatus('Bitte alle Felder ausfuellen.');
        return;
      }
      if (password !== passwordConfirm) {
        setAuthStatus('Passwoerter stimmen nicht ueberein.');
        return;
      }
      state.pendingEmail = email;
      sendJson({ type: 'authRegister', role: 'teacher', email, salutation, lastName, password, code });
      return;
    }
    if (state.authMode === 'login') {
      if (!email || !password) {
        setAuthStatus('Bitte E-Mail und Passwort eingeben.');
        return;
      }
      state.pendingEmail = email;
      sendJson({ type: 'authLogin', role: 'teacher', email, password });
      return;
    }
    if (state.authMode === 'verify') {
      const targetEmail = state.pendingEmail || email;
      if (!targetEmail || !code) {
        setAuthStatus('Bitte Code eingeben.');
        return;
      }
      sendJson({ type: 'authVerify', email: targetEmail, code });
      return;
    }
    if (state.authMode === 'reset-request') {
      if (!email) {
        setAuthStatus('Bitte E-Mail eingeben.');
        return;
      }
      state.pendingEmail = email;
      sendJson({ type: 'authResetRequest', email });
      return;
    }
    if (state.authMode === 'reset-confirm') {
      const targetEmail = state.pendingEmail || email;
      if (!targetEmail || !code || !password || !passwordConfirm) {
        setAuthStatus('Bitte alle Felder ausfuellen.');
        return;
      }
      if (password !== passwordConfirm) {
        setAuthStatus('Passwoerter stimmen nicht ueberein.');
        return;
      }
      sendJson({ type: 'authResetConfirm', email: targetEmail, code, password });
    }
  };

  els.logoutBtn.onclick = () => {
    localStorage.removeItem('meldelisteProfileTeacher');
    location.reload();
  };

  els.modeRegisterBtn.onclick = () => {
    state.authMode = 'register';
    setAuthStatus('');
    renderProfileInfo();
  };
  els.modeLoginBtn.onclick = () => {
    state.authMode = 'login';
    setAuthStatus('');
    renderProfileInfo();
  };
  els.forgotBtn.onclick = () => {
    state.authMode = 'reset-request';
    setAuthStatus('Code wird an die E-Mail gesendet.');
    renderAuthFields();
  };

  els.createRoomBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const name = els.roomNameInput.value.trim() || 'Raum';
    const classNames = Array.from(els.roomClassList.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
    const subject = els.roomSubjectInput.value || 'default';
    if (!classNames.length) return;
    sendJson({ type: 'roomCreate', name, classNames, subject });
    els.roomNameInput.value = '';
  };

  els.closeRoomBtn.onclick = () => {
    if (!state.currentRoom || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'roomClose', roomId: state.currentRoom });
  };

  els.addClassBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const cls = els.newClassInput.value.trim();
    if (!cls) return;
    sendJson({ type: 'createClass', className: cls });
    els.newClassInput.value = '';
  };

  els.addSubjectBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const subj = els.newSubjectInput.value.trim();
    if (!subj) return;
    sendJson({ type: 'createSubject', subject: subj });
    els.newSubjectInput.value = '';
  };

  if (els.moveStudentBtn) {
    els.moveStudentBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const userId = els.moveStudentSelect.value;
      const className = els.moveClassSelect.value;
      if (!userId || !className) return;
      sendJson({ type: 'adminMoveStudent', userId, className });
      if (els.moveStudentInfo) els.moveStudentInfo.textContent = 'Verschieben angefragt.';
    };
  }

  if (els.banAddEmailBtn) {
    els.banAddEmailBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const value = els.banEmailInput.value.trim();
      if (!value) return;
      sendJson({ type: 'banAdd', kind: 'email', value });
      els.banEmailInput.value = '';
    };
  }
  if (els.banAddIpBtn) {
    els.banAddIpBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const value = els.banIpInput.value.trim();
      if (!value) return;
      sendJson({ type: 'banAdd', kind: 'ip', value });
      els.banIpInput.value = '';
    };
  }

  if (els.fetchClassCodeBtn) {
    els.fetchClassCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const className = els.codeClassSelect.value;
      if (!className) return;
      sendJson({ type: 'classCodeRequest', className });
    };
  }
  if (els.rotateClassCodeBtn) {
    els.rotateClassCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const className = els.codeClassSelect.value;
      if (!className) return;
      sendJson({ type: 'classCodeRotate', className });
    };
  }
  if (els.fetchTeacherCodeBtn) {
    els.fetchTeacherCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: 'teacherCodeRequest' });
    };
  }
  if (els.rotateTeacherCodeBtn) {
    els.rotateTeacherCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: 'teacherCodeRotate' });
    };
  }

  if (els.feedbackQuestions) {
    els.feedbackQuestions.onclick = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName !== 'BUTTON') return;
      const parent = target.closest('[data-q]');
      if (!parent) return;
      const qid = parent.getAttribute('data-q');
      const val = Number(target.getAttribute('data-val'));
      if (!qid || !Number.isFinite(val)) return;
      state.feedbackAnswers[qid] = val;
      renderFeedbackForm();
    };
  }
  if (els.feedbackSendBtn) {
    els.feedbackSendBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const studentId = els.feedbackStudentSelect.value;
      const subject = (els.feedbackSubjectInput.value || '').trim();
      const questions = Array.isArray(state.questionnaireTeacher?.questions) ? state.questionnaireTeacher.questions : [];
      if (!studentId || !questions.length) return;
      const answers = questions.map((q) => ({ id: q.id, value: state.feedbackAnswers[q.id] }));
      const missing = answers.some((a) => !a.value || a.value < 1 || a.value > 5);
      if (missing) return;
      const text = els.feedbackText.value.trim();
      sendJson({ type: 'feedbackSubmit', studentId, subject, answers, text });
      els.feedbackText.value = '';
      state.feedbackAnswers = {};
    };
  }
  if (els.questionnaireTypeSelect) {
    els.questionnaireTypeSelect.onchange = () => {
      const role = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
      sendJson({ type: 'questionnaireRequest', role });
    };
  }
  if (els.questionnaireSaveBtn) {
    els.questionnaireSaveBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const role = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
      const title = (els.questionnaireTitleInput.value || '').trim();
      const lines = (els.questionnaireQuestionsInput.value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const questions = lines.map((text, idx) => ({ id: `q${idx + 1}`, text }));
      sendJson({ type: 'questionnaireSave', role, data: { title, questions } });
    };
  }

  els.addTeachingBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const classNames = Array.from(els.teachClassList.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
    const subj = els.teachSubjectSelect.value;
    if (!classNames.length || !subj) return;
    sendJson({ type: 'addTeaching', classNames, subject: subj });
  };

  els.questionClose.onclick = () => {
    els.questionBanner.style.display = 'none';
  };

  els.classStatsClose.onclick = () => {
    state.classStats = { className: '', classNames: [], subject: '', students: [] };
    state.classStudentStats = { className: '', classNames: [], subject: '', student: null, sessions: [] };
    renderClassStats();
    updateLayout();
  };

  els.classStudentClose.onclick = () => {
    state.classStudentStats = { className: '', classNames: [], subject: '', student: null, sessions: [] };
    renderClassStudentStats();
  };

  els.createPollBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const question = els.pollQuestionInput.value.trim();
    const opts = els.pollOptionsInput.value.split(';').map((s) => s.trim()).filter(Boolean);
    const multiple = els.pollMultipleInput.checked;
    const anonymous = els.pollAnonymousInput.checked;
    if (!question || opts.length < 2) return;
    sendJson({ type: 'pollCreate', roomId: state.currentRoom, question, options: opts, multiple, anonymous });
    els.pollQuestionInput.value = '';
    els.pollOptionsInput.value = '';
    els.pollMultipleInput.checked = false;
    els.pollAnonymousInput.checked = true;
  };

  els.endPollBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    sendJson({ type: 'pollEnd', roomId: state.currentRoom });
  };

  els.startThoughtsBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'thoughtStart', roomId: state.currentRoom });
    state.thoughts = [];
    renderThoughts();
  };

  els.endThoughtsBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'thoughtEnd', roomId: state.currentRoom });
  };

  els.sendHomeworkBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const text = els.homeworkText.value.trim();
    if (!text || !state.currentRoom) return;
    const room = state.rooms.find((r) => r.id === state.currentRoom);
    if (!room) return;
    const classNames = Array.isArray(room.classNames) && room.classNames.length ? room.classNames : (room.className ? [room.className] : []);
    sendJson({ type: 'homeworkSet', classNames, subject: room.subject || 'default', text });
    els.homeworkText.value = '';
  };
}
