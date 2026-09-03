import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
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
    return new Response(
      'ok',
      {
        headers: corsHeaders,
      }
    );
  }


  if (req.method !== 'POST') {
    return response(
      {
        error:
          'Method not allowed',
      },
      405
    );
  }


  try {

    // --------------------------------------------------------
    // 1. Require authenticated student
    // --------------------------------------------------------

    const authorization =
      req.headers.get('Authorization');

    if (!authorization) {
      return response(
        {
          error:
            'Authentication required',
        },
        401
      );
    }


    const supabase =
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          global: {
            headers: {
              Authorization:
                authorization,
            },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );


    const {
      data: {
        user,
      },
      error: userError,
    } =
      await supabase.auth.getUser();


    if (
      userError ||
      !user
    ) {
      return response(
        {
          error:
            'Authentication required',
        },
        401
      );
    }


    // --------------------------------------------------------
    // 2. Verify permanent student account
    // --------------------------------------------------------

    const {
      data: student,
      error: studentError,
    } =
      await supabase
        .from('students')
        .select(`
          id,
          student_id,
          student_name,
          gender,
          eligible
        `)
        .eq(
          'auth_user_id',
          user.id
        )
        .maybeSingle();


    if (studentError) {
      console.error(
        'Student lookup failed:',
        studentError
      );

      return response(
        {
          error:
            'Unable to verify student account',
        },
        500
      );
    }


    if (!student) {
      return response(
        {
          error:
            'Student account is not linked',
        },
        403
      );
    }


    if (!student.eligible) {
      return response(
        {
          error:
            'Student is not eligible for room allocation',
        },
        403
      );


    }


    // --------------------------------------------------------
    // 3. Read action
    // --------------------------------------------------------

    let body: {
      action?: string;
      room_id?: string;
      hold_id?: string;
    };


    try {
      body = await req.json();
    } catch {
      return response(
        {
          error:
            'Invalid request',
        },
        400
      );
    }


    const action =
      String(
        body.action ?? ''
      )
        .trim()
        .toLowerCase();


    // --------------------------------------------------------
    // 4. HOLD
    // --------------------------------------------------------

    if (action === 'hold') {

      const roomId =
        String(
          body.room_id ?? ''
        ).trim();


      if (!roomId) {
        return response(
          {
            error:
              'Room ID is required',
          },
          400
        );
      }


      const {
        data,
        error,
      } =
        await supabase.rpc(
          'create_room_hold',
          {
            p_room_id:
              roomId,
          }
        );


      if (error) {

        console.error(
          'create_room_hold failed:',
          error
        );

        return response(
          {
            error:
              error.message ??
              'Unable to hold room',
          },
          400
        );
      }


      return response(
        data,
        200
      );
    }


    // --------------------------------------------------------
    // 5. CONFIRM
    // --------------------------------------------------------

    if (action === 'confirm') {

      const holdId =
        String(
          body.hold_id ?? ''
        ).trim();


      if (!holdId) {
        return response(
          {
            error:
              'Hold ID is required',
          },
          400
        );
      }


      const {
        data,
        error,
      } =
        await supabase.rpc(
          'confirm_room_allocation',
          {
            p_hold_id:
              holdId,
          }
        );


      if (error) {

        console.error(
          'confirm_room_allocation failed:',
          error
        );

        return response(
          {
            error:
              error.message ??
              'Unable to confirm allocation',
          },
          400
        );
      }


      return response(
        data,
        200
      );
    }


    return response(
      {
        error:
          'Invalid action',
      },
      400
    );

  } catch (error) {

    console.error(
      'Allocate-room function error:',
      error
    );

    return response(
      {
        error:
          'Unable to process room allocation request',
      },
      500
    );
  }
});