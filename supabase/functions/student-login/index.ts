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


// ------------------------------------------------------------
// Supabase Admin client
//
// IMPORTANT:
// This client is NEVER exposed to the browser.
// ------------------------------------------------------------

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


// ------------------------------------------------------------
// Deterministic internal email for every student.
//
// Students never see or use this email.
// It exists solely because Supabase password authentication
// requires an email or phone identifier.
//
// Example:
//
// UHAS202212783
//
// becomes:
//
// uhas202212783@student-login.uhas.local
// ------------------------------------------------------------

function studentAuthEmail(
  studentId: string
) {
  const normalized =
    studentId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  return `${normalized}@student-login.uhas.local`;
}


// ------------------------------------------------------------
// Main handler
// ------------------------------------------------------------

Deno.serve(async (req) => {

  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  if (req.method === 'OPTIONS') {
    return new Response(
      'ok',
      {
        headers: corsHeaders,
      }
    );
  }


  // ----------------------------------------------------------
  // POST only
  // ----------------------------------------------------------

  if (req.method !== 'POST') {
    return response(
      {
        error: 'Method not allowed',
      },
      405
    );
  }


  try {

    // --------------------------------------------------------
    // 1. Read credentials
    // --------------------------------------------------------

    let body: {
      student_id?: string;
      access_code?: string;
    };

    try {
      body = await req.json();
    } catch {
      return response(
        {
          error:
            'Invalid index number or access code',
        },
        401
      );
    }


    const studentId =
      String(body.student_id ?? '')
        .trim()
        .toUpperCase();

    const accessCode =
      String(body.access_code ?? '')
        .trim();


    if (!studentId || !accessCode) {
      return response(
        {
          error:
            'Invalid index number or access code',
        },
        401
      );
    }


    // --------------------------------------------------------
    // 2. Authenticate against database
    // --------------------------------------------------------

    const {
      data: students,
      error: authError,
    } =
      await supabaseAdmin.rpc(
        'authenticate_student_access_code',
        {
          p_student_id: studentId,
          p_access_code: accessCode,
        }
      );


    if (
      authError ||
      !students ||
      students.length === 0
    ) {

      console.error(
        'Student credential verification failed:',
        authError
      );

      return response(
        {
          error:
            'Invalid index number or access code',
        },
        401
      );
    }


    const student = students[0];


    // --------------------------------------------------------
    // 3. Verify eligibility
    // --------------------------------------------------------

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
    // 4. Determine the permanent Auth account
    // --------------------------------------------------------

    const email =
      studentAuthEmail(student.student_id);


    let authUserId =
      student.auth_user_id;


    // --------------------------------------------------------
    // 5. Create Auth account if it does not exist
    // --------------------------------------------------------

    if (!authUserId) {

      const {
        data: created,
        error: createError,
      } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: accessCode,
          email_confirm: true,
          user_metadata: {
            student_id:
              student.student_id,
          },
          app_metadata: {
            account_type:
              'student',
            student_id:
              student.student_id,
          },
        });


      if (createError) {

        console.error(
          'Auth account creation failed:',
          createError
        );

        return response(
          {
            error:
              'Unable to create student account',
          },
          500
        );
      }


      authUserId =
        created.user.id;


      // ------------------------------------------------------
      // Link the permanent Auth account to the student.
      // ------------------------------------------------------

      const {
        error: linkError,
      } =
        await supabaseAdmin
          .from('students')
          .update({
            auth_user_id:
              authUserId,
          })
          .eq(
            'id',
            student.id
          );


      if (linkError) {

        console.error(
          'Failed to link Auth account:',
          linkError
        );

        // Prevent orphaned accounts from remaining around.
        await supabaseAdmin.auth.admin.deleteUser(
          authUserId
        );

        return response(
          {
            error:
              'Unable to complete student account setup',
          },
          500
        );
      }

    } else {

      // ------------------------------------------------------
      // Existing permanent Auth account.
      //
      // Synchronise the password with the current access code.
      //
      // This allows an administrator to regenerate/change an
      // access code without leaving the old Auth password active.
      // ------------------------------------------------------

      const {
        error: updateError,
      } =
        await supabaseAdmin.auth.admin.updateUserById(
          authUserId,
          {
            password: accessCode,
            email_confirm: true,
            user_metadata: {
              student_id:
                student.student_id,
            },
            app_metadata: {
              account_type:
                'student',
              student_id:
                student.student_id,
            },
          }
        );


      if (updateError) {

        console.error(
          'Auth account update failed:',
          updateError
        );

        return response(
          {
            error:
              'Unable to update student account',
          },
          500
        );
      }
    }


    // --------------------------------------------------------
    // 6. Create a completely separate client for signing in.
    //
    // NEVER use the service-role client for this operation.
    //
    // signInWithPassword creates the actual student session.
    // --------------------------------------------------------

    const supabaseAuth =
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );


    const {
      data: loginData,
      error: loginError,
    } =
      await supabaseAuth.auth.signInWithPassword({
        email,
        password: accessCode,
      });


    if (
      loginError ||
      !loginData.session
    ) {

      console.error(
        'Student Auth sign-in failed:',
        loginError
      );

      return response(
        {
          error:
            'Unable to sign in student',
        },
        401
      );
    }


    // --------------------------------------------------------
    // 7. Return Supabase session to browser
    // --------------------------------------------------------

    return response({
      success: true,

      session: {
        access_token:
          loginData.session.access_token,

        refresh_token:
          loginData.session.refresh_token,

        expires_in:
          loginData.session.expires_in,

        expires_at:
          loginData.session.expires_at,

        token_type:
          loginData.session.token_type,
      },

      student: {
        student_id:
          student.student_id,

        student_name:
          student.student_name,

        programme:
          student.programme,

        level:
          student.level,

        gender:
          student.gender,

        eligible:
          student.eligible,
      },
    });

  } catch (error) {

    console.error(
      'Student login error:',
      error
    );

    return response(
      {
        error:
          'Unable to process login request',
      },
      500
    );
  }
});