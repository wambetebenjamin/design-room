// Original color palettes and page-level design presets.

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { id: 'lagoon', name: 'Lagoon', colors: ['#0B7A70', '#12B5A9', '#7FE3D8', '#063F3B', '#F2FBFA'] },
  { id: 'citrus', name: 'Citrus', colors: ['#FF6B35', '#FFB627', '#FFE169', '#3D2C2E', '#FFF8E7'] },
  { id: 'berry', name: 'Berry', colors: ['#7B2CBF', '#C77DFF', '#E0AAFF', '#240046', '#F9F4FF'] },
  { id: 'ink', name: 'Ink', colors: ['#111418', '#4A5568', '#A0AEC0', '#E2E8F0', '#FFFFFF'] },
  { id: 'dune', name: 'Dune', colors: ['#B08968', '#EDE0D4', '#9C6644', '#3F2E23', '#FDF8F4'] },
  { id: 'ocean', name: 'Ocean', colors: ['#1D3557', '#457B9D', '#A8DADC', '#F1FAEE', '#0D1B2A'] },
];

export interface DesignPreset {
  id: string;
  name: string;
  background: string | { angle: number; from: string; to: string };
  palette: string[];
  displayFont: string;
  bodyFont: string;
}

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: 'midnight-pop',
    name: 'Midnight Pop',
    background: '#101820',
    palette: ['#12B5A9', '#FFE169', '#F2FBFA', '#FF6B35', '#7FE3D8'],
    displayFont: 'Bebas Neue',
    bodyFont: 'Inter',
  },
  {
    id: 'paper-serif',
    name: 'Paper & Serif',
    background: '#FDF8F4',
    palette: ['#9C6644', '#B08968', '#3F2E23', '#EDE0D4', '#111418'],
    displayFont: 'Playfair Display',
    bodyFont: 'Inter',
  },
  {
    id: 'lagoon-fresh',
    name: 'Lagoon Fresh',
    background: '#F2FBFA',
    palette: ['#0B7A70', '#12B5A9', '#063F3B', '#7FE3D8', '#FFB627'],
    displayFont: 'Space Grotesk',
    bodyFont: 'Inter',
  },
  {
    id: 'citrus-bold',
    name: 'Citrus Bold',
    background: '#FFE169',
    palette: ['#FF6B35', '#3D2C2E', '#FFF8E7', '#B08968', '#0B7A70'],
    displayFont: 'Bebas Neue',
    bodyFont: 'Space Grotesk',
  },
];
