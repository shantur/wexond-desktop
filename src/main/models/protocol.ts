import { protocol, session } from 'electron';
import { join } from 'path';
import { parse } from 'url';
import { HttpsProtocolHandler } from './httpsProtocolHandler';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wexond',
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: false,
    },
  },
  {
    scheme: 'https',
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: true,
    },
  },
]);

export const registerProtocol = (session: Electron.Session) => {
  session.protocol.registerFileProtocol(
    'wexond-error',
    (request, callback: any) => {
      const parsed = parse(request.url);

      if (parsed.hostname === 'network-error') {
        return callback({
          path: join(__dirname, '../static/pages/', `network-error.html`),
        });
      }
    },
    (error) => {
      if (error) console.error(error);
    },
  );

  if (process.env.NODE_ENV !== 'development') {
    session.protocol.registerFileProtocol(
      'wexond',
      (request, callback: any) => {
        const parsed = parse(request.url);

        if (parsed.path === '/') {
          return callback({
            path: join(__dirname, `${parsed.hostname}.html`),
          });
        }

        callback({ path: join(__dirname, parsed.path) });
      },
      (error) => {
        if (error) console.error(error);
      },
    );
  }

  const httpsHandler = new HttpsProtocolHandler(session);

  session.protocol.registerStreamProtocol(
    'https',
    httpsHandler.handle.bind(httpsHandler),
  );

  // session.protocol.interceptStreamProtocol(
  //   'http',
  //   httpsHandler.handle.bind(httpsHandler),
  // );
};
