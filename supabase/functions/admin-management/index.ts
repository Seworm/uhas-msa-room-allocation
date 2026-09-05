import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};

const json = (
  body: unknown,
  status = 200
) =>
  new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json"
      }
    }
  );

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      { headers: corsHeaders }
    );
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed." },
      405
    );
  }

  try {

    const authHeader =
      req.headers.get("Authorization");

    if (!authHeader) {
      return json(
        { error: "Missing authorization." },
        401
      );
    }

    /*
     * Client authenticated as the currently
     * logged-in administrator.
     */
    const userClient =
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get(
          "SUPABASE_ANON_KEY"
        )!,
        {
          global: {
            headers: {
              Authorization:
                authHeader
            }
          }
        }
      );

    const {
      data: {
        user
      },
      error: userError
    } =
      await userClient.auth
        .getUser();

    if (
      userError ||
      !user
    ) {
      return json(
        {
          error:
            "Authentication required."
        },
        401
      );
    }

    /*
     * Verify that the authenticated user
     * is actually a super administrator.
     */
    const {
      data: profile,
      error: profileError
    } =
      await userClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (
      profileError ||
      !profile ||
      profile.role !== "super_admin"
    ) {
      return json(
        {
          error:
            "Super administrator privileges required."
        },
        403
      );
    }

    /*
     * Service-role client.
     *
     * This key exists ONLY inside the Edge Function.
     * It is never exposed to the browser.
     */
    const adminClient =
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get(
          "SUPABASE_SERVICE_ROLE_KEY"
        )!
      );

    const body =
      await req.json();

    const action =
      body?.action;

    /*
     * --------------------------------------------------------
     * LIST ADMINISTRATORS
     * --------------------------------------------------------
     */
    if (action === "list") {

      const {
        data: profiles,
        error
      } =
        await adminClient
          .from("profiles")
          .select(
            "id, role, created_at"
          )
          .in(
            "role",
            [
              "admin",
              "super_admin"
            ]
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) {
        throw error;
      }

      const result = [];

      for (
        const profile
        of profiles || []
      ) {

        const {
          data: authData,
          error: authError
        } =
          await adminClient.auth
            .admin
            .getUserById(
              profile.id
            );

        if (authError) {
          continue;
        }

        result.push({
          id:
            profile.id,

          email:
            authData.user?.email ||
            "",

          role:
            profile.role,

          created_at:
            profile.created_at
        });
      }

      return json({
        administrators:
          result
      });
    }

    /*
     * --------------------------------------------------------
     * CREATE ADMINISTRATOR
     * --------------------------------------------------------
     */
    if (action === "create") {

      const email =
        String(
          body?.email || ""
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          body?.password || ""
        );

      const role =
        body?.role ===
        "super_admin"
          ? "super_admin"
          : "admin";

      if (!email) {
        return json(
          {
            error:
              "Email address is required."
          },
          400
        );
      }

      if (
        password.length < 8
      ) {
        return json(
          {
            error:
              "Password must be at least 8 characters."
          },
          400
        );
      }

      const {
        data: created,
        error: createError
      } =
        await adminClient.auth
          .admin
          .createUser({
            email,
            password,
            email_confirm:
              true
          });

      if (createError) {
        throw createError;
      }

      if (
        !created.user
      ) {
        throw new Error(
          "User was not created."
        );
      }

      const {
        error: profileInsertError
      } =
        await adminClient
          .from("profiles")
          .insert({
            id:
              created.user.id,
            role
          });

      if (profileInsertError) {

        /*
         * Roll back the Auth user if
         * the profile cannot be created.
         */
        await adminClient.auth
          .admin
          .deleteUser(
            created.user.id
          );

        throw profileInsertError;
      }

      return json({
        success: true,
        administrator: {
          id:
            created.user.id,
          email,
          role
        }
      });
    }

    /*
     * --------------------------------------------------------
     * CHANGE ROLE
     * --------------------------------------------------------
     */
    if (action === "change_role") {

      const userId =
        String(
          body?.user_id || ""
        );

      const newRole =
        body?.role ===
        "super_admin"
          ? "super_admin"
          : "admin";

      if (!userId) {
        return json(
          {
            error:
              "User ID is required."
          },
          400
        );
      }

      /*
       * Prevent a super-admin from
       * accidentally removing their own
       * super-admin privileges.
       */
      if (
        userId === user.id &&
        newRole !== "super_admin"
      ) {
        return json(
          {
            error:
              "You cannot remove your own super-admin privileges."
          },
          400
        );
      }

      const {
        error
      } =
        await adminClient
          .from("profiles")
          .update({
            role:
              newRole
          })
          .eq(
            "id",
            userId
          );

      if (error) {
        throw error;
      }

      return json({
        success: true
      });
    }

    /*
     * --------------------------------------------------------
     * DELETE ADMINISTRATOR
     * --------------------------------------------------------
     */
    if (action === "delete") {

      const userId =
        String(
          body?.user_id || ""
        );

      if (!userId) {
        return json(
          {
            error:
              "User ID is required."
          },
          400
        );
      }

      if (
        userId === user.id
      ) {
        return json(
          {
            error:
              "You cannot delete your own administrator account."
          },
          400
        );
      }

      const {
        data: targetProfile,
        error: targetError
      } =
        await adminClient
          .from("profiles")
          .select("role")
          .eq(
            "id",
            userId
          )
          .single();

      if (
        targetError ||
        !targetProfile
      ) {
        return json(
          {
            error:
              "Administrator profile not found."
          },
          404
        );
      }

      if (
        ![
          "admin",
          "super_admin"
        ].includes(
          targetProfile.role
        )
      ) {
        return json(
          {
            error:
              "Target user is not an administrator."
          },
          400
        );
      }

      const {
        error: deleteError
      } =
        await adminClient.auth
          .admin
          .deleteUser(
            userId
          );

      if (deleteError) {
        throw deleteError;
      }

      await adminClient
        .from("profiles")
        .delete()
        .eq(
          "id",
          userId
        );

      return json({
        success: true
      });
    }

    return json(
      {
        error:
          "Unknown action."
      },
      400
    );

  } catch (error) {

    console.error(
      "admin-management:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error."
      },
      500
    );
  }
});