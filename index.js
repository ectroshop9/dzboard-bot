import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dzboard_verify_123';
const API_URL = 'https://dzboard.onrender.com/api';
const STORE_URL = 'https://dzboard.vercel.app';

// --- Verification Endpoint ---
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

// --- Webhook Events Handler ---
app.post('/webhook', (req, res) => {
  const { body } = req;

  if (body.object === 'page') {
    // ⚡ رد فوري لمنع اعادة الإرسال من فيسبوك
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
          console.error('❌ Error handling event:', err.message);
        }
      });
    });
  } else {
    res.sendStatus(404);
  }
});

// --- Facebook API Helpers ---

// مؤشر الكتابة (Typing indicator)
async function sendSenderAction(senderId, action = 'typing_on') {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: senderId }, sender_action: action }
    );
  } catch (err) {
    console.error('Sender action error:', err.response?.data || err.message);
  }
}

// إرسال رسالة نصية
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

// إرسال كروت المنتجات أفقياً (Carousel Template)
async function sendProductCarousel(senderId, products) {
  const elements = products.map(product => {
    const buttons = [
      {
        type: 'web_url',
        title: '🛒 اطلب الآن',
        url: `${STORE_URL}/product/${product.id}`
      }
    ];

    if (product.update_url) {
      buttons.push({
        type: 'web_url',
        title: '🔄 تحديث الفيرموير',
        url: product.update_url
      });
    }

    return {
      title: product.name,
      subtitle: `💰 السعر: ${product.price} دج\n📦 الحالة: ${product.stock > 0 ? 'متوفر' : 'غير متوفر'}`,
      image_url: product.image_url || 'https://via.placeholder.com/300x200?text=DZBoard',
      buttons: buttons
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
            payload: {
              template_type: 'generic',
              elements: elements
            }
          }
        }
      }
    );
  } catch (err) {
    console.error('Send carousel error:', err.response?.data || err.message);
  }
}

// إرسال أزرار سريعة (Quick Replies)
async function sendQuickReplies(senderId, text, options) {
  const quickReplies = options.map(opt => ({
    content_type: 'text',
    title: opt.title,
    payload: opt.payload
  }));

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: {
          text: text,
          quick_replies: quickReplies
        }
      }
    );
  } catch (err) {
    console.error('Send quick replies error:', err.response?.data || err.message);
  }
}

// --- Logic Processors ---

async function handleMessage(senderId, message) {
  await sendSenderAction(senderId, 'typing_on');

  // معالجة الصور أو الملفات
  if (message.attachments) {
    await sendMessage(senderId, '📸 استلمنا الصورة! سيقوم موظف الصيانة بالفحص وموافاتك بالتفاصيل قريباً.');
    return;
  }

  const text = message.text ? message.text.trim() : '';
  const lower = text.toLowerCase();

  if (!text) return;

  // 1️⃣ الكشف عن التحيات
  const greetings = ['سلام', 'مرحبا', 'اهلا', 'hi', 'hello', 'bonjour', 'salut', 'السلام عليكم'];
  if (greetings.some(g => lower.includes(g))) {
    await sendQuickReplies(senderId, '👋 أهلاً بك في DZBoard لقطع غيار التلفزيونات!\nكيف يمكننا مساعدتك اليوم؟', [
      { title: '🛒 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
      { title: '🔍 البحث عن قطعة', payload: 'SEARCH' },
      { title: '📞 اتصل بنا', payload: 'CONTACT' }
    ]);
    return;
  }

  // 2️⃣ البحث عن المنتج من الخادم مباشرة (Server-side Search)
  try {
    // إرسال الكلمة المفتاحية مباشرة للباك إند بدلاً من جلب كامل البيانات
    const res = await axios.get(`${API_URL}/products`, {
      params: { search: text, include_inactive: false }
    });

    let products = res.data.products || [];

    // فلترة احتياطية في حال عدم استجابة الباك إند للبحث في الـ Params
    if (products.length > 0 && res.data.filtered !== true) {
      products = products.filter(p => p.name && p.name.toLowerCase().includes(lower));
    }

    const found = products.slice(0, 10); // الحد الأقصى للكاروسيل هو 10 كروت

    if (found.length > 0) {
      await sendMessage(senderId, `🔍 وجدنا ${found.length} نتائج لـ "${text}":`);
      await sendProductCarousel(senderId, found);
    } else {
      await sendQuickReplies(senderId, `❌ لم نجد أي قطعة مطابقة لـ "${text}".\nجرب البحث برقم البوردة أو اختر قسم:`, [
        { title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
        { title: '⚡ تغذية', payload: 'CATEGORY_alimentation' },
        { title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' }
      ]);
    }
  } catch (err) {
    console.error('Search Error:', err.message);
    await sendMessage(senderId, '⚠️ تعذر البحث حالياً. يرجى إعادة المحاولة بعد قليل.');
  }
}

async function handlePostback(senderId, postback) {
  await sendSenderAction(senderId, 'typing_on');
  const payload = postback.payload;

  switch (payload) {
    case 'BROWSE_PRODUCTS':
      await sendQuickReplies(senderId, '📂 اختر القسم المطلوب لتصفح القطع المتوفرة:', [
        { title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
        { title: '⚡ كارت تغذية', payload: 'CATEGORY_alimentation' },
        { title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' }
      ]);
      break;

    case 'CONTACT':
      await sendMessage(senderId, '📞 **بيانات الاتصال الدعم الفني:**\n📱 الهاتف: 0673320066\n📧 البريد: contact@dzboard.com\n🌐 المتجر: https://dzboard.vercel.app');
      break;

    case 'SEARCH':
      await sendMessage(senderId, '🔍 أرسل الموديل أو رقم القطعة (مثال: TP.HV320.PB801):');
      break;

    default:
      if (payload.startsWith('CATEGORY_')) {
        const category = payload.replace('CATEGORY_', '');
        try {
          const res = await axios.get(`${API_URL}/products`, {
            params: { category, include_inactive: false }
          });
          
          let products = res.data.products || [];
          if (res.data.filtered !== true) {
            products = products.filter(p => p.category === category);
          }
          
          const found = products.slice(0, 10);

          if (found.length > 0) {
            await sendProductCarousel(senderId, found);
          } else {
            await sendMessage(senderId, '📋 لا توجد قطع متوفرة في هذا القسم حالياً.');
          }
        } catch (err) {
          console.error('Category Fetch Error:', err.message);
          await sendMessage(senderId, '⚠️ خطأ أثناء جلب منتجات القسم.');
        }
      }
      break;
  }
}

// --- Server Listen ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Professional DZBoard Bot live on port ${PORT}`);
});