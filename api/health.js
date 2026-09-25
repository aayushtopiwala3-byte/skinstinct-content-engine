import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const envChecks = {
    telegramBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegramChatId: Boolean(process.env.TELEGRAM_CHAT_ID),
    telegramWebhookSecret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    geminiApiKey: Boolean(process.env.GEMINI_API_KEY),
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  let supabaseOk = false;
  let supabaseError = null;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('voice_skill').select('id').limit(1);
    supabaseOk = !error;
    if (error) supabaseError = error.message;
  } catch (err) {
    supabaseError = err.message;
  }

  const ok = Object.values(envChecks).every(Boolean) && supabaseOk;
  res.status(ok ? 200 : 500).json({ ok, envChecks, supabaseOk, supabaseError });
}
