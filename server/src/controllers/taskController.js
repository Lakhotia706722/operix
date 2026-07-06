const { v4: uuidv4 } = require('uuid');
const Task = require('../models/Task');
const Board = require('../models/Board');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const taskService = require('../services/taskService');
const activityService = require('../services/activityService');
const notificationService = require('../services/notificationService');
const { cloudinary } = require('../config/cloudinary');

// ─── Task CRUD ────────────────────────────────────────────────────────────────

exports.getTasks = asyncHandler(async (req, res) => {
  const { status, priority, assignee, label, search, archived } = req.query;
  const query = {
    board: req.params.boardId,
    isArchived: archived === 'true',
  };

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (assignee) query.assignedTo = assignee;
  if (label) query.labels = label;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  const tasks = await Task.find(query)
    .sort({ columnId: 1, position: 1 })
    .populate('assignedTo', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();

  res.json({ success: true, data: { tasks } });
});

exports.createTask = asyncHandler(async (req, res) => {
  const task = await taskService.createTask(req.params.boardId, req.user._id, req.body);
  const populated = await Task.findById(task._id)
    .populate('assignedTo', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();

  req.io?.to(`board:${req.params.boardId}`).emit('task:created', { task: populated, createdBy: req.user._id });

  res.status(201).json({ success: true, data: { task: populated } });
});

exports.getTask = asyncHandler(async (req, res, next) => {
  const task = await Task.findOne({ _id: req.params.taskId, board: req.params.boardId })
    .populate('assignedTo', 'name avatar email')
    .populate('createdBy', 'name avatar')
    .populate('watchedBy', 'name avatar')
    .populate('blockedBy', 'title status')
    .populate('checklist.completedBy', 'name avatar')
    .lean();

  if (!task) return next(new AppError('Task not found.', 404, 'TASK_NOT_FOUND'));
  res.json({ success: true, data: { task } });
});

exports.updateTask = asyncHandler(async (req, res, next) => {
  const allowedFields = [
    'title', 'description', 'priority', 'status', 'dueDate', 'startDate',
    'estimatedHours', 'labels', 'columnId', 'version',
  ];

  const updates = {};
  allowedFields.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  const oldTask = await Task.findById(req.params.taskId).select('version').lean();
  if (!oldTask) return next(new AppError('Task not found.', 404, 'TASK_NOT_FOUND'));

  // Check version if provided (optimistic concurrency control)
  if (updates.version !== undefined && updates.version !== oldTask.version) {
    return next(new AppError('Task was modified by another user. Please refresh and try again.', 409, 'VERSION_CONFLICT'));
  }

  // Always increment version on update
  updates.$inc = { version: 1 };
  delete updates.version; // Remove version from direct updates, use $inc instead

  const task = await Task.findByIdAndUpdate(req.params.taskId, updates, {
    new: true, runValidators: true,
  })
    .populate('assignedTo', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();

  // Log relevant activity
  if (updates.priority && updates.priority !== oldTask.priority) {
    await activityService.log({
      boardId: req.params.boardId, actorId: req.user._id, action: 'task_priority_changed',
      taskId: task._id, meta: { from: oldTask.priority, to: updates.priority },
    });
  }
  if (updates.dueDate !== undefined && String(updates.dueDate) !== String(oldTask.dueDate)) {
    await activityService.log({
      boardId: req.params.boardId, actorId: req.user._id, action: 'task_due_date_changed',
      taskId: task._id, meta: { dueDate: updates.dueDate },
    });
  }
  if (updates.title || updates.description) {
    await activityService.log({
      boardId: req.params.boardId, actorId: req.user._id, action: 'task_updated',
      taskId: task._id, meta: { fields: Object.keys(updates) },
    });
  }

  req.io?.to(`board:${req.params.boardId}`).emit('task:updated', {
    taskId: task._id, changes: updates, updatedBy: req.user._id,
  });

  res.json({ success: true, data: { task } });
});

exports.deleteTask = asyncHandler(async (req, res, next) => {
  if (req.memberRole !== 'owner' && req.memberRole !== 'admin') {
    return next(new AppError('Only admins/owners can delete tasks.', 403, 'INSUFFICIENT_ROLE'));
  }

  const task = await Task.findOneAndDelete({ _id: req.params.taskId, board: req.params.boardId });
  if (!task) return next(new AppError('Task not found.', 404, 'TASK_NOT_FOUND'));

  await activityService.log({
    boardId: req.params.boardId, actorId: req.user._id, action: 'task_deleted',
    meta: { taskTitle: task.title },
  });

  req.io?.to(`board:${req.params.boardId}`).emit('task:deleted', {
    taskId: task._id, columnId: task.columnId, deletedBy: req.user._id,
  });

  res.json({ success: true, data: { task } });
});

exports.moveTask = asyncHandler(async (req, res) => {
  const { columnId, position, moveId } = req.body;
  const task = await taskService.moveTask(
    req.params.taskId, req.user._id, columnId, position, req.io, moveId
  );
  res.json({ success: true, data: { task } });
});

exports.archiveTask = asyncHandler(async (req, res, next) => {
  const task = await Task.findOneAndUpdate(
    { _id: req.params.taskId, board: req.params.boardId },
    { isArchived: true, archivedBy: req.user._id, archivedAt: new Date() },
    { new: true }
  ).populate('assignedTo', 'name avatar').populate('createdBy', 'name avatar').lean();
  if (!task) return next(new AppError('Task not found.', 404, 'TASK_NOT_FOUND'));

  await activityService.log({
    boardId: req.params.boardId, actorId: req.user._id, action: 'task_archived',
    taskId: task._id, meta: { taskTitle: task.title },
  });

  req.io?.to(`board:${req.params.boardId}`).emit('task:archived', { taskId: task._id, archivedBy: req.user._id });
  res.json({ success: true, data: { task } });
});

exports.toggleWatch = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.taskId).select('watchedBy');
  const userId = req.user._id;
  const isWatching = task.watchedBy.some((id) => id.toString() === userId.toString());

  const update = isWatching
    ? { $pull: { watchedBy: userId } }
    : { $addToSet: { watchedBy: userId } };

  const updatedTask = await Task.findByIdAndUpdate(req.params.taskId, update, { new: true })
    .populate('assignedTo', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();
  res.json({ success: true, data: { task: updatedTask, watching: !isWatching } });
});

exports.assignUser = asyncHandler(async (req, res) => {
  const { userId, action } = req.body; // action: 'assign' | 'unassign'
  const update = action === 'assign'
    ? { $addToSet: { assignedTo: userId } }
    : { $pull: { assignedTo: userId } };

  const task = await Task.findOneAndUpdate(
    { _id: req.params.taskId, board: req.params.boardId },
    update,
    { new: true }
  ).populate('assignedTo', 'name avatar').lean();

  if (action === 'assign') {
    await notificationService.notifyAssignment(task, req.user._id, userId);
    await activityService.log({
      boardId: req.params.boardId, actorId: req.user._id, action: 'task_assigned',
      taskId: task._id, meta: { userId },
    });
  } else {
    await activityService.log({
      boardId: req.params.boardId, actorId: req.user._id, action: 'task_unassigned',
      taskId: task._id, meta: { userId },
    });
  }

  req.io?.to(`board:${req.params.boardId}`).emit('task:updated', {
    taskId: task._id, changes: { assignedTo: task.assignedTo },
  });

  res.json({ success: true, data: { task } });
});

// ─── Checklist ────────────────────────────────────────────────────────────────

exports.addChecklistItem = asyncHandler(async (req, res, next) => {
  const { text } = req.body;
  if (!text) return next(new AppError('Checklist item text is required.', 400, 'VALIDATION_ERROR'));

  const item = { id: uuidv4(), text, completed: false };
  const task = await Task.findByIdAndUpdate(
    req.params.taskId,
    { $push: { checklist: item } },
    { new: true }
  ).lean();

  await activityService.log({
    boardId: req.params.boardId, actorId: req.user._id, action: 'checklist_item_added',
    taskId: task._id, meta: { text },
  });

  res.status(201).json({ success: true, data: { checklist: task.checklist } });
});

exports.updateChecklistItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;
  const { completed, text } = req.body;
  const task = await Task.findById(req.params.taskId);
  const item = task.checklist.find((c) => c.id === itemId);
  if (!item) return next(new AppError('Checklist item not found.', 404, 'ITEM_NOT_FOUND'));

  if (text !== undefined) item.text = text;
  if (completed !== undefined) {
    item.completed = completed;
    item.completedBy = completed ? req.user._id : null;
    item.completedAt = completed ? new Date() : null;

    if (completed) {
      await activityService.log({
        boardId: req.params.boardId, actorId: req.user._id, action: 'checklist_item_completed',
        taskId: task._id, meta: { text: item.text },
      });
    }
  }

  await task.save();
  res.json({ success: true, data: { checklist: task.checklist } });
});

