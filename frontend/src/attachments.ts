import { useEffect, useState } from 'react'
import { HTTPService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import type { PlainMessageKey } from './i18n'

/**
 * The two things the editor needs from the Go side to work with attachments, kept out
 * of every component that draws one.
 *
 * Both are best effort in the same way `copySnippet` is: under `pnpm run dev` in a plain
 * browser there is no Wails runtime, so there is no file dialog and no filesystem — the
 * picker returns nothing and the stats come back empty, which is the same shape as
 * "cancelled" and "not found". That is the right degradation for a build where no
 * request can be sent either.
 */

/** What the grid knows about a path it did not just choose. */
export interface Attachment {
  name: string
  exists: boolean
  size: number
}

/**
 * Opens the native file chooser and reports the paths.
 *
 * The dialog lives in Go because a webview cannot read a filesystem path out of an
 * `<input type="file">` at all — see `internal/httpexec/pick.go`. `title` is passed in
 * because it is translated copy and the catalogue is not in Go.
 */
export const pickFiles = async (title: string, multiple: boolean): Promise<string[]> => {
  try {
    const result = await HTTPService.PickFiles({ title, multiple })
    if (result.cancelled) return []
    if (result.errorCode) {
      console.warn('The file dialog could not be opened', result.errorCode, result.errorText)
      return []
    }
    return result.paths ?? []
  } catch (error) {
    console.warn('The file dialog is unavailable', error)
    return []
  }
}

/** The dialog title for each of the two ways a file is chosen. */
export const PICK_TITLE = {
  one: 'editor.body.file.dialogTitle',
  many: 'editor.body.file.dialogTitleMany',
} as const satisfies Record<'one' | 'many', PlainMessageKey>

/**
 * Name, size and existence for a set of paths, refreshed whenever the set changes.
 *
 * None of this is kept in the document, and that is deliberate: a name and a size
 * copied in beside the path would be a second answer that goes stale the moment the
 * file is edited, moved or deleted. Asking each time is what lets the grid say "file
 * not found" *before* a send fails, which is the whole reason a missing attachment is
 * worth drawing differently.
 *
 * Keyed by path rather than by row, so two rows pointing at the same file cost one
 * lookup and a row that only changed its name costs none.
 */
const NOTHING_ATTACHED: Record<string, Attachment> = {}

export function useAttachments(paths: readonly string[]): Record<string, Attachment> {
  const [stats, setStats] = useState<Record<string, Attachment>>(NOTHING_ATTACHED)
  // The paths are the dependency, not the array: a re-render that produced an equal
  // list must not re-ask. Joined with a character no path can contain.
  const key = paths.join('\u0000')

  useEffect(() => {
    const wanted = key ? key.split('\u0000') : []
    // Nothing to ask about, and nothing to clear either: the empty case is answered by
    // the return at the bottom, not by writing state from inside an effect — which is
    // the cascading render the React Compiler rules reject outright.
    if (!wanted.length) return
    let live = true
    HTTPService.StatFiles(wanted).then(
      result => {
        if (!live) return
        const next: Record<string, Attachment> = {}
        for (const stat of result ?? []) next[stat.path] = { name: stat.name, exists: stat.exists, size: stat.size }
        setStats(next)
      },
      (error: unknown) => {
        if (!live) return
        // No backend: leave the map empty. `basename` below still names the file, and
        // nothing claims a size it does not have.
        console.warn('Could not stat the attached files', error)
        setStats({})
      },
    )
    return () => {
      live = false
    }
  }, [key])

  // Whatever the last answer was, or nothing at all while there is nothing to ask
  // about. Removing the only file row has to stop reporting its size immediately
  // rather than one round trip later, and a path that has not been stat'd yet is
  // simply absent — which is what `FileChip` reads as "no answer yet", distinct from
  // "not found".
  return key ? stats : NOTHING_ATTACHED
}

/**
 * The last segment of a path, splitting on both separators.
 *
 * Mirrors `baseName` in `internal/httpexec/pick.go`, and for the same reason: a
 * workspace written on Windows can be opened on Linux, where splitting on `/` alone
 * would report the whole `C:\Users\me\logo.png` as the filename. Used only until
 * `useAttachments` answers, and as the fallback when it cannot.
 */
export const basename = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed
}
