import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dzboard_verify_123';
const API_URL = 'https://dzboard.onrender.com/api';
const STORE_URL = 'https://dzboard.vercel.app';

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

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
          console.error('Error:', err.message);
        }
      });
    });
  } else {
    res.sendStatus(404);
  }
});

async function sendSenderAction(senderId, action = 'typing_on') {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: senderId }, sender_action: action }
    );
  } catch (err) {}
}

async function sendMessage(senderId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: senderId }, message: { text } }
    );
  } catch (err) {
    console.error('Send message error:', err.response?.data || err.message);
  }
}

// ✅ أزرار postback - تعمل دائماً
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
    console.error('Send buttons error:', err.response?.data || err.message);
  }
}

async function sendProductCarousel(senderId, products) {
  const elements = products.map(product => {
    const buttons = [
      { type: 'web_url', title: '🛒 اطلب الآن', url: `${STORE_URL}/product/${product.id}` }
    ];
    if (product.update_url) {
      buttons.push({ type: 'web_url', title: '🔄 تحديث', url: product.update_url });
    }
    return {
      title: product.name,
      subtitle: `💰 ${product.price} دج | 📦 ${product.stock > 0 ? 'متوفر' : 'غير متوفر'}`,
      image_url: product.image || 'https://via.placeholder.com/300x200?text=DZBoard',
      buttons
    };
  });

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: {
          attachment: {
            type: 'template',
            payload: { template_type: 'generic', elements }
          }
        }
      }
    );
  } catch (err) {
    console.error('Carousel error:', err.response?.data || err.message);
  }
}

async function handleMessage(senderId, message) {
  await sendSenderAction(senderId, 'typing_on');

  if (message.attachments) {
    await sendMessage(senderId, '📸 استلمنا الصورة! سيقوم الفني بالفحص والرد عليك.');
    return;
  }

  const text = message.text ? message.text.trim() : '';
  const lower = text.toLowerCase();

  if (!text) return;

  const greetings = ['سلام', 'مرحبا', 'اهلا', 'hi', 'hello', 'bonjour', 'salut', 'السلام عليكم'];
  if (greetings.some(g => lower.includes(g))) {
    await sendButtons(senderId, '👋 أهلاً بك في DZBoard!\nكيف يمكننا مساعدتك؟', [
      { type: 'postback', title: '🛒 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
      { type: 'postback', title: '🔍 البحث', payload: 'SEARCH' },
      { type: 'postback', title: '📞 اتصل بنا', payload: 'CONTACT' }
    ]);
    return;
  }

  try {
    const res = await axios.get(`${API_URL}/products?include_inactive=false`);
    const products = res.data.products || [];
    const found = products.filter(p => p.name && p.name.toLowerCase().includes(lower)).slice(0, 10);

    if (found.length > 0) {
      await sendMessage(senderId, `🔍 وجدنا ${found.length} نتائج:`);
      await sendProductCarousel(senderId, found);
    } else {
      await sendButtons(senderId, `❌ لم نجد "${text}".\nاختر قسماً:`, [
        { type: 'postback', title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
        { type: 'postback', title: '⚡ كارت تغذية', payload: 'CATEGORY_alimentation' },
        { type: 'postback', title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' }
      ]);
    }
  } catch (err) {
    await sendMessage(senderId, '⚠️ تعذر البحث حالياً.');
  }
}

async function handlePostback(senderId, postback) {
  await sendSenderAction(senderId, 'typing_on');
  const payload = postback.payload;

  switch (payload) {
    case 'BROWSE_PRODUCTS':
      await sendButtons(senderId, '📂 اختر القسم:', [
        { type: 'postback', title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
        { type: 'postback', title: '⚡ كارت تغذية', payload: 'CATEGORY_alimentation' },
        { type: 'postback', title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' }
      ]);
      break;

    case 'CONTACT':
      await sendMessage(senderId, '📞 الدعم الفني:\n📱 0673320066\n📧 contact@dzboard.com');
      break;

    case 'SEARCH':
      await sendMessage(senderId, '🔍 أرسل الموديل أو رقم القطعة:');
      break;

    default:
      if (payload.startsWith('CATEGORY_')) {
        const category = payload.replace('CATEGORY_', '');
        try {
          const res = await axios.get(`${API_URL}/products?include_inactive=false`);
          const products = (res.data.products || []).filter(p => p.category === category).slice(0, 10);
          if (products.length > 0) {
            await sendProductCarousel(senderId, products);
          } else {
            await sendMessage(senderId, '📋 لا توجد قطع في هذا القسم.');
          }
        } catch (err) {
          await sendMessage(senderId, '⚠️ خطأ في التحميل.');
        }
      }
      break;
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 DZBoard Bot live on port ${PORT}`);
});
