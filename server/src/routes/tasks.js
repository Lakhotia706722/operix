const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const router = express.Router({ mergeParams: true }); // inherits :boardId
const taskController = require('../controllers/taskController');
const commentController = require('../controllers/commentController');
const authMiddleware = require('../middlewares/auth');
const boardAccess = require('../middlewares/boardAccess');
const upload = require('../middlewares/upload');
const { apiLimiter } = require('../middlewares/rateLimiter');
const AppError = require('../utils/AppError');

router.use(authMiddleware, boardAccess('viewer'), apiLimiter);

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR', errors.array()[0].path));
  }
  next();
};

// Tasks
router.get(
  '/',
  [
    query('status').optional().isIn(['todo', 'in-progress', 'review', 'done']).withMessage('Invalid status'),
    query('priority').optional().isIn(['none', 'low', 'medium', 'high', 'urgent']).withMessage('Invalid priority'),
    query('archived').optional().isIn(['true', 'false']).withMessage('Archived must be true or false'),
  ],
  validateRequest,
  taskController.getTasks
);
router.post(
  '/',
  boardAccess('member'),
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }).withMessage('Title must be 200 characters or less'),
    body('description').optional().isLength({ max: 5000 }).withMessage('Description must be 5000 characters or less'),
    body('columnId').notEmpty().withMessage('Column ID is required'),
    body('priority').optional().isIn(['none', 'low', 'medium', 'high', 'urgent']).withMessage('Invalid priority'),
    body('status').optional().isIn(['todo', 'in-progress', 'review', 'done']).withMessage('Invalid status'),
    body('dueDate').optional().isISO8601().withMessage('Invalid date format'),
    body('startDate').optional().isISO8601().withMessage('Invalid date format'),
    body('estimatedHours').optional().isFloat({ min: 0 }).withMessage('Estimated hours must be a positive number'),
    body('assignedTo').optional().isArray().withMessage('AssignedTo must be an array'),
  ],
  validateRequest,
  taskController.createTask
);
router.get('/:taskId', taskController.getTask);
router.put(
  '/:taskId',
  boardAccess('member'),
  [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty').isLength({ max: 200 }).withMessage('Title must be 200 characters or less'),
    body('description').optional().isLength({ max: 5000 }).withMessage('Description must be 5000 characters or less'),
    body('priority').optional().isIn(['none', 'low', 'medium', 'high', 'urgent']).withMessage('Invalid priority'),
    body('status').optional().isIn(['todo', 'in-progress', 'review', 'done']).withMessage('Invalid status'),
    body('columnId').optional().notEmpty().withMessage('Column ID cannot be empty'),
    body('dueDate').optional().isISO8601().withMessage('Invalid date format'),
    body('startDate').optional().isISO8601().withMessage('Invalid date format'),
    body('estimatedHours').optional().isFloat({ min: 0 }).withMessage('Estimated hours must be a positive number'),
    body('labels').optional().isArray().withMessage('Labels must be an array'),
  ],
  validateRequest,
  taskController.updateTask
);
router.delete('/:taskId', boardAccess('member'), taskController.deleteTask);
router.post(
  '/:taskId/move',
  boardAccess('member'),
  [
    body('columnId').notEmpty().withMessage('Column ID is required'),
    body('position').isFloat().withMessage('Position must be a number'),
  ],
  validateRequest,
  taskController.moveTask
);
router.post('/:taskId/archive', boardAccess('member'), taskController.archiveTask);
router.post('/:taskId/watch', taskController.toggleWatch);
router.post(
  '/:taskId/assign',
  boardAccess('member'),
  [
    body('userId').isMongoId().withMessage('Invalid user ID'),
    body('action').isIn(['assign', 'unassign']).withMessage('Action must be assign or unassign'),
  ],
  validateRequest,
  taskController.assignUser
);

// Checklist
router.post(
  '/:taskId/checklist',
  boardAccess('member'),
  [body('text').trim().notEmpty().withMessage('Checklist item text is required').isLength({ max: 500 }).withMessage('Text must be 500 characters or less')],
  validateRequest,
  taskController.addChecklistItem
);
router.put(
  '/:taskId/checklist/:itemId',
  boardAccess('member'),
  [
    body('text').optional().trim().notEmpty().withMessage('Text cannot be empty').isLength({ max: 500 }).withMessage('Text must be 500 characters or less'),
    body('completed').optional().isBoolean().withMessage('Completed must be a boolean'),
  ],
  validateRequest,
  taskController.updateChecklistItem
);
router.delete('/:taskId/checklist/:itemId', boardAccess('member'), taskController.deleteChecklistItem);

// Attachments
router.post('/:taskId/attachments', boardAccess('member'), upload.single('file'), taskController.uploadAttachment);
router.delete('/:taskId/attachments/:attachmentId', boardAccess('member'), taskController.deleteAttachment);

// Time tracking
router.post('/:taskId/time/start', boardAccess('member'), taskController.startTimer);
router.post(
  '/:taskId/time/stop',
  boardAccess('member'),
  [body('note').optional().isString().withMessage('Note must be a string')],
  validateRequest,
  taskController.stopTimer
);

// Comments (nested)
router.get(
  '/:taskId/comments',
  [query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer')],
  validateRequest,
  commentController.getComments
);
router.post(
  '/:taskId/comments',
  boardAccess('member'),
  [body('content').trim().notEmpty().withMessage('Comment content is required').isLength({ max: 2000 }).withMessage('Comment must be 2000 characters or less')],
  validateRequest,
  commentController.addComment
);
router.put(
  '/:taskId/comments/:commentId',
  boardAccess('member'),
  [body('content').trim().notEmpty().withMessage('Content cannot be empty').isLength({ max: 2000 }).withMessage('Content must be 2000 characters or less')],
  validateRequest,
  commentController.editComment
);
router.delete('/:taskId/comments/:commentId', boardAccess('member'), commentController.deleteComment);
router.post(
  '/:taskId/comments/:commentId/reactions',
  boardAccess('member'),
  [body('emoji').notEmpty().withMessage('Emoji is required')],
  validateRequest,
  commentController.addReaction
);

module.exports = router;
