/**
 * Tel2Anon — Anonymous Telegram Inbox Bot
 * ----------------------------------------
 * Runs entirely on a Cloudflare Worker. Anyone can message the bot and the
 * message is relayed to the owner with zero information about the sender
 * attached to it. The bot uses NO database, NO KV, NO D1 — nothing is ever
 * persisted server-side. State needed to support "reply" lives only inside
 * the Telegram message itself (see README for details on this trade-off).
 *
 * License: MIT
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET') {
      return new Response('Tel2Anon bot is running.');
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Reject anything that isn't Telegram. secret_token is set on setWebhook.
    const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!env.WEBHOOK_SECRET || secretHeader !== env.WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch (err) {
      return new Response('Bad Request', { status: 400 });
    }

    // Answer Telegram immediately, do the work in the background.
    ctx.waitUntil(handleUpdate(update, env));
    return new Response('OK');
  },
};

const TEXT = {
  senderWelcome:
    'سلام! هر پیامی برای من بفرستید کاملاً ناشناس برایم ارسال می‌شود. هویت شما هرگز ذخیره یا نمایش داده نمی‌شود.',
  senderSent: '✅ پیام شما به صورت ناشناس ارسال شد.',
  ownerWelcome:
    'ربات پیام ناشناس فعال است ✅\nهر پیامی که دیگران بفرستند اینجا برایتان نمایش داده می‌شود.\nبرای پاسخ ناشناس، روی دکمه «پاسخ ناشناس» زیر پیام بزنید.',
  newMessageHeader: '📩 پیام ناشناس جدید:',
  replyButton: '↩️ پاسخ ناشناس',
  replyPrompt: '✍️ پاسخ خود را بنویسید (این پیام از قبل به‌صورت ریپلای تنظیم شده، فقط تایپ کنید):',
  replySent: '✅ پاسخ شما به صورت ناشناس ارسال شد.',
  replyNotFound: '⚠️ برای پاسخ دادن باید روی پیامی که دکمه «پاسخ ناشناس» زیرش هست کلیک کنید، نه روی پیام کاربر.',
};

async function handleUpdate(update, env) {
  const OWNER_ID = Number(env.OWNER_ID);
  const api = telegramApi(env.BOT_TOKEN);

  if (update.callback_query) {
    return handleCallback(update.callback_query, api, OWNER_ID);
  }

  const msg = update.message;
  if (!msg || msg.chat.type !== 'private' || msg.from?.is_bot) return;

  const chatId = msg.chat.id;

  // ---------------- Owner side ----------------
  if (chatId === OWNER_ID) {
    if (msg.text === '/start') {
      await api('sendMessage', { chat_id: OWNER_ID, text: TEXT.ownerWelcome });
      return;
    }

    if (msg.reply_to_message) {
      const targetId = extractTargetId(msg.reply_to_message.text);
      if (targetId) {
        await api('copyMessage', {
          chat_id: targetId,
          from_chat_id: OWNER_ID,
          message_id: msg.message_id,
        });
        await api('sendMessage', {
          chat_id: OWNER_ID,
          text: TEXT.replySent,
          reply_to_message_id: msg.message_id,
        });
      } else {
        await api('sendMessage', { chat_id: OWNER_ID, text: TEXT.replyNotFound });
      }
    }
    return;
  }

  // ---------------- Anonymous sender side ----------------
  if (msg.text === '/start') {
    await api('sendMessage', { chat_id: chatId, text: TEXT.senderWelcome });
    return;
  }

  await api('sendMessage', { chat_id: OWNER_ID, text: TEXT.newMessageHeader });
  await api('copyMessage', {
    chat_id: OWNER_ID,
    from_chat_id: chatId,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[{ text: TEXT.replyButton, callback_data: `r:${chatId}` }]],
    },
  });
  await api('sendMessage', { chat_id: chatId, text: TEXT.senderSent });
}

async function handleCallback(cb, api, OWNER_ID) {
  // Always ack the callback so Telegram stops showing the loading spinner.
  if (cb.from.id !== OWNER_ID || !(cb.data || '').startsWith('r:')) {
    return api('answerCallbackQuery', { callback_query_id: cb.id });
  }

  const targetId = cb.data.slice(2);
  await api('answerCallbackQuery', { callback_query_id: cb.id });
  await api('sendMessage', {
    chat_id: OWNER_ID,
    text: `${TEXT.replyPrompt}\nref:${targetId}`,
    reply_markup: { force_reply: true, selective: true },
  });
}

function extractTargetId(text) {
  if (!text) return null;
  const match = text.match(/ref:(-?\d+)/);
  return match ? match[1] : null;
}

function telegramApi(botToken) {
  const base = `https://api.telegram.org/bot${botToken}`;
  return async (method, body) => {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };
}
