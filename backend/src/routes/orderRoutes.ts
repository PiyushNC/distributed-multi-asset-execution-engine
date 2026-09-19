import { Router } from 'express';

import {
  cancelOrderHandler,
  createOrderHandler,
  listOrdersHandler,
} from '../controllers/orderController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.use(requireAuth);
router.post('/', createOrderHandler);
router.get('/', listOrdersHandler);
router.delete('/:id', cancelOrderHandler);

export default router;
