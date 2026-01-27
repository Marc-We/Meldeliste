import { state } from './state.js';
import { els } from './dom.js';
import { renderProfileInfo, updateLayout } from './ui.js';
import { renderMembers } from './render.js';
import { bindHandlers } from './handlers.js';
import { connect } from './ws.js';

function loadSavedProfile() {
  const saved = localStorage.getItem('meldelisteProfileTeacher');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.profile = { ...state.profile, ...parsed };
      els.emailInput.value = state.profile.email || '';
      els.salutationInput.value = state.profile.salutation || 'Herr';
      els.lastNameInput.value = state.profile.lastName || '';
    } catch (e) {}
  }
  renderProfileInfo();
}

bindHandlers();
loadSavedProfile();
setInterval(() => {
  if (state.currentRoom) renderMembers();
}, 10000);
updateLayout();
connect();
