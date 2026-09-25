import type { Database } from 'better-sqlite3';
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { AUDIO_PROTOCOL } from '../../shared/constants';
import { createLogger } from '../logger';

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

      // net.fetch on a file URL handles range requests, which <audio> relies on to seek.
      return await net.fetch(pathToFileURL(row.absolute_path).toString(), {
        bypassCustomProtocolHandlers: true,
      });
    } catch (error) {
      log.warn('could not serve audio request', error);
      return new Response('Playback failed', { status: 500 });
    }
  });
}
