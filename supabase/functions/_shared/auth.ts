import { createClient, type User } from 'npm:@supabase/supabase-js@2';

// Verify the caller is a signed-in user.
//
// We deploy with --no-verify-jwt, so Supabase does NOT check the token for us.
// supabaseClient.functions.invoke() in the browser sends the user's session
// JWT as "Authorization: Bearer <token>". We ask Supabase Auth whether that
// token belongs to a real, unexpired user. When nobody is signed in, the
// browser sends the anon key instead, which has no user — so it's rejected.
//
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically to every
// Edge Function; you don't need to set them as secrets.
export async function getAuthenticatedUser(req: Request): Promise<User | null> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;

    const token = authHeader.slice('Bearer '.length);
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
}
