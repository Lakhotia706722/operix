const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const Board = require('../models/Board');
const User = require('../models/User');
const Task = require('../models/Task');
const { cloudinary } = require('../config/cloudinary');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const boardService = require('../services/boardService');
const activityService = require('../services/activityService');
const { getRedis } = require('../config/redis');

// ─── Board CRUD ────────────────────────────────────────────────────────────────

exports.getBoards = asyncHandler(async (req, res) => {
  const boards = await Board.find({
    'members.user': req.user._id,
    isArchived: false,
  })
    .populate('members.user', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();

  // Sort: starred first, then by updatedAt
  const userId = req.user._id.toString();
  boards.sort((a, b) => {
    const aStarred = a.isStarred.some((id) => id.toString() === userId);
    const bStarred = b.isStarred.some((id) => id.toString() === userId);
    if (aStarred !== bStarred) return aStarred ? -1 : 1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  res.json({ success: true, data: { boards } });
});

exports.createBoard = asyncHandler(async (req, res) => {
  const board = await boardService.createBoard(req.user._id, req.body);
  res.status(201).json({ success: true, data: { board } });
});

exports.getBoard = asyncHandler(async (req, res) => {
  const redis = getRedis();
  const cacheKey = `board:members:${req.params.boardId}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return res.json({ success: true, data: { board: JSON.parse(cached) } });
  }

  const board = await boardService.getFullBoard(req.params.boardId, req.user._id);

  await redis.setex(cacheKey, 120, JSON.stringify(board)); // cache 2 min
  res.json({ success: true, data: { board } });
});

exports.updateBoard = asyncHandler(async (req, res) => {
  const { title, description, coverColor, settings } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (coverColor !== undefined) updates.coverColor = coverColor;
  if (settings !== undefined) updates.settings = settings;

  const board = await Board.findByIdAndUpdate(req.params.boardId, updates, {
    new: true,
    runValidators: true,
  })
    .populate('members.user', 'name avatar')
    .lean();

  // Invalidate cache
  await getRedis().del(`board:members:${req.params.boardId}`);

  await activityService.log({
    boardId: board._id,
    actorId: req.user._id,
    action: 'board_updated',
    meta: updates,
  });

  // Emit socket
  req.io?.to(`board:${board._id}`).emit('board:updated', { board });

  res.json({ success: true, data: { board } });
});

exports.deleteBoard = asyncHandler(async (req, res, next) => {
  if (req.memberRole !== 'owner') {
    return next(new AppError('Only the board owner can delete it.', 403, 'INSUFFICIENT_ROLE'));
  }

  const board = await Board.findById(req.params.boardId).lean();
  await Promise.all([
    Board.findByIdAndDelete(req.params.boardId),
    Task.deleteMany({ board: req.params.boardId }),
  ]);

  await getRedis().del(`board:members:${req.params.boardId}`);

  // Emit socket event to notify all board members
  req.io?.to(`board:${req.params.boardId}`).emit('board:deleted', {
    boardId: req.params.boardId,
  });

  res.json({ success: true, data: { board } });
});

exports.archiveBoard = asyncHandler(async (req, res) => {
  const board = await Board.findByIdAndUpdate(req.params.boardId, { isArchived: true }, { new: true })
    .populate('members.user', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();

  await activityService.log({
    boardId: req.params.boardId,
    actorId: req.user._id,
    action: 'board_archived',
  });

  res.json({ success: true, data: { board } });
});

exports.starBoard = asyncHandler(async (req, res) => {
  const board = await Board.findById(req.params.boardId).select('isStarred');
  const userId = req.user._id;
  const isStarred = board.isStarred.some((id) => id.toString() === userId.toString());

  const update = isStarred
    ? { $pull: { isStarred: userId } }
    : { $addToSet: { isStarred: userId } };

  const updatedBoard = await Board.findByIdAndUpdate(req.params.boardId, update, { new: true })
    .populate('members.user', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();
  res.json({ success: true, data: { board: updatedBoard, starred: !isStarred } });
});

// ─── Members ──────────────────────────────────────────────────────────────────

exports.inviteMember = asyncHandler(async (req, res) => {
  const { email, role } = req.body;
  await boardService.inviteMember(req.params.boardId, req.user._id, email, role);
  res.json({ success: true, message: 'Invitation sent.' });
});

exports.acceptInvite = asyncHandler(async (req, res, next) => {
  const { token } = req.params;
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch {
    return next(new AppError('Invite link is invalid or expired.', 400, 'INVALID_TOKEN'));
  }

  const { boardId, email, role } = decoded;

  // Find user by email
  const user = await User.findOne({ email }).lean();
  if (!user) return next(new AppError('Please register first, then accept the invite.', 404, 'USER_NOT_FOUND'));

  const board = await Board.findById(boardId);
  if (!board) return next(new AppError('Board not found.', 404, 'BOARD_NOT_FOUND'));

  const alreadyMember = board.members.some((m) => m.user.toString() === user._id.toString());
  if (alreadyMember) {
    return res.json({ success: true, message: 'You are already a member of this board.', data: { boardId } });
  }

  board.members.push({ user: user._id, role, joinedAt: new Date() });
  await board.save();

  await getRedis().del(`board:members:${boardId}`);

  await activityService.log({
    boardId,
    actorId: user._id,
    action: 'member_invited',
    meta: { email, role },
  });

  res.json({ success: true, message: 'Invite accepted.', data: { boardId } });
});

exports.updateMemberRole = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;

  if (!['admin', 'member', 'viewer'].includes(role)) {
    return next(new AppError('Invalid role.', 400, 'VALIDATION_ERROR'));
  }
  if (req.memberRole !== 'owner' && req.memberRole !== 'admin') {
    return next(new AppError('Only owner or admin can change roles.', 403, 'INSUFFICIENT_ROLE'));
  }

  const board = await Board.findOneAndUpdate(
    { _id: req.params.boardId, 'members.user': userId },
    { $set: { 'members.$.role': role } },
    { new: true }
  ).lean();

  if (!board) return next(new AppError('Member not found.', 404, 'MEMBER_NOT_FOUND'));

  await getRedis().del(`board:members:${req.params.boardId}`);
  await activityService.log({
    boardId: req.params.boardId,
    actorId: req.user._id,
    action: 'member_role_changed',
    meta: { userId, role },
  });

  res.json({ success: true, data: { board } });
});

exports.removeMember = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const isSelf = userId === req.user._id.toString();

  if (!isSelf && req.memberRole !== 'owner' && req.memberRole !== 'admin') {
    return next(new AppError('Insufficient permissions.', 403, 'INSUFFICIENT_ROLE'));
  }

  const board = await Board.findByIdAndUpdate(req.params.boardId, {
    $pull: { members: { user: userId } },
  }, { new: true })
    .populate('members.user', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();

  await getRedis().del(`board:members:${req.params.boardId}`);
  await activityService.log({
    boardId: req.params.boardId,
    actorId: req.user._id,
    action: 'member_removed',
    meta: { userId },
  });

  res.json({ success: true, data: { board } });
});

// ─── Columns ──────────────────────────────────────────────────────────────────

exports.addColumn = asyncHandler(async (req, res) => {
  const { title, color } = req.body;
  const board = await Board.findById(req.params.boardId);
  const maxPos = board.columns.reduce((max, c) => Math.max(max, c.position), 0);

  const newColumn = { id: uuidv4(), title, color: color || '#6366f1', position: maxPos + 1000, isDefault: false };
  board.columns.push(newColumn);
  await board.save();

  res.status(201).json({ success: true, data: { column: newColumn } });
});

exports.updateColumn = asyncHandler(async (req, res, next) => {
  const { columnId } = req.params;
  const { title, color } = req.body;

  const board = await Board.findById(req.params.boardId);
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) return next(new AppError('Column not found.', 404, 'COLUMN_NOT_FOUND'));

  if (title) col.title = title;
  if (color) col.color = color;
  await board.save();

  res.json({ success: true, data: { column: col } });
});

exports.deleteColumn = asyncHandler(async (req, res, next) => {
  const { columnId } = req.params;
  const board = await Board.findById(req.params.boardId);
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) return next(new AppError('Column not found.', 404, 'COLUMN_NOT_FOUND'));
  if (col.isDefault) return next(new AppError('Cannot delete default columns.', 403, 'CANNOT_DELETE_DEFAULT'));

  board.columns = board.columns.filter((c) => c.id !== columnId);
  await board.save();

  // Archive tasks in deleted column
  await Task.updateMany({ board: board._id, columnId }, { isArchived: true });

  const updatedBoard = await Board.findById(req.params.boardId)
    .populate('members.user', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();
  res.json({ success: true, data: { board: updatedBoard } });
});

exports.reorderColumns = asyncHandler(async (req, res) => {
  const { columns } = req.body; // [{ id, position }]
  const board = await Board.findById(req.params.boardId);
  columns.forEach(({ id, position }) => {
    const col = board.columns.find((c) => c.id === id);
    if (col) col.position = position;
  });
  await board.save();
  res.json({ success: true, data: { columns: board.columns } });
});

// ─── Labels ────────────────────────────────────────────────────────────────────

exports.addLabel = asyncHandler(async (req, res) => {
  const { name, color } = req.body;
  const board = await Board.findById(req.params.boardId);
  const newLabel = { id: uuidv4(), name, color };
  board.labels.push(newLabel);
  await board.save();
  res.status(201).json({ success: true, data: { label: newLabel } });
});

exports.updateLabel = asyncHandler(async (req, res, next) => {
  const { labelId } = req.params;
  const board = await Board.findById(req.params.boardId);
  const label = board.labels.find((l) => l.id === labelId);
  if (!label) return next(new AppError('Label not found.', 404, 'LABEL_NOT_FOUND'));
  if (req.body.name) label.name = req.body.name;
  if (req.body.color) label.color = req.body.color;
  await board.save();
  res.json({ success: true, data: { label } });
});

exports.deleteLabel = asyncHandler(async (req, res, next) => {
  const { labelId } = req.params;
  const board = await Board.findById(req.params.boardId);
  board.labels = board.labels.filter((l) => l.id !== labelId);
  await board.save();
  // Remove label from tasks
  await Task.updateMany({ board: board._id }, { $pull: { labels: labelId } });

  const updatedBoard = await Board.findById(req.params.boardId)
    .populate('members.user', 'name avatar')
    .populate('createdBy', 'name avatar')
    .lean();
  res.json({ success: true, data: { board: updatedBoard } });
});

// ─── Activity & Analytics ─────────────────────────────────────────────────────

exports.getBoardActivity = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const data = await activityService.getTimeline(req.params.boardId, page, limit);
  res.json({ success: true, data });
});

exports.getBoardAnalytics = asyncHandler(async (req, res) => {
  const redis = getRedis();
  const range = parseInt(req.query.range, 10) || 30;
  const cacheKey = `analytics:${req.params.boardId}:${range}`;

  const cached = await redis.get(cacheKey);
  if (cached) return res.json({ success: true, data: JSON.parse(cached) });

  const data = await boardService.getBoardAnalytics(req.params.boardId, range);
  await redis.setex(cacheKey, 300, JSON.stringify(data)); // cache 5 min

  res.json({ success: true, data });
});
