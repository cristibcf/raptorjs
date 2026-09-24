/**
 * `raptor:files` (spec sectiunea 6): fisiere cu domeniu, scrieri atomice si
 * parcurgere de directoare. Fiecare operatie cere explicit `files.read` sau
 * `files.write` - nu exista acces ambiental la disc.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HostContext } from "../context.ts";
import { normalizePath, relativeToRoot, resolvePath } from "../paths.ts";

export interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
}

export interface FileInfo {
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  readonly modifiedMs: number;
}

export interface RaptorFiles {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Scriere atomica: fisier temporar + rename in aceeasi partitie. */
  write(path: string, data: string | Uint8Array): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<readonly FileEntry[]>;
  stat(path: string): Promise<FileInfo>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  makeDir(path: string): Promise<void>;
}

export function createFiles(host: HostContext): RaptorFiles {
  const resolveIn = (path: string): string => resolvePath(host.projectRoot, path);

  const read = async (path: string): Promise<Uint8Array> => {
    const absolute = resolveIn(path);
    host.broker.require("files.read", absolute);
    const buffer = await readFile(absolute);
    host.observer.metric("files.read.bytes", buffer.byteLength, { path: relativeToRoot(host.projectRoot, absolute) });
    return new Uint8Array(buffer);
  };

  const writeAtomic = async (path: string, data: string | Uint8Array): Promise<void> => {
    const absolute = resolveIn(path);
    host.broker.require("files.write", absolute);
    await mkdir(dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.partial`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, absolute);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    const size = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    host.observer.metric("files.write.bytes", size, { path: relativeToRoot(host.projectRoot, absolute) });
  };

  return {
    async readText(path: string): Promise<string> {
      return Buffer.from(await read(path)).toString("utf8");
    },

    readBytes: read,
    write: writeAtomic,

    async append(path: string, data: string): Promise<void> {
      const existing = (await this.exists(path)) ? await this.readText(path) : "";
      await writeAtomic(path, existing + data);
    },

    async list(path: string): Promise<readonly FileEntry[]> {
      const absolute = resolveIn(path);
      host.broker.require("files.read", absolute);
      const entries = await readdir(absolute, { withFileTypes: true });
      return entries
        .map((entry) => ({
          name: entry.name,
          path: normalizePath(join(absolute, entry.name)),
          kind: entry.isFile() ? ("file" as const) : entry.isDirectory() ? ("directory" as const) : ("other" as const),
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },

    async stat(path: string): Promise<FileInfo> {
      const absolute = resolveIn(path);
      host.broker.require("files.read", absolute);
      const info = await stat(absolute);
      return {
        path: absolute,
        kind: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other",
        size: info.size,
        modifiedMs: info.mtimeMs,
      };
    },

    async exists(path: string): Promise<boolean> {
      const absolute = resolveIn(path);
      host.broker.require("files.read", absolute);
      try {
        await stat(absolute);
        return true;
      } catch {
        return false;
      }
    },

    async remove(path: string): Promise<void> {
      const absolute = resolveIn(path);
      host.broker.require("files.write", absolute);
      await rm(absolute, { recursive: true, force: true });
    },

    async makeDir(path: string): Promise<void> {
      const absolute = resolveIn(path);
      host.broker.require("files.write", absolute);
      await mkdir(absolute, { recursive: true });
    },
  };
}
