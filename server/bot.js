require('dotenv').config();
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://ofppoly.kishoianrs.ru';

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is required in .env');
    process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ========== Telegram API helpers ==========

function apiCall(method, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const url = new URL(`${API}/${method}`);
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let chunks = '';
            res.on('data', (d) => chunks += d);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(chunks));
                } catch {
                    resolve({ ok: false, description: chunks });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ========== Long polling ==========

let offset = 0;

async function poll() {
    try {
        const result = await apiCall('getUpdates', {
            offset,
            timeout: 30,
            allowed_updates: ['message'],
        });

        if (result.ok && result.result) {
            for (const update of result.result) {
                offset = update.update_id + 1;
                await handleUpdate(update);
            }
        }
    } catch (err) {
        console.error('Polling error:', err.message);
        await sleep(3000);
    }

    // Continue polling
    poll();
}

async function handleUpdate(update) {
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === '/start') {
        await apiCall('sendMessage', {
            chat_id: chatId,
            text: '💪 *FitToScroll* — тренируйся с AI\n\nПриседания, отжимания и планка с детекцией позы через камеру.\n\nНажми кнопку ниже, чтобы начать!',
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '🏋️ Открыть тренировку',
                        web_app: { url: WEBAPP_URL },
                    }
                ]],
            },
        });
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ========== Start ==========

console.log('FitToScroll Bot started (long polling)...');
poll();
