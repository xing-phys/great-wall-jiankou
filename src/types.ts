export type LonLat = [number, number];
export type Vec2 = [number, number];

export interface TerrainMeta {
  bbox: [number, number, number, number];
  zoom: number;
  size: [number, number];
  origin: [number, number];
  minElevation: number;
  maxElevation: number;
  metersPerPixel: [number, number];
  encoding: string;
  source: string;
}

export interface RouteData {
  length: number;
  points: LonLat[];
}

export interface TowerData {
  id: string;
  num: number | null;
  name: string;
  en: string;
  route: string;
  s: number;
  ruin: string;
  size: [number, number, number];
  lat: number;
  lon: number;
}

export interface LandmarkData {
  id: string;
  name: string;
  en: string;
  route: string;
  s: number;
  lat: number;
  lon: number;
  elevation: number | null;
  chapter: number;
  kind: string;
  desc: string;
}

export interface WallData {
  origin: [number, number];
  routes: Record<string, RouteData>;
  towers: TowerData[];
  landmarks: LandmarkData[];
  attribution: string[];
  note: string;
}

export interface RouteSample {
  s: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  yaw: number;
}

export interface Landmark {
  data: LandmarkData;
  route: string;
  s: number;
  mainS: number;
  position: { x: number; y: number; z: number };
  labelHeight: number;
}

export type Mode = 'overview' | 'walk';
