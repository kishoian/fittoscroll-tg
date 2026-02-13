const express = require('express');
const router = express.Router();
const { getUserStats, getWorkoutDetail, upsertUser } = require('../db');

// GET /api/stats — personal statistics
router.get('/stats', (req, res) => {
    try {
        const user = req.tgUser;
        const exercise = req.query.exercise || 'all';
        const period = req.query.period || 'all';

        if (!['all', 'squats', 'pushUps', 'plank'].includes(exercise)) {
            return res.status(400).json({ error: 'Invalid exercise filter' });
        }
        if (!['today', 'week', 'month', 'all'].includes(period)) {
            return res.status(400).json({ error: 'Invalid period' });
        }

        const stats = getUserStats(user.id, exercise, period);
        res.json(stats);
    } catch (err) {
        console.error('Error getting stats:', err);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// GET /api/stats/workout/:id — single workout detail
router.get('/stats/workout/:id', (req, res) => {
    try {
        const user = req.tgUser;
        const workoutId = parseInt(req.params.id, 10);
        if (isNaN(workoutId)) return res.status(400).json({ error: 'Invalid workout id' });

        const detail = getWorkoutDetail(workoutId, user.id);
        if (!detail) return res.status(404).json({ error: 'Workout not found' });

        res.json(detail);
    } catch (err) {
        console.error('Error getting workout detail:', err);
        res.status(500).json({ error: 'Failed to get workout' });
    }
});

// GET /api/me — current user profile + summary
router.get('/me', (req, res) => {
    try {
        const user = req.tgUser;
        upsertUser(user);

        const stats = getUserStats(user.id, 'all', 'all');
        res.json({
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name || '',
                username: user.username || '',
                photoUrl: user.photo_url || '',
            },
            summary: stats.summary,
            personalBests: stats.personalBests,
        });
    } catch (err) {
        console.error('Error getting profile:', err);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

module.exports = router;
