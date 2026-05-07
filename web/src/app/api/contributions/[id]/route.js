import sql from "@/app/api/utils/sql";

async function verifyAdminAndGetCollectionId(contributionId, token) {
  const [row] = await sql`
    SELECT c.admin_token, c.id AS collection_id
    FROM collections c
    JOIN contributions con ON con.collection_id = c.id
    WHERE con.id = ${contributionId}
  `;
  if (!token || row?.admin_token !== token) return null;
  return row.collection_id;
}

async function touchAdminActivity(collectionId) {
  await sql`
    UPDATE collections
    SET last_admin_activity_at = NOW()
    WHERE id = ${collectionId}
  `;
}

export async function PATCH(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  try {
    const collectionId = await verifyAdminAndGetCollectionId(id, token);
    if (!collectionId) {
      return Response.json({ error: "Obehörig" }, { status: 401 });
    }

    const body = await request.json();
    const { status, amount } = body;

    const setFields = [];
    const values = [];
    let counter = 1;

    if (status !== undefined) {
      setFields.push(`status = $${counter++}`);
      values.push(status);
    }
    if (amount !== undefined) {
      setFields.push(`amount = $${counter++}`);
      values.push(amount);
    }

    if (setFields.length === 0) {
      return Response.json(
        { error: "Inga fält att uppdatera" },
        { status: 400 },
      );
    }

    values.push(id);
    const query = `UPDATE contributions SET ${setFields.join(", ")} WHERE id = $${counter} RETURNING *`;
    const [updated] = await sql(query, values);

    await touchAdminActivity(collectionId);

    return Response.json(updated);
  } catch (error) {
    console.error("Error updating contribution:", error);
    return Response.json(
      { error: "Kunde inte uppdatera bidraget" },
      { status: 500 },
    );
  }
}

export async function DELETE(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  try {
    const collectionId = await verifyAdminAndGetCollectionId(id, token);
    if (!collectionId) {
      return Response.json({ error: "Obehörig" }, { status: 401 });
    }

    await sql`DELETE FROM contributions WHERE id = ${id}`;
    await touchAdminActivity(collectionId);

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error deleting contribution:", error);
    return Response.json(
      { error: "Kunde inte ta bort bidraget" },
      { status: 500 },
    );
  }
}
