/**
 * Tel2Anon — Anonymous Telegram Inbox Bot (one-way)
 * ---------------------------------------------------
 * Runs entirely on a Cloudflare Worker. Anyone can message the bot and the
 * message is relayed to the owner with zero information about the sender
 * attached to it. This is a one-way inbox: the owner cannot reply through
 * the bot. No database, no KV, no D1 — nothing is ever persisted or
 * logged server-side.
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
  ownerWelcome: 'ربات پیام ناشناس فعال است ✅\nهر پیامی که دیگران بفرستند اینجا برایتان نمایش داده می‌شود.',
  newMessageHeader: '📩 پیام ناشناس جدید:',
};

async function handleUpdate(update, env) {
  const OWNER_ID = Number(env.OWNER_ID);
  const api = telegramApi(env.BOT_TOKEN);

  const msg = update.message;
  if (!msg || msg.chat.type !== 'private' || msg.from?.is_bot) return;

  const chatId = msg.chat.id;

  // ---------------- Owner side ----------------
  if (chatId === OWNER_ID) {
    if (msg.text === '/start') {
      await api('sendMessage', { chat_id: OWNER_ID, text: TEXT.ownerWelcome });
    }
    // Any other message from the owner is ignored — this bot is one-way.
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
  });
  await api('sendMessage', { chat_id: chatId, text: TEXT.senderSent });
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
