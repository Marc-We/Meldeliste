import { state } from './state.js';
import { els } from './dom.js';
import { setVisible } from './ui.js';
import { requestSubjectStats, sendJoin } from './api.js';

export function renderHomework() {
  if (!state.homeworkItems.length) {
    els.homeworkList.innerHTML = '<div class="empty">Keine Hausaufgaben</div>';
    els.homeworkPanel.style.display = 'none';
    return;
  }
  els.homeworkPanel.style.display = 'block';
  els.homeworkList.innerHTML = state.homeworkItems.map((item) => {
    const hw = item.homework || {};
    const cur = hw.current?.text || '';
    return `<div class="card"><h3 style="margin:0 0 4px;">${item.subject || 'Fach'}</h3><div class="small">${item.className || ''}</div><div>${cur}</div></div>`;
  }).join('');
}

export function renderRooms() {
  els.roomSelect.innerHTML = '';
  const activeRooms = state.rooms
    .filter((r) => r.active !== false)
    .filter((r) => {
      if (!state.profile.className) return true;
      const classes = Array.isArray(r.classNames) && r.classNames.length ? r.classNames : (r.className ? [r.className] : []);
      if (!classes.length) return true;
      return classes.includes(state.profile.className);
    });
  if (activeRooms.length === 0) {
    els.roomSelect.innerHTML = '<option value="">Keine aktiven RÃ¤ume</option>';
    els.readyBtn.disabled = true;
    els.leaveBtn.disabled = true;
    els.withdrawBtn.disabled = true;
    return;
  }
  activeRooms.forEach((room) => {
    const opt = document.createElement('option');
    opt.value = room.id;
    opt.textContent = `${room.name} (${room.subject})`;
    els.roomSelect.appendChild(opt);
  });
  if (state.currentRoom) {
    els.roomSelect.value = state.currentRoom;
  } else {
    els.roomSelect.selectedIndex = 0;
    state.currentRoom = els.roomSelect.value || null;
    if (state.currentRoom) sendJoin(state.currentRoom);
  }
  els.readyBtn.disabled = !state.currentRoom;
  els.leaveBtn.disabled = !state.currentRoom;
  els.sendQuestionBtn.disabled = !state.currentRoom;
  updateStatsMode();
}

export function renderClassOptions() {
  const prev = els.classInput.value;
  els.classInput.innerHTML = '<option value="">Klasse waehlen</option>';
  state.classCatalog.forEach((cls) => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    els.classInput.appendChild(opt);
  });
  if (prev && state.classCatalog.includes(prev)) {
    els.classInput.value = prev;
  }
}

export function renderCalled(on) {
  els.calledBox.classList.toggle('show', on);
}

