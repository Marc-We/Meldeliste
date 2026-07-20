import { state } from './state.js';
import { els } from './dom.js';
import { sendJson } from './api.js';
import { renderAuthFields, renderProfileInfo, setAuthStatus, updateLayout, flashSend } from './ui.js';
import { renderClassStats, renderClassStudentStats, renderFeedbackForm, renderThoughts, renderAssignmentTemplates, renderGradeSheet, renderGradeClassOptions } from './render.js';

function resolveQuestionScale(questionnaire, question) {
  const globalType = questionnaire?.scaleType === 'yesno' ? 'yesno' : 'scale';
  const globalMin = Number.isFinite(Number(questionnaire?.scaleMin)) ? Number(questionnaire.scaleMin) : 1;
  const globalMax = Number.isFinite(Number(questionnaire?.scaleMax)) ? Number(questionnaire.scaleMax) : 5;
  const qType = question?.scaleType === 'yesno' ? 'yesno' : (question?.scaleType === 'scale' ? 'scale' : '');
  const qMin = Number.isFinite(Number(question?.scaleMin)) ? Number(question.scaleMin) : null;
  const qMax = Number.isFinite(Number(question?.scaleMax)) ? Number(question.scaleMax) : null;
  if (qType === 'yesno') {
    return { type: 'yesno', min: 0, max: 1 };
  }
  if (qMin !== null && qMax !== null) {
    return { type: 'scale', min: Math.min(qMin, qMax), max: Math.max(qMin, qMax) };
  }
  if (globalType === 'yesno') {
    return { type: 'yesno', min: 0, max: 1 };
  }
  return { type: 'scale', min: Math.min(globalMin, globalMax), max: Math.max(globalMin, globalMax) };
}

