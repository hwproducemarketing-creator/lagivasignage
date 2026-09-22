import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  logActivity('login', `Admin logged in: ${user.username}`);

  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

router.post('/logout', requireAuth, (req, res) => {
  const username = req.session.username;
  req.session.destroy(() => {
    logActivity('logout', `Admin logged out: ${username || 'unknown'}`);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({ user });
});

export default router;
