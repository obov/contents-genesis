import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { hashFile, within } from "../core/files.ts";

export type FilePin = {
  path: string;
  sha256: string;
  size: number;
};

export type FileStamp = {
  path: string;
  size: number;
  mtime_ms: number;
};

const portable = (path: string) => path.split(sep).join("/");

export function pinFile(root: string, path: string): FilePin {
  const file = within(root, path);
  if (!existsSync(file) || !lstatSync(file).isFile())
    throw new Error("Pinned input is not a file: " + path);
  return { path: portable(path), ...hashFile(file) };
}

export function pinFiles(root: string, paths: string[]) {
  return paths.map((path) => pinFile(root, path));
}

export function assertPinnedFiles(root: string, pins: FilePin[]) {
  for (const pin of pins) {
    const current = pinFile(root, pin.path);
    if (current.sha256 !== pin.sha256 || current.size !== pin.size)
      throw new Error("Adopted input changed: " + pin.path);
  }
}

export function snapshotTree(
  root: string,
  ignore: (relativePath: string) => boolean = () => false,
): FileStamp[] {
  if (!existsSync(root)) return [];
  const out: FileStamp[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name),
        rel = portable(relative(root, full));
      if (!rel || ignore(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = statSync(full);
        out.push({ path: rel, size: stat.size, mtime_ms: stat.mtimeMs });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function changedFiles(before: FileStamp[], after: FileStamp[]) {
  const old = new Map(before.map((item) => [item.path, item]));
  return after
    .filter((item) => {
      const previous = old.get(item.path);
      return (
        !previous ||
        previous.size !== item.size ||
        previous.mtime_ms !== item.mtime_ms
      );
    })
    .map((item) => item.path);
}
