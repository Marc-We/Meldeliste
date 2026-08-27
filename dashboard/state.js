export const state = {
  ws: null,
  profile: { role: 'teacher', userId: null, email: '', salutation: 'Herr', lastName: '' },
  authMode: 'login', // login | register | verify | reset-request | reset-confirm
  pendingEmail: '',
  rooms: [],
  currentRoom: null,
  presence: new Map(), // userId -> {ready, name, online}
  seatView: 'list', // 'list' | 'seat'
  seatEdit: false,
  seats: [], // [{id, x, y, userId|null}]
  seatPlans: [], // [{id, name, seats, isDefault}]
  seatActivePlanId: null,
  seatClassName: '',
  seatSubject: '',
  logEntries: [],
  stats: [],
  classCatalog: [],
  subjectCatalog: [],
  teacherCode: null,
  classCode: null,
  pendingTeachers: [],
  adminStudents: [],
  bans: { emails: [] },
  reports: [],
  teacherInbox: [],
  questionnaireStudent: null,
  questionnaireTeacher: null,
  activeQuestionnaire: null,
  qForms: [],           // Fragebögen für Schüler
  qFeedbackForms: [],   // Feedbackbögen (Lehrer füllt aus)
  qFormKind: 'student', // welche Sorte wird gerade bearbeitet
  selectedQFormId: null,
  studentNotes: {},
  pendingNoteUserId: '',
  feedbackAnswers: {},
  toiletStates: new Map(), // userId -> {status,start}
  questions: [],
  poll: null,
  groupPreview: null,
  ampel: null,
  prepRoster: [],
  prepPreview: null,
  timer: null,
  thoughts: [],
  assignment: null,
  assignmentTemplates: [],
  selectedAssignmentId: null,
  gradeSheets: [],
  selectedSheetId: null,
  gradeStudentList: [],
  gradeClassName: '',
  homeworkItems: [],
  classStats: { className: '', classNames: [], subject: '', students: [] },
  classStudentStats: { className: '', classNames: [], subject: '', student: null, sessions: [] },
};