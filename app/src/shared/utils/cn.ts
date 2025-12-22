/**
 * @file cn.ts
 * @description Utility for merging Tailwind CSS classes with proper conflict resolution
 * @feature shared
 * @dependencies clsx, tailwind-merge
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines class names and merges Tailwind CSS classes intelligently.
 * Uses clsx for conditional class handling and tailwind-merge for conflict resolution.
 *
 * @example
 * cn('px-4 py-2', isActive && 'bg-cobalt', className)
 * cn('text-sm', 'text-lg') // => 'text-lg' (resolves conflict)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
