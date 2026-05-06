# Windows native setup (SQLite)

The optional Lab queue uses `better-sqlite3`, which is a **native** Node addon. On Windows you may need a working build toolchain to install/rebuild it.

## Fast fix (most common)

If you upgraded Node and see a Node ABI / `NODE_MODULE_VERSION` mismatch:

```bash
pnpm install
pnpm setup:native
```

## `node-gyp` troubleshooting (`better-sqlite3`)

If `pnpm install` or `pnpm setup:native` fails while building `better-sqlite3`, verify the native toolchain and do a clean reinstall:

```powershell
# 1) Confirm Python is available
npm config get python
py --version

# 2) Ensure Visual Studio Build Tools 2022 includes:
#    - Desktop development with C++
#    - MSVC v143 build tools
#    - Windows 10/11 SDK

# 3) Stop processes that can lock better_sqlite3.node
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 4) Clean stale native artifacts/workspace install state
Remove-Item -Recurse -Force .\node_modules
Remove-Item -Recurse -Force .\apps\web\node_modules
Remove-Item -Force .\package-lock.json -ErrorAction SilentlyContinue

# 5) Reinstall with pnpm and rebuild native module
pnpm install
pnpm setup:native
```

If `npm config get python` is empty/invalid, set it explicitly (then rerun the clean reinstall):

```powershell
npm config set python "py"
```

