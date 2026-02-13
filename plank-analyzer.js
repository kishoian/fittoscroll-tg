import { PoseJoint, FormQuality, angleDegrees, averagePoint, isWorseThan } from './exercise-types.js';

const Phase = { notReady: 0, holding: 1, broken: 2 };

export class PlankAnalyzer {
    constructor() {
        this.exerciseType = 'plank';
        this.repHistory = [];
        this.holdHistory = [];
        this.resetAll();
    }

    resetAll() {
        this.phase = Phase.notReady;
        this.holdCounter = 0;
        this.holdHistory = [];
        this._holdStartTime = null;
        this._currentHoldDuration = 0;
        this._bestHoldDuration = 0;
        this._qualitySamples = [];
        this._smoothAlignment = null;
    }

    process(points, timestamp) {
        const now = typeof timestamp === 'number' ? timestamp : timestamp.getTime();

        const hasShoulder = points[PoseJoint.leftShoulder] || points[PoseJoint.rightShoulder];
        const hasHip = points[PoseJoint.leftHip] || points[PoseJoint.rightHip];
        const hasAnkle = points[PoseJoint.leftAnkle] || points[PoseJoint.rightAnkle];

        if (!hasShoulder || !hasHip || !hasAnkle) {
            if (this.phase === Phase.holding) this._finishHold(now);
            this.phase = Phase.notReady;
            return this._makeMetrics(false, now);
        }

        const shoulder = averagePoint(points[PoseJoint.leftShoulder], points[PoseJoint.rightShoulder]);
        const hip = averagePoint(points[PoseJoint.leftHip], points[PoseJoint.rightHip]);
        const ankle = averagePoint(points[PoseJoint.leftAnkle], points[PoseJoint.rightAnkle]);

        const rawAlignment = angleDegrees(shoulder, hip, ankle);
        const alignment = this._smooth(rawAlignment);

        // Horizontal check
        const yDiff = Math.abs(shoulder.y - ankle.y);
        const isHorizontal = yDiff < 0.15;

        // Quality
        let quality;
        if (alignment >= 165) quality = FormQuality.good;
        else if (alignment >= 150) quality = FormQuality.acceptable;
        else quality = FormQuality.poor;

        // Thresholds
        const HOLD = 155, BREAK = 140;

        // State machine
        switch (this.phase) {
            case Phase.notReady:
                if (alignment >= HOLD && isHorizontal) {
                    this.phase = Phase.holding;
                    this._holdStartTime = now;
                    this._qualitySamples = [quality];
                }
                break;
            case Phase.holding:
                this._currentHoldDuration = (now - this._holdStartTime) / 1000;
                this._qualitySamples.push(quality);
                if (alignment < BREAK || !isHorizontal) {
                    this._finishHold(now);
                    this.phase = Phase.broken;
                }
                break;
            case Phase.broken:
                if (alignment >= HOLD && isHorizontal) {
                    this.phase = Phase.holding;
                    this._holdStartTime = now;
                    this._qualitySamples = [quality];
                }
                break;
        }

        if (this.phase === Phase.holding) {
            this._bestHoldDuration = Math.max(this._bestHoldDuration, this._currentHoldDuration);
        }

        return this._makeMetrics(true, now, alignment, quality);
    }

    _finishHold(now) {
        const duration = (now - this._holdStartTime) / 1000;
        if (duration < 2) { this._currentHoldDuration = 0; return; }

        this.holdCounter++;
        this.holdHistory.push({
            id: this.holdCounter,
            duration,
            averageQuality: this._dominantQuality(this._qualitySamples),
            timestamp: this._holdStartTime,
        });
        this._currentHoldDuration = 0;
    }

    _dominantQuality(samples) {
        if (!samples.length) return FormQuality.unknown;
        let g = 0, a = 0, p = 0;
        for (const q of samples) {
            if (q === FormQuality.good) g++;
            else if (q === FormQuality.acceptable) a++;
            else if (q === FormQuality.poor) p++;
        }
        if (g >= a && g >= p) return FormQuality.good;
        if (a >= p) return FormQuality.acceptable;
        return FormQuality.poor;
    }

    _smooth(raw) {
        const alpha = 0.3;
        if (this._smoothAlignment === null) { this._smoothAlignment = raw; return raw; }
        const val = alpha * raw + (1 - alpha) * this._smoothAlignment;
        this._smoothAlignment = val;
        return val;
    }

    _formatTime(seconds) {
        const total = Math.floor(seconds);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    _makeMetrics(bodyDetected, now, alignment = null, quality = FormQuality.unknown) {
        let hold = 0;
        if (this.phase === Phase.holding && this._holdStartTime) {
            hold = (now - this._holdStartTime) / 1000;
        }

        return {
            repCount: 0,
            phase: this._mapPhase(),
            quality: bodyDetected ? quality : FormQuality.unknown,
            bodyDetected,
            primaryAngle: alignment,
            depthPercent: null,
            holdDuration: hold,
            longestHold: this._bestHoldDuration,
            primaryValue: this._formatTime(hold),
        };
    }

    _mapPhase() {
        switch (this.phase) {
            case Phase.notReady: return { type: 'notReady', label: 'Встань в планку' };
            case Phase.holding:  return { type: 'holding', label: 'Держишь планку!' };
            case Phase.broken:   return { type: 'broken', label: 'Планка сломана — выпрямись' };
        }
    }
}
