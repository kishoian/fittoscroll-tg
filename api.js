// ========== API Client ==========

const API_BASE = '/api';
const UNSAVED_KEY = 'fts_unsaved_workouts';

function getInitData() {
    return window.Telegram?.WebApp?.initData || '';
}

async function apiCall(method, path, body = null) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': getInitData(),
        },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error ${res.status}`);
    }
    return res.json();
}

// ========== Public API ==========

export const api = {
    saveWorkout: (data) => apiCall('POST', '/workouts', data),
    getStats: (exercise = 'all', period = 'all') =>
        apiCall('GET', `/stats?exercise=${exercise}&period=${period}`),
    getWorkoutDetail: (id) => apiCall('GET', `/stats/workout/${id}`),
    getLeaderboard: (exercise = 'squats', period = 'week') =>
        apiCall('GET', `/leaderboard?exercise=${exercise}&period=${period}`),
    getMe: () => apiCall('GET', '/me'),
};

// ========== Offline Retry ==========

export async function saveWorkoutWithRetry(data) {
    try {
        const result = await api.saveWorkout(data);
        // Try to flush any previously failed saves
        flushUnsaved();
        return result;
    } catch (err) {
        console.error('Failed to save workout, storing locally:', err);
        const unsaved = JSON.parse(localStorage.getItem(UNSAVED_KEY) || '[]');
        unsaved.push(data);
        localStorage.setItem(UNSAVED_KEY, JSON.stringify(unsaved));
        return null;
    }
}

export async function flushUnsaved() {
    const unsaved = JSON.parse(localStorage.getItem(UNSAVED_KEY) || '[]');
    if (unsaved.length === 0) return;

    const remaining = [];
    for (const data of unsaved) {
        try {
            await api.saveWorkout(data);
        } catch {
            remaining.push(data);
        }
    }

    if (remaining.length > 0) {
        localStorage.setItem(UNSAVED_KEY, JSON.stringify(remaining));
    } else {
        localStorage.removeItem(UNSAVED_KEY);
    }
}
