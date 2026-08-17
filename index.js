import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dzboard_verify_123';
const API_URL = 'https://dzboard.onrender.com/api';

// --- Webhook Verification ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// --- Webhook Event Handler ---
app.post('/webhook', (req, res) => {
  const { body } = req;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    body.entry.forEach(entry => {
      entry.messaging.forEach(async event => {
        const senderId = event.sender.id;

        try {
          if (event.message) {
            await handleMessage(senderId, event.message);
          } else if (event.postback) {
            await handlePostback(senderId, event.postback);
          }
        } catch (err) {
          console.error('Error handling event:', err);
        }
      });
    });
  } else {
    res.sendStatus(404);
  }
});

// --- Helper Functions ---
async function sendSenderAction(senderId, action = 'typing_on') {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: senderId }, sender_action: action }
    );
  } catch (err) {
    console.error('Sender Action Error:', err.response?.data || err.message);
  }
}

async function sendMessage(senderId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: senderId }, message: { text } }
    );
  } catch (err) {
    console.error('Send Message Error:', err.response?.data || err.message);
  }
}

async function sendButtons(senderId, text, buttons) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: {
          attachment: {
            type: 'template',
            payload: { template_type: 'button', text, buttons }
          }
        }
      }
    );
  } catch (err) {
    console.error('Send Buttons Error:', err.response?.data || err.message);
  }
}

// --- Business Logic ---
async function handleMessage(senderId, message) {
  await sendSenderAction(senderId, 'typing_on');

  if (message.attachments) {
    await sendMessage(senderId, '📸 شكراً لإرسال الصورة! سيقوم أحد ممثلي الخدمة بمسح المكونات والرد عليك قريباً.');
    return;
  }

  const text = message.text ? message.text.trim() : '';
  const lower = text.toLowerCase();

  if (!text) return;

  // 1️⃣ قائمة التحيات
  const greetings = ['سلام', 'مرحبا', 'اهلا', 'hi', 'hello', 'bonjour', 'salut', 'السلام عليكم'];
  const isGreeting = greetings.some(g => lower.includes(g));

  if (isGreeting) {
    await sendButtons(senderId, '👋 أهلاً بك في متجر DZBoard!\nكيف يمكننا مساعدتك اليوم؟', [
      { type: 'postback', title: '🛒 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
      { type: 'postback', title: '🔍 البحث عن قطعة', payload: 'SEARCH' },
      { type: 'postback', title: '📞 اتصل بنا', payload: 'CONTACT' }
    ]);
    return;
  }

  // 2️⃣ البحث عن منتج
  try {
    const res = await axios.get(`${API_URL}/products?include_inactive=false`);
    const products = res.data.products || [];

    const found = products.filter(p => p.name && p.name.toLowerCase().includes(lower)).slice(0, 3);

    if (found.length > 0) {
      await sendMessage(senderId, `🔍 وجدنا ${found.length} نتائج لـ "${text}":`);
      for (const product of found) {
        const buttons = [
          { type: 'web_url', title: '🛒 اطلب من المتجر', url: `https://dzboard.vercel.app/product/${product.id}` }
        ];
        
        if (product.update_url) {
          buttons.push({ type: 'web_url', title: '🔄 تحديث السوفتوير', url: product.update_url });
        }

        const stockStatus = product.stock > 0 ? `📦 المخزون: ${product.stock}` : '❌ غير متوفر حالياً';
        await sendButtons(senderId, `📌 ${product.name}\n💰 السعر: ${product.price} دج\n${stockStatus}`, buttons);
      }
    } else {
      await sendButtons(senderId, `❌ لم نجد أي قطعة باسم "${text}".\nيمكنك اختيار قسم لتصفح القطع المتوفرة:`, [
        { type: 'postback', title: '📂 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
        { type: 'postback', title: '📞 التواصل مع الدعم', payload: 'CONTACT' }
      ]);
    }
  } catch (err) {
    console.error('Search API Error:', err);
    await sendMessage(senderId, '⚠️ حدث خطأ أثناء الاتصال بالخادم. يرجى المحاولة لاحقاً.');
  }
}

async function handlePostback(senderId, postback) {
  await sendSenderAction(senderId, 'typing_on');
  const payload = postback.payload;

  switch (payload) {
    case 'BROWSE_PRODUCTS':
      await sendButtons(senderId, '📂 اختر القسم المطلوب:', [
        { type: 'postback', title: '🖥️ كارت تيكون (T-Con)', payload: 'CATEGORY_tcon' },
        { type: 'postback', title: '⚡ كارت تغذية (Alimentation)', payload: 'CATEGORY_alimentation' },
        { type: 'postback', title: '🔧 اللوحة الأم (Main Board)', payload: 'CATEGORY_main-board' }
      ]);
      break;

    case 'CONTACT':
      await sendMessage(senderId, '📞 **معلومات التواصل:**\n📱 الهاتف: 0673320066\n📧 البريد: contact@dzboard.com\n🌐 الموقع: https://dzboard.vercel.app');
      break;

    case 'SEARCH':
      await sendMessage(senderId, '🔍 أرسل اسم القطعة أو الرقم المرجعي (e.g., TP.HV320.PB801):');
      break;

    default:
      if (payload.startsWith('CATEGORY_')) {
        const category = payload.replace('CATEGORY_', '');
        try {
          const res = await axios.get(`${API_URL}/products?include_inactive=false`);
          const products = (res.data.products || []).filter(p => p.category === category).slice(0, 5);

          if (products.length > 0) {
            for (const product of products) {
              await sendButtons(senderId, `📌 ${product.name}\n💰 السعر: ${product.price} دج`, [
                { type: 'web_url', title: '🛒 تفاصيل واقتناء', url: `https://dzboard.vercel.app/product/${product.id}` }
              ]);
            }
          } else {
            await sendMessage(senderId, '📋 لا توجد قطع متوفرة حالياً في هذا القسم.');
          }
        } catch (err) {
          console.error('Category Fetch Error:', err);
          await sendMessage(senderId, '⚠️ خطأ في تحميل الأقسام. حاول لاحقاً.');
        }
      }
      break;
  }
}

// --- Server Initialization ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 DZBoard Pro Bot is live on port ${PORT}`);
});
