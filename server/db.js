const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'fittoscroll.db');
let db;

function getDb() {
    if (!db) {
        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    }
    return db;
}

function initDb() {
    const d = getDb();

    d.exec(`
        CREATE TABLE IF NOT EXISTS users (
            tg_id       INTEGER PRIMARY KEY,
            first_name  TEXT NOT NULL DEFAULT '',
            last_name   TEXT DEFAULT '',
            username    TEXT DEFAULT '',
            photo_url   TEXT DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS workouts (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id            INTEGER NOT NULL REFERENCES users(tg_id),
            exercise_type    TEXT NOT NULL CHECK (exercise_type IN ('squats', 'pushUps', 'plank')),
            total_reps       INTEGER NOT NULL DEFAULT 0,
            total_hold_time  REAL NOT NULL DEFAULT 0,
            total_duration   REAL NOT NULL DEFAULT 0,
            good_count       INTEGER NOT NULL DEFAULT 0,
            acceptable_count INTEGER NOT NULL DEFAULT 0,
            poor_count       INTEGER NOT NULL DEFAULT 0,
            avg_depth        REAL DEFAULT NULL,
            best_depth       REAL DEFAULT NULL,
            best_hold        REAL DEFAULT NULL,
            started_at       TEXT NOT NULL,
            ended_at         TEXT NOT NULL,
            created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS workout_reps (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id    INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
            rep_number    INTEGER NOT NULL,
            deepest_angle REAL NOT NULL,
            depth_percent REAL NOT NULL,
            form_quality  TEXT NOT NULL CHECK (form_quality IN ('good', 'acceptable', 'poor')),
            duration      REAL NOT NULL,
            timestamp     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workout_holds (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
            hold_number INTEGER NOT NULL,
            duration    REAL NOT NULL,
            avg_quality TEXT NOT NULL CHECK (avg_quality IN ('good', 'acceptable', 'poor', 'unknown')),
            timestamp   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_totals (
            tg_id           INTEGER NOT NULL REFERENCES users(tg_id),
            exercise_type   TEXT NOT NULL,
            day             TEXT NOT NULL,
            total_reps      INTEGER NOT NULL DEFAULT 0,
            total_hold_time REAL NOT NULL DEFAULT 0,
            workout_count   INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (tg_id, exercise_type, day)
        );
    `);

    // Create indexes if they don't exist
    d.exec(`
        CREATE INDEX IF NOT EXISTS idx_workouts_user_type ON workouts(tg_id, exercise_type);
        CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(tg_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_workouts_type_date ON workouts(exercise_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_daily_totals_day ON daily_totals(day, exercise_type);
    `);

    console.log('Database initialized at', DB_PATH);
}

// ========== User helpers ==========

function upsertUser(user) {
    const d = getDb();
    d.prepare(`
        INSERT INTO users (tg_id, first_name, last_name, username, photo_url)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tg_id) DO UPDATE SET
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            username = excluded.username,
            photo_url = excluded.photo_url,
            updated_at = datetime('now')
    `).run(user.id, user.first_name || '', user.last_name || '', user.username || '', user.photo_url || '');
}

// ========== Workout helpers ==========

