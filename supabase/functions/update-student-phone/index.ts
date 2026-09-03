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

function normalizePhone(phone: unknown): string {
  if (typeof phone !== "string") {
    return "";
  }

  // Remove spaces, hyphens, brackets, etc.
  return phone.trim().replace(/[\s\-().]/g, "");
}

function isValidGhanaPhone(phone: string): boolean {
  // Local Ghana format:
  // 0241234567
  //
  // International Ghana format:
  // +233241234567
  //
  // Supports the major Ghana mobile prefixes.
  return /^(0[2356789][0-9]{8}|\+233[2356789][0-9]{8})$/.test(
    phone,
  );
}

Deno.serve(async (req) => {
  // IMPORTANT: CORS preflight must be handled before auth.
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

    // Create a client using the authenticated user's JWT.
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
        {
          error:
            "Unauthorized. Your session is invalid or expired.",
        },
        401,
      );
    }

    // Read the request body.
    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON request body." },
        400,
      );
    }

    // Accept p_phone, phone_number, or phone for compatibility.
    const rawPhone =
      body.p_phone ??
      body.phone_number ??
      body.phone;

    const phone = normalizePhone(rawPhone);

    if (!phone) {
      return jsonResponse(
        { error: "Phone number is required." },
        400,
      );
    }

    if (!isValidGhanaPhone(phone)) {
      return jsonResponse(
        {
          error:
            "Please enter a valid Ghanaian mobile phone number.",
        },
        400,
      );
    }

    // Find the student linked to the authenticated Supabase user.
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

    // Update only the authenticated student's phone number.
    const {
      data: updatedStudent,
      error: updateError,
    } = await supabase
      .from("students")
      .update({
        phone_number: phone,
        updated_at: new Date().toISOString(),
      })
      .eq("auth_user_id", user.id)
      .select(
        "student_id, student_name, phone_number",
      )
      .single();

    if (updateError) {
      console.error(
        "Phone update error:",
        updateError,
      );

      return jsonResponse(
        {
          error:
            "Unable to save your phone number. Please try again.",
        },
        500,
      );
    }

    return jsonResponse({
      success: true,
      message: "Phone number saved successfully.",
      phone_number: updatedStudent.phone_number,
      student_id: updatedStudent.student_id,
      student_name: updatedStudent.student_name,
    });
  } catch (error) {
    console.error(
      "update-student-phone unexpected error:",
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