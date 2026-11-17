/** Read a text field from FormData. File entries and missing keys become "". */
export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
