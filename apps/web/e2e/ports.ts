// Ports used only by e2e, so a dev server or a hand-started Worker (5173/8787)
// is never mistaken for the test servers. E2E_PORT_OFFSET moves them all, so two
// checkouts can run their suites side by side without reusing each other's servers.
const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0)
export const WEB_PORT = 5175 + OFFSET
export const API_PORT = 8788 + OFFSET
/** The desktop flavour of the build, standing in for tauri://localhost. */
export const DESKTOP_PORT = 4174 + OFFSET
/** fixture-server.mjs: link previews and other pages tests fetch instead of the internet. */
export const FIXTURE_PORT = 5180 + OFFSET
export const FIXTURES = `http://localhost:${FIXTURE_PORT}`