exports.deleteChecklistItem = asyncHandler(async (req, res) => {
  const task = await Task.findByIdAndUpdate(
    req.params.taskId,
    { $pull: { checklist: { id: req.params.itemId } } },
    { new: true }
  ).lean();
  res.json({ success: true, data: { checklist: task.checklist } });
});

// ─── Attachments ──────────────────────────────────────────────────────────────

exports.uploadAttachment = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('No file uploaded.', 400, 'NO_FILE'));

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'taskflow/attachments', resource_type: 'auto' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(req.file.buffer);
  });

  const attachment = {
    filename: result.public_id,
    originalName: req.file.originalname,
    url: result.secure_url,
    publicId: result.public_id,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  };

  const task = await Task.findByIdAndUpdate(
    req.params.taskId,
    { $push: { attachments: attachment } },
    { new: true }
  ).lean();

  await activityService.log({
    boardId: req.params.boardId, actorId: req.user._id, action: 'attachment_added',
    taskId: task._id, meta: { filename: req.file.originalname },
  });

  res.status(201).json({ success: true, data: { attachments: task.attachments } });
});

exports.deleteAttachment = asyncHandler(async (req, res, next) => {
  const task = await Task.findById(req.params.taskId);
  const attachment = task.attachments.id(req.params.attachmentId);
  if (!attachment) return next(new AppError('Attachment not found.', 404, 'NOT_FOUND'));

  await cloudinary.uploader.destroy(attachment.publicId, { resource_type: 'auto' });
  task.attachments.pull(req.params.attachmentId);
  await task.save();

  await activityService.log({
    boardId: req.params.boardId, actorId: req.user._id, action: 'attachment_removed',
    taskId: task._id, meta: { filename: attachment.originalName },
  });

  const updatedTask = await Task.findById(req.params.taskId)
    .populate('assignedTo', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();
  res.json({ success: true, data: { task: updatedTask } });
});

// ─── Time Tracking ────────────────────────────────────────────────────────────

exports.startTimer = asyncHandler(async (req, res) => {
  const entry = { user: req.user._id, startTime: new Date() };
  const task = await Task.findByIdAndUpdate(
    req.params.taskId,
    { $push: { timeEntries: entry } },
    { new: true }
  ).lean();
  res.json({ success: true, data: { timeEntries: task.timeEntries } });
});

exports.stopTimer = asyncHandler(async (req, res, next) => {
  const task = await Task.findById(req.params.taskId);
  const { note } = req.body;

  // Find latest open entry for this user
  const openEntry = [...task.timeEntries]
    .reverse()
    .find(
      (e) => e.user.toString() === req.user._id.toString() && !e.endTime
    );

  if (!openEntry) return next(new AppError('No active timer found.', 404, 'NO_ACTIVE_TIMER'));

  const duration = Math.round((Date.now() - new Date(openEntry.startTime).getTime()) / 60000);
  openEntry.endTime = new Date();
  openEntry.duration = duration;
  if (note) openEntry.note = note;

  await task.save();
  res.json({ success: true, data: { timeEntries: task.timeEntries } });
});
