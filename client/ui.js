import { state } from './state.js';
import { els } from './dom.js';

export function setVisible(el, show) {
  if (!el) return;
  el.style.display = show ? '' : 'none';
}

export function setConnection(ok) {
  els.dot.classList.toggle('ok', ok);
  els.connText.textContent = ok ? 'Verbunden' : 'Getrennt';
}

export function setAuthStatus(text) {
  els.authStatus.textContent = text || '';
}

export function updateAuthModeButtons() {
  const isRegister = state.authMode === 'register';
  const isLogin = state.authMode === 'login';
  els.modeRegisterBtn.classList.toggle('primary', isRegister);
  els.modeLoginBtn.classList.toggle('primary', isLogin);
  els.modeRegisterBtn.classList.toggle('ghost', !isRegister);
  els.modeLoginBtn.classList.toggle('ghost', !isLogin);
  setVisible(els.modeRegisterBtn, true);
  setVisible(els.modeLoginBtn, true);
}

export function renderAuthFields() {
  const isRegister = state.authMode === 'register';
  const isLogin = state.authMode === 'login';
  const isVerify = state.authMode === 'verify';
  const isResetRequest = state.authMode === 'reset-request';
  const isResetConfirm = state.authMode === 'reset-confirm';

  setVisible(els.emailRow, true);
  setVisible(els.firstNameRow, isRegister);
  setVisible(els.lastNameRow, isRegister);
  setVisible(els.classRow, isRegister);
  setVisible(els.passwordRow, isRegister || isLogin || isResetConfirm);
  setVisible(els.confirmRow, isRegister || isResetConfirm);
  setVisible(els.codeRow, isVerify || isResetConfirm);
  setVisible(els.forgotBtn, isLogin);

  if (isRegister) els.saveProfileBtn.textContent = 'Registrieren';
  if (isLogin) els.saveProfileBtn.textContent = 'Anmelden';
  if (isVerify) els.saveProfileBtn.textContent = 'Code bestaetigen';
  if (isResetRequest) els.saveProfileBtn.textContent = 'Code senden';
  if (isResetConfirm) els.saveProfileBtn.textContent = 'Passwort speichern';

  updateAuthModeButtons();
}

export function renderProfileInfo() {
  if (!state.profile.userId) {
    els.profileInfo.textContent = 'Noch kein Profil gespeichert';
  } else {
    els.profileInfo.textContent = `Eingeloggt als ${state.profile.firstName || ''} ${state.profile.lastName || ''} (${state.profile.email || '-'})`;
  }
  renderAuthFields();
}
