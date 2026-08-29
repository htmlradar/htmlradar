// Which source panel /new opens on.
//
// The empty-library screen offers two ways in: upload a file, or track a page
// you already host. The second one links to /new?mode=url. Both modes have
// always existed on the form; only the file route was ever advertised.
//
// Deliberately total and defensive: anything that is not exactly "url" returns
// the upload mode, so a stale link, a typo, a missing parameter or an array of
// values all land on the behaviour the page had before this existed. There is
// no input that produces something other than one of the two modes.
export type NewDocumentMode = 'upload' | 'url';

export function parseNewDocumentMode(raw: string | string[] | undefined): NewDocumentMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim().toLowerCase() === 'url' ? 'url' : 'upload';
}
