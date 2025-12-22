/**
 * @file index.ts
 * @description Barrel export for shared UI components
 * @feature shared
 */

// Spinner
export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerSize, SpinnerColor } from './Spinner';

// Badge
export { Badge } from './Badge';
export type { BadgeProps, BadgeVariant, BadgeSize } from './Badge';

// Button
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

// Card
export { Card } from './Card';
export type { CardProps, CardVariant, CardHeaderProps, CardBodyProps, CardFooterProps } from './Card';

// Input
export { Input } from './Input';
export type { InputProps, InputSize } from './Input';

// Modal
export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';

// MenuButton
export { MenuButton } from './MenuButton';
export type { MenuButtonProps } from './MenuButton';

// PageLoader
export { PageLoader } from './PageLoader';
export type { PageLoaderProps } from './PageLoader';

// Tabs
export { Tabs } from './Tabs';
export type { TabsProps, Tab } from './Tabs';
