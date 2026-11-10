import type { Weather } from '../world/Environment';

const KEY = 'velabay.save.v1';

export interface SaveData {
  money: number;
  x: number;
  z: number;
  heading: number;
  time: number;
  weather: Weather;
  playTime: number;
  completed: string[];
  collected: string[];
  stats: Record<string, number>;
  savedAt: number;
  ammo?: number;
  ammoAk?: number;
  ammoRocket?: number;
}

export const Save = {
  has(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  },
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return typeof d.money === 'number' && typeof d.x === 'number' ? d : null;
    } catch {
      return null;
    }
  },
  write(d: SaveData): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  },
};
