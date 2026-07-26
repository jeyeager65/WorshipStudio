const EXAMPLE_FILE = String.raw`C:\Services\Example.pptx`

/** Mirrors the substitution domain::external_apps::build_args does on the Rust side, purely
 * for the editor's "Will run: ..." live preview — not used for the actual launch. */
export function previewExternalAppCommand(
  executablePath: string | undefined,
  parameterFormat: string | undefined,
  file: string = EXAMPLE_FILE,
): string {
  const exeName = executablePath?.split(/[\\/]/).pop() || executablePath || ''
  if (!exeName) return ''
  if (!parameterFormat) return exeName
  return `${exeName} ${parameterFormat.replace('{file}', file)}`
}
