// ============================================
// EDGE FUNCTION: embed-question
// ============================================
// Browser → (this function) → OpenAI
// Turns a user's question into a 1,536-dimension embedding so the browser
// can run match_sentences() against the database. The OpenAI key lives only
// here on the server, set with `supabase secrets set OPENAI_API_KEY=...`.
//
// Request:  POST { "question": "How can I find peace?" }
// Response: { "embedding": [0.012, -0.034, ...] }

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedUser } from '../_shared/auth.ts';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
// Must match the model used in scripts/04_embed_data.py — vectors from
// different models live in different "spaces" and can't be compared.
const EMBEDDING_MODEL = 'text-embedding-3-small';

Deno.serve(async (req) => {
    // 1. CORS preflight: the browser asks permission before the real POST
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
    let question: unknown;
    try {
        ({ question } = await req.json());
    } catch {
        return jsonResponse({ error: 'Request body must be JSON' }, 400);
    }
    if (typeof question !== 'string' || !question.trim()) {
        return jsonResponse({ error: 'Missing "question" (non-empty string)' }, 400);
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
        return jsonResponse({ error: 'Server misconfigured: OPENAI_API_KEY is not set' }, 500);
    }

    // 4. Ask OpenAI for the embedding
    const openaiResponse = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: question.trim() }),
    });

    if (!openaiResponse.ok) {
        // Log details server-side (visible in Dashboard → Edge Functions → Logs),
        // but don't leak them to the browser
        console.error('OpenAI error', openaiResponse.status, await openaiResponse.text());
        return jsonResponse({ error: 'Failed to generate embedding' }, 502);
    }

    const { data } = await openaiResponse.json();
    return jsonResponse({ embedding: data[0].embedding });
});
