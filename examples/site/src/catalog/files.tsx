/** Files and upload. */
import { state } from "@raptorstack/raptorjs/dom";
import { Dropzone, FileInput, type FileLike, FileList, type FileRejection, formatSize } from "@raptorstack/raptorjs/ui/files";
import { FilePreview, ImageUpload, UploadProgress } from "@raptorstack/raptorjs/ui/media";
import type { CatalogGroup } from "./types.ts";

const SAMPLE: FileLike[] = [
  { name: "report.pdf", size: 482_000, type: "application/pdf" },
  { name: "diagram.png", size: 91_500, type: "image/png" },
  { name: "notes.md", size: 3_200, type: "text/markdown" },
];

export const FILES: CatalogGroup = {
  slug: "files",
  title: "Files & upload",
  blurb:
    "Validation is a pure function over `{ name, size, type }`, so it is testable without a browser and the components stay thin.",
  items: [
    {
      slug: "file-input",
      name: "FileInput",
      tier: "T2",
      summary:
        "A styled file button that validates type, size and count before anything reaches your signal — rejected files come back with a reason.",
      code: `const files = state<readonly FileLike[]>([]);
FileInput({
  files,
  multiple: true,
  accept: ".png,.pdf",
  maxSize: 2 * 1024 * 1024,
  onReject: (r) => toast.error(r[0].message),
});`,
      props: [
        { name: "files", type: "State<readonly FileLike[]>", desc: "The accepted files." },
        { name: "accept", type: "string", desc: "Extensions (.png) or MIME patterns (image/*)." },
        { name: "maxSize / maxFiles", type: "number", desc: "Bounds; anything over them is rejected, not silently dropped." },
        { name: "onReject", type: "(rejections) => void", desc: "Each rejection carries file, reason and message." },
      ],
      demo: () => {
        const files = state<readonly FileLike[]>([]);
        const rejected = state("—");
        return (
          <div>
            <div class="cmp-row">
              {FileInput({
                files,
                multiple: true,
                maxSize: 1024 * 1024,
                label: "Attach files (max 1 MB each)",
                onReject: (r: readonly FileRejection[]) => rejected.set(r.map((x) => x.message).join("; ")),
              })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                accepted: <b>{() => String(files().length)}</b>
              </span>
              <span class="chip">
                rejected: <b>{rejected}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "dropzone",
      name: "Dropzone",
      tier: "T2",
      summary: "A drop target with the same validation, plus a visible state while a drag is over it. It is also a button, so the keyboard works.",
      code: `Dropzone({ files, accept: "image/*", hint: "PNG or JPG, up to 5 MB" });`,
      demo: () => {
        const files = state<readonly FileLike[]>([]);
        return (
          <div>
            {Dropzone({ files, multiple: true, hint: "Drop files here, or click to browse", label: "Upload" })}
            <div class="cmp-row" style="margin-top:12px">
              <span class="chip">{() => files().map((f) => f.name).join(", ") || "nothing dropped yet"}</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "file-list",
      name: "FileList",
      tier: "T2",
      summary: "The list that follows a picker: name, human-readable size, a remove button, and an optional per-file progress bar.",
      code: `FileList({ files, progress: () => ({ "report.pdf": 62 }) });`,
      demo: () => {
        const files = state<readonly FileLike[]>(SAMPLE);
        return FileList({
          files,
          progress: () => ({ "report.pdf": 62 }),
          label: "Attachments",
          empty: "No files",
        });
      },
      notes: [`\`formatSize(482000)\` → \`${formatSize(482_000)}\` — the same helper the list uses, exported for your own UI.`],
    },
    {
      slug: "image-upload",
      name: "ImageUpload",
      tier: "T3",
      summary: "A single image with a preview and a clear button — avatars and logos. You decide what happens to the file it hands you.",
      code: `ImageUpload({ value: avatarUrl, shape: "circle", onSelect: (file) => upload(file) });`,
      demo: () => {
        const url = state<string | null>(null);
        const picked = state("—");
        return (
          <div class="cmp-row">
            {ImageUpload({
              value: url,
              shape: "circle",
              size: "88px",
              label: "Avatar",
              onSelect: (f: FileLike) => picked.set(f.name),
            })}
            <span class="chip">
              last file: <b>{picked}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "upload-progress",
      name: "UploadProgress",
      tier: "T3",
      summary: "One row per upload with its own state — pending, uploading, done, error — and cancel/retry hooks.",
      code: `UploadProgress({ tasks, onCancel: cancel, onRetry: retry });`,
      demo: () =>
        UploadProgress({
          tasks: [
            { name: "report.pdf", progress: 100, status: "done", size: 482_000 },
            { name: "diagram.png", progress: 46, status: "uploading", size: 91_500 },
            { name: "video.mp4", progress: 0, status: "error", error: "Connection lost", size: 14_200_000 },
          ],
          label: "Uploads",
        }),
    },
    {
      slug: "file-preview",
      name: "FilePreview",
      tier: "T3",
      summary: "A thumbnail chosen by file type: the image itself when you give it a URL, a typed icon otherwise.",
      code: `FilePreview({ file, url: URL.createObjectURL(blob) });`,
      demo: () => (
        <div class="cmp-row">
          {SAMPLE.map((f) => FilePreview({ file: f, size: "72px" }))}
        </div>
      ),
    },
  ],
};
