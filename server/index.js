require('dotenv').config();

const express = require('express');
const { initDb } = require('./db');
const { authMiddleware } = require('./auth');
const workoutRoutes = require('./routes/workouts');
const statsRoutes = require('./routes/stats');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();
app.use(express.json({ limit: '1mb' }));

// All /api routes require Telegram auth
app.use('/api', authMiddleware);

app.use('/api', workoutRoutes);
app.use('/api', statsRoutes);
app.use('/api', leaderboardRoutes);

// Health check (no auth)
app.get('/health', (req, res) => res.json({ ok: true }));

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
initDb();
app.listen(PORT, '127.0.0.1', () => {
    console.log(`FitToScroll API running on port ${PORT}`);
});
