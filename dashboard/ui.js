import { state } from './state.js';
import { els } from './dom.js';

export function setConnection(ok) {
  els.dot.classList.toggle('ok', ok);
  els.connText.textContent = ok ? 'Verbunden' : 'Getrennt';
}

export function setVisible(el, show) {
  if (!el) return;
  el.style.display = show ? '' : 'none';
}

export function setAuthStatus(text) {
  els.authStatus.textContent = text || '';
}

export function renderAuthFields() {
  const isRegister = state.authMode === 'register';
  const isLogin = state.authMode === 'login';
  const isVerify = state.authMode === 'verify';
  const isResetRequest = state.authMode === 'reset-request';
  const isResetConfirm = state.authMode === 'reset-confirm';

  setVisible(els.emailRow, true);
  setVisible(els.salutationRow, isRegister);
  setVisible(els.lastNameRow, isRegister);
  setVisible(els.passwordRow, isRegister || isLogin || isResetConfirm);
  setVisible(els.confirmRow, isRegister || isResetConfirm);
  setVisible(els.codeRow, isVerify || isResetConfirm);
  setVisible(els.forgotBtn, isLogin);

  if (isRegister) els.saveProfileBtn.textContent = 'Registrieren';
  if (isLogin) els.saveProfileBtn.textContent = 'Anmelden';
  if (isVerify) els.saveProfileBtn.textContent = 'Code bestaetigen';
  if (isResetRequest) els.saveProfileBtn.textContent = 'Code senden';
  if (isResetConfirm) els.saveProfileBtn.textContent = 'Passwort speichern';

  els.modeRegisterBtn.classList.toggle('primary', isRegister);
  els.modeLoginBtn.classList.toggle('primary', isLogin);
  els.modeRegisterBtn.classList.toggle('ghost', !isRegister);
  els.modeLoginBtn.classList.toggle('ghost', !isLogin);
  setVisible(els.modeRegisterBtn, true);
  setVisible(els.modeLoginBtn, true);
}

export function renderProfileInfo() {
  if (!state.profile.userId) {
    els.profileInfo.textContent = 'Noch kein Profil gespeichert';
  } else {
    els.profileInfo.textContent = `Eingeloggt als ${state.profile.salutation || ''} ${state.profile.lastName || ''} (${state.profile.email || '-'})`;
  }
  renderAuthFields();
}

export function setPanelVisible(panel, show) {
  if (!panel) return;
  panel.style.display = show ? '' : 'none';
}

export function updateLayout() {
  const hasRoom = Boolean(state.currentRoom);
  setPanelVisible(els.profilePanel, !hasRoom);
  setPanelVisible(els.catalogPanel, !hasRoom && (state.profile.role === 'admin'));
  setPanelVisible(els.roomsPanel, true);
  setPanelVisible(els.teachingsPanel, true);
  setPanelVisible(els.currentRoomPanel, hasRoom);
  setPanelVisible(els.questionBanner, hasRoom);
  setPanelVisible(els.questionsPanel, hasRoom);
  setPanelVisible(els.logPanel, hasRoom);
  setPanelVisible(els.homeworkPanel, hasRoom);
  setPanelVisible(els.statsPanel, hasRoom);
  setPanelVisible(els.toolsPanel, hasRoom);
  setPanelVisible(els.classStatsPanel, Boolean(state.classStats.className));

  const order = hasRoom
    ? [els.currentRoomPanel, els.questionBanner, els.questionsPanel, els.logPanel, els.homeworkPanel, els.statsPanel, els.toolsPanel, els.teachingsPanel, els.classStatsPanel, els.roomsPanel]
    : [els.profilePanel, els.catalogPanel, els.roomsPanel, els.teachingsPanel, els.classStatsPanel];
  order.forEach((panel) => {
    if (panel && panel.parentElement === els.layout) {
      els.layout.appendChild(panel);
    }
  });
}
