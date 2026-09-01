import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get('Authorization');

    if (!authorization) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
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
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id,student_id,student_name')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (studentError) throw studentError;

    if (!student) {
      return new Response(
        JSON.stringify({
          error: 'Student record is not linked to this account',
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    const { data, error } = await supabase
      .from('allocations')
      .select(`
        allocation_number,
        status,
        created_at,
        beds (
          bed_number,
          rooms (
            room_code,
            block,
            floor,
            room_number
          )
        )
      `)
      .eq('student_id', student.id)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        student,
        allocation: data,
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: corsHeaders }
    );
  }
});