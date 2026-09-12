/**
 * @file oversightFormat.ts
 * @description Pure helpers that turn oversight data into labels. Severity
 *              colours come from the kit's statusTone().
 * @feature oversight
 */

/** "sensor_malfunction" → "Sensor malfunction" */
export function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDuration(fromIso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatInterval(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}
