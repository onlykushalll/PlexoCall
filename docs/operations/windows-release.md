# Windows development and release

The client is Windows-only in this milestone. The NSIS configuration targets x64 and arm64. Linux is used for the owner-run server containers; it is not a client target.

## Build prerequisites and commands

Use Windows, Node.js 24, npm, and (for calls against the local stack) Docker Desktop with Linux containers. From the repository root:

```powershell
npm ci
npm run services:up
npm run dev
```

To create installer artifacts on a Windows build machine:

```powershell
npm run build
npm run dist:win
```

`dist:win` runs the TypeScript/build script and electron-builder's NSIS packaging for x64 and arm64. The package manager lockfile should be used in release CI. The build downloads Electron/tooling artifacts, so the release worker needs network access and a controlled cache. Docker is not required just to package the desktop app.

## Distribution status

- The project currently has no configured code-signing certificate, signing credentials, release pipeline, automatic updater, or update feed.
- Do not redistribute the resulting installer as a trusted production release until signing, installer inspection, endpoint configuration, and Windows SmartScreen behavior have been reviewed. Keep signing keys in a secret manager and sign only from a protected release worker.
- Windows build verification on 2026-10-23 used Node 24.15.0 and npm 11.16.0. `npm run build` passed, including both TypeScript checks and the Electron main, preload, and renderer bundles. `services/control-api`: `npm run build` passed. `npm run dist:win` created the x64 `dist/win-unpacked` app directory, then stopped while electron-builder generated the NSIS uninstaller: Windows Application Control blocked the temporary helper executable (`spawn UNKNOWN`). No final installer was produced and ARM64 packaging was not reached. Resume installer packaging on a Windows build runner where that helper is allowed to execute; do not distribute the intermediate `*-setup.exe` or `.nsis.7z` files from the failed attempt.
- The app bundle has not been launch-tested or installed. Camera/microphone/screen-share, reconnect, audio playback, invite activation, and x64/arm64 installation still need real-device checks before release.
- Do not package development API or LiveKit credentials in the installer. Users configure the owner-operated HTTPS control endpoint; API and LiveKit secrets stay on the server.
- Generate a dependency license inventory and include all required notices with the installer before publishing.

## Dependency security note (checked 2026-10-23)

The control API's locked production dependency tree reported no npm audit findings. The desktop's production dependencies also reported no findings when auditing without development dependencies. The full desktop development tree reported eight moderate findings through `electron-builder` → `@electron/get` → `global-agent` → `roarr` → `sprintf-js`. The underlying [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) says versions through 1.1.3 are affected and currently lists no patched version. This dependency is in the packaging/build tool chain, not the packaged call runtime. Recheck the tree before release; do not hide the advisory with a blanket audit suppression or downgrade to an older builder without reviewing the security fixes it would lose.