function parseScaleLine(line) {
  const raw = String(line || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('ja') || raw.includes('yes') || raw.includes('nein') || raw.includes('no')) {
    return { scaleType: 'yesno', scaleMin: 0, scaleMax: 1 };
  }
  const nums = raw.match(/-?\d+/g);
  if (!nums || nums.length < 2) return null;
  const min = Number(nums[0]);
  const max = Number(nums[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { scaleType: 'scale', scaleMin: Math.min(min, max), scaleMax: Math.max(min, max) };
}

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
        setAuthStatus('Bitte alle Felder ausfüllen.');
        return;
      }
      if (password !== passwordConfirm) {
        setAuthStatus('Passwörter stimmen nicht überein.');
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
        setAuthStatus('Bitte alle Felder ausfüllen.');
        return;
      }
      if (password !== passwordConfirm) {
        setAuthStatus('Passwörter stimmen nicht überein.');
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
    flashSend(els.createRoomBtn);
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
    flashSend(els.addClassBtn);
    els.newClassInput.value = '';
  };

  els.addSubjectBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const subj = els.newSubjectInput.value.trim();
    if (!subj) return;
    sendJson({ type: 'createSubject', subject: subj });
    flashSend(els.addSubjectBtn);
    els.newSubjectInput.value = '';
  };

  if (els.moveStudentBtn) {
    els.moveStudentBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const userId = els.moveStudentSelect.value;
      const className = els.moveClassSelect.value;
      if (!userId || !className) return;
      sendJson({ type: 'adminMoveStudent', userId, className });
      flashSend(els.moveStudentBtn);
      if (els.moveStudentInfo) els.moveStudentInfo.textContent = 'Verschieben angefragt.';
    };
  }

  if (els.banAddEmailBtn) {
    els.banAddEmailBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const value = els.banEmailInput.value.trim();
      if (!value) return;
      sendJson({ type: 'banAdd', kind: 'email', value });
      flashSend(els.banAddEmailBtn);
      els.banEmailInput.value = '';
    };
  }

  if (els.fetchClassCodeBtn) {
    els.fetchClassCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const className = els.codeClassSelect.value;
      if (!className) return;
      sendJson({ type: 'classCodeRequest', className });
      flashSend(els.fetchClassCodeBtn);
    };
  }
  if (els.rotateClassCodeBtn) {
    els.rotateClassCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const className = els.codeClassSelect.value;
      if (!className) return;
      sendJson({ type: 'classCodeRotate', className });
      flashSend(els.rotateClassCodeBtn);
    };
  }
  if (els.fetchTeacherCodeBtn) {
    els.fetchTeacherCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: 'teacherCodeRequest' });
      flashSend(els.fetchTeacherCodeBtn);
    };
  }
  if (els.rotateTeacherCodeBtn) {
    els.rotateTeacherCodeBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: 'teacherCodeRotate' });
      flashSend(els.rotateTeacherCodeBtn);
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
      const missing = answers.some((a) => {
        const val = Number(a.value);
        if (!Number.isFinite(val)) return true;
        const q = questions.find((qItem) => qItem.id === a.id);
        if (!q) return true;
        const scale = resolveQuestionScale(state.questionnaireTeacher, q);
        if (scale.type === 'yesno') return !(val === 0 || val === 1);
        return val < scale.min || val > scale.max;
      });
      if (missing) return;
      const text = els.feedbackText.value.trim();
      sendJson({ type: 'feedbackSubmit', studentId, subject, answers, text });
      flashSend(els.feedbackSendBtn);
      els.feedbackText.value = '';
      state.feedbackAnswers = {};
    };
  }
  if (els.questionnaireTypeSelect) {
    els.questionnaireTypeSelect.onchange = () => {
      const role = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
      if (els.questionnaireSlotSelect) {
        els.questionnaireSlotSelect.style.display = role === 'student' ? '' : 'none';
      }
      const slot = role === 'student' ? (els.questionnaireSlotSelect?.value || 'default') : '';
      sendJson({ type: 'questionnaireRequest', role, slot });
    };
  }
  if (els.questionnaireSlotSelect) {
    els.questionnaireSlotSelect.onchange = () => {
      const role = els.questionnaireTypeSelect?.value === 'teacher' ? 'teacher' : 'student';
      if (role !== 'student') return;
      const slot = els.questionnaireSlotSelect.value || 'default';
      sendJson({ type: 'questionnaireRequest', role, slot });
    };
  }
  if (els.questionnaireScaleType) {
    els.questionnaireScaleType.onchange = () => {
      const isYesNo = els.questionnaireScaleType.value === 'yesno';
      if (els.questionnaireScaleMin) els.questionnaireScaleMin.disabled = isYesNo;
      if (els.questionnaireScaleMax) els.questionnaireScaleMax.disabled = isYesNo;
    };
  }
  if (els.questionnaireLoadBtn) {
    els.questionnaireLoadBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const role = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
      const slot = role === 'student' ? (els.questionnaireSlotSelect?.value || 'default') : '';
      sendJson({ type: 'questionnaireRequest', role, slot });
      flashSend(els.questionnaireLoadBtn);
    };
  }
  if (els.questionnaireSaveBtn) {
    els.questionnaireSaveBtn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const role = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
      const title = (els.questionnaireTitleInput.value || '').trim();
      const lines = (els.questionnaireQuestionsInput.value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const hints = (els.questionnaireHintsInput?.value || '').split(/\r?\n/).map((l) => l.trim());
      const scaleLines = (els.questionnaireScaleLines?.value || '').split(/\r?\n/).map((l) => l.trim());
      const questions = lines.map((text, idx) => {
        const question = { id: `q${idx + 1}`, text, hint: hints[idx] || '' };
        const scale = parseScaleLine(scaleLines[idx]);
        if (scale) {
          question.scaleType = scale.scaleType;
          question.scaleMin = scale.scaleMin;
          question.scaleMax = scale.scaleMax;
        }
        return question;
      });
      const scaleType = els.questionnaireScaleType?.value === 'yesno' ? 'yesno' : 'scale';
      const scaleMin = Number(els.questionnaireScaleMin?.value || 1);
      const scaleMax = Number(els.questionnaireScaleMax?.value || 5);
      const slot = role === 'student' ? (els.questionnaireSlotSelect?.value || 'default') : '';
      sendJson({ type: 'questionnaireSave', role, slot, data: { title, questions, scaleType, scaleMin, scaleMax } });
      flashSend(els.questionnaireSaveBtn);
    };
  }
  if (els.questionnaireBroadcastStart) {
    els.questionnaireBroadcastStart.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      if (!state.currentRoom) return;
      const slot = els.questionnaireBroadcastSlot?.value === 'extra2' ? 'extra2' : 'extra1';
      sendJson({ type: 'questionnaireActivate', roomId: state.currentRoom, slot });
      flashSend(els.questionnaireBroadcastStart);
    };
  }
  if (els.questionnaireBroadcastEnd) {
    els.questionnaireBroadcastEnd.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      if (!state.currentRoom) return;
      sendJson({ type: 'questionnaireDeactivate', roomId: state.currentRoom });
      flashSend(els.questionnaireBroadcastEnd);
    };
  }

  els.addTeachingBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const classNames = Array.from(els.teachClassList.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
    const subj = els.teachSubjectSelect.value;
    if (!classNames.length || !subj) return;
    sendJson({ type: 'addTeaching', classNames, subject: subj });
    flashSend(els.addTeachingBtn);
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
    flashSend(els.createPollBtn);
    els.pollQuestionInput.value = '';
    els.pollOptionsInput.value = '';
    els.pollMultipleInput.checked = false;
    els.pollAnonymousInput.checked = true;
  };

  els.endPollBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    sendJson({ type: 'pollEnd', roomId: state.currentRoom });
    flashSend(els.endPollBtn);
  };

  els.timerSetBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    const h = Math.max(0, parseInt(els.timerHours.value, 10) || 0);
    const m = Math.max(0, parseInt(els.timerMinutes.value, 10) || 0);
    const s = Math.max(0, parseInt(els.timerSeconds.value, 10) || 0);
    const total = h * 3600 + m * 60 + s;
    if (total < 1) return;
    sendJson({ type: 'timerSet', roomId: state.currentRoom, totalSeconds: total });
  };

  els.timerStartBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    sendJson({ type: 'timerStart', roomId: state.currentRoom });
  };

  els.timerPauseBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    const t = state.timer;
    sendJson({ type: t && t.running ? 'timerPause' : 'timerStart', roomId: state.currentRoom });
  };

  els.timerStopBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    sendJson({ type: 'timerStop', roomId: state.currentRoom });
  };

  els.timerFinishedClose.onclick = () => {
    els.timerFinished.style.display = 'none';
  };

  // --- Assignment handlers ---
  if (els.assignmentNewBtn) els.assignmentNewBtn.onclick = () => {
    state.selectedAssignmentId = null;
    els.assignmentTitle.value = '';
    els.assignmentDescription.value = '';
    els.assignmentHours.value = 0;
    els.assignmentMinutes.value = 0;
    els.assignmentSeconds.value = 0;
    els.assignmentDeleteBtn.style.display = 'none';
    renderAssignmentTemplates();
  };

  els.assignmentSaveBtn.onclick = () => {
    const title = els.assignmentTitle.value.trim();
    if (!title) return;
    const h = Math.max(0, parseInt(els.assignmentHours.value, 10) || 0);
    const m = Math.max(0, parseInt(els.assignmentMinutes.value, 10) || 0);
    const s = Math.max(0, parseInt(els.assignmentSeconds.value, 10) || 0);
    const totalSeconds = h * 3600 + m * 60 + s;
    sendJson({
      type: 'assignmentSave',
      assignmentId: state.selectedAssignmentId || undefined,
      title,
      description: els.assignmentDescription.value.trim(),
      totalSeconds,
    });
    if (!state.selectedAssignmentId) {
      state.knownAssignmentIds = state.assignmentTemplates.map((t) => t.id);
      state.pendingSelectAssignmentTitle = true;
    }
    flashSend(els.assignmentSaveBtn);
  };

  els.assignmentLaunchBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    if (!state.selectedAssignmentId) return;
    sendJson({ type: 'assignmentLaunch', assignmentId: state.selectedAssignmentId, roomId: state.currentRoom });
    flashSend(els.assignmentLaunchBtn);
  };

  els.assignmentEndBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
    sendJson({ type: 'assignmentEnd', roomId: state.currentRoom });
  };

  els.assignmentDeleteBtn.onclick = () => {
    if (!state.selectedAssignmentId) return;
    sendJson({ type: 'assignmentDelete', assignmentId: state.selectedAssignmentId });
    state.selectedAssignmentId = null;
    els.assignmentTitle.value = '';
    els.assignmentDescription.value = '';
    els.assignmentHours.value = 0;
    els.assignmentMinutes.value = 0;
    els.assignmentSeconds.value = 0;
    els.assignmentDeleteBtn.style.display = 'none';
  };

  // --- Grade sheet handlers ---
  els.gradeClassSelect.onchange = () => {
    const className = els.gradeClassSelect.value;
    state.gradeClassName = className;
    state.gradeStudentList = [];
    if (className && state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendJson({ type: 'gradeStudentListRequest', className });
    } else {
      renderGradeSheet();
    }
  };

  if (els.gradeSheetNewBtn) els.gradeSheetNewBtn.onclick = () => {
    state.selectedSheetId = null;
    els.gradeSheetLabel.value = '';
    els.gradeClassSelect.value = '';
    els.gradeSheetSubject.value = '';
    state.gradeStudentList = [];
    state.gradeClassName = '';
    els.gradeSheetDeleteBtn.style.display = 'none';
    renderGradeSheet();
  };

  els.gradeSheetSaveBtn.onclick = () => {
    const label = els.gradeSheetLabel.value.trim();
    if (!label) return;
    const entries = {};
    els.gradeEntryList.querySelectorAll('[data-uid]').forEach((row) => {
      const uid = row.dataset.uid;
      const mssEl = row.querySelector('.grade-mss');
      const commentEl = row.querySelector('.grade-comment');
      const mssVal = mssEl ? mssEl.value : '';
      entries[uid] = { mss: mssVal === '' ? null : Number(mssVal), comment: commentEl ? commentEl.value.trim() : '' };
    });
    sendJson({
      type: 'gradeSheetSave',
      sheetId: state.selectedSheetId || undefined,
      label,
      className: els.gradeClassSelect.value,
      subject: els.gradeSheetSubject.value.trim(),
      entries,
    });
    // Wenn ein neuer Bogen (ohne ID) gespeichert wird, nach Rückkehr der Liste auswählen
    if (!state.selectedSheetId) {
      state.knownSheetIds = state.gradeSheets.map((s) => s.id);
      state.pendingSelectLabel = true;
    }
    flashSend(els.gradeSheetSaveBtn);
  };

  els.gradeSheetSendBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom || !state.selectedSheetId) return;
    sendJson({ type: 'gradeSheetSend', sheetId: state.selectedSheetId, roomId: state.currentRoom });
    flashSend(els.gradeSheetSendBtn);
  };

  els.gradeSheetDeleteBtn.onclick = () => {
    if (!state.selectedSheetId) return;
    sendJson({ type: 'gradeSheetDelete', sheetId: state.selectedSheetId });
    state.selectedSheetId = null;
    els.gradeSheetLabel.value = '';
    els.gradeClassSelect.value = '';
    els.gradeSheetSubject.value = '';
    state.gradeStudentList = [];
    state.gradeClassName = '';
    els.gradeSheetDeleteBtn.style.display = 'none';
    renderGradeSheet();
  };

  els.startThoughtsBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'thoughtStart', roomId: state.currentRoom });
    state.thoughts = [];
    renderThoughts();
    flashSend(els.startThoughtsBtn);
  };

  els.endThoughtsBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'thoughtEnd', roomId: state.currentRoom });
    flashSend(els.endThoughtsBtn);
  };

  els.sendHomeworkBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const text = els.homeworkText.value.trim();
    if (!text || !state.currentRoom) return;
    const room = state.rooms.find((r) => r.id === state.currentRoom);
    if (!room) return;
    const classNames = Array.isArray(room.classNames) && room.classNames.length ? room.classNames : (room.className ? [room.className] : []);
    sendJson({ type: 'homeworkSet', classNames, subject: room.subject || 'default', text });
    flashSend(els.sendHomeworkBtn);
    els.homeworkText.value = '';
  };
}