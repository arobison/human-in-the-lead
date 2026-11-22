// The shared UI kit (HITLD-729, decisions HITLD-720, 721, 724 and 726): what a project's own app
// imports to build on the dashboard data contract. It ships with HITLD; the app brings its own
// React (18 or later) and bundler, since HITLD has React as a development dependency only.
//
//   import { Dashboard, readContract } from 'human-in-the-lead/core/lib/ui/index.mjs';
//
// The typed client (client.mjs) needs no framework. The hooks (hooks.mjs) and the components
// (components.mjs) need React. THEME_CSS (theme.mjs) styles the components; a project restyles
// them by setting the --hitld-* theme variables. A project's own panel types go in a registry
// (createRegistry) passed to HitldRoot or Dashboard.

export {
  ContractError,
  INLINE_ID,
  SUPPORTED_API_VERSION,
  fetchContract,
  fieldGetter,
  fieldValue,
  fileHref,
  itemOf,
  itemsById,
  itemsOf,
  panelOf,
  panelsOf,
  readContract,
  readInlined,
  readStamp,
} from './client.mjs';
export {
  ContractContext,
  ContractProvider,
  useContract,
  useField,
  useFileBase,
  useItem,
  useItems,
  useLoadContract,
  usePanel,
  usePanels,
  useReadStamp,
} from './hooks.mjs';
export {
  BUILTIN_PANELS,
  BarPanelView,
  BoardPanelView,
  Dashboard,
  GraphPanelView,
  HitldRoot,
  ItemLabel,
  ItemLink,
  LinePanelView,
  Panel,
  PanelsView,
  ReadStamp,
  RegistryContext,
  TablePanelView,
  TimelinePanelView,
  createRegistry,
} from './components.mjs';
export { PANELS_CSS, THEME_CSS, THEME_VARIABLES, themeProperty, themeStyle } from './theme.mjs';
export { valueText } from './text.mjs';
