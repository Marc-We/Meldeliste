import { state } from './state.js';
import { els } from './dom.js';
import { renderProfileInfo } from './ui.js';
import { renderClassOptions, updateStatsMode } from './render.js';
import { bindHandlers } from './handlers.js';
import { connect } from './ws.js';

function loadSavedProfile() {
  const saved = localStorage.getItem('meldelisteProfile');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.profile = { ...state.profile, ...parsed, role: 'student' };
      els.emailInput.value = state.profile.email || '';
      els.firstNameInput.value = state.profile.firstName || '';
      els.lastNameInput.value = state.profile.lastName || '';
      els.classInput.value = state.profile.className || '';
    } catch (e) {}
  }
  renderProfileInfo();
}

els.questionText.placeholder = 'Deine Frage oder Gedanken';
bindHandlers();
loadSavedProfile();
renderClassOptions();
updateStatsMode();
connect();
