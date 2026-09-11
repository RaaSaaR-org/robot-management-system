/**
 * @file index.ts
 * @description Barrel export for the shared UI kit. Pages build their generic
 *              parts from these and nothing else (design contract §5).
 * @feature shared
 */

// Layout
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';
export { Panel, panelClasses } from './Panel';
export type { PanelProps, PanelVariant, PanelPadding, PanelHeaderProps, PanelBodyProps, PanelFooterProps } from './Panel';
export { Card } from './Card';
export type { CardProps, CardVariant, CardHeaderProps, CardBodyProps, CardFooterProps } from './Card';
export { StatTile, StatRow } from './StatTile';
export type { StatTileProps, StatTileTrend, StatRowProps } from './StatTile';
export { Toolbar } from './Toolbar';
export type { ToolbarProps } from './Toolbar';
export { KeyValueList } from './KeyValueList';
export type { KeyValueListProps, KeyValueItem } from './KeyValueList';
export { Tabs } from './Tabs';
export type { TabsProps, Tab } from './Tabs';
export { Eyebrow, Divider } from './Eyebrow';
export type { EyebrowProps, DividerProps } from './Eyebrow';

// Actions
export { Button, buttonClasses } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize, ButtonClassOptions } from './Button';
export { LinkButton } from './LinkButton';
export type { LinkButtonProps } from './LinkButton';
export { DropdownMenu, RowActions } from './DropdownMenu';
export type { DropdownMenuProps, DropdownMenuItem, RowActionsProps, RowActionItem } from './DropdownMenu';
export { SegmentedControl, ToggleChip } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedOption, ToggleChipProps } from './SegmentedControl';
export { MenuButton } from './MenuButton';
export type { MenuButtonProps } from './MenuButton';

// Forms
export { FormField } from './FormField';
export type { FormFieldProps } from './FormField';
export { Input } from './Input';
export type { InputProps, InputSize } from './Input';
export { SearchInput } from './SearchInput';
export type { SearchInputProps } from './SearchInput';
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { FormModal } from './FormModal';
export type { FormModalProps } from './FormModal';

// Feedback
export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';
export { ConfirmDialog, ConfirmHost } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';
export { confirm } from './confirm';
export type { ConfirmOptions } from './confirm';
export { toast, useToast, dismissToast, getToasts, TOAST_DURATION, TOAST_ERROR_DURATION } from './toast';
export type { ToastApi, ToastOptions, ToastItem, ToastTone } from './toast';
export { Toaster } from './Toaster';
export { FeedbackProvider, ToastProvider } from './FeedbackProvider';
export type { FeedbackProviderProps } from './FeedbackProvider';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';
export { Skeleton, SkeletonText, SkeletonRows } from './Skeleton';
export type { SkeletonProps, SkeletonTextProps, SkeletonRowsProps } from './Skeleton';
export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerSize, SpinnerColor } from './Spinner';
export { PageLoader } from './PageLoader';
export type { PageLoaderProps } from './PageLoader';
export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps, ProgressBarVariant } from './ProgressBar';
export { Tooltip, InfoIcon } from './Tooltip';
export type { TooltipProps, TooltipSide, InfoIconProps } from './Tooltip';
export { NextStepBanner } from './NextStepBanner';
export type { NextStepBannerProps } from './NextStepBanner';
export { PipelineBreadcrumb } from './PipelineBreadcrumb';
export type { PipelineBreadcrumbProps, PipelineStage } from './PipelineBreadcrumb';

// Status
export { StatusTag } from './StatusTag';
export type { StatusTagProps, StatusTagTone, StatusTagSize } from './StatusTag';
export { statusTone, humanizeStatus, normalizeStatus } from './statusTone';
export type { StatusToneName } from './statusTone';
export { Badge } from './Badge';
export type { BadgeProps, BadgeVariant, BadgeSize } from './Badge';
export type { Tone, BaseTone } from './styles';
export { chartColors, chartTheme, chartSeriesColor } from './chartColors';

// Data
export { DataTable } from './DataTable';
export type {
  DataTableProps,
  DataTableColumn,
  DataTableSort,
  DataTablePagination,
  DataTableRowProps,
  SortDirection,
  SortValue,
} from './DataTable';
export { Pager } from './Pager';
export type { PagerProps } from './Pager';
