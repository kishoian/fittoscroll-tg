import { PoseJoint, FormQuality, angleDegrees, midpoint, isWorseThan, degradeQuality } from './exercise-types.js';

const Phase = { notReady: 0, standing: 1, descending: 2, bottom: 3, ascending: 4 };

export class SquatAnalyzer {
    constructor() {
        this.exerciseType = 'squats';
        this.repHistory = [];
        this.holdHistory = [];
        this.resetAll();
    }

    resetAll() {
        this.phase = Phase.notReady;
        this.repCount = 0;
        this.repHistory = [];
        this._lastRepTs = 0;
        this._standingKneeAngle = null;
        this._smoothedKnee = null;
        this._deepestAngle = 180;
        this._deepestDepth = 0;
        this._worstQuality = FormQuality.good;
        this._repStartTime = null;
    }

    process(points, timestamp) {
        const landmarks = this._requiredLandmarks(points);
        const kneeAngleRaw = this._averagedKneeAngle(points);

        if (!landmarks || kneeAngleRaw === null) {
            this.phase = Phase.notReady;
            this._smoothedKnee = null;
            return this._makeMetrics(false);
        }

        const kneeAngle = this._smooth(kneeAngleRaw);
        this._updateStandingRef(kneeAngle);
        const depthPercent = this._normalizedDepth(kneeAngle);
        const quality = this._evaluateQuality(kneeAngle, depthPercent, points, landmarks);

        if (this.phase === Phase.descending || this.phase === Phase.bottom || this.phase === Phase.ascending) {
            this._deepestAngle = Math.min(this._deepestAngle, kneeAngle);
            if (depthPercent !== null) this._deepestDepth = Math.max(this._deepestDepth, depthPercent);
            if (isWorseThan(quality, this._worstQuality)) this._worstQuality = quality;
        }

        this._updatePhase(kneeAngle, depthPercent, quality, timestamp);

        return this._makeMetrics(true, kneeAngle, depthPercent, quality);
    }

    _makeMetrics(bodyDetected, angle = null, depth = null, quality = FormQuality.unknown) {
        return {
            repCount: this.repCount,
            phase: this._mapPhase(),
            quality: bodyDetected ? quality : FormQuality.unknown,
            bodyDetected,
            primaryAngle: angle,
            depthPercent: depth,
            holdDuration: null,
            longestHold: null,
            primaryValue: `${this.repCount}`,
        };
    }

    _mapPhase() {
        switch (this.phase) {
            case Phase.notReady:   return { type: 'notReady', label: 'Встань в полный рост' };
            case Phase.standing:   return { type: 'ready', label: 'Стартовая стойка' };
            case Phase.descending: return { type: 'descending', label: 'Опускайся' };
            case Phase.bottom:     return { type: 'bottom', label: 'Нижняя точка' };
            case Phase.ascending:  return { type: 'ascending', label: 'Поднимайся' };
        }
    }

    _updatePhase(kneeAngle, depthPercent, quality, timestamp) {
        const now = typeof timestamp === 'number' ? timestamp : timestamp.getTime();

        switch (this.phase) {
            case Phase.notReady:
                if (kneeAngle >= 150) { this.phase = Phase.standing; this._resetAccum(); }
                break;
            case Phase.standing:
                if (kneeAngle < 140) {
                    this.phase = Phase.descending;
                    this._repStartTime = now;
                    this._deepestAngle = kneeAngle;
                    this._deepestDepth = depthPercent ?? 0;
                    this._worstQuality = quality;
                }
                break;
            case Phase.descending:
                if (kneeAngle <= 130) this.phase = Phase.bottom;
                else if (kneeAngle >= 150) { this.phase = Phase.standing; this._resetAccum(); }
                break;
            case Phase.bottom:
                if (kneeAngle >= 135) this.phase = Phase.ascending;
                break;
            case Phase.ascending:
                if (kneeAngle >= 150) {
                    if (this._deepestAngle <= 130 && (now - this._lastRepTs) >= 400) {
                        this.repCount++;
                        this._lastRepTs = now;
                        const duration = this._repStartTime ? (now - this._repStartTime) / 1000 : 0;
                        this.repHistory.push({
                            id: this.repCount,
                            deepestAngle: this._deepestAngle,
                            depthPercent: this._deepestDepth,
                            formQuality: this._worstQuality,
                            duration,
                            timestamp: now,
                        });
                    }
                    this.phase = Phase.standing;
                    this._resetAccum();
                } else if (kneeAngle <= 125) {
                    this.phase = Phase.bottom;
                }
                break;
        }
    }

    _resetAccum() {
        this._deepestAngle = 180;
        this._deepestDepth = 0;
        this._worstQuality = FormQuality.good;
        this._repStartTime = null;
    }

