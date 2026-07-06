const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const router = express.Router();
const boardController = require('../controllers/boardController');
const authMiddleware = require('../middlewares/auth');
const boardAccess = require('../middlewares/boardAccess');
const { apiLimiter } = require('../middlewares/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

router.use(authMiddleware, apiLimiter);

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR', errors.array()[0].path));
  }
  next();
};

// Board CRUD
router.get('/', boardController.getBoards);
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 100 }).withMessage('Title must be 100 characters or less'),
    body('description').optional().isLength({ max: 500 }).withMessage('Description must be 500 characters or less'),
    body('coverColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  ],
  validateRequest,
  boardController.createBoard
);
router.get('/:boardId', boardAccess('viewer'), boardController.getBoard);
router.put(
  '/:boardId',
  boardAccess('admin'),
  [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty').isLength({ max: 100 }).withMessage('Title must be 100 characters or less'),
    body('description').optional().isLength({ max: 500 }).withMessage('Description must be 500 characters or less'),
    body('coverColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
    body('settings').optional().isObject().withMessage('Settings must be an object'),
  ],
  validateRequest,
  boardController.updateBoard
);
router.delete('/:boardId', boardAccess('owner'), boardController.deleteBoard);
router.post('/:boardId/archive', boardAccess('admin'), boardController.archiveBoard);
router.post('/:boardId/star', boardAccess('viewer'), boardController.starBoard);

// Members
router.post(
  '/:boardId/invite',
  boardAccess('admin'),
  [
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('role').optional().isIn(['owner', 'admin', 'member', 'viewer']).withMessage('Invalid role'),
  ],
  validateRequest,
  boardController.inviteMember
);
router.post('/accept-invite/:token', boardController.acceptInvite);
router.put(
  '/:boardId/members/:userId',
  boardAccess('admin'),
  [
    param('userId').isMongoId().withMessage('Invalid user ID'),
    body('role').isIn(['admin', 'member', 'viewer']).withMessage('Invalid role'),
  ],
  validateRequest,
  boardController.updateMemberRole
);
router.delete(
  '/:boardId/members/:userId',
  boardAccess('member'),
  [param('userId').isMongoId().withMessage('Invalid user ID')],
  validateRequest,
  boardController.removeMember
);

// Columns
router.post(
  '/:boardId/columns',
  boardAccess('admin'),
  [
    body('title').trim().notEmpty().withMessage('Column title is required').isLength({ max: 50 }).withMessage('Title must be 50 characters or less'),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  ],
  validateRequest,
  boardController.addColumn
);
router.put(
  '/:boardId/columns/reorder',
  boardAccess('admin'),
  [
    body('columns').isArray({ min: 1 }).withMessage('Columns must be a non-empty array'),
    body('columns.*.id').notEmpty().withMessage('Column ID is required'),
    body('columns.*.position').isInt({ min: 0 }).withMessage('Position must be a non-negative integer'),
  ],
  validateRequest,
  boardController.reorderColumns
);
router.put(
  '/:boardId/columns/:columnId',
  boardAccess('admin'),
  [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty').isLength({ max: 50 }).withMessage('Title must be 50 characters or less'),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  ],
  validateRequest,
  boardController.updateColumn
);
router.delete(
  '/:boardId/columns/:columnId',
  boardAccess('admin'),
  [param('columnId').notEmpty().withMessage('Column ID is required')],
  validateRequest,
  boardController.deleteColumn
);

// Labels
router.post(
  '/:boardId/labels',
  boardAccess('admin'),
  [
    body('name').trim().notEmpty().withMessage('Label name is required').isLength({ max: 30 }).withMessage('Name must be 30 characters or less'),
    body('color').matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  ],
  validateRequest,
  boardController.addLabel
);
router.put(
  '/:boardId/labels/:labelId',
  boardAccess('admin'),
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 30 }).withMessage('Name must be 30 characters or less'),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  ],
  validateRequest,
  boardController.updateLabel
);
router.delete(
  '/:boardId/labels/:labelId',
  boardAccess('admin'),
  [param('labelId').notEmpty().withMessage('Label ID is required')],
  validateRequest,
  boardController.deleteLabel
);

// Activity & Analytics
router.get(
  '/:boardId/activity',
  boardAccess('viewer'),
  [
    param('boardId').isMongoId().withMessage('Invalid board ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  ],
  validateRequest,
  boardController.getBoardActivity
);
router.get(
  '/:boardId/analytics',
  boardAccess('viewer'),
  [
    param('boardId').isMongoId().withMessage('Invalid board ID'),
    query('range').optional().isInt({ min: 1, max: 365 }).withMessage('Range must be between 1 and 365 days'),
  ],
  validateRequest,
  boardController.getBoardAnalytics
);

module.exports = router;
