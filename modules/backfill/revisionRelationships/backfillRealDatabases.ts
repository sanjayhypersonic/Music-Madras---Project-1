// Phase 6J-11C — find the REAL database(s) this checkout is configured with, so the backfill can refuse to target one.
//
// The comparison list comes from the repository root (resolved by the caller from the script's own location, never from
// process.cwd()) and from the shell. It FAILS CLOSED: if the root cannot be recognised, the directory cannot be listed, or
// any .env* file cannot be read or parsed, the answer is "cannot tell" and the backfill refuses — an unreadable file is
// not evidence that it names no database. Env files are parsed in memory only (never loaded into process.env), and no
// value is ever put into a result or a message: only file names and error codes.

export interface EnvFileSystem {
  /** Names (not paths) of the entries of a directory. */
  readdir(directory: string): string[];
  readFile(file: string): string;
}

export type RealDatabasesResult = { ok: true; urls: string[] } | { ok: false; reason: string };

const REAL_URL_KEYS = ["DATABASE_URL", "DIRECT_URL"] as const;
const ENV_FILE = /^\.env(\..+)?$/;

function code(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "unreadable";
}

export function readConfiguredRealDatabaseUrls(
  root: string,
  shellEnv: Readonly<Record<string, string | undefined>>,
  fs: EnvFileSystem,
  parseEnv: (content: string) => Record<string, string>,
  join: (...parts: string[]) => string
): RealDatabasesResult {
  let names: string[];
  try {
    names = fs.readdir(root);
  } catch (error) {
    return { ok: false, reason: `cannot list the repository root to find the configured real database (${code(error)}).` };
  }
  if (!names.includes("package.json")) {
    return { ok: false, reason: "the repository root was not recognised (no package.json), so the configured real database cannot be determined." };
  }

  const urls: string[] = [];
  for (const name of names) {
    if (!ENV_FILE.test(name) || name === ".env.example") continue;
    let values: Record<string, string>;
    try {
      values = parseEnv(fs.readFile(join(root, name)));
    } catch (error) {
      return { ok: false, reason: `cannot safely inspect ${name} to compare it with the target (${code(error)}).` };
    }
    for (const key of REAL_URL_KEYS) if (values[key]) urls.push(values[key]);
  }
  for (const key of REAL_URL_KEYS) {
    const value = shellEnv[key];
    if (value) urls.push(value);
  }
  return { ok: true, urls };
}
