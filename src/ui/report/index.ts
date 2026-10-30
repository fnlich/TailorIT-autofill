/*
 * The review report's public face: what the side panel mounts now and Phase 6's in-page panel (content/ui/panel.tsx)
 * will mount in its closed shadow root. Presentational only: props in, callbacks out.
 */
export { Report, type ReportActions, type ReportProps, type SuggestionLabel } from './Report';
export { adoptReportStyles, adoptStyles, REPORT_CSS } from './styles';
