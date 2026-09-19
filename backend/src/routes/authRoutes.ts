import { Router } from 'express';

import { loginHandler, refreshHandler, registerHandler } from '../controllers/authController.js';

const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/refresh', refreshHandler);

export default router;
