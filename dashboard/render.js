import { state } from './state.js';
import { els } from './dom.js';
import { sendJson, sendJoin } from './api.js';
import { setPanelVisible, updateLayout } from './ui.js';

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(start) {
  if (!start) return '-';
  const diff = Date.now() - start;
  const sec = Math.round(diff / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

export function renderRooms() {
  els.roomListEl.innerHTML = '';
  if (!state.rooms.length) {
    els.roomListEl.innerHTML = '<div class="small">Keine Räume vorhanden</div>';
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
        <button class="ghost" data-join="${room.id}" ${room.active === false ? 'disabled' : ''}>Öffnen</button>
        <button class="danger" data-close="${room.id}" ${room.active === false ? 'disabled' : ''}>Schließen</button>
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
  const subs = state.subjectCatalog.length ? state.subjectCatalog.join(', ') : 'Keine Fächer';
  els.catalogInfo.textContent = `Klassen: ${cls} | Fächer: ${subs}`;

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

  fillSelect(els.roomSubjectInput, state.subjectCatalog, 'Fach wählen');
  fillSelect(els.teachSubjectSelect, state.subjectCatalog, 'Fach wählen');
  if (els.codeClassSelect) fillSelect(els.codeClassSelect, state.classCatalog, 'Klasse wählen');
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
  els.classCodeInfo.textContent = `${label} (gültig bis ${formatExpiry(entry.expiresAt)})`;
}

export function renderAdminPanel() {
  if (els.teacherCodeInfo) {
    if (!state.teacherCode) {
      els.teacherCodeInfo.textContent = 'Kein Code geladen';
    } else {
      els.teacherCodeInfo.textContent = `${state.teacherCode.code} (gültig bis ${formatExpiry(state.teacherCode.expiresAt)})`;
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
    els.moveStudentSelect.innerHTML = '<option value="">Schüler wählen</option>';
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
    els.moveClassSelect.innerHTML = '<option value="">Klasse wählen</option>';
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
      els.banList.innerHTML = 'Keine Einträge';
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
    const from = item.fromName || 'Schüler';
    const subject = item.subject || 'Fach';
    const answersList = Array.isArray(item.answersDetailed) ? item.answersDetailed : (item.answers || []);
    const qMap = new Map((state.questionnaireStudent?.questions || []).map((q) => [q.id, q.text]));
    const answers = answersList.map((a) => `${a.text || qMap.get(a.id) || a.id}: ${a.value}`).join(' | ');
    const text = item.text ? `<div style="margin-top:6px;">${item.text}</div>` : '';
    const deleteBtn = item.id ? `<button class="ghost" data-delete="${item.id}">Löschen</button>` : '';
    return `
      <div class="inbox-item">
        <div class="row" style="justify-content: space-between; align-items:center;">
          <div><strong>${from}</strong> ${subject}</div>
          ${deleteBtn}
        </div>
        <div class="small">${time}</div>
        <div class="small">${answers}</div>
        ${text}
      </div>
    `;
  }).join('');
  els.teacherInbox.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-delete');
      if (!id) return;
      sendJson({ type: 'feedbackDelete', id });
    };
  });
}

