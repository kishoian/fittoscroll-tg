import { PoseJoint, FormQuality, angleDegrees, averagePoint, isWorseThan } from './exercise-types.js';

const Phase = { notReady: 0, up: 1, lowering: 2, bottom: 3, pushing: 4 };

export class PushUpAnalyzer {
    constructor() {
        this.exerciseType = 'pushUps';
        this.repHistory = [];
        this.holdHistory = [];
        this.resetAll();
    }

    resetAll() {
        this.phase = Phase.notReady;
        this.repCounter = 0;
        this.repHistory = [];
        this._deepestElbow = 180;
        this._worstQuality = FormQuality.good;
        this._repStartTime = null;
        this._smoothElbow = null;
        this._smoothAlignment = null;
    }

    process(points, timestamp) {
        const now = typeof timestamp === 'number' ? timestamp : timestamp.getTime();

        const leftReady = points[PoseJoint.leftShoulder] && points[PoseJoint.leftElbow] && points[PoseJoint.leftWrist];
        const rightReady = points[PoseJoint.rightShoulder] && points[PoseJoint.rightElbow] && points[PoseJoint.rightWrist];
        const hasHip = points[PoseJoint.leftHip] || points[PoseJoint.rightHip];
        const hasAnkle = points[PoseJoint.leftAnkle] || points[PoseJoint.rightAnkle];

        if ((!leftReady && !rightReady) || !hasHip) {
            this.phase = Phase.notReady;
            return this._makeMetrics(false);
        }

        // Elbow angle
        const elbowAngles = [];
        if (leftReady) {
            elbowAngles.push(angleDegrees(points[PoseJoint.leftShoulder], points[PoseJoint.leftElbow], points[PoseJoint.leftWrist]));
        }
        if (rightReady) {
            elbowAngles.push(angleDegrees(points[PoseJoint.rightShoulder], points[PoseJoint.rightElbow], points[PoseJoint.rightWrist]));
        }
        const rawElbow = elbowAngles.reduce((a, b) => a + b, 0) / elbowAngles.length;
        const elbow = this._smooth('_smoothElbow', rawElbow);

        // Body alignment
        const shoulder = averagePoint(points[PoseJoint.leftShoulder], points[PoseJoint.rightShoulder]);
        const hip = averagePoint(points[PoseJoint.leftHip], points[PoseJoint.rightHip]);
        let alignment = 180;
        if (hasAnkle) {
            const ankle = averagePoint(points[PoseJoint.leftAnkle], points[PoseJoint.rightAnkle]);
            alignment = this._smooth('_smoothAlignment', angleDegrees(shoulder, hip, ankle));
        }

        // Quality
        let quality;
        if (alignment >= 160) quality = FormQuality.good;
        else if (alignment >= 140) quality = FormQuality.acceptable;
        else quality = FormQuality.poor;

        // Thresholds
        const UP = 145, LOWER = 130, BOTTOM = 100, PUSH = 110;

        // State machine
        switch (this.phase) {
            case Phase.notReady:
                if (elbow >= UP) { this.phase = Phase.up; this._repStartTime = now; }
                break;
            case Phase.up:
                if (elbow < LOWER) {
                    this.phase = Phase.lowering;
                    this._deepestElbow = elbow;
                    this._worstQuality = quality;
                    if (!this._repStartTime) this._repStartTime = now;
                }
                break;
            case Phase.lowering:
                this._deepestElbow = Math.min(this._deepestElbow, elbow);
                if (isWorseThan(quality, this._worstQuality)) this._worstQuality = quality;
                if (elbow <= BOTTOM) this.phase = Phase.bottom;
                else if (elbow >= UP) { this.phase = Phase.up; this._resetRep(now); }
                break;
            case Phase.bottom:
                this._deepestElbow = Math.min(this._deepestElbow, elbow);
                if (isWorseThan(quality, this._worstQuality)) this._worstQuality = quality;
                if (elbow > PUSH) this.phase = Phase.pushing;
                break;
            case Phase.pushing:
                if (isWorseThan(quality, this._worstQuality)) this._worstQuality = quality;
                if (elbow >= UP) {
                    this.repCounter++;
                    const depth = this._depthPercent(this._deepestElbow);
                    this.repHistory.push({
                        id: this.repCounter,
                        deepestAngle: this._deepestElbow,
                        depthPercent: depth,
                        formQuality: this._worstQuality,
                        duration: this._repStartTime ? (now - this._repStartTime) / 1000 : 0,
                        timestamp: now,
                    });
                    this.phase = Phase.up;
                    this._resetRep(now);
                } else if (elbow <= BOTTOM) {
                    this.phase = Phase.bottom;
                }
                break;
        }

        return this._makeMetrics(true, elbow, this._depthPercent(elbow), quality);
    }

    _resetRep(now) {
        this._deepestElbow = 180;
        this._worstQuality = FormQuality.good;
        this._repStartTime = now;
    }

    _smooth(key, raw) {
        const alpha = 0.3;
        if (this[key] === null) { this[key] = raw; return raw; }
        const val = alpha * raw + (1 - alpha) * this[key];
        this[key] = val;
        return val;
    }

    _depthPercent(elbow) {
        const clamped = Math.max(70, Math.min(180, elbow));
        return (180 - clamped) / 110;
    }

    _makeMetrics(bodyDetected, angle = null, depth = null, quality = FormQuality.unknown) {
        return {
            repCount: this.repCounter,
            phase: this._mapPhase(),
            quality: bodyDetected ? quality : FormQuality.unknown,
            bodyDetected,
            primaryAngle: angle,
            depthPercent: depth,
            holdDuration: null,
            longestHold: null,
            primaryValue: `${this.repCounter}`,
        };
    }

    _mapPhase() {
        switch (this.phase) {
            case Phase.notReady: return { type: 'notReady', label: 'Встань в упор лёжа' };
            case Phase.up:       return { type: 'ready', label: 'Вверху — опускайся' };
            case Phase.lowering: return { type: 'descending', label: 'Опускаешься' };
            case Phase.bottom:   return { type: 'bottom', label: 'Внизу — отжимайся!' };
            case Phase.pushing:  return { type: 'ascending', label: 'Поднимаешься' };
        }
    }
}
