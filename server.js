const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
// Вказуємо Express віддавати статичні файли з папки public
app.use(express.static(path.join(__dirname, 'public')));

// Конфігураційні дані (замініть на власні ключі тестових акаунтів)
const CONFIG = {
    SALESDRIVE: {
        API_KEY: 'YOUR_SALESDRIVE_API_KEY',
        DOMAIN: 'https://YOUR_DOMAIN.salesdrive.me'
    },
    DILOVOD: {
        API_KEY: 'YOUR_DILOVOD_API_KEY'
    },
    TELEGRAM: {
        BOT_TOKEN: 'YOUR_TELEGRAM_BOT_TOKEN',
        CHAT_ID: 'YOUR_TELEGRAM_CHAT_ID'
    }
};

/**
 * Функція сповіщення в Telegram при збоях API
 */
async function sendTelegramAlert(systemName, errorDetails) {
    const message = `⚠️ **УВАГА: Збій API System!**\n\nСистема: **${systemName}**\nПомилка: ${errorDetails}`;
    try {
        await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`, {
            chat_id: CONFIG.TELEGRAM.CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (err) {
        console.error('Не вдалося надіслати сповіщення в Telegram:', err.message);
    }
}

/**
 * Endpoint прийому форми
 */
app.post('/api/leads', async (req, res) => {
    const { fName, phone } = req.body;

    // --- КРОК 1: Відправка заявки в SalesDrive ---
    let salesDriveResult;
    try {
        const sdResponse = await axios.post(`${CONFIG.SALESDRIVE.DOMAIN}/api-req/in/v1/`, {
            form: CONFIG.SALESDRIVE.API_KEY,
            fName: fName,
            phone: phone,
            products: []
        }, { timeout: 7000 }); // таймаут 7 секунд

        salesDriveResult = sdResponse.data;
    } catch (err) {
        // Логуємо та сповіщаємо про падаюче API
        const errorMsg = err.response ? `Status ${err.response.status}` : err.message;
        await sendTelegramAlert('SalesDrive API', errorMsg);
        return res.status(502).json({ error: 'SalesDrive API unavailable' });
    }

    // --- КРОК 2: Передача даних у Діловод (Категорія "Клієнт") ---
    try {
        // Структура запиту до API Діловод
        const dilovodPayload = {
            version: "1.0",
            action: "save",
            params: {
                header: {
                    specifiedNum: "", 
                    remark: "Заявка з сайту / SalesDrive"
                },
                details: {
                    person: {
                        name: fName,
                        phone: phone,
                        roleCustomer: 1 // Прапор категорія "Клієнт" у Діловод
                    }
                }
            }
        };

        await axios.post('https://api.dilovod.ua/v1/', dilovodPayload, {
            headers: {
                'Authorization': `Bearer ${CONFIG.DILOVOD.API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 7000
        });

    } catch (err) {
        const errorMsg = err.response ? `Status ${err.response.status}` : err.message;
        await sendTelegramAlert('Діловод API', errorMsg);
        // Повертаємо 200/207, оскільки заявка в SalesDrive вже створилась
        return res.status(207).json({ status: 'Saved to SalesDrive, failed to sync with Dilovod' });
    }

    return res.json({ status: 'success', message: 'Lead saved to SalesDrive and Dilovod' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});