import {
  serve,
  type BackendEvent,
  type Message,
  type Request,
} from '../shared/ipc.ts';
import { createConfigStore } from './config-store.ts';
import { createSessions } from './sessions.ts';
import { createSettings } from './settings.ts';

// The back end has two hosts: the app runs it as a utilityProcess with parentPort.
// The test harness forks it with a Node IPC channel.
const port = process.parentPort;
const send = port
  ? (message: Message) => port.postMessage(message)
  : (message: Message) => process.send!(message);
const emit = (event: BackendEvent) => send({ event });

// Both hosts pass the app data folder as the last argument; they put different things before it.
const dataDir = process.argv.at(-1)!;

const { renamed, ...sessions } = createSessions(emit);
const handle = serve(
  {
    ...sessions,
    ...createSettings(dataDir, emit),
    ...createConfigStore(emit, renamed),
  },
  send,
);

if (port) port.on('message', (e) => handle(e.data as Request));
else process.on('message', (request) => handle(request as Request));
