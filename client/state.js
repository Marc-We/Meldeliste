export const state = {
  ws: null,
  profile: { role: 'student', userId: null, email: '', firstName: '', lastName: '', className: '' },
  authMode: 'login', // login | register | verify | reset-request | reset-confirm
  pendingEmail: '',
  classCatalog: [],
  rooms: [],
  currentRoom: null,
  myLog: [],
  myStats: { session: { signals: 0, calls: 0 }, total: { signals: 0, calls: 0 }, daily: {} },
  subjectStats: [],
  selectedSubject: '',
  lastAuth: null,
  poll: null,
  pollSelection: [],
  thoughtActive: false,
  pollCollapsed: false,
  homeworkItems: [],
};
