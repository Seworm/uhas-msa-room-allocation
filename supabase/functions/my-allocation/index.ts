import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
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

    // ------------------------------------------------------------
    // 1. Identify the currently authenticated student
    // ------------------------------------------------------------

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
    } = await supabaseAdmin
      .from('students')
      .select(`
        id,
        student_id,
        student_name,
        programme,
        level,
        gender,
        phone_number
      `)
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

    // ------------------------------------------------------------
    // 2. Get the student's active allocation
    // ------------------------------------------------------------

    const {
      data: allocation,
      error: allocationError,
    } = await supabaseAdmin
      .from('allocations')
      .select(`
        allocation_number,
        status,
        allocated_at,
        beds (
          bed_number,
          room_id,
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

    if (allocationError) {
      throw allocationError;
    }

    // ------------------------------------------------------------
    // 3. No allocation yet
    // ------------------------------------------------------------

    if (!allocation) {
      return new Response(
        JSON.stringify({
          student,
          allocation: null,
          roommates: [],
        }),
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    }

    // ------------------------------------------------------------
    // 4. Determine the student's room
    // ------------------------------------------------------------

    const bed = Array.isArray(allocation.beds)
      ? allocation.beds[0]
      : allocation.beds;

    const room = Array.isArray(bed?.rooms)
      ? bed.rooms[0]
      : bed?.rooms;

    if (!bed?.room_id) {
      throw new Error(
        'Allocation is missing its room information'
      );
    }

    // ------------------------------------------------------------
    // 5. Find all other active allocations in the same room
    //
    // IMPORTANT:
    // Only safe public-facing student information is selected.
    //
    // We deliberately DO NOT return:
    //   - student_id
    //   - students.id
    //   - auth_user_id
    //   - access_code
    //   - phone_number
    //   - gender
    // ------------------------------------------------------------

    const {
      data: roommateAllocations,
      error: roommatesError,
    } = await supabaseAdmin
      .from('allocations')
      .select(`
        student_id,
        beds!inner (
          room_id
        ),
        students!inner (
          student_name,
          programme,
          level
        )
      `)
      .eq('status', 'ACTIVE')
      .eq('beds.room_id', bed.room_id)
      .neq('student_id', student.id);

    if (roommatesError) {
      throw roommatesError;
    }

    // ------------------------------------------------------------
    // 6. Convert the database result into a deliberately small
    //    roommate object.
    // ------------------------------------------------------------

    const roommates = (roommateAllocations ?? []).map(
      (allocation) => {
        const roommate = Array.isArray(
          allocation.students
        )
          ? allocation.students[0]
          : allocation.students;

        return {
          student_name:
            roommate?.student_name ?? null,

          programme:
            roommate?.programme ?? null,

          level:
            roommate?.level ?? null,
        };
      }
    );

    // ------------------------------------------------------------
    // 7. Return the student portal payload
    // ------------------------------------------------------------

    return new Response(
      JSON.stringify({
        student,

        allocation: {
          allocation_number:
            allocation.allocation_number,

          status:
            allocation.status,

          created_at:
            allocation.allocated_at,

          beds: {
            bed_number:
              bed.bed_number,

            rooms: {
              room_code:
                room?.room_code ?? null,

              block:
                room?.block ?? null,

              floor:
                room?.floor ?? null,

              room_number:
                room?.room_number ?? null,
            },
          },
        },

        roommates,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (e) {
    console.error(
      'my-allocation error:',
      e
    );

    return new Response(
      JSON.stringify({
        error: 'Unable to load your allocation.',
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});