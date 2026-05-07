import sql from "@/app/api/utils/sql";

export async function GET(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  try {
    const [collection] = await sql`
      SELECT id, title, description, target_amount, swish_number, suggested_amount,
             is_active, created_at, require_proof, expires_at, hard_cap_at,
             last_admin_activity_at, last_contribution_at
      FROM collections
      WHERE id = ${id}
    `;

    if (!collection) {
      return Response.json(
        { error: "Insamlingen hittades inte" },
        { status: 404 },
      );
    }

    const [stats] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'verified') AS verified_count,
        COUNT(*) AS total_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'verified'), 0) AS total_collected
      FROM contributions
      WHERE collection_id = ${id}
    `;

    // Calculate expiry info
    const now = new Date();
    const expiresAt = new Date(collection.expires_at);
    const hardCapAt = new Date(collection.hard_cap_at);
    const daysUntilExpiry = Math.max(
      0,
      Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)),
    );
    const daysUntilHardCap = Math.max(
      0,
      Math.ceil((hardCapAt - now) / (1000 * 60 * 60 * 24)),
    );
    const isExpired = expiresAt < now;

    const result = {
      ...collection,
      stats: {
        verified_count: parseInt(stats.verified_count || 0),
        total_count: parseInt(stats.total_count || 0),
        total_collected: parseFloat(stats.total_collected || 0),
      },
      expiry: {
        daysUntilExpiry,
        daysUntilHardCap,
        isExpired,
        isAtHardCap: daysUntilHardCap <= 0,
        isNearHardCap: daysUntilHardCap <= 7,
      },
    };

    // Check admin access
    const [adminRow] = await sql`
      SELECT admin_token FROM collections WHERE id = ${id}
    `;

    if (token && adminRow?.admin_token === token) {
      const contributions = await sql`
        SELECT * FROM contributions
        WHERE collection_id = ${id}
        ORDER BY created_at DESC
      `;
      result.contributions = contributions;
      result.isAdmin = true;
    }

    return Response.json(result);
  } catch (error) {
    console.error("Error fetching collection:", error);
    return Response.json(
      { error: "Kunde inte hämta insamlingen" },
      { status: 500 },
    );
  }
}

export async function PATCH(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  try {
    const [adminRow] = await sql`
      SELECT admin_token, expires_at, hard_cap_at FROM collections WHERE id = ${id}
    `;

    if (!token || adminRow?.admin_token !== token) {
      return Response.json({ error: "Obehörig" }, { status: 401 });
    }

    const body = await request.json();
    const { is_active, extend } = body;

    if (extend) {
      // Extend by 14 days, capped at hard_cap_at
      const now = new Date();
      const newExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const hardCapAt = new Date(adminRow.hard_cap_at);
      const finalExpiry = newExpiry > hardCapAt ? hardCapAt : newExpiry;

      const [updated] = await sql`
        UPDATE collections
        SET
          expires_at = ${finalExpiry.toISOString()},
          last_admin_activity_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
      return Response.json(updated);
    }

    if (is_active !== undefined) {
      const [updated] = await sql`
        UPDATE collections
        SET
          is_active = ${is_active},
          last_admin_activity_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
      return Response.json(updated);
    }

    return Response.json({ error: "Inga fält att uppdatera" }, { status: 400 });
  } catch (error) {
    console.error("Error updating collection:", error);
    return Response.json(
      { error: "Kunde inte uppdatera insamlingen" },
      { status: 500 },
    );
  }
}
