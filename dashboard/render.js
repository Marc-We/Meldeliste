import { state } from './state.js';
import { els } from './dom.js';
import { sendJson, sendJoin } from './api.js';
import { setPanelVisible, updateLayout } from './ui.js';

function formatDuration(start) {
  if (!start) return '-';
  const diff = Date.now() - start;
  const sec = Math.round(diff / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function renderRooms() {
  els.roomListEl.innerHTML = '';
  if (!state.rooms.length) {
    els.roomListEl.innerHTML = '<div class="small">Keine RÃ¤ume vorhanden</div>';
    return;
  }
  state.rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-card';
    const classesLabel = Array.isArray(room.classNames) && room.classNames.length ? room.classNames.join(', ') : (room.className || '-');
    card.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: center;">
        <h3>${room.name}</h3>
        <div class="pill">${room.active === false ? 'geschlossen' : 'aktiv'}</div>
      </div>
      <div class="meta">Klassen: ${classesLabel}</div>
      <div class="row">
        <button class="ghost" data-join="${room.id}" ${room.active === false ? 'disabled' : ''}>Ã–ffnen</button>
        <button class="danger" data-close="${room.id}" ${room.active === false ? 'disabled' : ''}>SchlieÃŸen</button>
      </div>
    `;
    els.roomListEl.appendChild(card);
  });

  els.roomListEl.querySelectorAll('[data-join]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-join');
      state.currentRoom = id;
      sendJoin(id);
      renderCurrentRoom();
    };
  });
  els.roomListEl.querySelectorAll('[data-close]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-close');
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: 'roomClose', roomId: id });
      if (state.currentRoom === id) {
        state.currentRoom = null;
        renderCurrentRoom();
      }
    };
  });
}

export function renderCatalogs() {
  const cls = state.classCatalog.length ? state.classCatalog.join(', ') : 'Keine Klassen';
  const subs = state.subjectCatalog.length ? state.subjectCatalog.join(', ') : 'Keine FÃ¤cher';
  els.catalogInfo.textContent = `Klassen: ${cls} | FÃ¤cher: ${subs}`;

  const fillSelect = (el, data, label) => {
    const prev = el.value;
    el.innerHTML = `<option value="">${label}</option>`;
    data.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      el.appendChild(opt);
    });
    if (prev && data.includes(prev)) el.value = prev;
  };

  const fillChecklist = (el, data) => {
    const prev = Array.from(el.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
    el.innerHTML = data.map((item) => {
      const checked = prev.includes(item) ? 'checked' : '';
      return `<label class="item"><input type="checkbox" value="${item}" ${checked}>${item}</label>`;
    }).join('');
  };

  fillSelect(els.roomSubjectInput, state.subjectCatalog, 'Fach wÃ¤hlen');
  fillSelect(els.teachSubjectSelect, state.subjectCatalog, 'Fach wÃ¤hlen');
  if (els.codeClassSelect) fillSelect(els.codeClassSelect, state.classCatalog, 'Klasse waehlen');
  fillChecklist(els.roomClassList, state.classCatalog);
  fillChecklist(els.teachClassList, state.classCatalog);
}

function formatExpiry(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString();
}

export function renderCodes() {
  if (!els.classCodeInfo) return;
  if (!state.classCode) {
    els.classCodeInfo.textContent = 'Kein Code geladen';
    return;
  }
  const entry = state.classCode;
  const label = entry.className ? `${entry.className}: ${entry.code}` : entry.code;
  els.classCodeInfo.textContent = `${label} (gueltig bis ${formatExpiry(entry.expiresAt)})`;
}

export function renderAdminPanel() {
  if (els.teacherCodeInfo) {
    if (!state.teacherCode) {
      els.teacherCodeInfo.textContent = 'Kein Code geladen';
    } else {
      els.teacherCodeInfo.textContent = `${state.teacherCode.code} (gueltig bis ${formatExpiry(state.teacherCode.expiresAt)})`;
    }
  }
  if (els.pendingTeachers) {
    if (!state.pendingTeachers || !state.pendingTeachers.length) {
      els.pendingTeachers.innerHTML = '<div class="small">Keine Anfragen</div>';
    } else {
      els.pendingTeachers.innerHTML = state.pendingTeachers.map((t) => `
        <div class="row" style="justify-content: space-between; align-items: center; margin-top:6px;">
          <div>${t.name || 'Lehrer'} (${t.email || '-'})</div>
          <div class="row">
            <button class="primary" data-approve="${t.id}">Freigeben</button>
            <button class="danger" data-deny="${t.id}">Ablehnen</button>
          </div>
        </div>
      `).join('');
    }
    els.pendingTeachers.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.onclick = () => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        const userId = btn.getAttribute('data-approve');
        if (!userId) return;
        sendJson({ type: 'teacherApprove', userId });
      };
    });
    els.pendingTeachers.querySelectorAll('[data-deny]').forEach((btn) => {
      btn.onclick = () => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        const userId = btn.getAttribute('data-deny');
        if (!userId) return;
        sendJson({ type: 'teacherDeny', userId });
      };
    });
  }
  if (els.moveStudentSelect) {
    const prev = els.moveStudentSelect.value;
    els.moveStudentSelect.innerHTML = '<option value="">SchÃ¼ler wÃ¤hlen</option>';
    (state.adminStudents || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.className || '-'})`;
      els.moveStudentSelect.appendChild(opt);
    });
    if (prev && (state.adminStudents || []).some((s) => s.id === prev)) {
      els.moveStudentSelect.value = prev;
    }
  }
  if (els.moveClassSelect) {
    const prevClass = els.moveClassSelect.value;
    els.moveClassSelect.innerHTML = '<option value="">Klasse wÃ¤hlen</option>';
    (state.classCatalog || []).forEach((cls) => {
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = cls;
      els.moveClassSelect.appendChild(opt);
    });
    if (prevClass && (state.classCatalog || []).includes(prevClass)) {
      els.moveClassSelect.value = prevClass;
    }
  }
  if (els.banList) {
    const emails = (state.bans && Array.isArray(state.bans.emails)) ? state.bans.emails : [];
    const ips = (state.bans && Array.isArray(state.bans.ips)) ? state.bans.ips : [];
    if (!emails.length && !ips.length) {
      els.banList.innerHTML = 'Keine EintrÃ¤ge';
    } else {
      const emailRows = emails.map((e) => `<div class="row" style="justify-content: space-between; align-items:center; margin-top:4px;"><div>${e}</div><button class="ghost" data-unban-email="${e}">Entfernen</button></div>`).join('');
      const ipRows = ips.map((ip) => `<div class="row" style="justify-content: space-between; align-items:center; margin-top:4px;"><div>${ip}</div><button class="ghost" data-unban-ip="${ip}">Entfernen</button></div>`).join('');
      els.banList.innerHTML = `
        ${emails.length ? `<div><strong>E-Mails</strong>${emailRows}</div>` : ''}
        ${ips.length ? `<div style="margin-top:6px;"><strong>IPs</strong>${ipRows}</div>` : ''}
      `;
    }
    els.banList.querySelectorAll('[data-unban-email]').forEach((btn) => {
      btn.onclick = () => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        const value = btn.getAttribute('data-unban-email');
        if (!value) return;
        sendJson({ type: 'banRemove', kind: 'email', value });
      };
    });
    els.banList.querySelectorAll('[data-unban-ip]').forEach((btn) => {
      btn.onclick = () => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        const value = btn.getAttribute('data-unban-ip');
        if (!value) return;
        sendJson({ type: 'banRemove', kind: 'ip', value });
      };
    });
  }
}

