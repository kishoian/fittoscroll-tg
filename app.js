import { ExerciseType, PoseJoint, FormQuality } from './exercise-types.js';
import { SquatAnalyzer } from './squat-analyzer.js';
import { PushUpAnalyzer } from './pushup-analyzer.js';
import { PlankAnalyzer } from './plank-analyzer.js';

// MediaPipe Tasks Vision landmark indices -> our PoseJoint
const MP_INDEX_TO_JOINT = {
    0: PoseJoint.nose,
    11: PoseJoint.leftShoulder,
    12: PoseJoint.rightShoulder,
    13: PoseJoint.leftElbow,
    14: PoseJoint.rightElbow,
    15: PoseJoint.leftWrist,
    16: PoseJoint.rightWrist,
    23: PoseJoint.leftHip,
    24: PoseJoint.rightHip,
    25: PoseJoint.leftKnee,
    26: PoseJoint.rightKnee,
    27: PoseJoint.leftAnkle,
    28: PoseJoint.rightAnkle,
};

// ========== Globals ==========

let currentScreen = 'menu';
let selectedExercise = null;
let analyzer = null;
let poseLandmarker = null;
let videoEl = null;
let canvasEl = null;
let canvasCtx = null;
let animFrameId = null;

// Workout state
let workoutRunning = false;
let workoutPaused = false;
let workoutStartTime = 0;
let elapsedBeforePause = 0;
let lastResumeTime = 0;
let timerInterval = null;

// Throttle
let lastFrameTime = 0;
const MIN_FRAME_INTERVAL = 1000 / 15;

// ========== Init ==========

document.addEventListener('DOMContentLoaded', () => {
    // Telegram Web App init
    const tg = window.Telegram?.WebApp;
    if (tg) {
        tg.ready();
        tg.expand();
        tg.isVerticalSwipesEnabled = false;

        // Set CSS variable for TG header offset
        const updateTgTop = () => {
            const top = tg.contentSafeAreaInset?.top || 0;
            const headerHeight = tg.headerColor ? 0 : 0; // TG handles its own header
            document.documentElement.style.setProperty('--tg-top', `${top + 56}px`);
        };
        updateTgTop();
        tg.onEvent('viewportChanged', updateTgTop);
    } else {
        // Not in Telegram — use safe area insets
        document.documentElement.style.setProperty('--tg-top',
            `max(${getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)') || '0px'}, 16px)`
        );
    }

    videoEl = document.getElementById('camera-feed');
    canvasEl = document.getElementById('pose-canvas');
    canvasCtx = canvasEl.getContext('2d');

    document.querySelectorAll('.exercise-card').forEach(card => {
        card.addEventListener('click', () => startExercise(card.dataset.exercise));
    });

    document.getElementById('btn-pause').addEventListener('click', togglePause);
    document.getElementById('btn-stop').addEventListener('click', finishWorkout);
    document.getElementById('btn-new-workout').addEventListener('click', backToMenu);

    showScreen('menu');
});

// ========== Screen Navigation ==========

