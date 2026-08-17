import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// ==========================================
// 1. الإعدادات والمتغيرات
// ==========================================
const PORT = process.env.PORT || 5000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dzboard_verify_123';
const MY_API_URL = 'https://dzboard.onrender.com/api';
const FB_API_URL = 'https://graph.facebook.com/v18.0/me/messages';
const ADMIN_ID = process.env.ADMIN_ID || '100092160171252';

const GREETINGS = new Set(['سلام', 'مرحبا', 'اهلا', 'السلام عليكم', 'صباح الخير', 'مساء الخير', 'hi', 'hello']);

// دالة تأخير بسيطة
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ذاكرة المؤقتة للمستخدمين والحالات
const userMemory = new Map();  // senderId -> { name, lastVisit }
const userStates = new Map();  // senderId -> 'AWAITING_SEARCH' | 'AWAITING_TRACK'

// تنظيف الرموز لتعزيز البحث عن موديلات اللوحات
function normalizeText(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ==========================================
// 2. دوال الاتصال وجلب البيانات
// ==========================================
async function callFB_API(endpoint, payload) {
  try {
    await axios.post(endpoint, payload, {
      params: { access_token: PAGE_ACCESS_TOKEN }
    });
  } catch (error) {
    console.error('FB API Error:', error.response?.data?.error?.message || error.message);
  }
}

async function getUserProfile(senderId) {
  if (userMemory.has(senderId)) return userMemory.get(senderId);

  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/${senderId}`, {
      params: { fields: 'first_name,last_name', access_token: PAGE_ACCESS_TOKEN }
    });
    const userData = { 
      name: res.data.first_name || 'عزيزي الزبون', 
      fullName: `${res.data.first_name || ''} ${res.data.last_name || ''}`.trim() 
    };
    userMemory.set(senderId, userData);
    return userData;
  } catch (err) {
    return { name: 'عزيزي الزبون', fullName: 'مستخدم' };
  }
}

async function fetchProducts() {
  try {
    const res = await axios.get(`${MY_API_URL}/products?include_inactive=false`);
    return res.data.products || [];
  } catch (error) {
    console.error('API Fetch Error:', error.message);
    throw new Error('Database connection failed');
  }
}

// ==========================================
// 3. دوال إرسال الرسائل والقوائم
// ==========================================
async function sendAction(senderId, action = 'typing_on') {
  await callFB_API(FB_API_URL, { recipient: { id: senderId }, sender_action: action });
}

async function sendText(senderId, text) {
  await callFB_API(FB_API_URL, { recipient: { id: senderId }, message: { text } });
}

// ✅ الأزرار العمودية للقوائم (باقية كما طلبت بدون تغيير)
async function sendButtons(senderId, text, buttons) {
  await callFB_API(FB_API_URL, {
    recipient: { id: senderId },
    message: {
      attachment: {
        type: 'template',
        payload: { template_type: 'button', text, buttons }
      }
    }
  });
}

// ✅ نظام العرض الاحترافي مع دعم المنتجات غير المحدودة وتكبير الصور
async function sendProductList(senderId, products) {
  // تقسيم المنتجات إلى مجموعات (10 كحد أقصى لكل مجموعة حسب قوانين فيسبوك)
  const chunkSize = 10;
  
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    
    const elements = chunk.map(product => {
      const buttons = [
        { type: 'web_url', title: '🛒 اطلب الآن', url: `https://dzboard.vercel.app/checkout?product=${product.id}` }
      ];
      
      if (product.update_url) {
        buttons.push({ type: 'web_url', title: '🔄 تحديث السوفتوير', url: product.update_url });
      }

      const imageUrl = product.image || 'https://dzboard.vercel.app/default-product.jpg'; // صورة افتراضية

      return {
        title: product.name,
        image_url: imageUrl,
        subtitle: `💰 ${product.price} دج | 📦 ${product.stock > 0 ? 'متوفر' : 'غير متوفر'}`,
        // 💡 لفتح الصورة بحجم كبير عند النقر عليها
        default_action: {
          type: "web_url",
          url: imageUrl,
          webview_height_ratio: "full" 
        },
        buttons: buttons
      };
    });

    // إرسال المجموعة الحالية
    await callFB_API(FB_API_URL, {
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
    });

    // تأخير بسيط إذا كان هناك المزيد من المنتجات لتجنب حظر الرسائل
    if (i + chunkSize < products.length) {
      await sleep(1000);
    }
  }
}

