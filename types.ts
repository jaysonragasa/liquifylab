export enum ToolType {
  WARP = 'WARP',
  BLOAT = 'BLOAT',
  PUCKER = 'PUCKER',
  TWIRL_CW = 'TWIRL_CW',
  LASSO = 'LASSO', // Selects area, deletes outside
  TRANSFORM = 'TRANSFORM' // Move, Rotate, Scale
}

export interface BrushSettings {
  size: number;
  strength: number; // 0 to 1
  density: number; // 0 to 1, affects falloff
}

export interface Point {
  x: number;
  y: number;
}

export interface GeneratedImageResponse {
  imageUrl: string;
}

export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  imageData: ImageData | null; // The static pixel data
  blendMode: BlendMode;
  opacity: number; // 0 to 1
  // Transform props
  x: number;
  y: number;
  scale: number;
  rotation: number; // radians
}