export function renderFeedbackForm() {
  if (!els.feedbackQuestions) return;
  if (els.feedbackSubjectInput && state.classStats.subject) {
    els.feedbackSubjectInput.value = state.classStats.subject;
  }
  if (els.feedbackStudentSelect) {
    const prev = els.feedbackStudentSelect.value;
    els.feedbackStudentSelect.innerHTML = '<option value="">Schüler wählen</option>';
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
  const globalType = state.questionnaireTeacher?.scaleType === 'yesno' ? 'yesno' : 'scale';
  const globalMin = Number.isFinite(Number(state.questionnaireTeacher?.scaleMin)) ? Number(state.questionnaireTeacher.scaleMin) : 1;
  const globalMax = Number.isFinite(Number(state.questionnaireTeacher?.scaleMax)) ? Number(state.questionnaireTeacher.scaleMax) : 5;
  const scaleHint = state.questionnaireTeacher?.scaleHint || (globalType === 'yesno' ? 'Ja / Nein' : `${globalMin} = trifft nicht zu, ${globalMax} = trifft voll zu`);
  els.feedbackQuestions.innerHTML = questions.map((q) => {
    const current = state.feedbackAnswers[q.id];
    const scale = resolveQuestionScale(state.questionnaireTeacher, q);
    const hint = q.hint || (scale.type === 'yesno' ? 'Ja / Nein' : `${scale.min} = trifft nicht zu, ${scale.max} = trifft voll zu`) || scaleHint;
    const options = scale.type === 'yesno' ? [{ label: 'Ja', value: 1 }, { label: 'Nein', value: 0 }] : Array.from({ length: Math.max(1, scale.max - scale.min + 1) }).map((_, idx) => {
      const v = scale.min + idx;
      return { label: String(v), value: v };
    });
    return `
      <div class="q-item">
        <div>${q.text}</div>
        <div class="rating" data-q="${q.id}">
          ${options.map((opt) => `<button class="${current === opt.value ? 'active' : ''}" data-val="${opt.value}">${opt.label}</button>`).join('')}
        </div>
        <div class="small">${hint}</div>
      </div>
    `;
  }).join('');
}

export function renderQuestionnaireEditor() {
  if (!els.questionnaireTypeSelect) return;
  const type = els.questionnaireTypeSelect.value === 'teacher' ? 'teacher' : 'student';
  const data = type === 'teacher' ? state.questionnaireTeacher : state.questionnaireStudent;
  if (els.questionnaireSlotSelect) {
    els.questionnaireSlotSelect.style.display = type === 'student' ? '' : 'none';
  }
  if (data) {
    if (els.questionnaireTitleInput) els.questionnaireTitleInput.value = data.title || '';
    if (els.questionnaireQuestionsInput) {
      const text = Array.isArray(data.questions) ? data.questions.map((q) => q.text).join('\n') : '';
      els.questionnaireQuestionsInput.value = text;
    }
    if (els.questionnaireHintsInput) {
      const hints = Array.isArray(data.questions) ? data.questions.map((q) => q.hint || '').join('\n') : '';
      els.questionnaireHintsInput.value = hints;
    }
    if (els.questionnaireScaleLines) {
      const lines = Array.isArray(data.questions)
        ? data.questions.map((q) => {
          if (q.scaleType === 'yesno') return 'ja/nein';
          if (Number.isFinite(Number(q.scaleMin)) && Number.isFinite(Number(q.scaleMax))) {
            return `${q.scaleMin}-${q.scaleMax}`;
          }
          return '';
        }).join('\n')
        : '';
      els.questionnaireScaleLines.value = lines;
    }
    if (els.questionnaireScaleType) {
      els.questionnaireScaleType.value = data.scaleType === 'yesno' ? 'yesno' : 'scale';
    }
    if (els.questionnaireScaleMin) {
      els.questionnaireScaleMin.value = Number.isFinite(Number(data.scaleMin)) ? String(data.scaleMin) : '1';
    }
    if (els.questionnaireScaleMax) {
      els.questionnaireScaleMax.value = Number.isFinite(Number(data.scaleMax)) ? String(data.scaleMax) : '5';
    }
    if (els.questionnaireScaleMin && els.questionnaireScaleMax && els.questionnaireScaleType) {
      const isYesNo = els.questionnaireScaleType.value === 'yesno';
      els.questionnaireScaleMin.disabled = isYesNo;
      els.questionnaireScaleMax.disabled = isYesNo;
    }
  }
}

export function renderQuestionnaireBroadcast() {
  if (!els.questionnaireBroadcastStatus) return;
  if (!state.activeQuestionnaire || !state.activeQuestionnaire.active) {
    els.questionnaireBroadcastStatus.textContent = 'Kein Fragebogen aktiv';
    return;
  }
  const slotLabel = state.activeQuestionnaire.slot === 'extra2' ? 'Extra 2' : 'Extra 1';
  els.questionnaireBroadcastStatus.textContent = `Aktiv: ${slotLabel}`;
}

export function renderTeachings() {
  const list = Array.isArray(state.profile.teachings) ? state.profile.teachings : [];
  if (!list.length) {
    els.teachingsList.innerHTML = '<div class="small">Keine Einträge</div>';
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
    if (state.activeQuestionnaire) {
      state.activeQuestionnaire = null;
      renderQuestionnaireBroadcast();
    }
    els.currentRoomInfo.textContent = 'Kein Raum ausgewählt';
    els.closeRoomBtn.disabled = true;
    els.membersBoard.innerHTML = '';
    els.logBox.innerHTML = '<div class="small">Noch keine Einträge</div>';
    els.statsGrid.innerHTML = '';
    updateLayout();
    return;
  }
  const roomClasses = Array.isArray(room.classNames) && room.classNames.length ? room.classNames.join(', ') : (room.className || '-');
  els.currentRoomInfo.textContent = `${room.name} (Klassen ${roomClasses})`;
  if (state.activeQuestionnaire && state.activeQuestionnaire.roomId !== room.id) {
    state.activeQuestionnaire = null;
    renderQuestionnaireBroadcast();
  }
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
  const anyReady = members.some((m) => m.ready);
  const getLastName = (m) => (m.lastName || '').trim().toLowerCase();
  const nameSort = (a, b) => {
    const lastA = getLastName(a);
    const lastB = getLastName(b);
    if (lastA && lastB && lastA !== lastB) return lastA.localeCompare(lastB, 'de');
    return (a.name || '').localeCompare((b.name || ''), 'de');
  };
  const sorted = members.slice().sort((a, b) => {
    if (anyReady) {
      if (a.ready && !b.ready) return -1;
      if (!a.ready && b.ready) return 1;
      if (a.ready && b.ready) {
        const aTime = Number(a.readyAt || 0);
        const bTime = Number(b.readyAt || 0);
        if (aTime !== bTime) return aTime - bTime;
      }
      return nameSort(a, b);
    }
    return nameSort(a, b);
  });
  if (!members.length) {
    els.membersBoard.innerHTML = '<div class="small" style="padding:10px;">Noch keine Teilnehmer</div>';
    return;
  }
  const rows = sorted.map((m) => `
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
        <button data-note="open">Notizen</button>
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
      const noteAction = btn.getAttribute('data-note');
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
      if (noteAction === 'open') {
        if (!userId) return;
        state.pendingNoteUserId = userId;
        sendJson({ type: 'noteRequest', userId });
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
    els.logBox.innerHTML = '<div class="small">Noch keine Einträge</div>';
    return;
  }
  const rows = state.logEntries.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString();
    const action = e.action === 'rating' ? 'Bewertung' : 'Aufruf';
    const rating = e.rating ? e.rating : '';
    return `<tr><td>${time}</td><td>${e.name}</td><td>${action}</td><td>${rating}</td><td><button class="ghost trash" data-log="${e.id}">🗑</button></td></tr>`;
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
      <div class="small">Stunde: Meldungen ${session.signals || 0} · Aufrufe ${session.calls || 0}</div>
      <div class="small">Gesamt: Meldungen ${total.signals || 0} · Aufrufe ${total.calls || 0}</div>
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
  const subjectLabel = state.classStats.subject ? ` · Fach ${state.classStats.subject}` : '';
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
    const noteText = s.note ? `<div class="small">Notiz: ${s.note}</div>` : '';
    return `
      <div class="stat-card clickable" data-user="${s.userId}">
        <h4>${s.name}</h4>
        <div class="small">Gesamt: Meldungen ${total.signals || 0} · Aufrufe ${total.calls || 0}</div>
        <div class="small">Bew.: -- ${ratings['--'] || 0} | - ${ratings['-'] || 0} | 0 ${ratings['0'] || 0} | + ${ratings['+'] || 0} | ++ ${ratings['++'] || 0}</div>
        ${noteText}
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
  const subjectLabel = state.classStudentStats.subject ? ` · Fach ${state.classStudentStats.subject}` : '';
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

let _timerInterval = null;

function _timerRemaining(timer) {
  if (!timer) return 0;
  if (!timer.running) return timer.remainingAtSnapshot;
  return Math.max(0, timer.remainingAtSnapshot - Math.floor((Date.now() - timer.snapshotAt) / 1000));
}

function _fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function renderTimer() {
  clearInterval(_timerInterval);
  const t = state.timer;
  if (!t) {
    els.timerDisplay.textContent = '--:--';
    els.timerFinished.style.display = 'none';
    els.timerStartBtn.disabled = true;
    els.timerPauseBtn.disabled = true;
    els.timerStopBtn.disabled = true;
    return;
  }
  els.timerStartBtn.disabled = t.running;
  els.timerPauseBtn.disabled = false;
  els.timerPauseBtn.textContent = t.running ? 'Pause' : 'Weiter';
  els.timerStopBtn.disabled = false;
  let alerted = false;

  const tick = () => {
    const rem = _timerRemaining(state.timer);
    els.timerDisplay.textContent = _fmtTime(rem);
    if (rem <= 0 && !alerted) {
      alerted = true;
      els.timerFinished.style.display = 'flex';
      els.timerStartBtn.disabled = true;
      els.timerPauseBtn.disabled = true;
      clearInterval(_timerInterval);
    }
  };
  tick();
  if (t.running) _timerInterval = setInterval(tick, 500);
}

let _assignmentInterval = null;

export function renderAssignment() {
  clearInterval(_assignmentInterval);
  const a = state.assignment;
  const display = els.assignmentDisplay;
  if (!a) {
    display.style.display = 'none';
    els.assignmentEndBtn.disabled = true;
    return;
  }
  display.style.display = 'block';
  els.assignmentEndBtn.disabled = false;
  els.assignmentActiveTitle.textContent = a.title || '';
  els.assignmentActiveDesc.textContent = a.description || '';
  els.assignmentFinished.style.display = 'none';

  if (a.totalSeconds === 0) {
    els.assignmentCountdown.textContent = '';
    return;
  }

  let alerted = false;
  const tick = () => {
    const rem = a.running
      ? Math.max(0, a.remainingAtSnapshot - Math.floor((Date.now() - a.snapshotAt) / 1000))
      : a.remainingAtSnapshot;
    els.assignmentCountdown.textContent = _fmtTime(rem);
    if (rem <= 0 && !alerted) {
      alerted = true;
      els.assignmentFinished.style.display = 'block';
      clearInterval(_assignmentInterval);
    }
  };
  tick();
  if (a.running) _assignmentInterval = setInterval(tick, 500);
}

export function renderAssignmentTemplates() {
  const list = els.assignmentTemplateList;
  if (!state.assignmentTemplates.length) {
    list.innerHTML = '<div class="small">Keine Vorlagen gespeichert</div>';
    return;
  }
  list.innerHTML = state.assignmentTemplates.map((t) => `
    <div class="log-entry" style="cursor:pointer;padding:6px 8px;border-radius:6px;background:${state.selectedAssignmentId === t.id ? 'var(--accent)' : 'var(--card)'};color:${state.selectedAssignmentId === t.id ? '#fff' : 'inherit'};margin-bottom:4px" data-id="${t.id}">
      <span style="font-weight:600">${escHtml(t.title)}</span>
      <span style="font-size:0.8rem;margin-left:6px;opacity:0.7">${t.totalSeconds > 0 ? _fmtTime(t.totalSeconds) : 'kein Timer'}</span>
    </div>`).join('');
  list.querySelectorAll('[data-id]').forEach((el) => {
    el.onclick = () => {
      const tpl = state.assignmentTemplates.find((t) => t.id === el.dataset.id);
      if (!tpl) return;
      state.selectedAssignmentId = tpl.id;
      els.assignmentTitle.value = tpl.title;
      els.assignmentDescription.value = tpl.description;
      const h = Math.floor(tpl.totalSeconds / 3600);
      const m = Math.floor((tpl.totalSeconds % 3600) / 60);
      const s = tpl.totalSeconds % 60;
      els.assignmentHours.value = h;
      els.assignmentMinutes.value = m;
      els.assignmentSeconds.value = s;
      els.assignmentDeleteBtn.style.display = '';
      renderAssignmentTemplates();
    };
  });
}

const MSS_LABEL = ['6', '5–', '5', '5+', '4–', '4', '4+', '3–', '3', '3+', '2–', '2', '2+', '1–', '1', '1+'];

export function renderGradeClassOptions() {
  const teachings = Array.isArray(state.profile?.teachings) ? state.profile.teachings : [];
  const classSet = new Set();
  teachings.forEach((t) => {
    if (Array.isArray(t.classNames)) t.classNames.forEach((c) => classSet.add(c));
    else if (t.className) classSet.add(t.className);
  });
  const classes = Array.from(classSet).sort((a, b) => a.localeCompare(b, 'de'));
  const current = els.gradeClassSelect.value;
  els.gradeClassSelect.innerHTML = '<option value="">– Klasse wählen –</option>' +
    classes.map((c) => `<option value="${escHtml(c)}" ${c === current ? 'selected' : ''}>${escHtml(c)}</option>`).join('');
}

export function renderGradeSheet() {
  const sheetList = els.gradeSheetList;
  if (!state.gradeSheets.length) {
    sheetList.innerHTML = '<div class="small">Keine Bögen gespeichert</div>';
  } else {
    sheetList.innerHTML = state.gradeSheets.map((s) => `
      <div class="log-entry" style="cursor:pointer;padding:5px 8px;border-radius:6px;background:${state.selectedSheetId === s.id ? 'var(--accent)' : 'var(--card)'};color:${state.selectedSheetId === s.id ? '#fff' : 'inherit'};margin-bottom:3px" data-id="${s.id}">
        <span style="font-weight:600">${escHtml(s.label)}</span>
        <span style="font-size:0.8rem;margin-left:6px;opacity:0.7">${escHtml(s.className)} ${escHtml(s.subject)}</span>
      </div>`).join('');
    sheetList.querySelectorAll('[data-id]').forEach((el) => {
      el.onclick = () => {
        const sheet = state.gradeSheets.find((s) => s.id === el.dataset.id);
        if (!sheet) return;
        state.selectedSheetId = sheet.id;
        els.gradeSheetLabel.value = sheet.label;
        els.gradeClassSelect.value = sheet.className;
        els.gradeSheetSubject.value = sheet.subject || '';
        state.gradeClassName = sheet.className;
        els.gradeSheetDeleteBtn.style.display = '';
        renderGradeSheet();
        renderGradeEntries(sheet);
      };
    });
  }
  renderGradeEntries(state.selectedSheetId ? state.gradeSheets.find((s) => s.id === state.selectedSheetId) || null : null);
}

function renderGradeEntries(sheet) {
  const entries = sheet?.entries || {};
  const students = state.gradeStudentList;
  if (!students.length) {
    els.gradeEntryList.innerHTML = '<div class="small" style="color:var(--muted)">Klasse auswählen um Schüler zu laden</div>';
    return;
  }
  els.gradeEntryList.innerHTML = students.map((m) => {
    const e = entries[m.userId] || { mss: null, comment: '' };
    const mssOptions = [{ v: '', l: '– (keine Note)' }, ...[...MSS_LABEL.map((l, i) => ({ v: i, l: `${i} – ${l}` }))].reverse()];
    const opts = mssOptions.map((o) => `<option value="${o.v}" ${String(e.mss) === String(o.v) ? 'selected' : ''}>${o.l}</option>`).join('');
    return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap" data-uid="${m.userId}">
      <span style="min-width:120px;font-size:0.9rem">${escHtml(m.name || m.userId)}</span>
      <select class="grade-mss" style="width:130px">${opts}</select>
      <input class="grade-comment" type="text" placeholder="Kommentar" value="${escHtml(e.comment || '')}" style="flex:1;min-width:120px">
    </div>`;
  }).join('');
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
      <div class="q-time">${state.poll.multiple ? 'Mehrfachauswahl' : 'Einzelauswahl'} · ${state.poll.anonymous ? 'Anonym' : 'Namen sichtbar'} · ${status}</div>
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
      <div class="small">Klasse: ${item.className || '-'} · Fach: ${item.subject || 'default'}</div>
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


