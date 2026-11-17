import { resetTestDatabase } from "@pti/db/testing";

export default async function setup(): Promise<void> {
  await resetTestDatabase();
}
