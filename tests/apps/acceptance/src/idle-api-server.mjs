import { createServer } from 'node:http';
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('The idle API fixture requires a worker');
const port = parentPort;
/** @type {WeakMap<import('node:net').Socket, number>} */
const connections = new WeakMap();
let connectionId = 0;
const server = createServer((request, response) => {
  port.postMessage({
    event: 'request',
    connectionId: connections.get(request.socket),
    path: request.url,
  });
  if (request.url === '/disconnect') {
    request.socket.destroy();
    return;
  }
  response.statusCode = request.url === '/forbidden' ? 403 : 200;
  response.on('finish', () => port.postMessage({ event: 'finish', time: performance.now() }));
  response.end('fixture');
});
server.keepAliveTimeout = 5000;
server.keepAliveTimeoutBuffer = 1000;
server.on('connection', (socket) => {
  connections.set(socket, ++connectionId);
  socket.on('timeout', () =>
    port.postMessage({ event: 'timeout', connectionId: connections.get(socket) })
  );
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The fixture has no TCP address');
  port.postMessage({
    event: 'listening',
    port: address.port,
    idleDeadlineMs: server.keepAliveTimeout + server.keepAliveTimeoutBuffer,
  });
});
port.on('message', (/** @type {unknown} */ message) => {
  if (!message || typeof message !== 'object' || !('event' in message))
    throw new Error('The fixture received an invalid control');
  if (message.event === 'block' && 'until' in message && typeof message.until === 'number') {
    port.postMessage({ event: 'blocking' });
    // Simulate synchronous Strapi work spanning the socket deadline while its client can send.
    while (performance.now() < message.until) JSON.parse('{"document":"busy"}');
  } else if (message.event === 'close') {
    server.closeAllConnections();
    server.close(() => port.close());
  } else {
    throw new Error('The fixture received an unknown control');
  }
});
