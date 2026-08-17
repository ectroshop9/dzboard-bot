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

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook - استقبال الرسائل
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message) {
          handleMessage(event.sender.id, event.message);
        } else if (event.postback) {
          handlePostback(event.sender.id, event.postback);
        }
      });
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// إرسال رسالة
async function sendMessage(senderId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: { text }
      }
    );
  } catch (err) {
    console.error('Send message error:', err.response?.data || err.message);
  }
}

// إرسال أزرار
async function sendButtons(senderId, text, buttons) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text,
              buttons
            }
          }
        }
      }
    );
  } catch (err) {
    console.error('Send buttons error:', err.response?.data || err.message);
  }
}

// معالجة الرسائل
async function handleMessage(senderId, message) {
  const text = message.text || '';
  
  if (text.toLowerCase().includes('سلام') || text.toLowerCase().includes('مرحبا') || text === 'اهلا') {
    await sendButtons(senderId, 'أهلاً! كيف أقدر نساعدك؟', [
      { type: 'postback', title: '🛒 تصفح المنتجات', payload: 'BROWSE_PRODUCTS' },
      { type: 'postback', title: '🔍 البحث', payload: 'SEARCH' },
      { type: 'postback', title: '📞 اتصل بنا', payload: 'CONTACT' }
    ]);
  } else if (text) {
    // بحث عن منتج
    try {
      const res = await axios.get(`${API_URL}/products?include_inactive=false`);
      const products = res.data.products || [];
      const found = products.filter(p => 
        p.name.toLowerCase().includes(text.toLowerCase())
      ).slice(0, 5);
      
      if (found.length > 0) {
        for (const product of found) {
          const buttons = [
            { type: 'postback', title: '🛒 اطلب الآن', payload: `ORDER_${product.id}` }
          ];
          if (product.update_url) {
            buttons.push({ type: 'web_url', title: '🔄 تحديث متوفر', url: product.update_url });
          }
          await sendButtons(senderId, `${product.name}\n💰 ${product.price} دج\n📦 المخزون: ${product.stock}`, buttons);
        }
      } else {
        await sendMessage(senderId, '❌ لم أجد منتج بهذا الاسم. جرب كلمة أخرى.');
      }
    } catch (err) {
      await sendMessage(senderId, '⚠️ خطأ في البحث. حاول لاحقاً.');
    }
  }
}

// معالجة الأزرار
async function handlePostback(senderId, postback) {
  const payload = postback.payload;
  
  if (payload === 'BROWSE_PRODUCTS') {
    await sendButtons(senderId, 'اختر القسم:', [
      { type: 'postback', title: 'كرت تيكون', payload: 'CATEGORY_tcon' },
      { type: 'postback', title: 'اليمونتاسيون', payload: 'CATEGORY_alimentation' },
      { type: 'postback', title: 'مين بورد', payload: 'CATEGORY_main-board' }
    ]);
  } else if (payload.startsWith('CATEGORY_')) {
    const category = payload.replace('CATEGORY_', '');
    try {
      const res = await axios.get(`${API_URL}/products?include_inactive=false`);
      const products = res.data.products.filter(p => p.category === category).slice(0, 10);
      
      if (products.length > 0) {
        for (const product of products) {
          await sendButtons(senderId, `${product.name}\n💰 ${product.price} دج`, [
            { type: 'postback', title: 'اطلب الآن', payload: `ORDER_${product.id}` }
          ]);
        }
      } else {
        await sendMessage(senderId, 'لا توجد منتجات في هذا القسم.');
      }
    } catch (err) {
      await sendMessage(senderId, 'خطأ في التحميل.');
    }
  } else if (payload.startsWith('ORDER_')) {
    await sendMessage(senderId, '📝 لطلب المنتج، اذهب إلى المتجر:\nhttps://dzboard.vercel.app/store');
  } else if (payload === 'CONTACT') {
    await sendMessage(senderId, '📞 تواصل معنا:\n📱 0673320066\n📧 contact@dzboard.com');
  } else if (payload === 'SEARCH') {
    await sendMessage(senderId, '🔍 اكتب اسم المنتج الذي تبحث عنه.');
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`DZBoard Bot running on port ${PORT}`);
});
