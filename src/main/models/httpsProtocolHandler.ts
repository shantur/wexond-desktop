import { Session } from 'electron';

const axios = require('axios');

class UploadData {
  static getBlobFromUUID(ses: Session, identifier: string) {
    return ses.getBlobData(identifier);
  }

  static async getData(uploadData: Electron.UploadData[], ses: Session) {
    const data: Electron.UploadData = uploadData[0] || null;

    if (data && data.blobUUID) {
      return this.getBlobFromUUID(ses, data.blobUUID);
    }

    if (data && data.bytes) {
      return data.bytes;
    }

    return undefined;
  }
}

export class HttpsProtocolHandler {
  session: Session;

  constructor(_session: Session) {
    this.session = _session;
  }

  getCookieHeader(cookies: Electron.Cookie[]): string {
    let cookieHeader = '';

    cookies.forEach((cookie) => {
      cookieHeader += `${cookie.name}=${cookie.value}; `;
    });

    return cookieHeader;
  }

  async handle(
    request: Electron.Request,
    callback: (
      stream?: NodeJS.ReadableStream | Electron.StreamProtocolResponse,
    ) => void,
  ): Promise<void> {
    let response;
    try {
      const { headers, method, url } = request;

      console.log('Intercepted', request.url, request.method);
      headers['Referer'] = request.referrer;

      const parsedUrl = new URL(url);
      let newUrl = url;
      let newHeaders = headers;

      if (this.session) {
        const cookies: Electron.Cookie[] = await this.session.cookies.get({
          url: parsedUrl.origin,
        });

        cookies.concat(
          await this.session.cookies.get({
            domain: `.${parsedUrl.hostname}`,
          }),
        );

        cookies.concat(
          await this.session.cookies.get({
            domain: `${parsedUrl.hostname}`,
          }),
        );

        console.log('Request Cookies', cookies);

        const cookieHeader = cookies
          .map((_cookie: any) => {
            if (
              !_cookie.secure ||
              (_cookie.secure && newUrl.startsWith('https'))
            ) {
              return `${_cookie.name}=${_cookie.value}`;
            } else {
              return '';
            }
          })
          .join('; ');

        if (cookieHeader !== '') {
          newHeaders['Cookie'] = cookieHeader;
        }

        console.log('Request CookieHeader', cookieHeader);
      }

      let forceContentType;
      if (url.startsWith('https://media.githubusercontent.com/media/')) {
        newUrl = await this.getGithubUserContentImageUrl({
          url,
          headers: newHeaders,
        });
        // callback(request);
        newHeaders = {};
        forceContentType = url.includes('.jpg') ? 'image/jpeg' : 'image/png';
      } else if (
        url.match(/https:\/\/github.com\/(.*)\/(.*)\/raw\/(.*)\/(.*).(jpg|png)/)
      ) {
        newUrl = await this.getGithubRawImageUrl({ url, headers: newHeaders });
        // callback(request);
        newHeaders = {};
        forceContentType = url.includes('.jpg') ? 'image/jpeg' : 'image/png';
      }

      let auth;
      if (newUrl.includes('@')) {
        const authRegex = /https:\/\/(.*):(.*)@(.*)/;

        const authInfo = newUrl.match(authRegex);

        auth = {
          username: authInfo[1],
          password: authInfo[2],
        };
        newUrl = `https://${authInfo[3]}`;
      }

      const uploadData =
        typeof request.uploadData !== 'undefined'
          ? await UploadData.getData(request.uploadData, this.session)
          : undefined;
      const options = {
        responseType: 'stream',
        data: uploadData,
        method,
        headers: newHeaders,
        maxRedirects: 0,
        url: newUrl,
        auth: auth,
      };

      console.log('Options', options);
      response = await axios.request(options);

      console.log('Response', response.headers['set-cookie']);

      if (forceContentType) {
        response.headers['content-type'] = forceContentType;
        response.headers['content-disposition'] = 'inline; filename=image.jpg';
      }

      return callback({
        data: response.data,
        headers: response.headers,
        statusCode: response.status,
      });
    } catch (error) {
      console.log('error', error);
      if (error.response) {
        response = error.response;

        if (response.status === 302) {
          request.url = response.headers['location'];
          request.method = 'GET';
          this.handle(request, callback);
        } else {
          return callback({
            data: response.data,
            headers: response.headers,
            statusCode: response.status,
          });
        }
      } else if (error.request) {
        console.log('Error during the request. Aborting.');
        return callback();
      } else {
        console.log('Unknown error during the request. Aborting.');
        return callback();
      }
    }
  }

  async getGithubRawImageUrl(config: any): Promise<string> {
    const matches = config.url.replace('https://github.com/', '').split('/');

    const org = matches[0];
    const repo = matches[1];
    const commit = matches[3];

    const paths = matches.slice(4).join('/');

    return await this.getImageUrl(config, org, repo, commit, paths);
  }

  async getGithubUserContentImageUrl(config: any): Promise<string> {
    const matches = config.url
      .replace('https://media.githubusercontent.com/media/', '')
      .split('/');

    const org = matches[0];
    const repo = matches[1];
    const commit = matches[2];

    const paths = matches.slice(3).join('/');

    return await this.getImageUrl(config, org, repo, commit, paths);
  }

  async getImageUrl(
    config: any,
    org: string,
    repo: string,
    commit: string,
    paths: string,
  ): Promise<string> {
    console.log('Org', org);
    console.log('Repo', repo);
    console.log('Commit', commit);
    console.log('path', paths);

    config.method = 'GET';
    config.headers.Cookie = this.getCookieHeader(
      await this.session.cookies.get({ url: 'https://github.com' }),
    );

    try {
      config.url = `https://github.com/${org}/${repo}/raw/${commit}/.lfsconfig`;
      const lsconfig = (await axios(config)).data;

      const lfsurlRegex = /url = "(.*)"/;

      const lfsUrl = lsconfig.match(lfsurlRegex)[1];

      console.log('LSConfig ', lfsUrl);

      config.url = `https://github.com/${org}/${repo}/raw/${commit}/${paths}`;
      const lfsfile = (await axios(config)).data;

      const lfsFileShaRegex = /oid sha256:(.*)/;

      const lfsFileSha = lfsfile.match(lfsFileShaRegex)[1];

      console.log('LFSFile ', lfsFileSha);

      const binaryUrl = `${lfsUrl.replace(
        'api/lfs/',
        '',
      )}/objects/${lfsFileSha.substring(0, 2)}/${lfsFileSha.substring(
        2,
        4,
      )}/${lfsFileSha}`;

      console.log('Binary URL', binaryUrl);

      return binaryUrl;
    } catch (error) {
      console.log('LFSError', error);
      return null;
    }
  }
}
