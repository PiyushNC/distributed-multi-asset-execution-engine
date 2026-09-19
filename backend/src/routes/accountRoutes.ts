import { Router } from 'express';

import { accountHandler } from '../controllers/accountController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.get('/', requireAuth, accountHandler);

export default router;
