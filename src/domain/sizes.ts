// Canvas size presets offered on the "start a design" screen.

export interface SizePreset {
  id: string;
  label: string;
  hint: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'social', label: 'Social post', hint: 'Square feed post', width: 1080, height: 1080 },
  { id: 'story', label: 'Story', hint: 'Full-screen vertical', width: 1080, height: 1920 },
  { id: 'poster', label: 'Poster', hint: 'A4 at 150 DPI', width: 1654, height: 2339 },
  { id: 'present', label: 'Presentation', hint: 'Widescreen 16:9', width: 1920, height: 1080 },
];

export const CUSTOM_MIN = 64;
export const CUSTOM_MAX = 8000;
