/**
 * The network guard of the unit tests (test/setup/network-guard.ts): no
 * connection leaves this machine; loopback still works, so a test may run
 * its own server.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import axios from 'axios';

const BLOCKED = /A unit test tried to reach the network: /;

describe('network guard', () => {
  it('fetch to an outside host rejects with the message', async () => {
    await expect(fetch('https://nominatim.openstreetmap.org/search?q=Poznan')).rejects.toThrow(BLOCKED);
  });

  it('http and https requests to an outside host throw when the socket opens', () => {
    expect(() => http.get('http://router.project-osrm.org/route/v1')).toThrow(BLOCKED);
    expect(() => https.get('https://api.trans.eu/')).toThrow(BLOCKED);
  });

  it('axios (http adapter) is blocked too', async () => {
    await expect(axios.get('https://example.com/', { timeout: 2000 })).rejects.toThrow(BLOCKED);
  });

  it('a raw TCP connection to an outside address throws', () => {
    expect(() => net.connect({ host: '93.184.215.14', port: 443 })).toThrow(BLOCKED);
    expect(() => net.connect(443, 'example.com')).toThrow(BLOCKED);
  });

  it('loopback stays open: a server on 127.0.0.1 answers fetch and http', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    try {
      const viaFetch = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      const viaHttp = await new Promise<string>((resolve, reject) => {
        http.get({ host: 'localhost', port, path: '/' }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c)).on('end', () => resolve(body));
        }).on('error', reject);
      });
      expect([viaFetch, viaHttp]).toEqual(['ok', 'ok']);
    } finally {
      server.close();
    }
  });
});
