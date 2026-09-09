import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import pdfjs from 'pdfjs-dist/package.json';

const run = promisify(execFile);
const library = `/pdfjs/${pdfjs.version}/pdf.mjs`;
const worker = `/pdfjs/${pdfjs.version}/pdf.worker.mjs`;

it.each([
  ['', 200, 'application/javascript'],
  ['', 200, 'text/javascript; charset=utf-8'],
  [library, 404, 'text/html'],
  [worker, 404, 'text/html'],
  [library, 200, 'text/html'],
  [worker, 200, 'text/html'],
  ['/convert', 503, 'text/html'],
] as const)(
  'checks deployed HTTP responses and fails loudly for %s %i %s',
  async (badPath, status, type) => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const path = request.url!;
      requests.push(path);
      response.writeHead(path === badPath ? status : 200, {
        'Content-Type': path === badPath || !badPath ? type : 'application/javascript',
      });
      response.end('fixture');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const result = run(process.execPath, [
        fileURLToPath(new URL('../../scripts/smoke-pdfjs.mjs', import.meta.url)),
        `http://127.0.0.1:${address.port}`,
      ]);
      if (badPath) {
        await expect(result).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(badPath.split('/').at(-1)!),
        });
      } else {
        expect((await result).stdout).toContain('Converter page and both JavaScript assets passed');
        expect(requests).toEqual([library, worker, '/convert']);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
