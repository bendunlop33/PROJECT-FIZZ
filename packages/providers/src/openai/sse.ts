/**
 * Incremental Server-Sent Events parser (WHATWG event-stream rules, the
 * subset the Responses API uses): `event:` and `data:` fields, multi-line
 * data, comments, CRLF/LF/CR line endings, and chunks split anywhere.
 */

export interface SseEvent {
  event: string | null;
  data: string;
}

export interface SseParser {
  /** Feeds decoded text; returns the events completed by this chunk. */
  push(text: string): SseEvent[];
  /** Flushes a final event that wasn't followed by a blank line. */
  end(): SseEvent[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  let eventName: string | null = null;
  let dataLines: string[] = [];
  let pendingCr = false;

  function dispatch(out: SseEvent[]) {
    if (dataLines.length > 0) out.push({ event: eventName, data: dataLines.join('\n') });
    eventName = null;
    dataLines = [];
  }

  function line(text: string, out: SseEvent[]) {
    if (text === '') {
      dispatch(out);
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    // `id` and `retry` are not used by this client.
  }

  return {
    push(text) {
      const out: SseEvent[] = [];
      let chunk = text;
      // A CR at the end of the previous chunk may be the first half of CRLF.
      if (pendingCr && chunk.startsWith('\n')) chunk = chunk.slice(1);
      pendingCr = false;
      buffer += chunk;
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (match === null) break;
        // A trailing lone CR could be half of a CRLF split across chunks.
        if (match[0] === '\r' && match.index === buffer.length - 1) {
          line(buffer.slice(0, match.index), out);
          buffer = '';
          pendingCr = true;
          break;
        }
        line(buffer.slice(0, match.index), out);
        buffer = buffer.slice(match.index + match[0].length);
      }
      return out;
    },
    end() {
      const out: SseEvent[] = [];
      if (buffer !== '') line(buffer, out);
      buffer = '';
      dispatch(out);
      return out;
    },
  };
}