function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`).classList.add('active');
    currentScreen = name;
}

function showLoading(show) {
    document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

// ========== Exercise Start ==========

async function startExercise(key) {
    selectedExercise = ExerciseType[key];
    if (!selectedExercise) return;

    switch (key) {
        case 'squats':  analyzer = new SquatAnalyzer(); break;
        case 'pushUps': analyzer = new PushUpAnalyzer(); break;
        case 'plank':   analyzer = new PlankAnalyzer(); break;
    }

    showScreen('workout');
    document.getElementById('hud-primary').textContent = selectedExercise.isRepBased ? '0' : '0:00';
    document.getElementById('hud-phase').textContent = '';
    document.getElementById('hud-timer').textContent = '0:00';
    setQualityDot('unknown');
    showGuidance(selectedExercise.guidanceText);

    showLoading(true);

    try {
        await initCamera();
        if (!poseLandmarker) await initPoseLandmarker();
    } catch (err) {
        console.error('Init error:', err);
        showLoading(false);
        showGuidance('Ошибка инициализации камеры.\nРазреши доступ и попробуй снова.');
        return;
    }

    showLoading(false);

    workoutRunning = true;
    workoutPaused = false;
    workoutStartTime = Date.now();
    elapsedBeforePause = 0;
    lastResumeTime = workoutStartTime;
    startTimer();
    startDetectionLoop();
}

// ========== Camera ==========

async function initCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (!canvasEl) return;
    canvasEl.width = canvasEl.clientWidth * (window.devicePixelRatio || 1);
    canvasEl.height = canvasEl.clientHeight * (window.devicePixelRatio || 1);
    if (canvasCtx) {
        canvasCtx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    }
}

// ========== MediaPipe PoseLandmarker (Tasks Vision API) ==========

async function initPoseLandmarker() {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
    const { PoseLandmarker, FilesetResolver } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });
}

// ========== Detection Loop ==========

function startDetectionLoop() {
    function loop() {
        if (currentScreen !== 'workout') return;

        const now = performance.now();
        if (now - lastFrameTime >= MIN_FRAME_INTERVAL && !workoutPaused && videoEl.readyState >= 2 && poseLandmarker) {
            lastFrameTime = now;

            let results;
            try {
                results = poseLandmarker.detectForVideo(videoEl, now);
            } catch (e) {
                // Ignore transient errors
            }

            if (results?.landmarks?.length > 0) {
                const landmarks = results.landmarks[0];
                const points = {};

                for (const [mpIdx, joint] of Object.entries(MP_INDEX_TO_JOINT)) {
                    const lm = landmarks[parseInt(mpIdx)];
                    if (lm && lm.visibility > 0.35) {
                        points[joint] = { x: lm.x, y: lm.y };
                    }
                }

                const metrics = analyzer.process(points, Date.now());
                updateHUD(metrics);
                drawPose(points);
            } else {
                updateHUD(null);
                drawPose(null);
            }
        }

        animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
}

function stopDetectionLoop() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

// ========== HUD ==========

function updateHUD(metrics) {
    if (!metrics) {
        showGuidance(selectedExercise?.guidanceText || '');
        return;
    }

    document.getElementById('hud-primary').textContent = metrics.primaryValue;
    document.getElementById('hud-phase').textContent = metrics.phase?.label || '';
    setQualityDot(metrics.quality);

    if (!metrics.bodyDetected) {
        showGuidance(selectedExercise.guidanceText);
    } else {
        hideGuidance();
    }
}

function setQualityDot(quality) {
    const dot = document.getElementById('hud-quality-dot');
    dot.className = 'hud-quality-dot';
    if (quality && quality !== 'unknown') dot.classList.add(quality);
}

function showGuidance(text) {
    const el = document.getElementById('hud-guidance');
    el.textContent = text;
    el.classList.remove('hidden');
}

function hideGuidance() {
    document.getElementById('hud-guidance').classList.add('hidden');
}

// ========== Pose Overlay ==========

const CONNECTIONS = [
    [PoseJoint.leftShoulder, PoseJoint.rightShoulder],
    [PoseJoint.leftShoulder, PoseJoint.leftElbow],
    [PoseJoint.leftElbow, PoseJoint.leftWrist],
    [PoseJoint.rightShoulder, PoseJoint.rightElbow],
    [PoseJoint.rightElbow, PoseJoint.rightWrist],
    [PoseJoint.leftShoulder, PoseJoint.leftHip],
    [PoseJoint.rightShoulder, PoseJoint.rightHip],
    [PoseJoint.leftHip, PoseJoint.rightHip],
    [PoseJoint.leftHip, PoseJoint.leftKnee],
    [PoseJoint.leftKnee, PoseJoint.leftAnkle],
    [PoseJoint.rightHip, PoseJoint.rightKnee],
    [PoseJoint.rightKnee, PoseJoint.rightAnkle],
];

function drawPose(points) {
    if (!canvasCtx || !canvasEl) return;
    const w = canvasEl.clientWidth;
    const h = canvasEl.clientHeight;
    canvasCtx.clearRect(0, 0, w, h);

    if (!points || Object.keys(points).length === 0) return;

    // Mirror X to match flipped video
    const toScreen = (p) => ({ x: (1 - p.x) * w, y: p.y * h });

    // Connections
    canvasCtx.strokeStyle = 'rgba(0, 222, 214, 0.95)';
    canvasCtx.lineWidth = 3;
    canvasCtx.lineCap = 'round';

    for (const [a, b] of CONNECTIONS) {
        if (!points[a] || !points[b]) continue;
        const pa = toScreen(points[a]);
        const pb = toScreen(points[b]);
        canvasCtx.beginPath();
        canvasCtx.moveTo(pa.x, pa.y);
        canvasCtx.lineTo(pb.x, pb.y);
        canvasCtx.stroke();
    }

    // Joints
    canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    for (const joint of Object.values(points)) {
        const p = toScreen(joint);
        canvasCtx.beginPath();
        canvasCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        canvasCtx.fill();
    }
}

// ========== Timer ==========

function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
        if (!workoutRunning || workoutPaused) return;
        let total = elapsedBeforePause;
        if (lastResumeTime) total += (Date.now() - lastResumeTime) / 1000;
        const totalSec = Math.floor(total);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        document.getElementById('hud-timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ========== Pause / Resume ==========

function togglePause() {
    if (workoutPaused) {
        workoutPaused = false;
        lastResumeTime = Date.now();
        document.getElementById('pause-icon').textContent = '⏸';
    } else {
        workoutPaused = true;
        if (lastResumeTime) {
            elapsedBeforePause += (Date.now() - lastResumeTime) / 1000;
            lastResumeTime = 0;
        }
        document.getElementById('pause-icon').textContent = '▶️';
    }
}

// ========== Finish Workout ==========

function finishWorkout() {
    workoutRunning = false;
    stopTimer();
    stopDetectionLoop();

    let totalDuration = elapsedBeforePause;
    if (lastResumeTime) totalDuration += (Date.now() - lastResumeTime) / 1000;

    stopCamera();

    const result = {
        exerciseType: selectedExercise,
        reps: analyzer?.repHistory || [],
        holds: analyzer?.holdHistory || [],
        totalDuration,
        startedAt: workoutStartTime,
        endedAt: Date.now(),
    };

    showResults(result);
}

function stopCamera() {
    if (videoEl?.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
    }
    window.removeEventListener('resize', resizeCanvas);
}

// ========== Results Screen ==========

function showResults(result) {
    const ex = result.exerciseType;

    const date = new Date(result.endedAt);
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const dateStr = `${date.getDate()} ${months[date.getMonth()]}, ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    document.getElementById('results-subtitle').textContent = `${ex.displayName} — ${dateStr}`;

    if (ex.isRepBased) {
        document.getElementById('results-hero-value').textContent = result.reps.length;
        document.getElementById('results-hero-label').textContent = 'повторений';
    } else {
        const totalHold = result.holds.reduce((s, h) => s + h.duration, 0);
        document.getElementById('results-hero-value').textContent = formatTime(totalHold);
        document.getElementById('results-hero-label').textContent = 'в планке';
    }

    const statsEl = document.getElementById('results-stats');
    statsEl.innerHTML = '';
    if (ex.isRepBased) {
        const avgDepth = result.reps.length > 0
            ? Math.round(result.reps.reduce((s, r) => s + r.depthPercent, 0) / result.reps.length * 100)
            : '--';
        const maxDepth = result.reps.length > 0
            ? Math.round(Math.max(...result.reps.map(r => r.depthPercent)) * 100)
            : '--';
        const streak = bestGoodStreak(result.reps);
        statsEl.innerHTML =
            statCard('Средняя глубина', avgDepth !== '--' ? `${avgDepth}%` : '--') +
            statCard('Макс. глубина', maxDepth !== '--' ? `${maxDepth}%` : '--') +
            statCard('Длительность', formatTime(result.totalDuration)) +
            statCard('Лучшая серия', streak > 0 ? streak : '--');
    } else {
        const totalHold = result.holds.reduce((s, h) => s + h.duration, 0);
        const bestHold = result.holds.length > 0 ? Math.max(...result.holds.map(h => h.duration)) : 0;
        statsEl.innerHTML =
            statCard('Лучший подход', bestHold > 0 ? formatTime(bestHold) : '--') +
            statCard('Подходов', result.holds.length) +
            statCard('Длительность', formatTime(result.totalDuration)) +
            statCard('Общее время', formatTime(totalHold));
    }

    // Form distribution
    const distEl = document.getElementById('results-form-dist');
    const items = ex.isRepBased ? result.reps.map(r => r.formQuality) : result.holds.map(h => h.averageQuality);
    const dist = { good: 0, acceptable: 0, poor: 0 };
    for (const q of items) { if (dist[q] !== undefined) dist[q]++; }
    const total = items.length;

    if (total > 0) {
        distEl.innerHTML = `
            <div class="form-dist-title">Качество техники</div>
            <div class="form-bar">
                ${dist.good > 0 ? `<div class="form-bar-segment good" style="flex:${dist.good}"></div>` : ''}
                ${dist.acceptable > 0 ? `<div class="form-bar-segment acceptable" style="flex:${dist.acceptable}"></div>` : ''}
                ${dist.poor > 0 ? `<div class="form-bar-segment poor" style="flex:${dist.poor}"></div>` : ''}
            </div>
            <div class="form-legend">
                <div class="legend-item"><div class="legend-dot good"></div>Хорошо: ${dist.good}</div>
                <div class="legend-item"><div class="legend-dot acceptable"></div>Допустимо: ${dist.acceptable}</div>
                <div class="legend-item"><div class="legend-dot poor"></div>Слабо: ${dist.poor}</div>
            </div>`;
    } else {
        distEl.innerHTML = `<div class="form-dist-title">Качество техники</div>
            <div style="color:rgba(255,255,255,0.3);font-size:14px">Нет данных</div>`;
    }

    // Rep / hold list
    const listEl = document.getElementById('results-rep-list');
    if (ex.isRepBased && result.reps.length > 0) {
        listEl.innerHTML = `<div class="rep-list-title">Повторения</div>` +
            result.reps.map(rep => `
                <div class="rep-row">
                    <span class="rep-id">#${rep.id}</span>
                    <div class="rep-bar-wrap">
                        <div class="rep-bar-fill ${rep.formQuality}" style="width:${Math.round(rep.depthPercent * 100)}%"></div>
                    </div>
                    <span class="rep-value">${Math.round(rep.depthPercent * 100)}%</span>
                    <div class="rep-quality-dot" style="background:var(--${qColor(rep.formQuality)})"></div>
                </div>`).join('');
    } else if (!ex.isRepBased && result.holds.length > 0) {
        const maxDur = Math.max(...result.holds.map(h => h.duration));
        listEl.innerHTML = `<div class="rep-list-title">Подходы</div>` +
            result.holds.map(hold => `
                <div class="rep-row">
                    <span class="rep-id">#${hold.id}</span>
                    <div class="rep-bar-wrap">
                        <div class="rep-bar-fill ${hold.averageQuality}" style="width:${maxDur > 0 ? Math.round(hold.duration / maxDur * 100) : 0}%"></div>
                    </div>
                    <span class="rep-value">${formatTime(hold.duration)}</span>
                    <div class="rep-quality-dot" style="background:var(--${qColor(hold.averageQuality)})"></div>
                </div>`).join('');
    } else {
        listEl.innerHTML = '';
    }

    showScreen('results');
}

function statCard(title, value) {
    return `<div class="stat-card"><div class="stat-card-title">${title}</div><div class="stat-card-value">${value}</div></div>`;
}

function qColor(q) {
    return q === 'good' ? 'green' : q === 'acceptable' ? 'yellow' : q === 'poor' ? 'red' : 'green';
}

function bestGoodStreak(reps) {
    let best = 0, cur = 0;
    for (const r of reps) {
        if (r.formQuality === 'good') { cur++; best = Math.max(best, cur); }
        else cur = 0;
    }
    return best;
}

function formatTime(seconds) {
    const t = Math.floor(seconds);
    return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
}

// ========== Back to Menu ==========

function backToMenu() {
    analyzer = null;
    selectedExercise = null;
    showScreen('menu');
}
