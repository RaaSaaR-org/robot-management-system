/**
 * @file index.ts
 * @description Barrel export for layout components
 * @feature layout
 */

export { AppLayout } from './AppLayout';
export { Sidebar } from './Sidebar';
export type { SidebarProps } from './Sidebar';
export { TopBar } from './TopBar';
export type { TopBarProps } from './TopBar';
export { MobileNav } from './MobileNav';
export type { MobileNavProps } from './MobileNav';
export { NavList } from './NavList';
export type { NavListProps, NavListVariant } from './NavList';
export { SectionRail } from './SectionRail';
export type { SectionRailProps } from './SectionRail';
export {
  NAV_GROUPS,
  NAV_ITEMS,
  isNavItemActive,
  filterNavGroups,
  navDestinations,
  useVisibleNavGroups,
  useVisibleNavItems,
} from './navigation';
export type {
  NavDestination,
  NavDestinationKind,
  NavGroup,
  NavItem,
  NavRailItem,
  NavTab,
} from './navigation';
