import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard cn(...) utility — merges Tailwind class lists with proper
// last-wins handling. Used by every component on the landing page.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
