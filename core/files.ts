import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
export const newId = () => randomUUID();
export const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8"));
/** Lexical containment only: rejects absolute paths and ".." escapes. */
export function lexicallyWithin(root: string, key: string): string {
  const file = resolve(root, key),
    rel = relative(root, file);
  if (isAbsolute(key) || !rel || rel === ".." || rel.startsWith(".." + sep))
    throw new Error(`Unsafe relative path: ${key}`);
  return file;
}
export function within(root: string, key: string): string {
  const file = resolve(root, key),
    rel = relative(root, file);
  if (isAbsolute(key) || !rel || rel === ".." || rel.startsWith(".." + sep))
    throw new Error(`Unsafe relative path: ${key}`);
  // Existing symlink components must not escape the declared root.
  let current = file;
  while (!existsSync(current) && current !== dirname(current))
    current = dirname(current);
  if (existsSync(root)) {
    const realRel = relative(realpathSync(root), realpathSync(current));
    if (
      realRel === ".." ||
      realRel.startsWith(".." + sep) ||
      isAbsolute(realRel)
    )
      throw new Error(`Symlink escapes store: ${key}`);
  }
  return file;
}
export function durableWrite(file: string, data: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "wx");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function syncDirectory(dir: string) {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function atomicJson(file: string, value: unknown) {
  const temp = `${file}.${newId()}.tmp`;
  try {
    durableWrite(temp, json(value));
    renameSync(temp, file);
    syncDirectory(dirname(file));
  } finally {
    rmSync(temp, { force: true });
  }
}

export function hashFile(file: string): { sha256: string; size: number } {
  const fd = openSync(file, "r"),
    digest = createHash("sha256"),
    buffer = Buffer.allocUnsafe(1024 * 1024);
  let size = 0;
  try {
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, count));
      size += count;
    }
  } finally {
    closeSync(fd);
  }
  return { sha256: digest.digest("hex"), size };
}
