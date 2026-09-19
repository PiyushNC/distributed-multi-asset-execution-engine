import { Router } from 'express';

import { meHandler } from '../controllers/userController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/me', requireAuth, meHandler);

export default router;
