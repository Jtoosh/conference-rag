// ============================================
// EDGE FUNCTION: generate-answer
// ============================================
// The "G" in RAG. The browser has already Retrieved the most relevant talks
// (embed-question + match_sentences); this function Augments a prompt with
// those talks and asks the model to Generate a grounded, cited answer.
//
// Request:  POST { "question": "...", "context_talks": [{ title, speaker, text }] }
// Response: { "answer": "..." }

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedUser } from '../_shared/auth.ts';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const CHAT_MODEL = 'gpt-6-luna';

// Cost guards: the app sends 3 full talks (~15–20k characters each).
// These limits leave room for that while stopping oversized requests.
const MAX_TALKS = 5;
const MAX_TALK_CHARS = 30_000;

const SYSTEM_PROMPT = `You answer questions about General Conference talks of The Church of Jesus Christ of Latter-day Saints.

Rules:
- Use ONLY the numbered talks provided. Do not rely on outside knowledge.
- Cite the talk behind each point inline as (Title — Speaker).
- If the talks do not answer the question, say so plainly instead of guessing.
- End with a line starting "Sources:" that lists only the talks you cited.
- Write plain text in short paragraphs. Do not use Markdown (no #, *, or bullet lists).`;

interface ContextTalk {
    title: string;
    speaker: string;
    text: string;
}

function isContextTalk(value: unknown): value is ContextTalk {
    const t = value as ContextTalk;
    return typeof t?.title === 'string' && typeof t?.speaker === 'string' && typeof t?.text === 'string';
}

// Number each talk so the model can tell them apart and cite them by name
function formatContext(talks: ContextTalk[]): string {
    return talks
        .map((t, i) => `[${i + 1}] "${t.title}" — ${t.speaker}\n${t.text.slice(0, MAX_TALK_CHARS)}`)
        .join('\n\n---\n\n');
}

Deno.serve(async (req) => {
    // 1. CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // 2. Only signed-in users may spend our OpenAI credits
    const user = await getAuthenticatedUser(req);
    if (!user) {
        return jsonResponse({ error: 'Unauthorized — please sign in' }, 401);
    }

    // 3. Validate the request body
    let question: unknown, contextTalks: unknown;
    try {
        ({ question, context_talks: contextTalks } = await req.json());
    } catch {
        return jsonResponse({ error: 'Request body must be JSON' }, 400);
    }
    if (typeof question !== 'string' || !question.trim()) {
        return jsonResponse({ error: 'Missing "question" (non-empty string)' }, 400);
    }
    // Rejecting an empty list also means the app's page-load readiness check
    // (which sends context_talks: []) never triggers a paid model call.
    if (!Array.isArray(contextTalks) || contextTalks.length === 0) {
        return jsonResponse({ error: '"context_talks" must be a non-empty array' }, 400);
    }
    if (contextTalks.length > MAX_TALKS) {
        return jsonResponse({ error: `At most ${MAX_TALKS} context talks allowed` }, 400);
    }
    if (!contextTalks.every(isContextTalk)) {
        return jsonResponse({ error: 'Each context talk needs string title, speaker, and text' }, 400);
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
        return jsonResponse({ error: 'Server misconfigured: OPENAI_API_KEY is not set' }, 500);
    }

    // 4. Augment: put the retrieved talks in front of the question
    const userPrompt = `Conference talks:\n\n${formatContext(contextTalks)}\n\nQuestion: ${question.trim()}`;

    // 5. Generate
    const openaiResponse = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: CHAT_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
        }),
    });

    if (!openaiResponse.ok) {
        console.error('OpenAI error', openaiResponse.status, await openaiResponse.text());
        return jsonResponse({ error: 'Failed to generate answer' }, 502);
    }

    const completion = await openaiResponse.json();
    const answer = completion.choices?.[0]?.message?.content;
    if (!answer) {
        console.error('OpenAI returned no answer', JSON.stringify(completion));
        return jsonResponse({ error: 'Model returned an empty answer' }, 502);
    }

    return jsonResponse({ answer });
});
