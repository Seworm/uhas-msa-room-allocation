import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const VALID_BLOCKS = ['Ahoe', 'Bankoe', 'Dome', 'Hliha'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed',
      }),
      {
        status: 405,
        headers: corsHeaders,
      }
    );
  }

  try {
    const authorization = req.headers.get('Authorization');

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

    // Verify the JWT/session.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
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

    // Confirm that this authenticated account is linked
    // to an eligible student.
    const {
      data: student,
      error: studentError,
    } = await supabase
      .from('students')
      .select(
        'id, student_id, student_name, gender, eligible'
      )
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (studentError) {
      console.error('Student lookup failed:', studentError);

      return new Response(
        JSON.stringify({
          error: 'Unable to verify student account',
        }),
        {
          status: 500,
          headers: corsHeaders,
        }
      );
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

    if (!student.eligible) {
      return new Response(
        JSON.stringify({
          error: 'Student is not eligible for room allocation',
        }),
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    // Gender must be selected before rooms can be displayed.
    const studentGender = String(
      student.gender ?? ''
    )
      .trim()
      .toUpperCase();

    if (
      studentGender !== 'MALE' &&
      studentGender !== 'FEMALE'
    ) {
      return new Response(
        JSON.stringify({
          error: 'Please select your gender before viewing rooms',
          code: 'GENDER_REQUIRED',
        }),
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Read the selected block from the request body.
    let body: { block?: string } = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const block = String(body.block ?? '').trim();

    if (!VALID_BLOCKS.includes(block)) {
      return new Response(
        JSON.stringify({
          error:
            'A valid block must be selected: Ahoe, Bankoe, Dome, or Hliha',
          code: 'BLOCK_REQUIRED',
        }),
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    /*
     * IMPORTANT:
     *
     * Do NOT query rooms directly here.
     *
     * available_rooms_for_current_student() is the database
     * authority for room availability. It enforces:
     *
     * - student's selected gender
     * - dynamic room gender
     * - male 92-room maximum
     * - female 68-room maximum
     * - Dome 31–40 male-only rule
     * - Ahoe temporary locks
     * - Ahoe unlocking after all other rooms are completely full
     * - available beds
     */
    const {
      data: rooms,
      error: roomsError,
    } = await supabase.rpc(
      'available_rooms_for_current_student',
      {
        p_block: block,
      }
    );

    if (roomsError) {
      console.error(
        'available_rooms_for_current_student failed:',
        roomsError
      );

      return new Response(
        JSON.stringify({
          error: 'Unable to load available rooms',
        }),
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }

    /*
     * Normalize the database result for the frontend.
     *
     * The database function remains the source of truth.
     * This only shapes its output for the web application.
     */
    const normalizedRooms = (rooms ?? [])
      .map((room: any) => ({
        id: room.id ?? room.room_id,
        room_code: room.room_code,
        block: room.block,
        floor: room.floor,
        room_number: room.room_number,
        capacity: room.capacity,
        room_type: room.room_type,
        gender: room.gender,
        available_beds:
          Number(
            room.available_beds ??
              room.available_bed_count ??
              0
          ),
        occupied_beds:
          Number(
            room.occupied_beds ??
              room.occupied_bed_count ??
              0
          ),
      }))
      .filter(
        (room: any) =>
          room.id &&
          room.available_beds > 0
      );

    return new Response(
      JSON.stringify({
        rooms: normalizedRooms,
        block,
        student_gender: studentGender,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    console.error('Rooms function error:', error);

    return new Response(
      JSON.stringify({
        error: 'Unable to load available rooms',
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});