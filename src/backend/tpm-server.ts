import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

export type FakeTpmEntry = {
  id: number;
  name: string;
  username: string;
  password: string;
};

/**
 * A Team Password Manager API v6 on 127.0.0.1 that checks what the real one checks: 415 without a `Content-Type` header,
 * 401 for a request not signed with `keys`. It serves `entries` and records the method and path of every request.
 */
export async function startFakeTpm(
  keys: { publicKey: string; privateKey: string },
  entries: FakeTpmEntry[],
) {
  const requests: { method: string; path: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const send = (status: number, json?: unknown) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(json === undefined ? '' : JSON.stringify(json));
      };
      const error = (status: number, message: string) =>
        send(status, { error: true, type: String(status), message });
      const path = new URL(req.url!, 'http://tpm').pathname;
      requests.push({ method: req.method!, path });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return error(415, 'Missing Content-Type header');
      // The signed path is the part after `index.php/`.
      const signed = path.replace(/^\/index\.php\//, '');
      const timestamp = String(req.headers['x-request-timestamp']);
      const hash = createHmac('sha256', keys.privateKey)
        .update(signed + timestamp + body)
        .digest('hex');
      if (
        req.headers['x-public-key'] !== keys.publicKey ||
        req.headers['x-request-hash'] !== hash ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 60
      )
        return error(401, 'Invalid HMAC authentication');
      if (req.method !== 'GET') return error(405, 'Method not allowed');

      const show = signed.match(/^api\/v6\/passwords\/(\d+)\.json$/);
      if (show) {
        const entry = entries.find((e) => e.id === Number(show[1]));
        if (!entry) return error(404, 'Password not found');
        return send(200, {
          ...entry,
          user_permission: { id: 30, label: 'Manage' },
        });
      }
      const search = signed.match(/^api\/v6\/passwords\/search\/(.+)\.json$/);
      if (search) {
        const query = decodeURIComponent(search[1]).toLowerCase();
        return send(
          200,
          entries
            .filter((e) =>
              `${e.name} ${e.username}`.toLowerCase().includes(query),
            )
            .map(({ id, name, username }) => ({ id, name, username })),
        );
      }
      error(404, 'Not found');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    /** The value of `tpmUrl` in `settings.json`. */
    url: `http://127.0.0.1:${port}/index.php`,
    requests,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