// ==========================================
// 4. واجهات التفاعل (القوائم والتقييم)
// ==========================================
async function sendMainMenu(senderId) {
  userStates.delete(senderId);
  const user = await getUserProfile(senderId);
  const greeting = `👋 أهلاً بك ${user.name} في DZBoard! كيف يمكننا مساعدتك اليوم؟`;
  
  await sendButtons(senderId, greeting, [
    { type: 'postback', title: '🛒 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
    { type: 'postback', title: '🔍 البحث عن قطعة', payload: 'SEARCH' },
    { type: 'postback', title: '📦 تتبع طلبك', payload: 'TRACK_ORDER' }
  ]);
  await sendButtons(senderId, '🌐 روابط مهمة:', [
    { type: 'web_url', title: '🛍️ زيارة المتجر', url: 'https://dzboard.vercel.app/' },
    { type: 'web_url', title: '📝 طلب قطعة خاصة', url: 'https://dzboard.vercel.app/request-part' }
  ]);
}

async function notifyAdmin(message) {
  if (ADMIN_ID) {
    await sendText(ADMIN_ID, message);
  }
}

async function trackOrder(senderId, orderId) {
  await sendButtons(senderId, `📦 تفاصيل الطلب رقم #${orderId}:`, [
    { type: 'web_url', title: '📍 تتبع حالة الشحنة', url: `https://dzboard.vercel.app/track/${orderId}` },
    { type: 'postback', title: '🔙 القائمة الرئيسية', payload: 'MAIN_MENU' }
  ]);
}

async function askRating(senderId) {
  await sendButtons(senderId, '💡 هل وجدت ما تبحث عنه؟ شاركنا تقييمك:', [
    { type: 'postback', title: '👍 ممتاز', payload: 'RATING_GOOD' },
    { type: 'postback', title: '👎 تحتاج تحسين', payload: 'RATING_BAD' }
  ]);
}

// ==========================================
// 5. معالجة الأحداث (Messages & Postbacks)
// ==========================================
async function handleMessage(senderId, message) {
  await sendAction(senderId, 'typing_on');

  if (message.attachments) {
    await sendText(senderId, '📸 استلمنا الصورة! سيقوم الفني بمراجعتها والرد عليك في أقرب وقت.');
    await notifyAdmin(`📥 استلمت صورة جديدة من مستخدم (ID: ${senderId})`);
    return;
  }

  const text = message.text ? message.text.trim() : '';
  const lower = text.toLowerCase();
  if (!text) return;

  const currentState = userStates.get(senderId);

  // حالة انتظار كود التتبع
  if (currentState === 'AWAITING_TRACK' || lower.startsWith('trk-') || lower.startsWith('ord-')) {
    userStates.delete(senderId);
    const orderId = text.replace('#', '').trim();
    await trackOrder(senderId, orderId);
    return;
  }

  // التحقق من الترحيب
  const isGreeting = [...GREETINGS].some(g => lower.includes(g));
  if (isGreeting && currentState !== 'AWAITING_SEARCH') {
    await sendMainMenu(senderId);
    return;
  }

  // معالجة البحث
  userStates.delete(senderId);
  const cleanQuery = normalizeText(text);

  try {
    const products = await fetchProducts();
    const found = products.filter(p => {
      const cleanName = normalizeText(p.name || '');
      const cleanCat = normalizeText(p.category || '');
      return cleanName.includes(cleanQuery) || cleanCat.includes(cleanQuery);
    });

    if (found.length > 0) {
      await sendText(senderId, `🔍 وجدنا ${found.length} نتائج لـ "${text}":`);
      await sendProductList(senderId, found); // استخدام العرض الاحترافي الجديد مع التقسيم
    } else {
      await sendButtons(senderId, `❌ لم نجد نتائج لـ "${text}".\nيمكنك تجريب اختيار القسم مباشرة:`, [
        { type: 'postback', title: '📂 تصفح الأقسام', payload: 'BROWSE_PRODUCTS' },
        { type: 'postback', title: '🔍 إعادة البحث', payload: 'SEARCH' }
      ]);
    }
  } catch (err) {
    await sendText(senderId, '⚠️ نعتذر، حدث خطأ أثناء الاتصال بقاعدة البيانات.');
  }
}

async function handlePostback(senderId, postback) {
  await sendAction(senderId, 'typing_on');
  const payload = postback.payload;

  try {
    switch (payload) {
      case 'GET_STARTED':
      case 'MAIN_MENU':
        await sendMainMenu(senderId);
        break;

      case 'BROWSE_PRODUCTS':
        userStates.delete(senderId);
        await sendButtons(senderId, '📂 اختر القسم المطلوب:', [
          { type: 'postback', title: '🖥️ كارت تيكون', payload: 'CATEGORY_tcon' },
          { type: 'postback', title: '⚡ كارت تغذية', payload: 'CATEGORY_alimentation' },
          { type: 'postback', title: '🔧 اللوحة الأم', payload: 'CATEGORY_main-board' }
        ]);
        await sendButtons(senderId, '📂 خيارات أخرى:', [
          { type: 'postback', title: '🔩 قطع غيار متنوعة', payload: 'CATEGORY_parts' },
          { type: 'postback', title: '📞 اتصل بنا', payload: 'CONTACT' },
          { type: 'postback', title: '🔙 القائمة الرئيسية', payload: 'MAIN_MENU' }
        ]);
        break;

      case 'CONTACT':
        await sendButtons(senderId, '📞 وسائل التواصل الدعم الفني:\n📱 الهاتف: 0673310066\n📧 الإيميل: contact@dzboard.com', [
          { type: 'postback', title: '🔙 القائمة الرئيسية', payload: 'MAIN_MENU' }
        ]);
        break;

      case 'SEARCH':
        userStates.set(senderId, 'AWAITING_SEARCH');
        await sendText(senderId, '🔍 أرسل لي اسم القطعة أو الرقم التسلسلي (مثال: TP.MS338.PB801):');
        break;

      case 'TRACK_ORDER':
        userStates.set(senderId, 'AWAITING_TRACK');
        await sendText(senderId, '📦 يرجى إرسال رقم الطلب الخاص بك (مثال: 1024):');
        break;

      case 'RATING_GOOD':
        await sendText(senderId, '😊 شكراً جزيلاً لتقييمك الإيجابي!');
        {
          const user = await getUserProfile(senderId);
          await notifyAdmin(`⭐ تقييم إيجابي جديد من: ${user.fullName}`);
        }
        break;

      case 'RATING_BAD':
        await sendText(senderId, '😔 نعتذر منك. تم إبلاغ الإدارة وسنتواصل معك لتحسين الخدمة.');
        {
          const user = await getUserProfile(senderId);
          await notifyAdmin(`⚠️ تقييم سلبي من: ${user.fullName} (ID: ${senderId})`);
        }
        break;

      default:
        // معالجة اختيار الأقسام
        if (payload.startsWith('CATEGORY_')) {
          const category = payload.replace('CATEGORY_', '');
          const products = await fetchProducts();
          const found = products.filter(p => p.category === category);
          
          if (found.length > 0) {
            await sendProductList(senderId, found); // العرض الاحترافي مع دعم عدد كبير
            await sleep(1500);
            await askRating(senderId);
          } else {
            await sendButtons(senderId, '📋 لا توجد قطع متوفرة في هذا القسم حالياً.', [
              { type: 'postback', title: '📂 أقسام أخرى', payload: 'BROWSE_PRODUCTS' }
            ]);
          }
        }
        break;
    }
  } catch (err) {
    await sendText(senderId, '⚠️ حدث خطأ غير متوقع.');
  }
}

// ==========================================
// 6. مسارات السيرفر (Webhooks)
// ==========================================

// إعداد القائمة الدائمة (تُستدعى مرة واحدة من المتصفح)
app.get('/setup-messenger', async (req, res) => {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/me/messenger_profile`, {
      get_started: { payload: 'GET_STARTED' },
      persistent_menu: [{
        locale: 'default',
        composer_input_disabled: false,
        call_to_actions: [
          { type: 'postback', title: '🏠 القائمة الرئيسية', payload: 'MAIN_MENU' },
          { type: 'postback', title: '🔍 بحث عن قطعة', payload: 'SEARCH' },
          { type: 'postback', title: '📦 تتبع طلب', payload: 'TRACK_ORDER' }
        ]
      }]
    }, { params: { access_token: PAGE_ACCESS_TOKEN } });

    res.send('✅ تم إعداد القائمة الدائمة وزر Get Started بنجاح!');
  } catch (err) {
    res.status(500).send(err.response?.data || err.message);
  }
});

// التحقق من الويب هوك الخاص بفيسبوك
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// استقبال الأحداث من فيسبوك
app.post('/webhook', async (req, res) => {
  const { body } = req;
  
  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED'); // رد فوري لفيسبوك لتجنب إعادة الإرسال

    for (const entry of body.entry) {
      for (const event of entry.messaging) {
        if (event.message?.is_echo) continue;
        
        const senderId = event.sender.id;
        
        try {
          if (event.message) {
            await handleMessage(senderId, event.message);
          } else if (event.postback) {
            await handlePostback(senderId, event.postback);
          }
        } catch (err) {
          console.error(`Error for ${senderId}:`, err.message);
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 DZBoard Bot live on port ${PORT}`);
});