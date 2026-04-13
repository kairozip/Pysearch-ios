# Legacy `services/` folder

Browser logic has moved to modular top-level packages:

- `features/` — search, privacy, migration, network
- `extension-runtime/` — extension loader/state
- `core/bootstrap.js` — main process composition (window, IPC, sessions)
- `ai/` — safe tool-based agent IPC
- `sync/` — encrypted bundle + remote sync IPC

Do not add new modules here; extend the folders above.
