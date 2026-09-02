/**
 * Where the vendored native binaries live inside the extension: `native/bin/<platform>-<arch>/`.
 * The layout is shared with `native/build.mjs` (which stages it) and `release.yml` (which
 * packages one target per vsix), so this is the one place the path is spelled.
 */

export function nativeTarget(platform: string, arch: string): string {
  return `${platform}-${arch}`;
}

export function nativeBinaryPath(root: string, name: string, platform: string, arch: string): string {
  const suffix = platform === "win32" ? ".exe" : "";
  return `${root}/native/bin/${nativeTarget(platform, arch)}/${name}${suffix}`;
}
