// v5 p1-shell: a font file imported with Vite's `?inline` is its bytes as a data: URL in the bundle (ui/brand/font.ts),
// never a file the extension serves: it has no web-accessible resources.
declare module '*.woff2?inline' {
  const dataUrl: string;
  export default dataUrl;
}
