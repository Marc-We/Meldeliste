import { state } from './state.js';
import { els } from './dom.js';
import { sendJson, sendJoin } from './api.js';
import { renderAuthFields, renderProfileInfo, setAuthStatus } from './ui.js';
import { renderCalled, renderRooms, updateStatsMode } from './render.js';

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
        setAuthStatus('Bitte alle Felder ausfuellen.');
        return;
      }
      if (password !== passwordConfirm) {
        setAuthStatus('Passwoerter stimmen nicht ueberein.');
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
    state.currentRoom = els.roomSelect.value || null;
    if (state.currentRoom) {
      sendJoin(state.currentRoom);
      els.readyBtn.disabled = false;
      els.leaveBtn.disabled = false;
      els.withdrawBtn.disabled = true;
      renderCalled(false);
    } else {
      els.readyBtn.disabled = true;
      els.leaveBtn.disabled = true;
      els.withdrawBtn.disabled = true;
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
    updateStatsMode();
  };

  els.calledBox.onclick = () => {
    renderCalled(false);
  };
}
