import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function response(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: corsHeaders,
    }
  );
}

Deno.serve(async (req) => {

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return response(
      { error: 'Method not allowed' },
      405
    );
  }

  try {

    const authorization =
      req.headers.get('Authorization');

    if (!authorization) {
      return response(
        { error: 'Authentication required' },
        401
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return response(
        { error: 'Authentication required' },
        401
      );
    }

    const body = await req.json();

    const studentId =
      String(body.student_id ?? '');

    const accessCode =
      String(body.access_code ?? '');

    if (!studentId || !accessCode) {
      return response(
        { error: 'Invalid index number or access code' },
        401
      );
    }

    const { data, error } =
      await supabase.rpc(
        'activate_student',
        {
          p_student_id: studentId,
          p_access_code: accessCode,
        }
      );

    if (error) {
      /*
       * Deliberately return a generic credential error.
       * Do not reveal whether the index number exists,
       * whether the code was close, etc.
       */
      return response(
        {
          error:
            'Invalid index number or access code',
        },
        401
      );
    }

    return response({
      success: true,
      student: data,
    });

  } catch {
    return response(
      {
        error:
          'Unable to process login request',
      },
      500
    );
  }
});