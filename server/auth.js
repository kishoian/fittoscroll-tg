const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

function validateInitData(initDataRaw) {
    if (!initDataRaw || !BOT_TOKEN) return null;

    try {
        const params = new URLSearchParams(initDataRaw);
        const hash = params.get('hash');
        if (!hash) return null;

        params.delete('hash');
        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');

        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const computedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (computedHash !== hash) return null;

        // Check freshness (allow 1 hour for testing, tighten later)
        const authDate = parseInt(params.get('auth_date'), 10);
        if (Date.now() / 1000 - authDate > 3600) return null;

        return JSON.parse(params.get('user'));
    } catch (e) {
        console.error('initData validation error:', e.message);
        return null;
    }
}

function authMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];

    // Dev mode: allow without auth if BOT_TOKEN not set
    if (!BOT_TOKEN) {
        req.tgUser = { id: 1, first_name: 'Dev', last_name: '', username: 'dev' };
        return next();
    }

    if (!initData) {
        return res.status(401).json({ error: 'Missing Telegram init data' });
    }

    const user = validateInitData(initData);
    if (!user) {
        return res.status(403).json({ error: 'Invalid or expired init data' });
    }

    req.tgUser = user;
    next();
}

module.exports = { validateInitData, authMiddleware };
