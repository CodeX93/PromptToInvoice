import { eq, schema, withOrg } from "@pti/db";
import { db } from "@/server/db";
import { orgContextOrThrow } from "@/server/session";
import { readBlob } from "@/server/storage";
import { isAppError } from "@/server/errors";

/**
 * Authenticated file download. RLS guarantees the file belongs to the
 * caller's organisation; a foreign id simply doesn't exist for them.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const org = await orgContextOrThrow();
    const [file] = await withOrg(db, org.org.id, (tx) => tx.select().from(schema.files).where(eq(schema.files.id, id)).limit(1));
    if (!file) return new Response("Not found", { status: 404 });
    const body = await readBlob(file.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(body.length),
        "Cache-Control": "private, max-age=3600, immutable",
        ETag: `"${file.sha256}"`,
        "Content-Disposition": `${file.contentType.startsWith("image/") ? "inline" : "attachment"}; filename="${file.fileName.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response(err.message, { status: err.status });
    throw err;
  }
}