export function renderTeacherInbox() {
  if (!els.teacherInbox) return;
  if (!state.teacherInbox || !state.teacherInbox.length) {
    els.teacherInbox.innerHTML = '<div class="small">Keine Nachrichten</div>';
    return;
  }
  els.teacherInbox.innerHTML = state.teacherInbox.map((item) => {
    const time = new Date(item.ts || Date.now()).toLocaleString();
    const from = item.fromName || 'SchÃ¼ler';
    const subject = item.subject || 'Fach';
    const answers = (item.answers || []).map((a) => `${a.id}: ${a.value}`).join(' | ');
    const text = item.text ? `<div style="margin-top:6px;">${item.text}</div>` : '';
    return `
      <div class="inbox-item">
        <div><strong>${from}</strong> â€“ ${subject}</div>
        <div class="small">${time}</div>
        <div class="small">${answers}</div>
        ${text}
      </div>
    `;
  }).join('');
}

export function renderFeedbackForm() {
  if (!els.feedbackQuestions) return;
  if (els.feedbackSubjectInput && state.classStats.subject) {
    els.feedbackSubjectInput.value = state.classStats.subject;
  }
  if (els.feedbackStudentSelect) {
    const prev = els.feedbackStudentSelect.value;
    els.feedbackStudentSelect.innerHTML = '<option value="">SchÃ¼ler wÃ¤hlen</option>';
    const list = Array.isArray(state.classStats.students) ? state.classStats.students : [];
    list.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.userId;
      opt.textContent = s.name || s.userId;
      els.feedbackStudentSelect.appendChild(opt);
    });
    if (prev && list.some((s) => s.userId === prev)) {
      els.feedbackStudentSelect.value = prev;
    }
  }
  const questions = Array.isArray(state.questionnaireTeacher?.questions) ? state.questionnaireTeacher.questions : [];
  if (!questions.length) {
    els.feedbackQuestions.innerHTML = '<div class="small">Kein Feedback-Fragebogen vorhanden.</div>';
    return;
  }
  const scaleHint = state.questionnaireTeacher?.scaleHint || '1 = trifft nicht zu, 5 = trifft voll zu';
  els.feedbackQuestions.innerHTML = questions.map((q) => {
    const current = state.feedbackAnswers[q.id];
    return `
      <div class="q-item">
        <div>${q.text}</div>
        <div class="rating" data-q="${q.id}">
          ${[1,2,3,4,5].map((v) => `<button class="${current === v ? 'active' : ''}" data-val="${v}">${v}</button>`).join('')}
        </div>
        <div class="small">${scaleHint}</div>
      </div>
    `;
  }).join('');
}

