import sql from "@/app/api/utils/sql";
import argon2 from "argon2";

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      target_amount,
      swish_number,
      suggested_amount,
      require_proof,
      pin,
    } = body;

    if (!title || !swish_number) {
      return Response.json(
        { error: "Titel och Swish-nummer krävs" },
        { status: 400 },
      );
    }

    const admin_token = generateUUID();

    let pin_hash = null;
    if (pin && String(pin).length >= 4) {
      pin_hash = await argon2.hash(String(pin));
    }

    const [collection] = await sql`
      INSERT INTO collections (
        title,
        description,
        target_amount,
        swish_number,
        suggested_amount,
        require_proof,
        admin_token,
        pin_hash,
        expires_at,
        hard_cap_at,
        last_admin_activity_at
      ) VALUES (
        ${title},
        ${description || null},
        ${target_amount ? Number(target_amount) : null},
        ${swish_number},
        ${suggested_amount ? Number(suggested_amount) : null},
        ${require_proof || false},
        ${admin_token},
        ${pin_hash},
        NOW() + INTERVAL '14 days',
        NOW() + INTERVAL '30 days',
        NOW()
      ) RETURNING *
    `;

    return Response.json(collection);
  } catch (error) {
    console.error("Error creating collection:", error);
    return Response.json(
      { error: "Kunde inte skapa insamlingen" },
      { status: 500 },
    );
  }
}
