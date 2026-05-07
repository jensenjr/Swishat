import sql from "@/app/api/utils/sql";
import argon2 from "argon2";

export async function POST(request) {
  try {
    const body = await request.json();
    const { swish_number, pin } = body;

    if (!swish_number || !pin) {
      return Response.json(
        { error: "Swish-nummer och PIN-kod krävs" },
        { status: 400 },
      );
    }

    // Find active collections with this swish number that have a pin
    const collections = await sql`
      SELECT id, title, admin_token, pin_hash, expires_at, is_active
      FROM collections
      WHERE swish_number = ${swish_number}
        AND pin_hash IS NOT NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;

    if (!collections.length) {
      return Response.json(
        {
          error: "Ingen insamling hittades med detta Swish-nummer och PIN-kod",
        },
        { status: 404 },
      );
    }

    // Try to match PIN against each collection
    for (const collection of collections) {
      const match = await argon2.verify(collection.pin_hash, pin.toString());
      if (match) {
        return Response.json({
          id: collection.id,
          title: collection.title,
          admin_token: collection.admin_token,
        });
      }
    }

    // No match found
    return Response.json(
      { error: "Felaktigt Swish-nummer eller PIN-kod" },
      { status: 401 },
    );
  } catch (error) {
    console.error("Error recovering collection:", error);
    return Response.json(
      { error: "Återställning misslyckades" },
      { status: 500 },
    );
  }
}
