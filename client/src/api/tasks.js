import api from './axios';

// Generate a unique ID for idempotency
const generateMoveId = () => `move_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const tasksApi = {
  getAll: (boardId, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    return api.get(`/boards/${boardId}/tasks?${params}`).then((r) => r.data.data.tasks);
  },
  getOne: (boardId, taskId) => api.get(`/boards/${boardId}/tasks/${taskId}`).then((r) => r.data.data.task),
  create: (boardId, data) => api.post(`/boards/${boardId}/tasks`, data).then((r) => r.data.data.task),
  update: (boardId, taskId, data) => api.put(`/boards/${boardId}/tasks/${taskId}`, data).then((r) => r.data.data.task),
  delete: (boardId, taskId) => api.delete(`/boards/${boardId}/tasks/${taskId}`).then((r) => r.data),
  move: (boardId, taskId, data) => {
    const moveId = generateMoveId();
    return api.post(`/boards/${boardId}/tasks/${taskId}/move`, { ...data, moveId }).then((r) => r.data.data.task);
  },
  archive: (boardId, taskId) => api.post(`/boards/${boardId}/tasks/${taskId}/archive`).then((r) => r.data),
  toggleWatch: (boardId, taskId) => api.post(`/boards/${boardId}/tasks/${taskId}/watch`).then((r) => r.data.data),
  assign: (boardId, taskId, userId, action) => api.post(`/boards/${boardId}/tasks/${taskId}/assign`, { userId, action }).then((r) => r.data.data.task),
  addChecklistItem: (boardId, taskId, text) => api.post(`/boards/${boardId}/tasks/${taskId}/checklist`, { text }).then((r) => r.data.data.checklist),
  updateChecklistItem: (boardId, taskId, itemId, data) => api.put(`/boards/${boardId}/tasks/${taskId}/checklist/${itemId}`, data).then((r) => r.data.data.checklist),
  deleteChecklistItem: (boardId, taskId, itemId) => api.delete(`/boards/${boardId}/tasks/${taskId}/checklist/${itemId}`).then((r) => r.data.data.checklist),
  uploadAttachment: (boardId, taskId, formData) => api.post(`/boards/${boardId}/tasks/${taskId}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data.data.attachments),
  deleteAttachment: (boardId, taskId, attachmentId) => api.delete(`/boards/${boardId}/tasks/${taskId}/attachments/${attachmentId}`).then((r) => r.data),
  getComments: (boardId, taskId, page = 1) => api.get(`/boards/${boardId}/tasks/${taskId}/comments?page=${page}`).then((r) => r.data.data),
  addComment: (boardId, taskId, data) => api.post(`/boards/${boardId}/tasks/${taskId}/comments`, data).then((r) => r.data.data.comment),
  editComment: (boardId, taskId, commentId, content) => api.put(`/boards/${boardId}/tasks/${taskId}/comments/${commentId}`, { content }).then((r) => r.data.data.comment),
  deleteComment: (boardId, taskId, commentId) => api.delete(`/boards/${boardId}/tasks/${taskId}/comments/${commentId}`).then((r) => r.data),
  addReaction: (boardId, taskId, commentId, emoji) => api.post(`/boards/${boardId}/tasks/${taskId}/comments/${commentId}/reactions`, { emoji }).then((r) => r.data.data.reactions),
  startTimer: (boardId, taskId) => api.post(`/boards/${boardId}/tasks/${taskId}/time/start`).then((r) => r.data.data),
  stopTimer: (boardId, taskId, note) => api.post(`/boards/${boardId}/tasks/${taskId}/time/stop`, { note }).then((r) => r.data.data),
};
