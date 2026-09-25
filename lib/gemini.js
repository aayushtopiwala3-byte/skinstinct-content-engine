const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callGemini({ prompt, json = false, search = false }) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (search) {
    body.tools = [{ google_search: {} }];
  } else if (json) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini API error: ${JSON.stringify(data)}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) {
    throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  }
  return text;
}

function parseJsonLoose(raw) {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}

export async function scoreNote(noteText) {
  const prompt = `You are the content editor for Meera, a skincare-brand founder whose LinkedIn posts are grounded in specific operational and formulation detail, concrete moments, and numeric evidence — never vague reflection or generic opinion.

Score this raw voice-note transcript from 1 (too thin or vague to build a post from) to 10 (excellent, ready to build a strong post from). A strong note has a concrete moment or specific numbers/data, and a real insight or decision behind it.

Return strict JSON only, no prose, no markdown fences, in exactly this shape:
{"score": <integer 1-10>, "reason": "<one sentence, specific to this note>", "keywords": ["<up to 5 short topical keywords>"]}

Note:
"""
${noteText}
"""`;

  const raw = await callGemini({ prompt, json: true });
  return parseJsonLoose(raw);
}

export async function findNewsAngle(noteText, keywords) {
  const prompt = `A skincare-brand founder wrote this note, with topical keywords: ${keywords.join(', ')}.

Note:
"""
${noteText}
"""

Search for a real, well-known, recent news story or industry narrative (skincare, beauty, DTC, or manufacturing/supply chain) that this note could be meaningfully connected to for a LinkedIn post. Only report one if you find a genuine, verifiable match — do not invent one.

Respond with ONLY raw JSON, no markdown fences, no commentary, in exactly this shape:
{"hasAngle": boolean, "angle": "one sentence describing the real story and the connection, or empty string"}`;

  const raw = await callGemini({ prompt, search: true });
  return parseJsonLoose(raw);
}

export async function draftPost({ noteText, voiceGuide, newsAngle }) {
  const prompt = `You are ghostwriting a LinkedIn post for Meera, a skincare-brand founder. Write in her voice exactly as described below. Do not soften it into generic LinkedIn-guru tone.

Voice profile:
${voiceGuide}

Raw note from Meera (the seed of the post):
"""
${noteText}
"""
${newsAngle ? `\nA real, relevant industry angle you may weave in if it strengthens the post (optional, do not force it):\n${newsAngle}\n` : ''}
Write the LinkedIn post now. Output only the post text — no title, no hashtags unless they occur naturally, no preamble like "Here's a draft:".`;

  const raw = await callGemini({ prompt });
  return raw.trim();
}
