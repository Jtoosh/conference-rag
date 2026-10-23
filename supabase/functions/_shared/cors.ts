// CORS headers shared by every Edge Function.
// The browser (on GitHub Pages or localhost) is a different origin than
// *.supabase.co, so it first sends an OPTIONS "preflight" request asking
// permission. These headers grant it.
//
// '*' is fine here because we authenticate with a Bearer token, not cookies:
// CORS isn't the security boundary — the auth check in auth.ts is.
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Build a JSON response that always includes the CORS headers
// (the browser hides responses that are missing them — even errors).
export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
