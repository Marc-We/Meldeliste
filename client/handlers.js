import { state } from './state.js';
import { els } from './dom.js';
import { sendJson, sendJoin } from './api.js';
import { renderAuthFields, renderProfileInfo, setAuthStatus, flashSend } from './ui.js';
import { renderCalled, renderRooms, renderQuestionnaire, updateStatsMode, renderGroup } from './render.js';

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

export function bindHandlers() {
  els.saveProfileBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const email = els.emailInput.value.trim();
    const password = els.passwordInput.value;
    const passwordConfirm = els.passwordConfirmInput.value;
    const code = els.verifyCodeInput.value.trim();
    const firstName = els.firstNameInput.value.trim();
    const lastName = els.lastNameInput.value.trim();

    if (state.authMode === 'register') {
      if (!email || !firstName || !lastName || !code || !password || !passwordConfirm) {
        setAuthStatus('Bitte alle Felder ausfüllen.');
        return;
      }
      if (password !== passwordConfirm) {
        setAuthStatus('Passwörter stimmen nicht überein.');
        return;
      }
      state.pendingEmail = email;
      state.lastAuth = { email, password };
      sendJson({ type: 'authRegister', role: 'student', email, firstName, lastName, code, password });
      return;
    }
    if (state.authMode === 'login') {
      if (!email || !password) {
        setAuthStatus('Bitte E-Mail und Passwort eingeben.');
        return;
      }
      state.pendingEmail = email;
      state.lastAuth = { email, password };
      sendJson({ type: 'authLogin', role: 'student', email, password });
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
    localStorage.removeItem('meldelisteProfile');
    localStorage.removeItem('meldelisteRemember');
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

  if (els.saveCoursesBtn) {
    els.saveCoursesBtn.onclick = () => {
      if (!state.profile.userId || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const checked = Array.from(els.courseList.querySelectorAll('input[type=checkbox]:checked'));
      const courses = checked.map((input) => ({
        subject: input.getAttribute('data-subject') || '',
        teacherId: input.getAttribute('data-teacher') || '',
      })).filter((c) => c.subject && c.teacherId);
      state.selectedCourses = checked.map((input) => input.value);
      sendJson({ type: 'courseUpdate', courses });
      renderRooms();
      updateStatsMode();
    };
  }

  els.roomSelect.onchange = () => {
    const prevRoom = state.currentRoom;
    state.currentRoom = els.roomSelect.value || null;
    if (prevRoom !== state.currentRoom) {
      state.group = null;
      renderGroup();
    }
    if (prevRoom && prevRoom !== state.currentRoom) {
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
    if (state.currentRoom) {
      sendJoin(state.currentRoom);
      els.readyBtn.disabled = false;
      els.leaveBtn.disabled = false;
      els.withdrawBtn.disabled = true;
      els.sendQuestionBtn.disabled = false;
      renderCalled(false);
    } else {
      if (prevRoom && state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendJson({ type: 'leave' });
      }
      els.readyBtn.disabled = true;
      els.leaveBtn.disabled = true;
      els.withdrawBtn.disabled = true;
      els.sendQuestionBtn.disabled = true;
    }
    updateStatsMode();
  };

  els.readyBtn.onclick = () => {
    if (!state.currentRoom || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'ready', roomId: state.currentRoom });
    els.readyBtn.disabled = true;
    els.withdrawBtn.disabled = false;
  };

  els.withdrawBtn.onclick = () => {
    if (!state.currentRoom || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'withdraw', roomId: state.currentRoom });
    els.readyBtn.disabled = false;
    els.withdrawBtn.disabled = true;
  };

  els.sendQuestionBtn.onclick = () => {
    if (!state.currentRoom || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const text = els.questionText.value.trim();
    if (!text) return;
    if (state.thoughtActive) {
      sendJson({ type: 'thoughtSubmit', roomId: state.currentRoom, text });
    } else {
      sendJson({ type: 'questionSubmit', roomId: state.currentRoom, text, anonymous: els.questionAnonymous.checked });
    }
    els.questionText.value = '';
    flashSend(els.sendQuestionBtn);
  };

  els.gradePanelClose.onclick = () => {
    state.grade = null;
    els.gradePanel.style.display = 'none';
  };

  els.pollVoteBtn.onclick = () => {
    if (!state.currentRoom || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (!state.poll || state.poll.open === false || state.poll.voted) return;
    const inputs = els.pollContainer.querySelectorAll('input[name="pollopt"]');
    const selected = [];
    inputs.forEach((inp) => {
      if (inp.checked) selected.push(inp.value);
    });
    if (!selected.length) return;
    sendJson({ type: 'pollVote', roomId: state.currentRoom, options: selected });
    state.pollSelection = selected;
    state.pollCollapsed = true;
    els.pollContainer.innerHTML = '<div class="empty">Abgegeben</div>';
    els.pollVoteBtn.disabled = true;
    els.pollBox.style.display = 'none';
    flashSend(els.pollVoteBtn);
  };

  els.leaveBtn.onclick = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'leave' });
    state.currentRoom = null;
    els.roomSelect.value = '';
    els.readyBtn.disabled = true;
    els.leaveBtn.disabled = true;
    els.withdrawBtn.disabled = true;
    renderCalled(false);
    state.group = null;
    renderGroup();
    state.activeQuestionnaire = null;
    if (state.questionnaire.slot !== 'default') {
      state.questionnaire.open = false;
      state.questionnaire.data = null;
      state.questionnaire.answers = {};
      state.questionnaire.loading = false;
      state.questionnaire.slot = 'default';
      renderQuestionnaire();
    }
    updateStatsMode();
  };

  els.calledBox.onclick = () => {
    renderCalled(false);
  };

  if (els.questionnaireClose) {
    els.questionnaireClose.onclick = () => {
      state.questionnaire.open = false;
      state.questionnaire.data = null;
      state.questionnaire.loading = false;
      if (state.questionnaire.slot !== 'default') {
        state.questionnaire.slot = 'default';
      }
      renderQuestionnaire();
    };
  }
  if (els.questionnaireTeacher) {
    els.questionnaireTeacher.onchange = () => {
      state.questionnaire.teacherId = els.questionnaireTeacher.value || '';
      state.questionnaire.data = null;
      state.questionnaire.loading = false;
      if (state.questionnaire.teacherId) {
        const slot = state.questionnaire.slot || 'default';
        sendJson({ type: 'questionnaireRequest', role: 'student', teacherId: state.questionnaire.teacherId, slot });
      }
    };
  }
  if (els.questionnaireQuestions) {
    els.questionnaireQuestions.onclick = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName !== 'BUTTON') return;
      const parent = target.closest('[data-q]');
      if (!parent) return;
      const qid = parent.getAttribute('data-q');
      const val = Number(target.getAttribute('data-val'));
      if (!qid || !Number.isFinite(val)) return;
      state.questionnaire.answers[qid] = val;
      renderQuestionnaire();
    };
  }
  if (els.questionnaireSend) {
    els.questionnaireSend.onclick = () => {
      if (!state.questionnaire.data || !state.questionnaire.teacherId) return;
      const questions = Array.isArray(state.questionnaire.data.questions) ? state.questionnaire.data.questions : [];
      if (!questions.length) return;
      const answers = questions.map((q) => ({ id: q.id, value: state.questionnaire.answers[q.id] }));
      const missing = answers.some((a) => {
        const val = Number(a.value);
        if (!Number.isFinite(val)) return true;
        const q = questions.find((qItem) => qItem.id === a.id);
        if (!q) return true;
        const scale = resolveQuestionScale(state.questionnaire.data, q);
        if (scale.type === 'yesno') return !(val === 0 || val === 1);
        return val < scale.min || val > scale.max;
      });
      if (missing) return;
      const text = els.questionnaireText.value.trim();
      sendJson({
        type: 'questionnaireSubmit',
        teacherId: state.questionnaire.teacherId,
        subject: state.questionnaire.subject,
        slot: state.questionnaire.slot || 'default',
        answers,
        text,
      });
      flashSend(els.questionnaireSend);
      els.questionnaireText.value = '';
      state.questionnaire.open = false;
      state.questionnaire.data = null;
      state.questionnaire.answers = {};
      state.questionnaire.loading = false;
      state.questionnaire.slot = 'default';
      renderQuestionnaire();
    };
  }
}