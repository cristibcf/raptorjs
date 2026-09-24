/**
 * Sample images for the media demos, generated as inline SVG data URIs.
 *
 * No network, no placeholder service: the demos have to work offline, and an
 * image that fails to load would look like a bug in the component.
 */

function svg(label: string, from: string, to: string, w = 900, h = 600): string {
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="IBM Plex Mono, monospace" font-size="${Math.round(w / 14)}" fill="#ffffff" opacity="0.9">${label}</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(doc);
}

export interface SampleImage {
  src: string;
  alt: string;
  caption?: string;
  thumbnail?: string;
}

const PALETTE: Array<[string, string, string]> = [
  ["Canyon", "#17457a", "#0e7490"],
  ["Forest", "#0f6e4f", "#17457a"],
  ["Dusk", "#8250a8", "#b42318"],
  ["Amber", "#b45309", "#8250a8"],
];

export const SAMPLE_IMAGES: SampleImage[] = PALETTE.map(([label, from, to]) => ({
  src: svg(label, from, to),
  alt: "A generated gradient labelled " + label,
  caption: label,
  thumbnail: svg(label, from, to, 300, 200),
}));

/** A deliberately broken URL, to show a component's fallback path. */
export const BROKEN_IMAGE = "https://example.invalid/not-here.png";
