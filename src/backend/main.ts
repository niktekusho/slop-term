import { serve, type Message, type Request } from '../shared/ipc.ts';
import { createSessions } from './sessions.ts';

// The back end has two hosts: the app runs it as a utilityProcess with parentPort.
// The test harness forks it with a Node IPC channel.
const port = process.parentPort;
const send = port
  ? (message: Message) => port.postMessage(message)
  : (message: Message) => process.send!(message);

const handle = serve(
  createSessions((event) => send({ event })),
  send,
);

if (port) port.on('message', (e) => handle(e.data as Request));
else process.on('message', (request) => handle(request as Request));
