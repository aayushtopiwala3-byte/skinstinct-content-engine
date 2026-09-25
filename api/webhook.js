import { getSupabase } from '../lib/supabase.js';
import { sendMessage } from '../lib/telegram.js';
import { scoreNote, findNewsAngle, draftPost } from '../lib/gemini.js';

const REJECT_THRESHOLD = 6;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).end();
    return;
  }

  try {
    await processUpdate(req.body);
  } catch (err) {
    console.error('webhook processing error', err);
  }

  res.status(200).json({ ok: true });
}

async function processUpdate(update) {
  const message = update?.channel_post || update?.message;
  if (!message) return;

  const chatId = message.chat?.id;
  if (String(chatId) !== String(process.env.TELEGRAM_CHAT_ID)) {
    console.log('ignoring message from unexpected chat', chatId);
    return;
  }

  const text = (message.text || '').trim();
  if (!text) return;

  if (message.reply_to_message) {
    await handleDecision(message);
    return;
  }

  await handleNewNote(chatId, message, text);
}

async function handleDecision(message) {
  const decision = message.text.trim().toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'REJECT') return;

  const supabase = getSupabase();
  const repliedToId = message.reply_to_message.message_id;

  const { data: draft, error } = await supabase
    .from('drafts')
    .select('id, status')
    .eq('telegram_message_id', repliedToId)
    .maybeSingle();

  if (error || !draft) {
    console.log('no matching draft for reply', repliedToId, error);
    return;
  }

  if (draft.status !== 'pending') return;

  const status = decision === 'APPROVE' ? 'approved' : 'rejected';
  await supabase
    .from('drafts')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', draft.id);

  await sendMessage(
    message.chat.id,
    status === 'approved' ? 'Marked as approved.' : 'Marked as rejected.',
    message.message_id
  );
}

async function handleNewNote(chatId, message, text) {
  const supabase = getSupabase();

  // Idempotency: if this exact channel message was already recorded (e.g. Telegram retried
  // the webhook because processing took a while), skip reprocessing it.
  const { data: note, error: insertError } = await supabase
    .from('notes')
    .insert({
      telegram_message_id: message.message_id,
      chat_id: chatId,
      raw_text: text,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      console.log('duplicate note, skipping', message.message_id);
      return;
    }
    console.error('failed to insert note', insertError);
    return;
  }

  let scoring;
  try {
    scoring = await scoreNote(text);
  } catch (err) {
    console.error('scoring failed', err);
    await sendMessage(
      chatId,
      "Couldn't score this note due to an internal error. It's saved but not drafted.",
      message.message_id
    );
    return;
  }

  if (!scoring || typeof scoring.score !== 'number' || scoring.score < REJECT_THRESHOLD) {
    const reason = scoring?.reason || 'Too thin to build a post from.';
    await supabase
      .from('notes')
      .update({ status: 'rejected', score: scoring?.score ?? null, reject_reason: reason })
      .eq('id', note.id);
    await sendMessage(chatId, `Rejected: ${reason}`, message.message_id);
    return;
  }

  let newsAngle = null;
  try {
    const angleResult = await findNewsAngle(text, scoring.keywords || []);
    if (angleResult?.hasAngle && angleResult.angle) {
      newsAngle = angleResult.angle;
    }
  } catch (err) {
    console.error('news angle lookup failed, continuing without it', err);
  }

  const { data: voiceRow } = await supabase
    .from('voice_skill')
    .select('content')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const voiceGuide = voiceRow?.content || '';

  let draftText;
  try {
    draftText = await draftPost({ noteText: text, voiceGuide, newsAngle });
  } catch (err) {
    console.error('drafting failed', err);
    await sendMessage(
      chatId,
      'Scored well but drafting failed due to an internal error.',
      message.message_id
    );
    return;
  }

  await supabase
    .from('notes')
    .update({ status: 'drafted', score: scoring.score, news_angle: newsAngle })
    .eq('id', note.id);

  const sent = await sendMessage(
    chatId,
    `${draftText}\n\nReply APPROVE or REJECT to this message.`,
    message.message_id
  );

  await supabase.from('drafts').insert({
    note_id: note.id,
    content: draftText,
    telegram_message_id: sent.message_id,
    status: 'pending',
  });
}
