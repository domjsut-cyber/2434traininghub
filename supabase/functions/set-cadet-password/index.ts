/* ============================================================================
   set-cadet-password — give a cadet a new password, from inside the hub

   WHY THIS EXISTS AS A SERVER FUNCTION
     Changing somebody else's password needs Supabase's SECRET key. That key
     ignores every row-level security policy in hub-schema.sql, so it must never
     be in a browser - which is why the hub could not do this itself and staff
     had to use the Supabase dashboard.

     This runs on Supabase's servers instead. The secret key is read from the
     environment Supabase injects; it is never sent anywhere and never reaches
     a cadet's tablet.

   WHAT IT WILL AND WILL NOT DO
     It trusts nothing the caller says about themselves. It reads their access
     token, asks Supabase who that is, and then asks the database whether that
     person is staff. A cadet calling this directly gets 403, whatever they put
     in the request.

     It only ever sets a password on a profile that exists in this squadron, and
     it refuses to touch your own account - use Password in the hub's header for
     that, which needs your current password and so cannot be used by someone
     who found your screen unattended.

   DEPLOYING IT
     Supabase dashboard > Edge Functions > Deploy a new function, name it
     exactly  set-cadet-password , paste this file in, deploy. No secrets to
     configure: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
     are provided automatically.

     Until it is deployed the hub says so plainly and staff carry on using the
     dashboard. Nothing else stops working.
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !secretKey) {
    return json({ error: 'This function is missing its Supabase settings.' }, 500);
  }

  /* 1. Who is actually calling? Their own token, never a claim in the body. */
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'You are not signed in.' }, 401);
  }
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: 'Your sign-in has lapsed. Sign in again.' }, 401);

  /* 2. Are they staff? Asked of the database, not of the request. */
  const asAdmin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: me } = await asAdmin
    .from('profiles').select('is_staff').eq('id', caller.id).maybeSingle();
  if (!me || !me.is_staff) {
    return json({ error: 'Only staff can give someone a new password.' }, 403);
  }

  /* 3. What are we being asked to do? */
  let body: { cadet_id?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const cadetId = String(body?.cadet_id || '').trim();
  const password = String(body?.password || '');
  if (!cadetId) return json({ error: 'No cadet was named.' }, 400);
  if (password.length < 8) return json({ error: 'That password is too short.' }, 400);
  if (cadetId === caller.id) {
    return json({ error: 'To change your own password use Password at the top of the hub.' }, 400);
  }

  /* 4. Only someone who is actually in this squadron. */
  const { data: target } = await asAdmin
    .from('profiles').select('id, display_name').eq('id', cadetId).maybeSingle();
  if (!target) return json({ error: 'That person is not on the squadron list.' }, 404);

  const { error } = await asAdmin.auth.admin.updateUserById(cadetId, { password });
  if (error) return json({ error: error.message }, 400);

  return json({ ok: true, display_name: target.display_name });
});
