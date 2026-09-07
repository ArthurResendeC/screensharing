# Repository guidance

- Runtime, package manager and bundler: Bun.
- Lint with `bun run lint` (oxlint + type-aware `tsgolint`) and format with `bun run format` (oxfmt); keep both clean.
- Frontend: HTML, CSS and TypeScript without a UI framework.
- Keep media P2P; the server only serves files and relays typed signaling messages.
- Preserve the one-received-stream-per-participant rule and the peer-per-subscription model.
