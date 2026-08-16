# Releasing HTTiny

Installers are built and published by `.github/workflows/release.yml`. Pushing a version tag
is the whole process; nothing is uploaded by hand.

## Publishing a release

1. Bump the version in the two source manifests, keeping them byte-for-byte identical:
   - `frontend/package.json` → `"version"`
   - `build/config.yml` → `info.version`
2. Propagate it into the packaging metadata, which carries the version too — it is what
   the installers, the `.deb` and the `.app` bundle actually report:

   ```bash
   wails3 update build-assets -dir build -config build/config.yml -name HTTiny -binaryname httiny
   rm -rf build/ios   # recreated every time; this project is desktop-only
   ```

   Then **reapply the two deliberate local edits it discards** (see the last section), and
   check nothing was missed:

   ```bash
   grep -rn "<old version>" build frontend/package.json   # must return nothing
   ```

3. Commit the bump.
4. Tag the commit with `v` + the same number and push it:

   ```bash
   git tag v0.20.2
   git push origin main
   git push origin v0.20.2
   ```

The workflow refuses to build if the tag and the two manifests disagree. The installers carry
the manifest version, not the tag, so a mismatch would publish a release advertising a number
nothing was built with — it fails in `verify`, before anything is compiled.

## What gets built

| Platform | Runner | Artifact |
| --- | --- | --- |
| Windows | `windows-latest` | `HTTiny-<version>-windows-amd64-installer.exe` (NSIS, per-user install, no UAC) |
| macOS | `macos-latest` | `HTTiny-<version>-macos-universal.dmg` (Intel + Apple Silicon) |
| Linux | `ubuntu-24.04` | `HTTiny-<version>-linux-amd64.AppImage` and `…-linux-amd64.deb` |

Linux is pinned to `ubuntu-24.04` because Wails v3 targets GTK4 and WebKitGTK 6.0. Ubuntu 22.04
only ships WebKit2GTK 4.1 and would need the `-tags gtk3` opt-in. For the same reason the `.deb`
depends on `libgtk-4-1` and `libwebkitgtk-6.0-4`, so it installs on Ubuntu 24.04+ / Debian 13+
and not on older releases.

## How the workflow is shaped

The release is created **once** as a draft, before the build matrix runs, and every platform job
uploads into that same draft. A final job flips it to published. This matters: if each matrix job
created its own release, the GitHub API races with itself and the per-OS artifacts end up split
across duplicate drafts.

If a platform fails, the draft stays unpublished with only the artifacts that made it. Delete the
draft release before re-pushing the tag, otherwise the retry uploads into a half-filled one.

## Testing the pipeline without releasing

Run the workflow manually from the Actions tab (`workflow_dispatch`). It runs the same matrix but
creates no release: the installers land in the run's own artifact list. Use this instead of
pushing throwaway tags.

## Code signing

There is none. The installers are unsigned, so:

- **Windows** shows a SmartScreen warning on first run — *More info* → *Run anyway*.
- **macOS** Gatekeeper blocks a double-click; the app has to be opened with right-click → *Open*
  the first time. The `.app` is ad-hoc signed by the packaging task, which is not the same thing
  as a Developer ID signature.

The signing tasks already exist (`windows:sign`, `darwin:sign:notarize`, `linux:sign:deb`) and
read their certificates from `wails3 setup`. Wiring them into CI needs an Apple Developer
Program membership and/or an Authenticode certificate.

## Regenerating the packaging assets

`build/windows/`, `build/darwin/` and `build/linux/` come from the Wails CLI, but **never point
`wails3 generate build-assets` at `build/`** — it extracts its template with `os.Create` and would
truncate `build/config.yml` and `build/Taskfile.yml`, both of which are hand-maintained here.
Generate into a scratch directory and copy across what you need.

`wails3 update build-assets -dir build -config build/config.yml -name HTTiny -binaryname httiny`
is safe for `config.yml` and `Taskfile.yml`, but it *does* rewrite the templated files and will
discard two deliberate local edits:

- `build/windows/info.json` — the language key is `0409` (en-US), not the template's `0000`
  (language-neutral), and `fixed.product_version` is set. See the note in CLAUDE.md.
- `build/linux/nfpm/nfpm.yaml` — the homepage points at this repository, the `license` field is
  removed because the repository declares no license, and the icon installed is
  `build/appicon.svg` into `hicolor/scalable/apps/` rather than the 1024×1024
  `build/appicon.png` into `hicolor/128x128/apps/`, whose directory name lied about the size.

It also recreates `build/ios/`, which this desktop-only project does not use; delete it.
