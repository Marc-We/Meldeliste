import { state } from './state.js';
import { els } from './dom.js';
import { setVisible } from './ui.js';
import { requestSubjectStats, sendJoin, sendJson } from './api.js';

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

function courseKey(subject, teacherId) {
  return `${subject || 'default'}::${teacherId || ''}`;
}

export function renderCourseCatalog() {
  if (!els.coursePanel) return;
  if (!state.profile.userId) {
    els.coursePanel.style.display = 'none';
    return;
  }
  els.coursePanel.style.display = 'block';
  if (!state.courseCatalog.length) {
    els.courseList.innerHTML = '<div class="empty">Keine Kurse vorhanden</div>';
    els.courseHint.textContent = 'Ein Lehrer muss den Kurs zuerst anlegen.';
    return;
  }
  const selected = new Set(state.selectedCourses || []);
  els.courseList.innerHTML = state.courseCatalog.map((course) => {
    const key = courseKey(course.subject, course.teacherId);
    const checked = selected.has(key) ? 'checked' : '';
    const label = course.teacherName ? `${course.subject} (${course.teacherName})` : course.subject;
    return `<label class="item"><input type="checkbox" value="${key}" data-subject="${course.subject}" data-teacher="${course.teacherId}" ${checked}>${label}</label>`;
  }).join('');
  els.courseHint.textContent = 'Nur gewaehlte Kurse sind sichtbar.';
}

