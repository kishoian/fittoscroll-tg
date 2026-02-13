// ========== Pose Joints ==========

export const PoseJoint = {
    nose: 'nose',
    leftShoulder: 'leftShoulder',
    rightShoulder: 'rightShoulder',
    leftElbow: 'leftElbow',
    rightElbow: 'rightElbow',
    leftWrist: 'leftWrist',
    rightWrist: 'rightWrist',
    leftHip: 'leftHip',
    rightHip: 'rightHip',
    leftKnee: 'leftKnee',
    rightKnee: 'rightKnee',
    leftAnkle: 'leftAnkle',
    rightAnkle: 'rightAnkle',
};

// MediaPipe Pose landmark index -> our PoseJoint mapping
export const MEDIAPIPE_TO_JOINT = {
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

// ========== Exercise Types ==========

export const ExerciseType = {
    squats: {
        key: 'squats',
        displayName: 'Приседания',
        isRepBased: true,
        guidanceText: 'Отойди на 2-3 метра.\nВ кадре должны быть плечи, таз, колени и стопы.',
    },
    pushUps: {
        key: 'pushUps',
        displayName: 'Отжимания',
        isRepBased: true,
        guidanceText: 'Поставь телефон сбоку на уровне пола.\nВ кадре должны быть плечи, локти и стопы.',
    },
    plank: {
        key: 'plank',
        displayName: 'Планка',
        isRepBased: false,
        guidanceText: 'Поставь телефон сбоку на уровне пола.\nВ кадре должны быть плечи, таз и стопы.',
    },
};

// ========== Form Quality ==========

export const FormQuality = {
    unknown: 'unknown',
    good: 'good',
    acceptable: 'acceptable',
    poor: 'poor',
};

export const QUALITY_TITLES = {
    unknown: 'Ожидание',
    good: 'Техника: хорошо',
    acceptable: 'Техника: допустимо',
    poor: 'Техника: поправить',
};

const QUALITY_RANK = { good: 0, acceptable: 1, poor: 2, unknown: 3 };

export function isWorseThan(a, b) {
    return QUALITY_RANK[a] > QUALITY_RANK[b];
}

export function degradeQuality(q) {
    if (q === 'good') return 'acceptable';
    if (q === 'acceptable') return 'poor';
    return q;
}

// ========== Math Utilities ==========

export function angleDegrees(a, b, c) {
    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const baMag = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
    const bcMag = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
    if (baMag < 0.0001 || bcMag < 0.0001) return 0;
    const dot = ba.x * bc.x + ba.y * bc.y;
    const cosine = Math.max(-1, Math.min(1, dot / (baMag * bcMag)));
    return Math.acos(cosine) * (180 / Math.PI);
}

export function midpoint(a, b) {
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

export function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export function averagePoint(a, b) {
    if (a && b) return midpoint(a, b);
    return a || b || null;
}