export function renderQuestionnaireEditor() {
  if (!els.questionnaireTypeSelect) return;
  const type = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
  const data = type === 'teacher' ? state.questionnaireTeacher : state.questionnaireStudent;
  if (data) {
    if (els.questionnaireTitleInput) els.questionnaireTitleInput.value = data.title || '';
    if (els.questionnaireQuestionsInput) {
      const text = Array.isArray(data.questions) ? data.questions.map((q) => q.text).join('\n') : '';
      els.questionnaireQuestionsInput.value = text;
    }
  }
}

export function renderTeachings() {
  const list = Array.isArray(state.profile.teachings) ? state.profile.teachings : [];
  if (!list.length) {
    els.teachingsList.innerHTML = '<div class="small">Keine EintrÃ¤ge</div>';
    return;
  }
  const classesLabel = (t) => Array.isArray(t.classNames) && t.classNames.length ? t.classNames.join(', ') : (t.className || '');
  const classesValue = (t) => Array.isArray(t.classNames) && t.classNames.length ? t.classNames.join('|') : (t.className || '');
  els.teachingsList.innerHTML = list.map((t) => `
    <div class="stat-card clickable" data-classnames="${classesValue(t)}" data-subject="${t.subject}">
      <h4>${classesLabel(t)}</h4>
      <div class="small">${t.subject}</div>
      <div class="row" style="margin-top:8px;">
        <button class="primary" data-create-room="${classesValue(t)}|${t.subject}">Raum starten</button>
      </div>
    </div>
  `).join('');
  els.teachingsList.querySelectorAll('[data-classnames]').forEach((card) => {
    card.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const classNamesRaw = card.getAttribute('data-classnames') || '';
      const subject = card.getAttribute('data-subject');
      const classNames = classNamesRaw.split('|').map((c) => c.trim()).filter(Boolean);
      if (!classNames.length) return;
      sendJson({ type: 'classStats', classNames, subject });
    };
  });
  els.teachingsList.querySelectorAll('[data-create-room]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const payload = btn.getAttribute('data-create-room') || '';
      const parts = payload.split('|');
      const subject = parts.pop();
      const classNamesRaw = parts.join('|');
      const classNames = (classNamesRaw || '').split('|').map((c) => c.trim()).filter(Boolean);
      if (!classNames.length || !subject) return;
      sendJson({ type: 'roomCreate', name: `${subject} ${classNames.join(', ')}`, classNames, subject });
    };
  });
}

export function renderCurrentRoom() {
  const room = state.rooms.find((r) => r.id === state.currentRoom);
  if (!room) {
    els.currentRoomInfo.textContent = 'Kein Raum ausgewÃ¤hlt';
    els.closeRoomBtn.disabled = true;
    els.membersBoard.innerHTML = '';
    els.logBox.innerHTML = '<div class="small">Noch keine EintrÃ¤ge</div>';
    els.statsGrid.innerHTML = '';
    updateLayout();
    return;
  }
  const roomClasses = Array.isArray(room.classNames) && room.classNames.length ? room.classNames.join(', ') : (room.className || '-');
  els.currentRoomInfo.textContent = `${room.name} (Klassen ${roomClasses})`;
  els.closeRoomBtn.disabled = room.active === false;
  renderMembers();
  renderLog();
  renderStats();
  updateLayout();
}

