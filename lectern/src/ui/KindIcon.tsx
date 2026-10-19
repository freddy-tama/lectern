import {
  BookOpen, Bookmark, ChartColumn, ChartLine, ChartNoAxesColumn, ChartPie, CircleHelp, ClipboardList, Code, Columns2, DoorOpen,
  FileText, Filter, GalleryHorizontal, Grid2x2, Image, Images, Languages, LayoutGrid, List, ListChecks, ListOrdered, type LucideIcon,
  Megaphone, MessageSquareText, Milestone, Presentation, Puzzle, Quote, RefreshCw, Square, Table, Type, Users, Waypoints,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  presentation: Presentation,
  bookmark: Bookmark,
  'list-ordered': ListOrdered,
  list: List,
  'columns-2': Columns2,
  image: Image,
  quote: Quote,
  'book-open': BookOpen,
  'chart-no-axes-column': ChartNoAxesColumn,
  milestone: Milestone,
  'circle-help': CircleHelp,
  'layout-grid': LayoutGrid,
  'list-checks': ListChecks,
  'door-open': DoorOpen,
  puzzle: Puzzle,
  // Extra names mods can use.
  'grid-2x2': Grid2x2,
  languages: Languages,
  'message-square-text': MessageSquareText,
  'clipboard-list': ClipboardList,
  'file-text': FileText,
  type: Type,
  'chart-column': ChartColumn,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  table: Table,
  megaphone: Megaphone,
  images: Images,
  'gallery-horizontal': GalleryHorizontal,
  users: Users,
  'refresh-cw': RefreshCw,
  filter: Filter,
  waypoints: Waypoints,
  code: Code,
};

/** Icons are referenced by name so the core and mods stay free of React. */
export function KindIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Square;
  return <Icon size={size} aria-hidden />;
}
