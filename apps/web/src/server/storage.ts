import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { schema, type DbOrTx } from "@pti/db";
import { env } from "./env";

/**
 * Blob storage behind a two-method interface. Local filesystem in dev,
 * S3-compatible (AWS, R2, MinIO) in production. Keys are org-prefixed and
 * opaque; metadata lives in the `files` table.
 */
interface BlobStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function fsStore(root: string): BlobStore {
  const base = resolve(root);
  const path = (key: string) => {
    const p = resolve(join(base, key));
    if (!p.startsWith(base + "/")) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    get: (key) => readFile(path(key)),
    delete: (key) => rm(path(key), { force: true }),
  };
}

async function s3Store(): Promise<BlobStore> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
    await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  const Bucket = env.S3_BUCKET ?? "";
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: env.S3_ENDPOINT ? undefined : "AES256",
        }),
      );
    },
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!r.Body) throw new Error("Empty object");
      return Buffer.from(await r.Body.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

let store: Promise<BlobStore> | undefined;
const blobs = () =>
  (store ??=
    env.STORAGE_DRIVER === "s3" ? s3Store() : Promise.resolve(fsStore(env.STORAGE_FS_ROOT)));

export type FileKind = (typeof schema.files.$inferInsert)["kind"];

export interface StoredFile {
  id: string;
  storageKey: string;
  sha256: string;
  size: number;
}

/** Upload bytes and record metadata in the same transaction context. */
export async function storeFile(
  tx: DbOrTx,
  args: {
    orgId: string;
    kind: FileKind;
    body: Buffer;
    contentType: string;
    fileName: string;
    retainUntil?: Date | null;
  },
): Promise<StoredFile> {
  const sha256 = createHash("sha256").update(args.body).digest("hex");
  const id = crypto.randomUUID();
  const ext = args.fileName.includes(".")
    ? args.fileName.slice(args.fileName.lastIndexOf(".")).toLowerCase()
    : "";
  const storageKey = `${args.orgId}/${args.kind}/${id}${ext}`;
  await (await blobs()).put(storageKey, args.body, args.contentType);
  await tx.insert(schema.files).values({
    id,
    orgId: args.orgId,
    kind: args.kind,
    storageKey,
    contentType: args.contentType,
    size: args.body.length,
    sha256,
    fileName: args.fileName,
    retainUntil: args.retainUntil ?? null,
  });
  return { id, storageKey, sha256, size: args.body.length };
}

export async function readBlob(storageKey: string): Promise<Buffer> {
  return (await blobs()).get(storageKey);
}

export async function deleteBlob(storageKey: string): Promise<void> {
  await (await blobs()).delete(storageKey);
}
