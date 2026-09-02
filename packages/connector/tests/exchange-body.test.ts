// The deadline on the handle exchange has to cover the body, not only the
// headers. A `fetch` promise settles as soon as the response head arrives, so
// a timer cancelled at that point leaves an origin free to dribble the body out
// forever — the same hung request the deadline exists to prevent, one step
// later.

import { describe, expect, it } from 'vitest';
import { readCapped } from '../src/consent.js';

/** A response whose body arrives in pieces, under the test's control. */
function dribbling(): {
  response: Response;
  send: (text: string) => void;
  finish: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body),
    send: (text) => controller.enqueue(encoder.encode(text)),
    finish: () => controller.close(),
  };
}

describe('reading the exchange answer', () => {
  it('reads a whole body that arrives in pieces', async () => {
    const { response, send, finish } = dribbling();
    send('{"user_id":');
    send('"user-1"}');
    finish();
    expect(await readCapped(response, 4096, new AbortController().signal)).toBe(
      '{"user_id":"user-1"}',
    );
  });

  it('refuses a body that passes the cap, rather than buffering it', async () => {
    const { response, send } = dribbling();
    send('x'.repeat(5000));
    await expect(readCapped(response, 4096, new AbortController().signal)).rejects.toThrow(
      /larger than 4096/,
    );
  });

  it('stops when the deadline has already passed', async () => {
    const { response, send } = dribbling();
    send('{');
    const stop = new AbortController();
    stop.abort();
    await expect(readCapped(response, 4096, stop.signal)).rejects.toThrow(/too long/);
  });

  it('stops mid-body when the deadline fires between pieces', async () => {
    // This is the case the fix exists for: headers arrived, the first piece
    // arrived, and then the origin went quiet. Without a live deadline the read
    // waits for as long as the platform allows.
    const { response, send } = dribbling();
    const stop = new AbortController();
    send('{"user_id":');
    const reading = readCapped(response, 4096, stop.signal);
    // The origin sends one more piece after the clock has run out. The read is
    // abandoned rather than continuing to collect it.
    setTimeout(() => {
      stop.abort();
      send('"user-1"}');
    }, 5);
    await expect(reading).rejects.toThrow(/too long/);
  });
});
