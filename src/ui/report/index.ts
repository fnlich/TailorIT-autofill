/*
 * The review report's public face: what the side panel mounts, and the in-page panel (content/ui/panel.tsx) in its
 * closed shadow root. Presentational only: props in, callbacks out.
 */
export {
  Report, ReportNotices, RunStatusLine, type PolicyCardDecision, type ReportActions, type ReportProps,
  type SuggestionLabel,
} from './Report';
export { adoptReportStyles, adoptStyles, REPORT_CSS } from './styles';
