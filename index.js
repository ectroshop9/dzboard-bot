import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dzboard_verify_123';
const API_URL = 'https://dzboard.onrender.com/api';

// Webhook Verification
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

// Webhook Events
app.post('/webhook', (req, res) => {
  const { body } = req;
  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    body.entry.forEach(entry => {
      entry.messaging.forEach(async event => {
        if (event.message && event.message.is_echo) return;
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

const fbApi = axios.create({
  baseURL: 'https://graph.facebook.com/v18.0/me/messages',
  params: { access_token: PAGE_ACCESS_TOKEN }
});

async function sendSenderAction(senderId, action = 'typing_on') {
  try { await fbApi.post('', { recipient: { id: senderId }, sender_action: action }); } catch (err) {}
}

async function sendMessage(senderId, text) {
  try { await fbApi.post('', { recipient: { id: senderId }, message: { text } }); } 
  catch (err) { console.error('Message Error:', err.response?.data || err.message); }
}

// ✅ Button Template - 3 أزرار
async function sendButtons(senderId, text, buttons) {
  try {
    await fbApi.post('', {
      recipient: { id: senderId },
      message: {
        attachment: {
          type: 'template',
          payload: { template_type: 'button', text, buttons }
        }
      }
    });
  } catch (err) {
    console.error('Buttons Error:', err.response?.data || err.message);
  }
}

// ✅ Carousel للمنتجات
async function sendProductCarousel(senderId, products) {
  const elements = products.map(product => {
    const buttons = [
      { type: 'web_url', title: '🛒 اطلب الآن', url: `https://dzboard.vercel.app/checkout?product=${product.id}` }
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
    await fbApi.post('', {
      recipient: { id: senderId },
      message: { attachment: { type: 'template', payload: { template_type: 'generic', elements } } }
    });
  } catch (err) {
    console.error('Carousel Error:', err.response?.data || err.message);
  }
}

async function fetchProducts() {
  const res = await axios.get(`${API_URL}/products?include_inactive=false`);
  return res.data.products || [];
}

async function handleMessage(senderId, message) {
  await sendSenderAction(senderId, 'typing_on');

  if (message.attachments) {
    await sendMessage(senderId, '📸 استلمنا الصورة! سيقوم الفني بالفحص والرد.');
    return;
  }

  const text = message.text ? message.text.trim() : '';
  const lower = text.toLowerCase();
  if (!text) return;

  const greetings = ['سلام', 'مرحبا', 'اهلا', 'hi', 'hello', 'bonjour', 'salut', 'السلام عليكم'];
  if (greetings.some(g => lower.includes(g))) {
    await sendMainMenu(senderId);
    return;
  }

  try {
    const products = await fetchProducts();
    const found = products.filter(p => p.name && p.name.toLowerCase().includes(lower)).slice(0, 10);

    if (found.length > 0) {
      await sendMessage(senderId, `🔍 وجدنا ${found.length} نتائج:`);
      await sendProductCarousel(senderId, found);
    } else {
      await sendButtons(senderId, `❌ لم نجد "${text}".\nتصفح الأقسام:`, [
        { type: 'postback', title: '📂 الأقسام', payload: 'BROWSE_PRODUCTS' },
        { type: 'postback', title: '🔍 بحث', payload: 'SEARCH' }
      ]);
    }
  } catch (err) {
    await sendMessage(senderId, '⚠️ تعذر البحث.');
  }
}

async function handlePostback(senderId, postback) {
  await sendSenderAction(senderId, 'typing_on');
  const payload = postback.payload;

  switch (payload) {
    case 'GET_STARTED':
      await sendMessage(senderId, 'مرحباً بك في DZBoard! 📺');
      await sendMainMenu(senderId);
      break;

    case 'BROWSE_PRODUCTS':
      await sendButtons(senderId, '📂 اختر القسم:', [
        { type: 'postback', title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
        { type: 'postback', title: '⚡ كارت تغذية', payload: 'CATEGORY_alimentation' },
        { type: 'postback', title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' }
      ]);
      break;

    case 'CATEGORY_MORE':
      await sendButtons(senderId, '📂 المزيد:', [
        { type: 'postback', title: '🔩 قطع غيار', payload: 'CATEGORY_parts' },
        { type: 'postback', title: '🔙 رجوع', payload: 'BROWSE_PRODUCTS' }
      ]);
      break;

    case 'CONTACT':
      await sendMessage(senderId, '📞 0673320066\n📧 contact@dzboard.com');
      break;

    case 'SEARCH':
      await sendMessage(senderId, '🔍 أرسل اسم القطعة:');
      break;

    default:
      if (payload.startsWith('CATEGORY_')) {
        const category = payload.replace('CATEGORY_', '');
        try {
          const products = await fetchProducts();
          const found = products.filter(p => p.category === category).slice(0, 10);
          if (found.length > 0) {
            await sendProductCarousel(senderId, found);
          } else {
            await sendMessage(senderId, '📋 لا توجد قطع في هذا القسم.');
          }
        } catch (err) {
          await sendMessage(senderId, '⚠️ خطأ.');
        }
      }
      break;
  }
}

async function sendMainMenu(senderId) {
  await sendButtons(senderId, '👋 كيف نساعدك؟', [
    { type: 'postback', title: '🛒 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
    { type: 'postback', title: '🔍 البحث', payload: 'SEARCH' },
    { type: 'postback', title: '📞 اتصل بنا', payload: 'CONTACT' }
  ]);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 DZBoard Bot live on port ${PORT}`);
});
