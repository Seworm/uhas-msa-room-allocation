import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

// ------------------------------------------------------------
// Supabase Admin client
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
// Deterministic internal email for every student
//
// Example:
// UHAS202212783
//
// becomes:
// uhas202212783@student-login.uhas.local
// ------------------------------------------------------------

function studentAuthEmail(studentId: string) {
  const normalized = studentId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  return `${normalized}@student-login.uhas.local`;
}

// ------------------------------------------------------------
// Create permanent student Auth account
// ------------------------------------------------------------

async function createPermanentStudentAccount(
  studentId: string,
  accessCode: string,
  email: string
) {
  const {
    data: created,
    error: createError,
  } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: accessCode,
    email_confirm: true,
    user_metadata: {
      student_id: studentId,
    },
    app_metadata: {
      account_type: 'student',
      student_id: studentId,
    },
  });

  if (createError || !created?.user) {
  console.error(
    'Permanent student Auth account creation failed:',
    {
      message: createError?.message,
      code: createError?.code,
      status: createError?.status,
    }
  );

  return response(
    {
      error: 'Unable to create student account',
      diagnostic: {
        message: createError?.message ?? 'Unknown Auth error',
        code: createError?.code ?? null,
        status: createError?.status ?? null,
      },
    },
    500
  );
}

  return created.user;
}

// ------------------------------------------------------------
// Main handler
// ------------------------------------------------------------

Deno.serve(async (req) => {
  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
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
          error: 'Invalid index number or access code',
        },
        401
      );
    }

    const studentId = String(body.student_id ?? '')
      .trim()
      .toUpperCase();

    const accessCode = String(body.access_code ?? '')
      .trim();

    if (!studentId || !accessCode) {
      return response(
        {
          error: 'Invalid index number or access code',
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
    } = await supabaseAdmin.rpc(
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
        {
          message: authError?.message,
          code: authError?.code,
          status: authError?.status,
        }
      );

      return response(
        {
          error: 'Invalid index number or access code',
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
    // 4. Determine student's Auth account
    // --------------------------------------------------------

    const email = studentAuthEmail(
      student.student_id
    );

    let authUserId = student.auth_user_id;

    // --------------------------------------------------------
    // 5. Check existing Auth account
    // --------------------------------------------------------

    let existingAuthUser = null;

    if (authUserId) {
      const {
        data: existingUserData,
        error: existingUserError,
      } =
        await supabaseAdmin.auth.admin.getUserById(
          authUserId
        );

      if (existingUserError) {
        console.warn(
          'Existing Auth user could not be retrieved:',
          {
            authUserId,
            message: existingUserError.message,
            code: existingUserError.code,
            status: existingUserError.status,
          }
        );

        existingAuthUser = null;
      } else {
        existingAuthUser =
          existingUserData?.user ?? null;
      }
    }

    // --------------------------------------------------------
    // 6. No valid Auth account
    //
    // Create a permanent account.
    // --------------------------------------------------------

    if (!existingAuthUser) {
      const oldAuthUserId = authUserId;

      const createdUser =
        await createPermanentStudentAccount(
          student.student_id,
          accessCode,
          email
        );

      authUserId = createdUser.id;

      // Link permanent account to student
      const {
        error: linkError,
      } = await supabaseAdmin
        .from('students')
        .update({
          auth_user_id: authUserId,
        })
        .eq('id', student.id);

      if (linkError) {
        console.error(
          'Failed to link permanent Auth account:',
          linkError
        );

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

      // Delete stale/anonymous account if one existed
      if (
        oldAuthUserId &&
        oldAuthUserId !== authUserId
      ) {
        const {
          error: deleteOldUserError,
        } =
          await supabaseAdmin.auth.admin.deleteUser(
            oldAuthUserId
          );

        if (deleteOldUserError) {
          console.warn(
            'Old Auth account could not be deleted:',
            {
              authUserId: oldAuthUserId,
              message:
                deleteOldUserError.message,
            }
          );
        }
      }
    }

    // --------------------------------------------------------
    // 7. Existing account is anonymous
    //
    // This fixes the old device-specific authentication.
    // --------------------------------------------------------

    else if (existingAuthUser.is_anonymous) {
      const oldAnonymousUserId =
        existingAuthUser.id;

      console.log(
        'Detected old anonymous student account. ' +
        'Creating permanent account.',
        {
          studentId: student.student_id,
          oldAuthUserId: oldAnonymousUserId,
        }
      );

      // Create permanent account
      const createdUser =
        await createPermanentStudentAccount(
          student.student_id,
          accessCode,
          email
        );

      authUserId = createdUser.id;

      // Relink student
      const {
        error: linkError,
      } = await supabaseAdmin
        .from('students')
        .update({
          auth_user_id: authUserId,
        })
        .eq('id', student.id);

      if (linkError) {
        console.error(
          'Failed to relink student to permanent Auth account:',
          linkError
        );

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

      // Delete old anonymous account
      const {
        error: deleteAnonymousError,
      } =
        await supabaseAdmin.auth.admin.deleteUser(
          oldAnonymousUserId
        );

      if (deleteAnonymousError) {
        console.warn(
          'Old anonymous account could not be deleted:',
          {
            authUserId: oldAnonymousUserId,
            message:
              deleteAnonymousError.message,
          }
        );
      }
    }

    // --------------------------------------------------------
    // 8. Existing permanent account
    //
    // Synchronise its password with the current access code.
    // --------------------------------------------------------

    else {
      const {
        error: updateError,
      } =
        await supabaseAdmin.auth.admin.updateUserById(
          existingAuthUser.id,
          {
            email,
            password: accessCode,
            email_confirm: true,
            user_metadata: {
              student_id:
                student.student_id,
            },
            app_metadata: {
              account_type: 'student',
              student_id:
                student.student_id,
            },
          }
        );

      if (updateError) {
        console.error(
          'Permanent Auth account update failed:',
          {
            message: updateError.message,
            code: updateError.code,
            status: updateError.status,
          }
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
    // 9. Sign in using normal Supabase Auth
    //
    // NEVER use the service-role client for sign-in.
    // --------------------------------------------------------

    const supabaseAuth = createClient(
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
      !loginData?.session
    ) {
      console.error(
        'Student Auth sign-in failed:',
        {
          message: loginError?.message,
          code: loginError?.code,
          status: loginError?.status,
        }
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
    // 10. Return the real Supabase session
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
          error instanceof Error
            ? error.message
            : 'Unable to process login request',
      },
      500
    );
  }
});