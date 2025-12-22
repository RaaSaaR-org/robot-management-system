/**
 * @file common.types.ts
 * @description Common utility types used throughout the application
 * @feature shared
 * @dependencies None
 */

/** Makes all properties of T optional recursively */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Extracts the resolved type from a Promise */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/** Makes specified keys K of T required */
export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Makes specified keys K of T optional */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Nullable type helper */
export type Nullable<T> = T | null;

/** Standard ID type used for entities */
export type EntityId = string;

/** Timestamp in ISO 8601 format */
export type ISOTimestamp = string;

/** Status for async operations */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

/** Generic callback function type */
export type Callback<T = void> = () => T;

/** Event handler type */
export type EventHandler<E = Event> = (event: E) => void;

/** Extract props type from a React component */
export type PropsOf<T> = T extends React.ComponentType<infer P> ? P : never;

/** Make a type with only some keys from T */
export type PickRequired<T, K extends keyof T> = Required<Pick<T, K>>;

/** Omit keys that are undefined */
export type NonUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};