    _evaluateQuality(kneeAngle, depthPercent, points, landmarks) {
        let quality;
        switch (this.phase) {
            case Phase.notReady: quality = FormQuality.unknown; break;
            case Phase.standing:
                quality = kneeAngle >= 150 ? FormQuality.good : kneeAngle >= 140 ? FormQuality.acceptable : FormQuality.poor;
                break;
            case Phase.descending:
            case Phase.ascending:
                quality = (kneeAngle >= 100 && kneeAngle <= 165) ? FormQuality.good
                    : (kneeAngle >= 85 && kneeAngle <= 175) ? FormQuality.acceptable : FormQuality.poor;
                break;
            case Phase.bottom:
                quality = kneeAngle <= 130 ? FormQuality.good : kneeAngle <= 140 ? FormQuality.acceptable : FormQuality.poor;
                break;
            default:
                quality = FormQuality.unknown;
        }

        const l = this._kneeAngleSide('left', points);
        const r = this._kneeAngleSide('right', points);
        if (l !== null && r !== null && Math.abs(l - r) > 18) quality = degradeQuality(quality);

        const trunk = this._trunkAngle(points);
        if (trunk !== null && trunk < 100) quality = degradeQuality(quality);

        if (this.phase !== Phase.bottom && this.phase !== Phase.descending && landmarks.hipCenter.y <= landmarks.kneeCenter.y) {
            quality = FormQuality.poor;
        }

        return quality;
    }

    _updateStandingRef(kneeAngle) {
        if (this._standingKneeAngle === null && kneeAngle >= 148) {
            this._standingKneeAngle = kneeAngle;
        }
        if (kneeAngle < 148) return;
        if (this._standingKneeAngle !== null) {
            this._standingKneeAngle = this._standingKneeAngle * 0.85 + kneeAngle * 0.15;
        } else {
            this._standingKneeAngle = kneeAngle;
        }
    }

    _normalizedDepth(kneeAngle) {
        if (this._standingKneeAngle === null) return null;
        const range = this._standingKneeAngle - 90;
        if (range <= 1) return null;
        return Math.max(0, Math.min(1, (this._standingKneeAngle - kneeAngle) / range));
    }

    _smooth(value) {
        const alpha = 0.3;
        if (this._smoothedKnee === null) { this._smoothedKnee = value; return value; }
        const next = this._smoothedKnee * (1 - alpha) + value * alpha;
        this._smoothedKnee = next;
        return next;
    }

    _averagedKneeAngle(points) {
        const l = this._kneeAngleSide('left', points);
        const r = this._kneeAngleSide('right', points);
        if (l !== null && r !== null) return (l + r) * 0.5;
        return l ?? r ?? null;
    }

    _kneeAngleSide(side, points) {
        const h = side === 'left' ? PoseJoint.leftHip : PoseJoint.rightHip;
        const k = side === 'left' ? PoseJoint.leftKnee : PoseJoint.rightKnee;
        const a = side === 'left' ? PoseJoint.leftAnkle : PoseJoint.rightAnkle;
        if (!points[h] || !points[k] || !points[a]) return null;
        return angleDegrees(points[h], points[k], points[a]);
    }

    _trunkAngle(points) {
        const l = this._hipAngleSide('left', points);
        const r = this._hipAngleSide('right', points);
        if (l !== null && r !== null) return (l + r) * 0.5;
        return l ?? r ?? null;
    }

    _hipAngleSide(side, points) {
        const s = side === 'left' ? PoseJoint.leftShoulder : PoseJoint.rightShoulder;
        const h = side === 'left' ? PoseJoint.leftHip : PoseJoint.rightHip;
        const k = side === 'left' ? PoseJoint.leftKnee : PoseJoint.rightKnee;
        if (!points[s] || !points[h] || !points[k]) return null;
        return angleDegrees(points[s], points[h], points[k]);
    }

    _requiredLandmarks(points) {
        const hasL = points[PoseJoint.leftHip] && points[PoseJoint.leftKnee] && points[PoseJoint.leftAnkle];
        const hasR = points[PoseJoint.rightHip] && points[PoseJoint.rightKnee] && points[PoseJoint.rightAnkle];
        if (!hasL && !hasR) return null;

        if (hasL && hasR) {
            return {
                hipCenter: midpoint(points[PoseJoint.leftHip], points[PoseJoint.rightHip]),
                kneeCenter: midpoint(points[PoseJoint.leftKnee], points[PoseJoint.rightKnee]),
                ankleCenter: midpoint(points[PoseJoint.leftAnkle], points[PoseJoint.rightAnkle]),
            };
        }
        if (hasL) {
            return { hipCenter: points[PoseJoint.leftHip], kneeCenter: points[PoseJoint.leftKnee], ankleCenter: points[PoseJoint.leftAnkle] };
        }
        return { hipCenter: points[PoseJoint.rightHip], kneeCenter: points[PoseJoint.rightKnee], ankleCenter: points[PoseJoint.rightAnkle] };
    }
}
