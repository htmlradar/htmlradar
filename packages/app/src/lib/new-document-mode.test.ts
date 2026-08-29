import { describe, expect, it } from 'vitest';
import { parseNewDocumentMode } from './new-document-mode';

// The empty-library screen now links to /new?mode=url. The regression this
// guards is the important one: anyone arriving WITHOUT the parameter, or with
// a junk value, must land on the upload panel exactly as they did before the
// parameter existed.
describe('parseNewDocumentMode', () => {
  it('opens the url panel when explicitly asked', () => {
    expect(parseNewDocumentMode('url')).toBe('url');
  });

  it('tolerates case and whitespace, since the value comes from a URL', () => {
    expect(parseNewDocumentMode('URL')).toBe('url');
    expect(parseNewDocumentMode(' Url ')).toBe('url');
  });

  it('defaults to upload when the parameter is absent — the pre-existing behaviour', () => {
    expect(parseNewDocumentMode(undefined)).toBe('upload');
  });

  it('defaults to upload for any unrecognised value rather than throwing', () => {
    for (const junk of ['', ' ', 'file', 'urls', 'URL;drop', '../../etc', 'null', '0']) {
      expect(parseNewDocumentMode(junk)).toBe('upload');
    }
  });

  it('handles a repeated query parameter, which arrives as an array', () => {
    expect(parseNewDocumentMode(['url', 'upload'])).toBe('url');
    expect(parseNewDocumentMode(['nonsense'])).toBe('upload');
    expect(parseNewDocumentMode([])).toBe('upload');
  });

  it('only ever returns one of the two known modes', () => {
    const inputs = [undefined, '', 'url', 'UPLOAD', 'x', ['a'], ['url']];
    for (const i of inputs) {
      expect(['upload', 'url']).toContain(parseNewDocumentMode(i as never));
    }
  });
});
