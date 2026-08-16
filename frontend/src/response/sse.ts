/**
 * A reader for `text/event-stream`, following the WHATWG event-stream parsing rules.
 *
 * Worth being exact about what this is and is not. HTTiny sends a request and reads the
 * response to completion, so what reaches here is whatever the server managed to emit
 * before the connection closed — a finite transcript, not a live subscription. Streaming
 * as it arrives would need the response to arrive in chunks across the binding, which is
 * a different piece of work. Parsing the transcript costs a few lines and turns an
 * unreadable run of `data:` prefixes into the events they encode, which is most of the
 * value at a fraction of the cost.
 */

export interface SseEvent {
  /** Sequential, so React keys survive an id the server repeats — or omits entirely. */
  index: number
  id: string
  /** The spec's default when the server names no type. */
  event: string
  data: string
  retry: string
  /** Set when `data` is itself a JSON document, which for most APIs it is. */
  json: string | null
}

const DEFAULT_EVENT = 'message'

/**
 * A field is `name: value`, with one optional leading space stripped from the value.
 * A line with no colon is a field name with an empty value; a line starting with a
 * colon is a comment, which servers use as a keep-alive and which is dropped here.
 */
function field(line: string): { name: string; value: string } | null {
  if (line.startsWith(':')) return null
  const colon = line.indexOf(':')
  if (colon === -1) return { name: line, value: '' }
  const value = line.slice(colon + 1)
  return { name: line.slice(0, colon), value: value.startsWith(' ') ? value.slice(1) : value }
}

/** Pretty-prints `data` when it parses as JSON, so an event body is not one long line. */
function asJson(data: string): string | null {
  const trimmed = data.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

export function parseSse(source: string): SseEvent[] {
  const events: SseEvent[] = []
  let data: string[] = []
  let id = ''
  let event = ''
  let retry = ''

  const dispatch = () => {
    // The spec is explicit: an empty line with no data buffered dispatches nothing.
    // Servers rely on that for keep-alives, and emitting a blank event for each one
    // would bury the real traffic.
    if (data.length === 0) {
      event = ''
      return
    }
    const body = data.join('\n')
    events.push({ index: events.length, id, event: event || DEFAULT_EVENT, data: body, retry, json: asJson(body) })
    data = []
    event = ''
  }

  // `id` and `retry` deliberately persist across events — they are stream state in the
  // spec, and an event carrying neither inherits what was last set.
  for (const line of source.split(/\r\n|\r|\n/)) {
    if (line === '') {
      dispatch()
      continue
    }
    const parsed = field(line)
    if (!parsed) continue
    switch (parsed.name) {
      case 'data':
        data.push(parsed.value)
        break
      case 'event':
        event = parsed.value
        break
      case 'id':
        // A NUL in an id is required to be ignored rather than stored.
        if (!parsed.value.includes('\0')) id = parsed.value
        break
      case 'retry':
        if (/^\d+$/.test(parsed.value)) retry = parsed.value
        break
      default:
        break
    }
  }
  // A stream cut off mid-event leaves data buffered with no terminating blank line.
  // Showing it is the point: that truncated last event is often the interesting one.
  dispatch()

  return events
}
