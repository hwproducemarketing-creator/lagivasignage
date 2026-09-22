import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getRecentActivity } from '../services/activity.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ activity: getRecentActivity(limit) });
});

export default router;
