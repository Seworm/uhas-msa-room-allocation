import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const VALID_BLOCKS = [
  'Ahoe',
  'Bankoe',
  'Dome',
  'Hliha',
];

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

    // ------------------------------------------------------------
    // 1. Verify the authenticated session
    // ------------------------------------------------------------

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

    // ------------------------------------------------------------
    // 2. Verify that this account belongs to an eligible student
    // ------------------------------------------------------------

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
      console.error(
        'Student lookup failed:',
        studentError
      );

      return new Response(
        JSON.stringify({
          error:
            'Unable to verify student account',
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
          error:
            'Student is not eligible for room allocation',
        }),
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    // ------------------------------------------------------------
    // 3. Verify gender
    // ------------------------------------------------------------

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
          error:
            'Please select your gender before viewing rooms',
          code: 'GENDER_REQUIRED',
        }),
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // ------------------------------------------------------------
    // 4. Read selected block
    // ------------------------------------------------------------

    let body: { block?: string } = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const block = String(
      body.block ?? ''
    ).trim();

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

    // ------------------------------------------------------------
    // 5. Ask the database for available rooms
    //
    // This function is deliberately NOT querying the rooms table
    // directly.
    //
    // The database function is the authority for:
    //
    // - student gender
    // - room gender
    // - male/female room quotas
    // - Dome 31–40 male-only rule
    // - Ahoe temporary locks
    // - Ahoe unlocking rules
    // - available beds
    // ------------------------------------------------------------

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
          error:
            'Unable to load available rooms',
        }),
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }

    // ------------------------------------------------------------
    // 6. Normalize database response
    // ------------------------------------------------------------

    const normalizedRooms = (rooms ?? [])
      .map((room: any) => ({
        id:
          room.id ??
          room.room_id ??
          null,

        room_code:
          room.room_code ??
          null,

        block:
          room.block ??
          null,

        floor:
          room.floor ??
          null,

        room_number:
          room.room_number ??
          null,

        capacity:
          Number(room.capacity ?? 0),

        room_type:
          room.room_type ??
          null,

        gender:
          room.gender ??
          null,

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

    // ------------------------------------------------------------
    // 7. Return room data
    // ------------------------------------------------------------

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
    console.error(
      'Rooms function error:',
      error
    );

    return new Response(
      JSON.stringify({
        error:
          'Unable to load available rooms',
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});