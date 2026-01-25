import { state } from './state.js';

export function sendJson(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
  state.ws.send(JSON.stringify(payload));
  return true;
}

export function sendJoin(roomId) {
  if (!roomId) return;
  sendJson({ type: 'join', roomId });
}

export function requestSubjectStats() {
  if (!state.profile.userId) return;
  sendJson({ type: 'studentSubjectStats' });
}
