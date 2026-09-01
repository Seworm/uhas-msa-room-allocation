import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  let createdUserId: string | undefined;
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const studentId = String(body.student_id ?? '').trim().toUpperCase().replace(/\s+/g, '');
    const accessCode = String(body.access_code ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!studentId || !accessCode || studentId.length > 64 || accessCode.length > 64) {
      return response({ error: 'Invalid index number or access code.' }, 401);
    }

    const clientIp = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
    const password = crypto.randomUUID();
    const email = `student-${crypto.randomUUID()}@example.com`;

    // These credentials never leave this server; the browser only receives its session.
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { uhas_student_access: true },
    });
    if (createError || !created.user) throw createError ?? new Error('Could not create login session');
    createdUserId = created.user.id;

    const { data: claim, error: claimError } = await service.rpc('claim_student_access', {
      p_student_id: studentId,
      p_access_code: accessCode,
      p_auth_user_id: createdUserId,
      p_request_key: await sha256(clientIp),
    });
    if (claimError) throw claimError;

    if (!claim?.authenticated) {
      await service.auth.admin.deleteUser(createdUserId);
      createdUserId = undefined;
      return response(
        { error: claim?.rate_limited ? 'Too many attempts. Please try again in 15 minutes.' : 'Invalid index number or access code.' },
        claim?.rate_limited ? 429 : 401,
      );
    }

    const { data: signedIn, error: signInError } = await service.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw signInError ?? new Error('Could not create login session');

    return response({
      session: { access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token },
      student: { index_number: claim.index_number, student_name: claim.student_name },
    });
  } catch (error) {
    if (createdUserId) await service.auth.admin.deleteUser(createdUserId);
    console.error('student-login failed', error);
    return response({ error: 'Unable to sign in. Please try again.' }, 500);
  }
});