export function renderRooms() {
  els.roomSelect.innerHTML = '';
  if (state.profile.userId && (!state.selectedCourses || !state.selectedCourses.length)) {
    els.roomSelect.innerHTML = '<option value="">Bitte Kurse waehlen</option>';
    els.readyBtn.disabled = true;
    els.leaveBtn.disabled = true;
    els.withdrawBtn.disabled = true;
    return;
  }
  const allowedCourses = new Set(state.selectedCourses || []);
  const activeRooms = state.rooms
    .filter((r) => r.active !== false)
    .filter((r) => {
      if (!state.profile.className) return true;
      const classes = Array.isArray(r.classNames) && r.classNames.length ? r.classNames : (r.className ? [r.className] : []);
      if (!classes.length) return true;
      return classes.includes(state.profile.className);
    })
    .filter((r) => {
      if (!state.profile.userId) return true;
      if (!allowedCourses.size) return false;
      return allowedCourses.has(courseKey(r.subject || 'default', r.teacherId || ''));
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
        <button class="ghost" data-questionnaire="${s.subject}">Fragebogen</button>
      </div>
    `;
  }).join('');
  els.subjectGrid.querySelectorAll('[data-subject]').forEach((card) => {
    card.onclick = () => {
      state.selectedSubject = card.getAttribute('data-subject') || '';
      renderSubjectDetail();
    };
  });
  els.subjectGrid.querySelectorAll('[data-questionnaire]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      state.questionnaire.subject = btn.getAttribute('data-questionnaire') || '';
      state.questionnaire.open = true;
      state.questionnaire.data = null;
      state.questionnaire.answers = {};
      state.questionnaire.teacherId = '';
      state.questionnaire.loading = false;
      renderQuestionnaire();
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

function getTeacherOptionsForSubject(subject) {
  const courses = Array.isArray(state.profile.courses) ? state.profile.courses : [];
  const options = courses.filter((c) => c && c.subject === subject);
  return options.map((c) => {
    const match = (state.courseCatalog || []).find((cc) => cc.teacherId === c.teacherId && cc.subject === subject);
    return { teacherId: c.teacherId, teacherName: match?.teacherName || 'Lehrer' };
  });
}

export function renderQuestionnaire() {
  if (!els.questionnairePanel) return;
  if (!state.questionnaire.open || !state.questionnaire.subject) {
    els.questionnairePanel.style.display = 'none';
    return;
  }
  els.questionnairePanel.style.display = 'block';
  const subject = state.questionnaire.subject;
  const teachers = getTeacherOptionsForSubject(subject);
  if (teachers.length > 1) {
    els.questionnaireTeacherRow.style.display = 'block';
    els.questionnaireTeacher.innerHTML = teachers.map((t) => `<option value="${t.teacherId}">${t.teacherName}</option>`).join('');
    if (!state.questionnaire.teacherId) {
      state.questionnaire.teacherId = teachers[0].teacherId;
    }
    els.questionnaireTeacher.value = state.questionnaire.teacherId;
  } else if (teachers.length === 1) {
    els.questionnaireTeacherRow.style.display = 'none';
    state.questionnaire.teacherId = teachers[0].teacherId;
  } else {
    els.questionnaireTeacherRow.style.display = 'none';
    els.questionnaireQuestions.innerHTML = '<div class="empty">Kein Kurs gefunden.</div>';
    return;
  }
  if (!state.questionnaire.data) {
    els.questionnaireQuestions.innerHTML = '<div class="empty">Lade Fragebogen...</div>';
    if (!state.questionnaire.loading && state.questionnaire.teacherId) {
      state.questionnaire.loading = true;
      sendJson({ type: 'questionnaireRequest', role: 'student', teacherId: state.questionnaire.teacherId });
    }
    return;
  }
  els.questionnaireTitle.textContent = state.questionnaire.data.title || 'Fragebogen';
  const scaleType = state.questionnaire.data.scaleType === 'yesno' ? 'yesno' : 'scale';
  const scaleMin = Number.isFinite(Number(state.questionnaire.data.scaleMin)) ? Number(state.questionnaire.data.scaleMin) : 1;
  const scaleMax = Number.isFinite(Number(state.questionnaire.data.scaleMax)) ? Number(state.questionnaire.data.scaleMax) : 5;
  const scaleHint = state.questionnaire.data.scaleHint || (scaleType === 'yesno' ? 'Ja / Nein' : `${scaleMin} = trifft nicht zu, ${scaleMax} = trifft voll zu`);
  const questions = Array.isArray(state.questionnaire.data.questions) ? state.questionnaire.data.questions : [];
  if (!questions.length) {
    els.questionnaireQuestions.innerHTML = '<div class="empty">Keine Fragen vorhanden.</div>';
    return;
  }
  els.questionnaireQuestions.innerHTML = questions.map((q) => {
    const current = state.questionnaire.answers[q.id];
    const hint = q.hint || scaleHint;
    const options = scaleType === 'yesno' ? [{ label: 'Ja', value: 1 }, { label: 'Nein', value: 0 }] : Array.from({ length: Math.max(1, scaleMax - scaleMin + 1) }).map((_, idx) => {
      const v = scaleMin + idx;
      return { label: String(v), value: v };
    });
    return `
      <div class="q-item">
        <div>${q.text}</div>
        <div class="rating" data-q="${q.id}">
          ${options.map((opt) => `<button class="${current === opt.value ? 'active' : ''}" data-val="${opt.value}">${opt.label}</button>`).join('')}
        </div>
        <div class="scale">${hint}</div>
      </div>
    `;
  }).join('');
}

export function renderFeedbackInbox() {
  if (!els.feedbackPanel) return;
  if (!state.feedbackInbox || !state.feedbackInbox.length) {
    els.feedbackPanel.style.display = 'block';
    els.feedbackList.innerHTML = '<div class="empty">Keine Nachrichten</div>';
    return;
  }
  els.feedbackPanel.style.display = 'block';
  els.feedbackList.innerHTML = state.feedbackInbox.map((item) => {
    const time = new Date(item.ts || Date.now()).toLocaleString();
    const from = item.fromName || 'Lehrer';
    const subject = item.subject || 'Fach';
    const answers = (item.answers || []).map((a) => `${a.id}: ${a.value}`).join(' | ');
    const text = item.text ? `<div style="margin-top:6px;">${item.text}</div>` : '';
    return `
      <div class="inbox-item">
        <div><strong>${from}</strong> ${subject}</div>
        <div class="small">${time}</div>
        <div class="small">${answers}</div>
        ${text}
      </div>
    `;
  }).join('');
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
    els.thoughtState.textContent = 'Gedankenrunde aktiv schreibe deine Gedanken und sende sie.';
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

