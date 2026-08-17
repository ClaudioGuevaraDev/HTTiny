/**
 * String quoting, per target language.
 *
 * This is the file the whole `snippets/` directory rests on. A generated snippet is
 * worthless if it does not run, and the only thing standing between "runs" and "syntax
 * error" is getting one apostrophe right — so no generator builds a quoted string by
 * hand. They all come through here.
 *
 * Every function takes an arbitrary string and returns a literal that the target
 * language parses back to exactly that string. There is no sanitising and no rejecting:
 * a header value containing a quote, a dollar sign, a backslash and a newline is a
 * legitimate thing to send, and the snippet has to carry it verbatim.
 */

/**
 * A POSIX shell string.
 *
 * Single quotes are the default and the reason is that they are the only shell quoting with
 * no interior escapes at all — no `$` expansion, no backslash, no backtick — which is what
 * makes them right for a JSON body or a token.
 *
 * Their one weakness is the apostrophe, which cannot appear inside them: the string has to
 * be closed, an escaped quote emitted, and the string reopened, so `'` becomes `'\''`. That
 * is always *correct* and, past two or three of them, unreadable — an Odoo domain filter
 * turns into `[('\''state'\'',` and stops looking like a URL at all.
 *
 * So when the value contains an apostrophe, double quotes are used instead — but only when
 * nothing inside them would come alive. `$` and a backtick both substitute, `\` escapes,
 * `"` would close the string, and `!` is history expansion in an interactive shell. Any of
 * those and it falls back to single quotes, which can always represent anything.
 */
