import sql from "@/app/api/utils/sql";

export async function POST(request) {
  try {
    const body = await request.json();
    const { collection_id, name, amount } = body;

    if (!collection_id || !name) {
      return Response.json(
        { error: "Insamlings-ID och namn krävs" },
        { status: 400 },
      );
    }

    // Check collection is active and not expired
    const [collection] = await sql`
      SELECT id, is_active, expires_at, hard_cap_at, suggested_amount
      FROM collections
      WHERE id = ${collection_id}
    `;

    if (!collection) {
      return Response.json(
        { error: "Insamlingen hittades inte" },
        { status: 404 },
      );
    }

    if (!collection.is_active) {
      return Response.json({ error: "Insamlingen är stängd" }, { status: 403 });
    }

    if (new Date(collection.expires_at) < new Date()) {
      return Response.json(
        { error: "Insamlingen har gått ut" },
        { status: 403 },
      );
    }

    // Generate reference code: XXXX-XXXX
    const generateRef = () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const part1 = Array.from(
        { length: 4 },
        () => chars[Math.floor(Math.random() * chars.length)],
      ).join("");
      const part2 = Array.from(
        { length: 4 },
        () => chars[Math.floor(Math.random() * chars.length)],
      ).join("");
      return `${part1}-${part2}`;
    };

    const reference_code = generateRef();

    const [contribution] = await sql`
      INSERT INTO contributions (
        collection_id,
        name,
        amount,
        reference_code,
        status
      ) VALUES (
        ${collection_id},
        ${name},
        ${amount || collection.suggested_amount || null},
        ${reference_code},
        'unverified'
      ) RETURNING *
    `;

    // Auto-extend: if less than 7 days remain, push by 7 days (capped at hard_cap_at)
    const now = new Date();
    const expiresAt = new Date(collection.expires_at);
    const hardCapAt = new Date(collection.hard_cap_at);
    const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);

    if (daysUntilExpiry < 7) {
      const newExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const finalExpiry = newExpiry > hardCapAt ? hardCapAt : newExpiry;

      await sql`
        UPDATE collections
        SET
          expires_at = ${finalExpiry.toISOString()},
          last_contribution_at = NOW()
        WHERE id = ${collection_id}
      `;
    } else {
      await sql`
        UPDATE collections
        SET last_contribution_at = NOW()
        WHERE id = ${collection_id}
      `;
    }

    return Response.json(contribution);
  } catch (error) {
    console.error("Error creating contribution:", error);
    return Response.json(
      { error: "Kunde inte registrera betalningen" },
      { status: 500 },
    );
  }
}
