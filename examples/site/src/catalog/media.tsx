/** Media. */
import { state } from "@raptor/dom";
import { Input } from "@raptor/ui/input";
import { AudioPlayer, ImageZoom, VideoPlayer, Waveform } from "@raptor/ui/media";
import { QRCode } from "@raptor/ui/qrcode";
import { SAMPLE_IMAGES } from "./sample.ts";
import type { CatalogGroup } from "./types.ts";

/** A plausible waveform, computed rather than fetched. */
const PEAKS = Array.from({ length: 96 }, (_, i) => {
  const envelope = Math.sin((i / 96) * Math.PI);
  const detail = 0.55 + 0.45 * Math.sin(i / 2.1) * Math.cos(i / 5.7);
  return Math.max(0.05, Math.min(1, envelope * detail));
});

const VIDEO = "https://mdn.github.io/shared-assets/videos/flower.mp4";
const AUDIO = "https://mdn.github.io/shared-assets/audio/t-rex-roar.mp3";

export const MEDIA: CatalogGroup = {
  slug: "media",
  title: "Media",
  blurb: "Players and viewers. Each one draws its own controls, so they look the same in every browser and are reachable by keyboard.",
  items: [
    {
      slug: "video-player",
      name: "VideoPlayer",
      tier: "T3",
      summary:
        "A video with its own controls: play, a seek bar bound to the media element's time, volume, subtitle tracks and full screen.",
      code: `VideoPlayer({
  src: "/media/intro.mp4",
  poster: "/media/intro.jpg",
  tracks: [{ src: "/media/intro.en.vtt", label: "English", lang: "en", default: true }],
});`,
      demo: () => VideoPlayer({ src: VIDEO, label: "Sample video" }),
      notes: ["The sample file is fetched from MDN's public assets, so this demo needs a network connection."],
    },
    {
      slug: "audio-player",
      name: "AudioPlayer",
      tier: "T3",
      summary: "The same controls without the picture — progress, time, volume.",
      code: `AudioPlayer({ src: "/media/episode-12.mp3" });`,
      demo: () => AudioPlayer({ src: AUDIO, label: "Sample audio" }),
      notes: ["Also an external sample file."],
    },
    {
      slug: "image-zoom",
      name: "ImageZoom",
      tier: "T3",
      summary: "A magnifier that follows the pointer — product photos, maps, screenshots of dense UI.",
      code: `ImageZoom({ src: photo, alt: "Product front", zoom: 2.5 });`,
      demo: () => (
        <div style="max-width:360px">
          {ImageZoom({ src: SAMPLE_IMAGES[0]!.src, alt: SAMPLE_IMAGES[0]!.alt, zoom: 3 })}
        </div>
      ),
    },
    {
      slug: "waveform",
      name: "Waveform",
      tier: "T3",
      summary:
        "Amplitude bars with a progress position and click-to-seek. It deliberately does not decode audio — that needs an `AudioContext` and the whole file in memory, which has no business inside a UI component. You compute the peaks on the server or in a worker and pass them in.",
      code: `Waveform({ peaks, progress: () => played(), onSeek: (f) => audio.seek(f) });`,
      props: [
        { name: "peaks", type: "Accessor<readonly number[]> | readonly number[]", desc: "Normalised 0..1 amplitudes, one per bar." },
        { name: "progress", type: "Accessor<number>", desc: "Playback position, 0..1." },
        { name: "onSeek", type: "(fraction: number) => void", desc: "Click or keyboard seek." },
        { name: "barWidth / gap / height", type: "number", desc: "The shape of the bars." },
      ],
      demo: () => {
        const progress = state(0.35);
        return (
          <div>
            {Waveform({
              peaks: PEAKS,
              progress: () => progress(),
              onSeek: (f: number) => progress.set(f),
              width: 460,
              height: 72,
              label: "Sample waveform",
            })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                position = <b>{() => Math.round(progress() * 100) + "%"}</b>
              </span>
              <span class="chip">click the waveform to seek</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "qrcode",
      name: "QRCode",
      tier: "T3",
      summary:
        "A real QR encoder — Reed–Solomon error correction, version selection, mask scoring — in about 500 lines and no dependency. Type below and the matrix is recomputed as you go.",
      code: `QRCode({ value: () => url(), level: "M", size: 180, label: "Link to this page" });`,
      props: [
        { name: "value", type: "Accessor<string> | string", desc: "The encoded text." },
        { name: "level", type: `"L" | "M" | "Q" | "H"`, desc: "Error correction; H survives about 30% damage." },
        { name: "size / quietZone", type: "number", desc: "Pixel width, and the margin the standard asks for (4 modules)." },
        { name: "fallback", type: "Child", desc: "Shown when the text does not fit any version." },
      ],
      demo: () => {
        const value = state("https://raptorjs.dev");
        return (
          <div class="cmp-row" style="align-items:flex-start">
            {QRCode({ value: () => value(), size: 168, level: "M", label: "QR code for the typed text" })}
            <div style="flex:1;min-width:200px">
              {Input({ value, label: "Encoded text", placeholder: "Type anything…" })}
              <div class="cmp-row" style="margin-top:10px">
                <span class="chip">
                  <b>{() => String(value().length)}</b> characters
                </span>
              </div>
            </div>
          </div>
        );
      },
    },
  ],
};
