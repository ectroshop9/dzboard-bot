import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dzboard_verify_123';
const API_URL = 'https://dzboard.onrender.com/api';
const STORE_URL = 'https://dzboard.vercel.app';

// ==========================================
// 1. Webhook Verification
// ==========================================
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

// ==========================================
// 2. Event Routing
// ==========================================
app.post('/webhook', (req, res) => {
  const { body } = req;
  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED'); // الرد السريع لمنع Timeout

    body.entry.forEach(entry => {
      entry.messaging.forEach(async event => {
        // تجاهل رسائل البوت لنفسه (Echoes)
        if (event.message && event.message.is_echo) return;

        const senderId = event.sender.id;
        try {
          if (event.message) {
            await handleMessage(senderId, event.message);
          } else if (event.postback) {
            await handlePostback(senderId, event.postback);
          }
        } catch (err) {
          console.error('Event Error:', err.message);
        }
      });
    });
  } else {
    res.sendStatus(404);
  }
});

// ==========================================
// 3. Facebook Messenger API Helpers
// ==========================================
const fbApi = axios.create({
  baseURL: 'https://graph.facebook.com/v18.0/me/messages',
  params: { access_token: PAGE_ACCESS_TOKEN }
});

async function sendSenderAction(senderId, action = 'typing_on') {
  try { await fbApi.post('', { recipient: { id: senderId }, sender_action: action }); } 
  catch (err) {} // التجاهل الصامت لأخطاء الـ Typing
}

async function sendMessage(senderId, text) {
  try { await fbApi.post('', { recipient: { id: senderId }, message: { text } }); } 
  catch (err) { console.error('Message Error:', err.response?.data || err.message); }
}

// الردود السريعة أفضل لقوائم التصفح لأنها لا تتقيد بـ 3 أزرار فقط
async function sendQuickReplies(senderId, text, replies) {
  const quick_replies = replies.map(reply => ({
    content_type: 'text',
    title: reply.title,
    payload: reply.payload
  }));

  try {
    await fbApi.post('', { recipient: { id: senderId }, message: { text, quick_replies } });
  } catch (err) {
    console.error('Quick Replies Error:', err.response?.data || err.message);
  }
}

async function sendProductCarousel(senderId, products) {
  const elements = products.map(product => {
    const buttons = [
{ type: 'web_url', title: '🛒 اطلب الآن', url: 'https://dzboard.vercel.app/checkout' }    ];
    if (product.update_url) {
      buttons.push({ type: 'web_url', title: '🔄 تحديث السوفتوير', url: product.update_url });
    }
    return {
      title: product.name,
      subtitle: `💰 ${product.price} دج | 📦 ${product.stock > 0 ? 'متوفر' : 'نفذت الكمية'}`,
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

// ==========================================
// 4. Backend API Helper
// ==========================================
async function fetchProductsFromStore() {
  const res = await axios.get(`${API_URL}/products?include_inactive=false`);
  return res.data.products || [];
}

// ==========================================
// 5. Message & Postback Handlers
// ==========================================
async function handleMessage(senderId, message) {
  await sendSenderAction(senderId, 'typing_on');

  // 1. معالجة الصور
  if (message.attachments) {
    await sendMessage(senderId, '📸 استلمنا الصورة! سيقوم الفني بمراجعة القطعة والرد عليك قريباً.');
    return;
  }

  // 2. معالجة الردود السريعة (Quick Replies تُعامل كرسالة عادية لكنها تحمل payload)
  if (message.quick_reply) {
    await handlePostback(senderId, { payload: message.quick_reply.payload });
    return;
  }

  const text = message.text ? message.text.trim() : '';
  const lower = text.toLowerCase();
  if (!text) return;

  // 3. التحيات
  const greetings = ['سلام', 'مرحبا', 'اهلا', 'hi', 'hello', 'bonjour', 'salut', 'السلام عليكم'];
  if (greetings.some(g => lower.includes(g))) {
    sendMainMenu(senderId);
    return;
  }

  // 4. البحث النصي الذكي
  try {
    const products = await fetchProductsFromStore();
    const found = products.filter(p => p.name && p.name.toLowerCase().includes(lower)).slice(0, 10);

    if (found.length > 0) {
      await sendMessage(senderId, `🔍 وجدنا ${found.length} نتائج مطابقة لـ "${text}":`);
      await sendProductCarousel(senderId, found);
    } else {
      await sendQuickReplies(senderId, `❌ لم نجد قطعة باسم "${text}".\nجرب البحث برقم البوردة أو تصفح الأقسام:`, [
        { title: '📂 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
        { title: '📞 تواصل معنا', payload: 'CONTACT' }
      ]);
    }
  } catch (err) {
    await sendMessage(senderId, '⚠️ نعتذر، تعذر البحث حالياً بسبب تحديث في النظام.');
  }
}

async function handlePostback(senderId, postback) {
  await sendSenderAction(senderId, 'typing_on');
  const payload = postback.payload;

  switch (payload) {
    case 'GET_STARTED': // عندما يضغط المستخدم الجديد على "بدء الاستخدام"
      await sendMessage(senderId, 'مرحباً بك في متجر DZBoard لقطع غيار الشاشات! 📺');
      sendMainMenu(senderId);
      break;

    case 'BROWSE_PRODUCTS':
      // استخدام Quick Replies هنا يتجاوز مشكلة 3 أزرار في فيسبوك
      await sendQuickReplies(senderId, '📂 اختر القسم الذي تبحث عنه:', [
        { title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
        { title: '⚡ كارت تغذية', payload: 'CATEGORY_alimentation' },
        { title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' },
        { title: '🔩 قطع غيار', payload: 'CATEGORY_parts' },
        { title: '🔙 رجوع', payload: 'MAIN_MENU' }
      ]);
      break;

    case 'CONTACT':
      await sendMessage(senderId, '📞 **الدعم الفني والمبيعات:**\n📱 0673320066\n📧 contact@dzboard.com\n🌐 https://dzboard.vercel.app');
      break;

    case 'SEARCH':
      await sendMessage(senderId, '🔍 أرسل الموديل أو رقم البوردة في رسالة (مثال: TP.HV320.PB801):');
      break;
      
    case 'MAIN_MENU':
      sendMainMenu(senderId);
      break;

    default:
      if (payload.startsWith('CATEGORY_')) {
        const category = payload.replace('CATEGORY_', '');
        try {
          const products = await fetchProductsFromStore();
          const found = products.filter(p => p.category === category).slice(0, 10);
          
          if (found.length > 0) {
            await sendProductCarousel(senderId, found);
          } else {
            await sendMessage(senderId, '📋 لا توجد قطع متوفرة في هذا القسم حالياً.');
          }
        } catch (err) {
          await sendMessage(senderId, '⚠️ خطأ في تحميل الأقسام. حاول لاحقاً.');
        }
      }
      break;
  }
}

// دالة مساعدة لإرسال القائمة الرئيسية
async function sendMainMenu(senderId) {
  await sendQuickReplies(senderId, 'كيف يمكننا مساعدتك اليوم؟', [
    { title: '🛒 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
    { title: '🔍 البحث', payload: 'SEARCH' },
    { title: '📞 اتصل بنا', payload: 'CONTACT' }
  ]);
}

// ==========================================
// 6. Server Initialization
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 DZBoard Bot live on port ${PORT}`);
});