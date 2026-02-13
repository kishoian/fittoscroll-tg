import { api } from './api.js';

let currentExercise = 'squats';
let currentPeriod = 'week';

export async function showLeaderboardScreen() {
    const container = document.getElementById('leaderboard-content');
    container.innerHTML = '<div class="loading-inline"><div class="spinner"></div></div>';

    setupTabs();
    await loadLeaderboard();
}

function setupTabs() {
    document.querySelectorAll('#lb-exercise-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#lb-exercise-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentExercise = btn.dataset.value;
            loadLeaderboard();
        });
    });

    document.querySelectorAll('#lb-period-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#lb-period-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.value;
            loadLeaderboard();
        });
    });
}

async function loadLeaderboard() {
    const container = document.getElementById('leaderboard-content');

    try {
        const data = await api.getLeaderboard(currentExercise, currentPeriod);
        renderLeaderboard(container, data);
    } catch (err) {
        console.error('Failed to load leaderboard:', err);
        container.innerHTML = '<div class="empty-state">Не удалось загрузить лидерборд</div>';
    }
}

function renderLeaderboard(container, data) {
    const { rankings, myRank } = data;

    if (rankings.length === 0) {
        container.innerHTML = '<div class="empty-state">Пока нет данных.<br>Начни первую тренировку!</div>';
        return;
    }

    const isPlank = currentExercise === 'plank';
    let html = '<div class="lb-list">';

    rankings.forEach((entry, i) => {
        const rank = entry.rank || (i + 1);
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
        const isMe = myRank && entry.tg_id === myRank.tg_id;
        const value = isPlank ? fmtTime(entry.value) : entry.value;
        const unit = isPlank ? '' : ' повт.';
        const name = entry.first_name + (entry.last_name ? ` ${entry.last_name.charAt(0)}.` : '');
        const avatar = entry.photo_url
            ? `<img class="lb-avatar" src="${entry.photo_url}" alt="">`
            : `<div class="lb-avatar lb-avatar-placeholder">${(entry.first_name || '?').charAt(0)}</div>`;

        html += `
            <div class="lb-row${isMe ? ' lb-row-me' : ''}${rank <= 3 ? ' lb-row-top' : ''}">
                <div class="lb-rank">${medal}</div>
                ${avatar}
                <div class="lb-info">
                    <div class="lb-name">${name}</div>
                    <div class="lb-workouts">${entry.workoutCount} трен.</div>
                </div>
                <div class="lb-value">${value}${unit}</div>
            </div>
        `;
    });

    html += '</div>';

    // Sticky "my position" if I'm not in visible top
    if (myRank && myRank.rank > rankings.length) {
        const value = isPlank ? fmtTime(myRank.value) : myRank.value;
        const unit = isPlank ? '' : ' повт.';

        html += `
            <div class="lb-my-position">
                <div class="lb-row lb-row-me">
                    <div class="lb-rank">${myRank.rank}</div>
                    <div class="lb-avatar lb-avatar-placeholder">Я</div>
                    <div class="lb-info">
                        <div class="lb-name">Моя позиция</div>
                        <div class="lb-workouts">${myRank.workoutCount} трен.</div>
                    </div>
                    <div class="lb-value">${value}${unit}</div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

function fmtTime(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const t = Math.floor(seconds);
    return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
}
