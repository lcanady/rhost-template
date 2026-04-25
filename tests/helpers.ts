/**
 * Shared test helpers for RhostMUSH projects.
 *
 * Works around two dockerized-RhostMUSH quirks:
 *   - create() side-effect output leaks arrival messages into eval responses
 *   - RhostWorld has dig(), not createRoom()
 *
 * Use explicit @create / @dig and then look up the dbref via lastcreate().
 */
import type { RhostClient } from '@rhost/testkit';

export async function createThing(client: RhostClient, name: string): Promise<string> {
    await client.command(`@create ${name}`);
    const dbref = (await client.eval(`lastcreate(me,t)`)).trim();
    const m = dbref.match(/#\d+/);
    if (!m) throw new Error(`createThing(${name}) failed: got ${JSON.stringify(dbref)}`);
    return m[0];
}

export async function createRoom(client: RhostClient, name: string): Promise<string> {
    await client.command(`@dig ${name}`);
    const dbref = (await client.eval(`lastcreate(me,r)`)).trim();
    const m = dbref.match(/#\d+/);
    if (!m) throw new Error(`createRoom(${name}) failed: got ${JSON.stringify(dbref)}`);
    return m[0];
}

/** Set a `_`-prefixed (wiz-only hidden) attribute on an object. */
export async function setHidden(client: RhostClient, dbref: string, attr: string, value: string) {
    await client.command(`&_${attr} ${dbref}=${value}`);
}

/** Wipe all `_`-prefixed attributes matching a glob from an object. */
export async function wipeHidden(client: RhostClient, dbref: string, glob: string) {
    await client.command(`@wipe ${dbref}/_${glob}`);
}
