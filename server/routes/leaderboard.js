const express = require('express');
const router = express.Router();
const { getLeaderboard } = require('../db');

// GET /api/leaderboard — rankings
router.get('/leaderboard', (req, res) => {
    try {
        const user = req.tgUser;
        const exercise = req.query.exercise || 'squats';
        const period = req.query.period || 'week';
        const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 50));

        if (!['squats', 'pushUps', 'plank'].includes(exercise)) {
            return res.status(400).json({ error: 'Invalid exercise' });
        }
        if (!['today', 'week', 'month', 'all'].includes(period)) {
            return res.status(400).json({ error: 'Invalid period' });
        }

        const result = getLeaderboard(exercise, period, limit, user.id);
        res.json(result);
    } catch (err) {
        console.error('Error getting leaderboard:', err);
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

module.exports = router;
