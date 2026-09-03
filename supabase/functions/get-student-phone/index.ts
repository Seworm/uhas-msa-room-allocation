import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const jsonResponse = (
  body: Record<string, unknown>,
  status = 200,
) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
};

Deno.serve(async (req) => {
  // IMPORTANT: Handle browser CORS preflight before authentication.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase environment variables.");

      return jsonResponse(
        { error: "Server configuration error." },
        500,
      );
    }

    const authorization =
      req.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse(
        { error: "Unauthorized. Missing access token." },
        401,
      );
    }

    const token = authorization.substring(7).trim();

    if (!token) {
      return jsonResponse(
        { error: "Unauthorized. Invalid access token." },
        401,
      );
    }

    // Create a client using the user's JWT.
    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    );

    // Verify the authenticated user.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error("Authentication error:", authError);

      return jsonResponse(
        { error: "Unauthorized. Your session is invalid or expired." },
        401,
      );
    }

    // Find the student belonging to the authenticated user.
    const {
      data: student,
      error: studentError,
    } = await supabase
      .from("students")
      .select(
        "student_id, student_name, phone_number",
      )
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (studentError) {
      console.error(
        "Student lookup error:",
        studentError,
      );

      return jsonResponse(
        { error: "Unable to retrieve your student profile." },
        500,
      );
    }

    if (!student) {
      return jsonResponse(
        {
          error:
            "No student profile is linked to your account.",
        },
        404,
      );
    }

    return jsonResponse({
      success: true,
      phone_number: student.phone_number ?? "",
      student_id: student.student_id,
      student_name: student.student_name,
    });
  } catch (error) {
    console.error(
      "get-student-phone unexpected error:",
      error,
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected server error occurred.",
      },
      500,
    );
  }
});