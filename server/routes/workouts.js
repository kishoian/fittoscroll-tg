const express = require('express');
const router = express.Router();
const { upsertUser, insertWorkout } = require('../db');

// POST /api/workouts — save a completed workout
router.post('/workouts', (req, res) => {
    try {
        const user = req.tgUser;
        const data = req.body;

        // Validate required fields
        if (!data.exerciseType || !['squats', 'pushUps', 'plank'].includes(data.exerciseType)) {
            return res.status(400).json({ error: 'Invalid exercise type' });
        }
        if (typeof data.totalDuration !== 'number' || data.totalDuration < 0) {
            return res.status(400).json({ error: 'Invalid duration' });
        }

        // Basic sanity checks
        const reps = Array.isArray(data.reps) ? data.reps : [];
        const holds = Array.isArray(data.holds) ? data.holds : [];
        if (reps.length > 500) return res.status(400).json({ error: 'Too many reps' });
        if (holds.length > 100) return res.status(400).json({ error: 'Too many holds' });

        // Upsert user
        upsertUser(user);

        // Insert workout
        const workoutId = insertWorkout(user.id, data);

        res.json({ id: workoutId, saved: true });
    } catch (err) {
        console.error('Error saving workout:', err);
        res.status(500).json({ error: 'Failed to save workout' });
    }
});

module.exports = router;
