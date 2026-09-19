import { Router } from 'express';

import { orderBookHandler } from '../controllers/marketController.js';

const router = Router();

router.get('/:pair/orderbook', orderBookHandler);

export default router;
