import type { Database } from 'better-sqlite3';
import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { AUDIO_PROTOCOL } from '../../shared/constants';
import { createLogger } from '../logger';
import { audioMimeType, parseByteRange } from './range';

const log = createLogger('audio-protocol');

/**
 * Must run before `app.ready`. Marking the scheme as standard and stream-capable is what
 * lets <audio> seek within a response instead of buffering the whole file.
 */
export function registerAudioProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_PROTOCOL,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ]);
}

/**
 * Serves indexed audio to the renderer without handing it filesystem access.
 *
 * URLs carry an index row id, never a path: the handler looks the path up in the database,
 * so the renderer can only ever play files the user actually indexed. A renderer that tried
 * to request `audio-asset://file/../../secrets` would simply fail the integer parse.
 */
export function registerAudioProtocolHandler(db: Database): void {
  const lookup = db.prepare('SELECT absolute_path FROM audio_files WHERE id = ?');

  protocol.handle(AUDIO_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      const id = Number(url.pathname.replace(/^\/+/, ''));

      if (!Number.isInteger(id) || id <= 0) {
        return new Response('Bad asset id', { status: 400 });
      }

      const row = lookup.get(id) as { absolute_path: string } | undefined;
      if (!row) return new Response('Unknown asset', { status: 404 });

      const info = await stat(row.absolute_path).catch(() => null);
      if (!info?.isFile()) return new Response('File missing', { status: 404 });

      // Served by hand rather than via net.fetch(file://): that response carried neither a
      // length nor range support, so Chromium treated MP3/OGG/M4A as live streams with
      // infinite duration and seeking them did nothing.
      const size = info.size;
      const headers: Record<string, string> = {
        'Content-Type': audioMimeType(extname(row.absolute_path)),
        'Accept-Ranges': 'bytes',
      };

      const range = parseByteRange(request.headers.get('range'), size);
      if (range === 'unsatisfiable') {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      }
      if (size === 0) {
        return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
      }

      const { start, end } = range ?? { start: 0, end: size - 1 };
      headers['Content-Length'] = String(end - start + 1);
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

      // Streamed, so seeking in a long file reads only what is needed; cancelling the
      // response (the user moved on) closes the file.
      const body = Readable.toWeb(createReadStream(row.absolute_path, { start, end })) as ReadableStream;
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch (error) {
      log.warn('could not serve audio request', error);
      return new Response('Playback failed', { status: 500 });
    }
  });
}
