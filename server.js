import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const SALESDRIVE_URL = process.env.SALESDRIVE_URL;
const SALESDRIVE_API_KEY = process.env.SALESDRIVE_API_KEY;

const DILOVOD_API_URL = process.env.DILOVOD_API_URL || 'https://api.dilovod.ua';
const DILOVOD_API_KEY = process.env.DILOVOD_API_KEY;
const DILOVOD_VERSION = '0.25';

// Telegram Bot Config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Функція відправки сповіщення в Telegram про помилки API
 */
async function sendTelegramAlert(serviceName, errorMessage, leadInfo = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram Bot token або Chat ID не налаштовані в .env');
    return;
  }

  const timestamp = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

  const message = `
⚠️ <b>Збій інтеграції: ${serviceName}</b>

<b>Час:</b> ${timestamp}
<b>Помилка:</b> <code>${errorMessage}</code>
<b>Дані ліда:</b>
• <b>Ім'я:</b> ${leadInfo.name || 'Н/Д'}
• <b>Телефон:</b> ${leadInfo.phone || 'Н/Д'}
  `.trim();

  try {
    const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const resText = await response.text();
      console.error(`Помилка надсилання сповіщення в Telegram: ${response.status} - ${resText}`);
    }
  } catch (err) {
    console.error('Не вдалося відправити сповіщення в Telegram:', err.message);
  }
}

async function callDilovod(action, params) {
  const packet = {
    version: DILOVOD_VERSION,
    key: DILOVOD_API_KEY,
    action,
    params
  };

  const body = new URLSearchParams();
  body.append('packet', JSON.stringify(packet));

  const response = await fetch(DILOVOD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  return response.json();
}

app.post('/api/lead', async (req, res) => {
  try {
    const { name, phone, website } = req.body;

    if (website) {
      console.warn('Виявлено спам-бота (заповнено honeypot)');
      return res.status(400).json({ success: false, message: 'Spam detected' });
    }

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Ім’я та телефон обов’язкові' });
    }

    const nameRegex = /^[a-zA-Zа-яА-ЯіІїЇєЄґҐ\s]+$/;
    if (!nameRegex.test(name.trim())) {
      return res.status(400).json({ success: false, message: 'Ім’я повинно містити лише літери' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const phoneRegex = /^(380|0)\d{9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Некоректний номер телефону' });
    }

    const leadInfo = { name: name.trim(), phone: cleanPhone };

    let salesDriveResult = null;
    let dilovodResult = null;

    // --- SALESDRIVE INTEGRATION ---
    try {
      const salesDrivePayload = {
        getResultData: "1",
        fName: name.trim(),
        phone: cleanPhone,
        products: [],
        comment: "",
        externalId: "",
        lName: "",
        mName: "",
        email: "",
        con_comment: "",
        shipping_method: "",
        payment_method: "",
        shipping_address: "",
        sajt: req.headers.referer || ""
      };

      const sdResponse = await fetch(SALESDRIVE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': SALESDRIVE_API_KEY
        },
        body: JSON.stringify(salesDrivePayload)
      });

      if (!sdResponse.ok) {
        throw new Error(`SalesDrive HTTP Status ${sdResponse.status}`);
      }

      const sdText = await sdResponse.text();
      try {
        salesDriveResult = JSON.parse(sdText);
      } catch {
        salesDriveResult = { raw: sdText };
      }

    } catch (error) {
      console.error('Помилка при відправці в SalesDrive:', error.message);
      await sendTelegramAlert('SalesDrive', error.message, leadInfo);
    }

    // --- DILOVOD INTEGRATION ---
    try {
      const contactData = await callDilovod('saveObject', {
        header: {
          id: 'catalogs.persons',
          name: { uk: name.trim(), ru: name.trim() },
          details: JSON.stringify({
            phones: [{ pr: cleanPhone, kind: 'phone' }],
            emails: [],
            messengers: [],
            urls: [],
            attributes: [],
            notes: []
          })
        }
      });

      console.log('Dilovod contact response:', JSON.stringify(contactData));

      if (contactData.error) {
        throw new Error(`Діловод (Contact) error: ${contactData.error}`);
      }

      const contactId = contactData.id;

      if (contactId) {
        dilovodResult = await callDilovod('call', {
          method: 'saleOrderCreate',
          arguments: {
            header: {
              person: contactId,
              remarkFromPerson: 'Заявка з веб-форми (Express)'
            },
            goods: []
          }
        });

        if (dilovodResult.error) {
          throw new Error(`Діловод (Order) error: ${dilovodResult.error}`);
        }
      }

    } catch (error) {
      console.error('Помилка при відправці в Діловод:', error.message);
      await sendTelegramAlert('Діловод', error.message, leadInfo);
    }

    // --- RESPONSE HANDLING ---
    if (salesDriveResult || dilovodResult) {
      return res.status(200).json({
        success: true,
        message: 'Заявку успішно оброблено',
        data: {
          salesDrive: salesDriveResult,
          dilovod: dilovodResult
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Не вдалося зберегти заявку в CRM системах'
      });
    }

  } catch (error) {
    console.error('Критична помилка сервера:', error);
    return res.status(500).json({
      success: false,
      message: 'Виникла внутрішня помилка сервера.'
    });
  }
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер успішно запущено на порту ${PORT}`);
});