const posixUnsafeInDouble = /["$`\\!]/

export const posix = (value: string): string => (value.includes("'") && !posixUnsafeInDouble.test(value) ? `"${value}"` : `'${value.split("'").join(`'\\''`)}'`)

/**
 * A PowerShell string, on the same rule as `posix` and for the same reason: a single-quoted
 * PowerShell string interpolates nothing, so it is the default, and its escape for an
 * interior apostrophe is a doubled quote rather than a backslashed one.
 *
 * The unsafe set for the double-quoted form is shorter here — `\` is not an escape in
 * PowerShell, the backtick is — but `$` still matters, and not hypothetically: an OData
 * query is `?$filter=…`, and inside double quotes PowerShell would try to read a variable
 * called `filter`.
 */
const powershellUnsafeInDouble = /["$`]/

export const powershell = (value: string): string =>
  value.includes("'") && !powershellUnsafeInDouble.test(value) ? `"${value}"` : `'${value.split("'").join("''")}'`

/**
 * One argument for a native executable, escaped for Windows' own argv rules.
 *
 * This exists because of a defect worth stating plainly: **Windows PowerShell does not
 * escape double quotes when it builds a native command line.** `curl.exe --data-raw
 * '{"a": 1}'` reaches curl as `{a: 1}` — verified against httpbin, which reported the
 * quotes gone and the JSON therefore invalid. Every JSON body would have been silently
 * corrupted, which is worse than a snippet that fails to run.
 *
 * So the quotes are pre-escaped the way `CommandLineToArgvW` reads them: a `"` is
 * backslash-escaped, and a run of backslashes *immediately before* one is doubled first,
 * because that run would otherwise be consumed escaping the escape. Trailing backslashes
 * are doubled for the same reason — PowerShell appends its own closing quote to any
 * argument containing a space, and a lone trailing backslash would escape it.
 *
 * Backslashes anywhere else are literal, which is why `C:\temp` needs no help.
 *
 * Fixed in PowerShell 7.3, and this is safe there too: the escaping describes what the
 * receiving program parses, not what the shell does with it.
 */
export const windowsArg = (value: string): string => {
  let out = ''
  let slashes = 0
  for (const char of value) {
    if (char === '\\') {
      slashes += 1
      continue
    }
    if (char === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"'
      slashes = 0
      continue
    }
    out += '\\'.repeat(slashes) + char
    slashes = 0
  }
  return out + '\\'.repeat(slashes * 2)
}

/**
 * A double-quoted string literal, escaped the way JSON escapes one.
 *
 * Deliberately shared by JavaScript, Python, Java, C#, Go, Ruby and Rust. All seven read
 * `\\`, `\"`, `\n`, `\r` and `\t` identically, so one function serves them and there is
 * one place to be wrong rather than seven. What differs between them — raw strings,
 * heredocs, text blocks — is the *multi-line* form, and each generator picks that itself.
 *
 * The remaining C0 controls go out as `\uXXXX`, which all seven also accept, so a value
 * carrying a stray 0x01 cannot break out of the literal.
 */
export const double = (value: string): string => {
  let out = '"'
  for (const char of value) {
    switch (char) {
      case '\\':
        out += '\\\\'
        break
      case '"':
        out += '\\"'
        break
      case '\n':
        out += '\\n'
        break
      case '\r':
        out += '\\r'
        break
      case '\t':
        out += '\\t'
        break
      default:
        out += char < ' ' ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char
    }
  }
  return out + '"'
}

/**
 * A JavaScript template literal, for a body worth reading across several lines.
 *
 * Only `\``, `\\` and the `${` sequence can end a template early. Escaping the dollar
 * only when a brace follows keeps a body full of `$` — a jQuery payload, a shell script
 * being posted — from turning into a wall of backslashes.
 */
export const backtick = (value: string): string => `\`${value.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${')}\``

/**
 * Whether a value is worth a multi-line literal at all.
 *
 * Single-line bodies read better escaped and inline in every language, so the raw-string
 * and heredoc forms below are only reached when there is something to gain.
 */
export const multiline = (value: string): boolean => value.includes('\n')

/**
 * The multi-line forms, each with the one guard that makes it safe to use.
 *
 * A raw string has no escapes by definition, so there is exactly one sequence it cannot
 * contain — its own terminator. When the body contains that sequence the guard fails and
 * the caller falls back to `double`, which can always represent anything. That is the
 * same contract the response parsers keep: input that cannot be handled comes back in the
 * form that can.
 */

/** Go: a backquoted raw string. Cannot contain a backquote, and eats no escapes. */
export const goRaw = (value: string): string | null => (value.includes('`') || value.includes('\r') ? null : `\`${value}\``)

/** Python: a triple-quoted string. A trailing quote would fuse with the terminator. */
export const pythonTriple = (value: string): string => (value.includes('"""') || value.includes('\\') || value.endsWith('"') ? double(value) : `"""${value}"""`)

/** C#: a verbatim string, where the only escape is a doubled quote. */
export const csharpVerbatim = (value: string): string => `@"${value.split('"').join('""')}"`

/** Rust: a raw string. `r#"…"#` fails only on a literal `"#`, in which case add a hash. */
export const rustRaw = (value: string): string => {
  if (!value.includes('"#')) return `r#"${value}"#`
  if (!value.includes('"##')) return `r##"${value}"##`
  return double(value)
}

/**
 * Ruby: a heredoc, and two details in it are load-bearing.
 *
 * The tag is **quoted** (`<<-'BODY'`). An unquoted heredoc behaves like a double-quoted
 * string: it interpolates `#{…}` and processes backslash escapes, so a JSON body would
 * arrive with its `\"` and `\\` already eaten. Quoting the tag makes it literal.
 *
 * It is `<<-` and not the squiggly `<<~`, and the content is not indented to match its
 * statement. `<<~` strips the *common* leading whitespace, which is the same thing as
 * saying it changes the payload whenever the payload's own lines share an indent — a
 * pretty snippet that sends different bytes. `<<-` only allows the terminator to be
 * indented and leaves the content exactly as it is.
 *
 * The guard is a line whose trimmed form is the terminator, since `<<-` would let an
 * indented one end the document early.
 */
export const rubyHeredoc = (value: string, tag: string, pad: string): string | null => {
  if (value.split('\n').some(line => line.trim() === tag)) return null
  return `<<-'${tag}'\n${value}\n${pad}${tag}`
}
