import { api } from './fts-api.js';

let currentPeriod = 'week';
let currentExercise = 'all';

export async function showStatsScreen() {
    const container = document.getElementById('stats-content');
    container.innerHTML = '<div class="loading-inline"><div class="spinner"></div></div>';

    // Attach tab handlers
    setupTabs();

    await loadStats();
}

function setupTabs() {
    document.querySelectorAll('#stats-period-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#stats-period-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.value;
            loadStats();
        });
    });

    document.querySelectorAll('#stats-exercise-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#stats-exercise-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentExercise = btn.dataset.value;
            loadStats();
        });
    });
}

async function loadStats() {
    const container = document.getElementById('stats-content');

    try {
        const data = await api.getStats(currentExercise, currentPeriod);
        renderStats(container, data);
    } catch (err) {
        console.error('Failed to load stats:', err);
        container.innerHTML = '<div class="empty-state">Не удалось загрузить статистику</div>';
    }
}

function renderStats(container, data) {
    const s = data.summary;
    const qTotal = s.goodTotal + s.acceptableTotal + s.poorTotal;

    let html = `
        <div class="stats-grid">
            ${statCard('Тренировок', s.totalWorkouts)}
            ${statCard('Повторений', s.totalReps)}
            ${statCard('Серия дней', `${s.currentStreak} 🔥`)}
            ${statCard('Лучшая', s.bestSingleWorkoutReps > 0 ? `${s.bestSingleWorkoutReps} повт.` : fmtTime(s.bestSingleHold))}
        </div>
    `;

    // Form quality distribution
    if (qTotal > 0) {
        const gPct = Math.round(s.goodTotal / qTotal * 100);
        const aPct = Math.round(s.acceptableTotal / qTotal * 100);
        const pPct = Math.round(s.poorTotal / qTotal * 100);
        html += `
            <div class="form-distribution">
                <div class="form-dist-title">Качество техники</div>
                <div class="form-bar">
                    ${s.goodTotal > 0 ? `<div class="form-bar-segment good" style="flex:${s.goodTotal}"></div>` : ''}
                    ${s.acceptableTotal > 0 ? `<div class="form-bar-segment acceptable" style="flex:${s.acceptableTotal}"></div>` : ''}
                    ${s.poorTotal > 0 ? `<div class="form-bar-segment poor" style="flex:${s.poorTotal}"></div>` : ''}
                </div>
                <div class="form-legend">
                    <div class="legend-item"><div class="legend-dot good"></div>${gPct}%</div>
                    <div class="legend-item"><div class="legend-dot acceptable"></div>${aPct}%</div>
                    <div class="legend-item"><div class="legend-dot poor"></div>${pPct}%</div>
                </div>
            </div>
        `;
    }

    // Activity heatmap (last 28 days)
    if (data.history.length > 0) {
        html += renderHeatmap(data.history);
    }

    // Personal bests
    const pb = data.personalBests;
    html += `
        <div class="section-card">
            <div class="section-title">Персональные рекорды</div>
            <div class="pb-list">
                ${pbRow('🏋️ Приседания', pb.squats?.maxReps ? `${pb.squats.maxReps} повт.` : '—')}
                ${pbRow('💪 Отжимания', pb.pushUps?.maxReps ? `${pb.pushUps.maxReps} повт.` : '—')}
                ${pbRow('🧘 Планка', pb.plank?.longestHold ? fmtTime(pb.plank.longestHold) : '—')}
            </div>
        </div>
    `;

    // Recent workouts
    if (data.recentWorkouts.length > 0) {
        html += `
            <div class="section-card">
                <div class="section-title">Последние тренировки</div>
                ${data.recentWorkouts.map(w => {
                    const icon = w.exercise_type === 'squats' ? '🏋️' : w.exercise_type === 'pushUps' ? '💪' : '🧘';
                    const value = w.exercise_type === 'plank' ? fmtTime(w.total_hold_time) : `${w.total_reps} повт.`;
                    const date = new Date(w.created_at);
                    const dateStr = `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
                    const dots = qualityDots(w.good_count, w.acceptable_count, w.poor_count);
                    return `
                        <div class="recent-workout-row">
                            <span class="rw-icon">${icon}</span>
                            <span class="rw-value">${value}</span>
                            <span class="rw-dots">${dots}</span>
                            <span class="rw-date">${dateStr}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    if (s.totalWorkouts === 0) {
        html = '<div class="empty-state">Пока нет тренировок.<br>Начни первую!</div>';
    }

    container.innerHTML = html;
}

function renderHeatmap(history) {
    const map = {};
    for (const h of history) map[h.date] = h;

    let cells = '';
    for (let i = 27; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const entry = map[key];
        const level = entry
            ? (entry.workouts >= 3 ? 'high' : entry.workouts >= 2 ? 'mid' : 'low')
            : 'empty';
        cells += `<div class="heatmap-cell ${level}" title="${key}"></div>`;
    }

    return `
        <div class="section-card">
            <div class="section-title">Активность (28 дней)</div>
            <div class="heatmap-grid">${cells}</div>
        </div>
    `;
}

function statCard(title, value) {
    return `<div class="stat-card"><div class="stat-card-title">${title}</div><div class="stat-card-value">${value}</div></div>`;
}

function pbRow(label, value) {
    return `<div class="pb-row"><span>${label}</span><span class="pb-value">${value}</span></div>`;
}

function qualityDots(g, a, p) {
    return '<span class="quality-mini good"></span>'.repeat(Math.min(g, 5)) +
           '<span class="quality-mini acceptable"></span>'.repeat(Math.min(a, 3)) +
           '<span class="quality-mini poor"></span>'.repeat(Math.min(p, 3));
}

function fmtTime(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const t = Math.floor(seconds);
    return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
}
