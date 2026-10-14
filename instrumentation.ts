// Phase 6J-9A — runs once when a Next.js server instance starts and must finish before the server
// accepts requests (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
//
// Its only job today is to stop a PRODUCTION server whose security-critical configuration is missing
// or unsafe from serving anything (modules/config/productionConfig.ts): a throw here makes Next log the
// error and answer every request with 500, so health checks fail. The check does nothing in development,
// in tests, or during `next build`, never touches the database or the network, and never prints a
// value — only variable names. It is imported dynamically inside the Node.js branch so the Edge
// bundle of this file stays empty.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionConfig } = await import("./modules/config/productionConfig");
  const warnings = assertProductionConfig(process.env);
  for (const warning of warnings) {
    console.warn(`[config] ${warning.variable}: ${warning.problem}`);
  }
}