function insertWorkout(tgId, data) {
    const d = getDb();

    const reps = data.reps || [];
    const holds = data.holds || [];
    const isRepBased = data.exerciseType !== 'plank';

    // Compute aggregates
    let goodCount = 0, acceptableCount = 0, poorCount = 0;
    const qualityItems = isRepBased ? reps.map(r => r.formQuality) : holds.map(h => h.averageQuality);
    for (const q of qualityItems) {
        if (q === 'good') goodCount++;
        else if (q === 'acceptable') acceptableCount++;
        else if (q === 'poor') poorCount++;
    }

    const avgDepth = reps.length > 0
        ? reps.reduce((s, r) => s + (r.depthPercent || 0), 0) / reps.length
        : null;
    const bestDepth = reps.length > 0
        ? Math.max(...reps.map(r => r.depthPercent || 0))
        : null;
    const bestHold = holds.length > 0
        ? Math.max(...holds.map(h => h.duration || 0))
        : null;
    const totalHoldTime = holds.reduce((s, h) => s + (h.duration || 0), 0);

    const insertWorkoutStmt = d.prepare(`
        INSERT INTO workouts (tg_id, exercise_type, total_reps, total_hold_time, total_duration,
            good_count, acceptable_count, poor_count, avg_depth, best_depth, best_hold, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRepStmt = d.prepare(`
        INSERT INTO workout_reps (workout_id, rep_number, deepest_angle, depth_percent, form_quality, duration, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertHoldStmt = d.prepare(`
        INSERT INTO workout_holds (workout_id, hold_number, duration, avg_quality, timestamp)
        VALUES (?, ?, ?, ?, ?)
    `);

    const upsertDailyStmt = d.prepare(`
        INSERT INTO daily_totals (tg_id, exercise_type, day, total_reps, total_hold_time, workout_count)
        VALUES (?, ?, date(?), ?, ?, 1)
        ON CONFLICT(tg_id, exercise_type, day) DO UPDATE SET
            total_reps = daily_totals.total_reps + excluded.total_reps,
            total_hold_time = daily_totals.total_hold_time + excluded.total_hold_time,
            workout_count = daily_totals.workout_count + 1
    `);

    const result = d.transaction(() => {
        const info = insertWorkoutStmt.run(
            tgId, data.exerciseType, reps.length, totalHoldTime, data.totalDuration || 0,
            goodCount, acceptableCount, poorCount, avgDepth, bestDepth, bestHold,
            new Date(data.startedAt).toISOString(), new Date(data.endedAt).toISOString()
        );
        const workoutId = info.lastInsertRowid;

        for (const rep of reps) {
            insertRepStmt.run(workoutId, rep.id, rep.deepestAngle || 0, rep.depthPercent || 0,
                rep.formQuality || 'poor', rep.duration || 0, rep.timestamp || 0);
        }

        for (const hold of holds) {
            insertHoldStmt.run(workoutId, hold.id, hold.duration || 0,
                hold.averageQuality || 'unknown', hold.timestamp || 0);
        }

        upsertDailyStmt.run(tgId, data.exerciseType,
            new Date(data.endedAt).toISOString(), reps.length, totalHoldTime);

        return workoutId;
    })();

    return result;
}

// ========== Stats helpers ==========

function getDateFilter(period) {
    switch (period) {
        case 'today': return "date('now')";
        case 'week':  return "date('now', '-7 days')";
        case 'month': return "date('now', '-30 days')";
        default:      return "'1970-01-01'";
    }
}

function getUserStats(tgId, exercise, period) {
    const d = getDb();
    const dateFrom = getDateFilter(period);

    let exerciseFilter = '';
    const params = [tgId];
    if (exercise && exercise !== 'all') {
        exerciseFilter = 'AND exercise_type = ?';
        params.push(exercise);
    }

    // Summary
    const summary = d.prepare(`
        SELECT
            COUNT(*) as totalWorkouts,
            COALESCE(SUM(total_reps), 0) as totalReps,
            COALESCE(SUM(total_hold_time), 0) as totalHoldTime,
            COALESCE(MAX(total_reps), 0) as bestSingleWorkoutReps,
            COALESCE(MAX(best_hold), 0) as bestSingleHold,
            COALESCE(SUM(good_count), 0) as goodTotal,
            COALESCE(SUM(acceptable_count), 0) as acceptableTotal,
            COALESCE(SUM(poor_count), 0) as poorTotal
        FROM workouts
        WHERE tg_id = ? ${exerciseFilter}
        AND date(created_at) >= ${dateFrom}
    `).get(...params);

    // History by day
    const history = d.prepare(`
        SELECT
            date(created_at) as date,
            COUNT(*) as workouts,
            SUM(total_reps) as totalReps,
            SUM(total_hold_time) as totalHoldTime
        FROM workouts
        WHERE tg_id = ? ${exerciseFilter}
        AND date(created_at) >= ${dateFrom}
        GROUP BY date(created_at)
        ORDER BY date(created_at) DESC
    `).all(...params);

    // Streak (consecutive days with at least 1 workout)
    const allDays = d.prepare(`
        SELECT DISTINCT date(created_at) as day
        FROM workouts WHERE tg_id = ?
        ORDER BY day DESC
    `).all(tgId);

    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < allDays.length; i++) {
        const day = allDays[i].day;
        const expected = new Date();
        expected.setDate(expected.getDate() - i);
        const expectedStr = expected.toISOString().slice(0, 10);

        if (day === expectedStr) {
            streak++;
            longestStreak = Math.max(longestStreak, streak);
        } else {
            if (i === 0 && day !== today) {
                // No workout today — streak might start from yesterday
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                if (day === yesterday.toISOString().slice(0, 10)) {
                    streak = 1;
                    // Re-check from i+1
                    continue;
                }
            }
            break;
        }
    }
    currentStreak = streak;

    // Personal bests (all time)
    const personalBests = {};
    for (const ex of ['squats', 'pushUps', 'plank']) {
        const best = d.prepare(`
            SELECT MAX(total_reps) as maxReps, MAX(best_depth) as bestDepth,
                   MAX(best_hold) as longestHold, MAX(total_hold_time) as totalHoldRecord
            FROM workouts WHERE tg_id = ? AND exercise_type = ?
        `).get(tgId, ex);
        personalBests[ex] = best;
    }

    // Recent workouts
    const recent = d.prepare(`
        SELECT id, exercise_type, total_reps, total_hold_time, total_duration,
               good_count, acceptable_count, poor_count, avg_depth, best_hold, created_at
        FROM workouts
        WHERE tg_id = ? ${exerciseFilter}
        AND date(created_at) >= ${dateFrom}
        ORDER BY created_at DESC
        LIMIT 20
    `).all(...params);

    return {
        summary: {
            ...summary,
            currentStreak,
            longestStreak,
            avgRepsPerWorkout: summary.totalWorkouts > 0
                ? Math.round(summary.totalReps / summary.totalWorkouts * 10) / 10 : 0,
        },
        history,
        personalBests,
        recentWorkouts: recent,
    };
}

function getWorkoutDetail(workoutId, tgId) {
    const d = getDb();
    const workout = d.prepare('SELECT * FROM workouts WHERE id = ? AND tg_id = ?').get(workoutId, tgId);
    if (!workout) return null;

    const reps = d.prepare('SELECT * FROM workout_reps WHERE workout_id = ? ORDER BY rep_number').all(workoutId);
    const holds = d.prepare('SELECT * FROM workout_holds WHERE workout_id = ? ORDER BY hold_number').all(workoutId);

    return { ...workout, reps, holds };
}

// ========== Leaderboard ==========

function getLeaderboard(exercise, period, limit = 50, myTgId = null) {
    const d = getDb();
    const dateFrom = getDateFilter(period);
    const valueColumn = exercise === 'plank' ? 'total_hold_time' : 'total_reps';

    const rankings = d.prepare(`
        SELECT
            u.tg_id, u.first_name, u.last_name, u.username, u.photo_url,
            COALESCE(SUM(dt.${valueColumn}), 0) as value,
            COALESCE(SUM(dt.workout_count), 0) as workoutCount
        FROM daily_totals dt
        JOIN users u ON u.tg_id = dt.tg_id
        WHERE dt.exercise_type = ?
        AND dt.day >= ${dateFrom}
        GROUP BY dt.tg_id
        HAVING value > 0
        ORDER BY value DESC
        LIMIT ?
    `).all(exercise, limit);

    // Add rank
    rankings.forEach((r, i) => { r.rank = i + 1; });

    // Find my rank
    let myRank = null;
    if (myTgId) {
        const found = rankings.find(r => r.tg_id === myTgId);
        if (found) {
            myRank = { rank: found.rank, value: found.value, workoutCount: found.workoutCount };
        } else {
            // Not in top — find my position
            const my = d.prepare(`
                SELECT COALESCE(SUM(dt.${valueColumn}), 0) as value,
                       COALESCE(SUM(dt.workout_count), 0) as workoutCount
                FROM daily_totals dt
                WHERE dt.tg_id = ? AND dt.exercise_type = ? AND dt.day >= ${dateFrom}
            `).get(myTgId, exercise);

            if (my && my.value > 0) {
                const above = d.prepare(`
                    SELECT COUNT(DISTINCT dt.tg_id) as cnt
                    FROM daily_totals dt
                    WHERE dt.exercise_type = ? AND dt.day >= ${dateFrom}
                    GROUP BY dt.tg_id
                    HAVING SUM(dt.${valueColumn}) > ?
                `).all(exercise, my.value);
                myRank = { rank: above.length + 1, value: my.value, workoutCount: my.workoutCount };
            }
        }
    }

    return { exercise, period, rankings, myRank };
}

module.exports = { initDb, getDb, upsertUser, insertWorkout, getUserStats, getWorkoutDetail, getLeaderboard };