export function renderLog() {
  if (!state.myLog.length) {
    els.logBox.innerHTML = '<div class="empty">Noch keine EintrÃ¤ge</div>';
    return;
  }
  const rows = state.myLog.map((entry) => {
    const time = new Date(entry.ts).toLocaleTimeString();
    return `<tr><td>${time}</td><td>${entry.action === 'called' ? 'Aufruf' : ''}</td></tr>`;
  }).join('');
  els.logBox.innerHTML = `<table><thead><tr><th>Zeit</th><th>Aktion</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderStats() {
  const session = state.myStats.session || { signals: 0, calls: 0 };
  const total = state.myStats.total || { signals: 0, calls: 0 };
  els.countSignals.textContent = `${session.signals || 0} / ${total.signals || 0}`;
  els.countCalls.textContent = `${session.calls || 0} / ${total.calls || 0}`;
  const daily = state.myStats.daily || {};
  const days = Object.keys(daily).sort().slice(-5);
  if (!days.length) {
    els.dailyStatsEl.textContent = 'Keine Tagesdaten';
  } else {
    els.dailyStatsEl.textContent = 'Letzte Tage: ' + days.map((d) => `${d}: M ${daily[d].signals || 0} Â· A ${daily[d].calls || 0}`).join(' | ');
  }
}

export function renderSubjectStats() {
  if (!state.subjectStats.length) {
    els.subjectGrid.innerHTML = '<div class="empty">Keine Daten</div>';
    els.subjectDetail.innerHTML = '<div class="empty">Keine Details</div>';
    return;
  }
  els.subjectGrid.innerHTML = state.subjectStats.map((s) => {
    const total = s.total || { signals: 0, calls: 0 };
    return `
      <div class="card clickable" data-subject="${s.subject}">
        <h3>${s.subject}</h3>
        <div class="num">M ${total.signals || 0} Â· A ${total.calls || 0}</div>
      </div>
    `;
  }).join('');
  els.subjectGrid.querySelectorAll('[data-subject]').forEach((card) => {
    card.onclick = () => {
      state.selectedSubject = card.getAttribute('data-subject') || '';
      renderSubjectDetail();
    };
  });
  if (!state.selectedSubject) {
    state.selectedSubject = state.subjectStats[0]?.subject || '';
  }
  renderSubjectDetail();
}

export function renderSubjectDetail() {
  const entry = state.subjectStats.find((s) => s.subject === state.selectedSubject);
  if (!entry || !entry.sessions || !entry.sessions.length) {
    els.subjectDetail.innerHTML = '<div class="empty">Keine Details</div>';
    return;
  }
  const rows = entry.sessions.map((s) => {
    const time = s.createdAt ? new Date(s.createdAt).toLocaleString() : '-';
    const stats = s.stats || {};
    return `<tr><td>${time}</td><td>${s.name || '-'}</td><td>${s.className || '-'}</td><td>${stats.signals || 0}</td><td>${stats.calls || 0}</td></tr>`;
  }).join('');
  els.subjectDetail.innerHTML = `<table><thead><tr><th>Zeit</th><th>Raum</th><th>Klasse</th><th>Meldungen</th><th>Aufrufe</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderPoll() {
  if (!state.poll) {
    els.pollContainer.innerHTML = '<div class="empty">Keine Umfrage</div>';
    els.pollVoteBtn.disabled = true;
    els.pollBox.style.display = 'none';
    return;
  }
  if (state.poll.voted) {
    els.pollContainer.innerHTML = '<div class="empty">Abgegeben</div>';
    els.pollVoteBtn.disabled = true;
    els.pollBox.style.display = 'none';
    return;
  }
  if (state.poll.open === false) {
    els.pollContainer.innerHTML = '<div class="empty">Umfrage beendet</div>';
    els.pollVoteBtn.disabled = true;
    els.pollBox.style.display = 'block';
    return;
  }
  els.pollBox.style.display = 'block';
  state.pollCollapsed = false;
  els.pollContainer.innerHTML = `
    <div class="card">
      <h3 style="margin:0 0 6px;">${state.poll.question}</h3>
      ${state.poll.options.map((opt) => {
        const inputType = state.poll.multiple ? 'checkbox' : 'radio';
        const checked = state.pollSelection.includes(opt.id) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:8px;margin:4px 0;"><input type="${inputType}" name="pollopt" value="${opt.id}" ${checked}>${opt.text}</label>`;
      }).join('')}
    </div>
  `;
  els.pollVoteBtn.disabled = false;
}

export function renderThoughtState() {
  if (state.thoughtActive) {
    els.thoughtState.textContent = 'Gedankenrunde aktiv â€“ schreibe deine Gedanken und sende sie.';
    els.thoughtPanel.style.display = 'block';
  } else {
    els.thoughtState.textContent = 'Nicht aktiv';
    els.thoughtPanel.style.display = 'none';
  }
}

export function updateStatsMode() {
  const hasRoom = Boolean(state.currentRoom);
  els.statsTitle.textContent = hasRoom ? 'Deine Stunde' : 'Deine Statistiken';
  setVisible(els.sessionStats, hasRoom);
  setVisible(els.subjectStatsEl, !hasRoom);
  if (!hasRoom) {
    requestSubjectStats();
  }
}
