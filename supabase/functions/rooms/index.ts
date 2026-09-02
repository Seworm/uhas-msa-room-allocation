import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  try {

    const authorization =
      req.headers.get('Authorization');

    if (!authorization) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: corsHeaders,
        }
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
        JSON.stringify({
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    const {
      data: student,
      error: studentError,
    } =
      await supabase
        .from('students')
        .select(
          'id,student_id,student_name,gender,eligible'
        )
        .eq('auth_user_id', user.id)
        .maybeSingle();

    if (studentError) {
      throw studentError;
    }

    if (!student) {
      return new Response(
        JSON.stringify({
          error:
            'Student record is not linked to this account',
        }),
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    const {
      data,
      error,
    } = await supabase
      .from('rooms')
      .select(
        `
        id,
        room_code,
        block,
        floor,
        room_number,
        capacity,
        room_type,
        gender,
        beds(
          id,
          bed_number,
          status
        )
        `
      )
      .eq('active', true)
      .order('block')
      .order('room_number');

    if (error) {
      throw error;
    }

    const rooms = (data ?? [])
      .filter((room: any) => {

        const roomGender =
          String(room.gender ?? '')
            .trim()
            .toUpperCase();

        const studentGender =
          String(student.gender ?? '')
            .trim()
            .toUpperCase();

        if (
          !roomGender ||
          roomGender === 'ALL' ||
          roomGender === 'ANY'
        ) {
          return true;
        }

        return (
          studentGender !== '' &&
          studentGender === roomGender
        );
      })
      .map((room: any) => {

        const beds =
          (room.beds ?? []).filter(
            (bed: any) =>
              bed.status === 'AVAILABLE'
          );

        return {
          id: room.id,
          room_code: room.room_code,
          block: room.block,
          floor: room.floor,
          room_number: room.room_number,
          capacity: room.capacity,
          room_type: room.room_type,
          gender: room.gender,
          available_beds: beds.length,
        };
      })
      .filter(
        (room: any) =>
          room.available_beds > 0
      );

    return new Response(
      JSON.stringify({
        rooms,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );

  } catch (e) {

    return new Response(
      JSON.stringify({
        error: String(e),
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );

  }
});