export function renderMembers() {
  const room = state.rooms.find((r) => r.id === state.currentRoom);
  if (!room) {
    els.membersBoard.innerHTML = '';
    return;
  }
  const members = Array.from(state.presence.values()).filter((m) => m.role !== 'teacher' && m.role !== 'admin');
  if (!members.length) {
    els.membersBoard.innerHTML = '<div class="small" style="padding:10px;">Noch keine Teilnehmer</div>';
    return;
  }
  const rows = members.map((m) => `
    <div class="member-row ${m.ready ? 'ready' : ''}">
      <div></div>
      <div>
        <div>${m.name}</div>
        <div class="meta-line">${m.online ? 'online' : 'offline'}</div>
      </div>
      <div class="ratings" data-user="${m.userId}">
        <button data-call="only">Aufrufen</button>
        ${['--','-','0','+','++'].map((r) => `<button data-rating="${r}">${r}</button>`).join(' ')}
        ${state.toiletStates.get(m.userId)?.status === 'pending' ? '<button data-allow="toilet">Erlauben</button>' : ''}
        ${state.toiletStates.get(m.userId)?.status === 'allowed' ? `<span class="small">Toilette seit ${formatDuration(state.toiletStates.get(m.userId)?.start)}</span>` : ''}
        ${m.important ? '<button data-important="clear">Wichtig erledigt</button>' : ''}
      </div>
    </div>
  `).join('');
  els.membersBoard.innerHTML = rows;

  els.membersBoard.querySelectorAll('.ratings button').forEach((btn) => {
    btn.onclick = () => {
      const userId = btn.parentElement.getAttribute('data-user');
      const ratingAttr = btn.getAttribute('data-rating');
      const isCallOnly = btn.getAttribute('data-call') === 'only';
      const isAllowToilet = btn.getAttribute('data-allow') === 'toilet';
      const impAction = btn.getAttribute('data-important');
      if (!state.currentRoom || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;

      if (isCallOnly) {
        sendJson({ type: 'ack', roomId: state.currentRoom, userId });
        return;
      }
      if (isAllowToilet) {
        sendJson({ type: 'toiletAllow', roomId: state.currentRoom, userId });
        return;
      }
      if (impAction === 'clear') {
        sendJson({ type: 'importantClear', roomId: state.currentRoom, userId });
        return;
      }
      if (impAction === 'set') {
        sendJson({ type: 'important', roomId: state.currentRoom });
        return;
      }

      if (ratingAttr) {
        sendJson({ type: 'rate', roomId: state.currentRoom, userId, rating: ratingAttr });
      }
    };
  });
}

export function renderLog() {
  if (!state.logEntries.length) {
    els.logBox.innerHTML = '<div class="small">Noch keine EintrÃ¤ge</div>';
    return;
  }
  const rows = state.logEntries.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString();
    const action = e.action === 'rating' ? 'Bewertung' : 'Aufruf';
    const rating = e.rating ? e.rating : '';
    return `<tr><td>${time}</td><td>${e.name}</td><td>${action}</td><td>${rating}</td><td><button class="ghost trash" data-log="${e.id}">ðŸ—‘</button></td></tr>`;
  }).join('');
  els.logBox.innerHTML = `<table><thead><tr><th>Zeit</th><th>Name</th><th>Aktion</th><th>Bew.</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  els.logBox.querySelectorAll('[data-log]').forEach((btn) => {
    btn.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentRoom) return;
      const logId = btn.getAttribute('data-log');
      if (!logId) return;
      sendJson({ type: 'logDelete', roomId: state.currentRoom, logId });
    };
  });
}

export function renderStats() {
  if (!state.stats.length) {
    els.statsGrid.innerHTML = '<div class="small">Keine Daten</div>';
    return;
  }
  els.statsGrid.innerHTML = state.stats.map((s) => {
    const session = s.session || { signals: 0, calls: 0 };
    const total = s.total || { signals: 0, calls: 0, ratings: { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 }, toiletSeconds: 0 };
    const ratings = total.ratings || {};
    return `
    <div class="stat-card">
      <h4>${s.name}</h4>
      <div class="small">Stunde: Meldungen ${session.signals || 0} Â· Aufrufe ${session.calls || 0}</div>
      <div class="small">Gesamt: Meldungen ${total.signals || 0} Â· Aufrufe ${total.calls || 0}</div>
      <div class="small">Bew.: -- ${ratings['--'] || 0} | - ${ratings['-'] || 0} | 0 ${ratings['0'] || 0} | + ${ratings['+'] || 0} | ++ ${ratings['++'] || 0}</div>
    </div>`;
  }).join('');
}

export function renderClassStats() {
  if (!state.classStats.className) {
    els.classStudentPanel.style.display = 'none';
    els.classStatsPanel.style.display = 'none';
    return;
  }
  const subjectLabel = state.classStats.subject ? ` Â· Fach ${state.classStats.subject}` : '';
  const classLabel = (state.classStats.classNames && state.classStats.classNames.length) ? state.classStats.classNames.join(', ') : state.classStats.className;
  els.classStatsTitle.textContent = `Klassen ${classLabel}${subjectLabel}`;
  if (!state.classStats.students.length) {
    els.classStudentPanel.style.display = 'none';
    els.classStatsGrid.innerHTML = '<div class="small">Keine Daten</div>';
    els.classStatsPanel.style.display = 'block';
    return;
  }
  els.classStatsGrid.innerHTML = state.classStats.students.map((s) => {
    const total = s.total || { signals: 0, calls: 0, ratings: { '--': 0, '-': 0, '0': 0, '+': 0, '++': 0 } };
    const ratings = total.ratings || {};
    return `
      <div class="stat-card clickable" data-user="${s.userId}">
        <h4>${s.name}</h4>
        <div class="small">Gesamt: Meldungen ${total.signals || 0} Â· Aufrufe ${total.calls || 0}</div>
        <div class="small">Bew.: -- ${ratings['--'] || 0} | - ${ratings['-'] || 0} | 0 ${ratings['0'] || 0} | + ${ratings['+'] || 0} | ++ ${ratings['++'] || 0}</div>
        <div class="row" style="margin-top:8px;">
          <button class="ghost" data-report="${s.userId}">Melden</button>
          <button class="danger" data-kick="${s.userId}">Kurs entfernen</button>
          <button class="danger" data-ban="${s.userId}">Bannen</button>
        </div>
      </div>`;
  }).join('');
  els.classStatsGrid.querySelectorAll('[data-user]').forEach((card) => {
    card.onclick = () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const userId = card.getAttribute('data-user');
      if (!userId) return;
      sendJson({ type: 'classStudentStats', className: state.classStats.className, classNames: state.classStats.classNames, subject: state.classStats.subject, userId });
    };
  });
  els.classStatsGrid.querySelectorAll('[data-report]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const userId = btn.getAttribute('data-report');
      if (!userId) return;
      sendJson({ type: 'courseReport', userId, subject: state.classStats.subject || 'default' });
    };
  });
  els.classStatsGrid.querySelectorAll('[data-kick]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const userId = btn.getAttribute('data-kick');
      if (!userId) return;
      sendJson({ type: 'courseKick', userId, subject: state.classStats.subject || 'default' });
    };
  });
  els.classStatsGrid.querySelectorAll('[data-ban]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const userId = btn.getAttribute('data-ban');
      if (!userId) return;
      sendJson({ type: 'banStudent', userId, subject: state.classStats.subject || 'default' });
    };
  });
  els.classStatsPanel.style.display = 'block';
  renderClassStudentStats();
}

export function renderClassStudentStats() {
  if (!state.classStudentStats.student) {
    els.classStudentPanel.style.display = 'none';
    return;
  }
  const subjectLabel = state.classStudentStats.subject ? ` Â· Fach ${state.classStudentStats.subject}` : '';
  const classLabel = (state.classStudentStats.classNames && state.classStudentStats.classNames.length) ? state.classStudentStats.classNames.join(', ') : state.classStudentStats.className;
  els.classStudentTitle.textContent = `${state.classStudentStats.student.name} (Klassen ${classLabel}${subjectLabel})`;
  const sessions = state.classStudentStats.sessions || [];
  if (!sessions.length) {
    els.classStudentTable.innerHTML = '<div class="small">Keine Daten</div>';
    els.classStudentPanel.style.display = 'block';
    return;
  }
  const rows = sessions.map((s) => {
    const time = s.createdAt ? new Date(s.createdAt).toLocaleString() : '-';
    const stats = s.stats || {};
    const ratings = stats.ratings || {};
    const ratingText = `-- ${ratings['--'] || 0} | - ${ratings['-'] || 0} | 0 ${ratings['0'] || 0} | + ${ratings['+'] || 0} | ++ ${ratings['++'] || 0}`;
    return `<tr><td>${time}</td><td>${s.name || '-'}</td><td>${s.subject || 'default'}</td><td>${stats.signals || 0}</td><td>${stats.calls || 0}</td><td>${ratingText}</td></tr>`;
  }).join('');
  els.classStudentTable.innerHTML = `<table><thead><tr><th>Zeit</th><th>Raum</th><th>Fach</th><th>Meldungen</th><th>Aufrufe</th><th>Bewertungen</th></tr></thead><tbody>${rows}</tbody></table>`;
  els.classStudentPanel.style.display = 'block';
}

export function renderPoll() {
  if (!state.poll) {
    els.pollResultsBox.innerHTML = '<div class="small">Keine aktive Umfrage</div>';
    els.endPollBtn.disabled = true;
    return;
  }
  els.endPollBtn.disabled = state.poll.open === false;
  const status = state.poll.open === false ? 'Beendet' : 'Aktiv';
  els.pollResultsBox.innerHTML = `
    <div class="q-item">
      <div>${state.poll.question}</div>
      <div class="q-time">${state.poll.multiple ? 'Mehrfachauswahl' : 'Einzelauswahl'} Â· ${state.poll.anonymous ? 'Anonym' : 'Namen sichtbar'} Â· ${status}</div>
    </div>
    ${state.poll.options.map((o) => `<div class="q-item"><div>${o.text}</div><div class="q-time">${o.count || 0} Stimmen</div></div>`).join('')}
    ${state.poll.anonymous ? '' : `
      <div class="q-item">
        <div class="small">Stimmen</div>
        ${(state.poll.votesList || []).map((v) => {
          const labels = (v.options || []).map((id) => state.poll.options.find((o) => o.id === id)?.text || id);
          return `<div class="small">${v.name}: ${labels.join(', ') || '-'}</div>`;
        }).join('')}
      </div>
    `}
  `;
}

export function renderThoughts() {
  if (!state.thoughts.length) {
    els.thoughtsCloud.innerHTML = '<div class="small">Keine Daten</div>';
    return;
  }
  const max = Math.max(...state.thoughts.map((t) => t.count));
  els.thoughtsCloud.innerHTML = state.thoughts.map((t) => {
    const size = 12 + Math.round((t.count / max) * 18);
    return `<span class="word" style="font-size:${size}px">${t.text} (${t.count})</span>`;
  }).join(' ');
}

export function renderHomework() {
  if (!state.homeworkItems.length) {
    els.homeworkList.innerHTML = '<div class="small">Keine Hausaufgaben</div>';
    return;
  }
  els.homeworkList.innerHTML = state.homeworkItems.map((item) => `
    <div class="homework-card">
      <div class="small">Klasse: ${item.className || '-'} Â· Fach: ${item.subject || 'default'}</div>
      ${item.homework.current ? `<div>Aktuell: ${item.homework.current.text || ''}</div>` : '<div>Aktuell: -</div>'}
      ${item.homework.previous ? `<div class="small">Letzte Stunde: ${item.homework.previous.text || ''}</div>` : ''}
    </div>
  `).join('');
}

export function renderQuestions() {
  if (!state.questions.length) {
    els.questionsBox.innerHTML = '<div class="small">Keine Fragen</div>';
    els.questionBanner.style.display = 'none';
    return;
  }
  const sorted = [...state.questions].sort((a, b) => b.ts - a.ts);
  els.questionsBox.innerHTML = sorted.map((q) => {
    const time = new Date(q.ts).toLocaleTimeString();
    const isAnon = q.anonymous !== false;
    const author = isAnon ? 'Anonym' : (q.name || 'Unbekannt');
    return `<div class="q-item"><div>${q.text}</div><div class="q-time">${time} | ${author}</div></div>`;
  }).join('');
  const latest = sorted[0];
  const latestAuthor = latest.anonymous !== false ? 'Anonym' : (latest.name || 'Unbekannt');
  els.questionBannerText.innerHTML = `<div>${latest.text}</div><div class="q-time">${new Date(latest.ts).toLocaleTimeString()} | ${latestAuthor}</div>`;
  els.questionBanner.style.display = 'block';
}


