/**
 * Example test suite — rename and adapt for your project.
 *
 * Each test file:
 *   - Imports RhostRunner from @rhost/testkit
 *   - Connects using env vars injected by tests/run.ts
 *   - Uses beforeAll to look up installed objects by name (never hardcode dbrefs)
 *   - Calls runner.run() at the bottom with process.exit
 */
import { RhostRunner } from '@rhost/testkit';
import { createThing } from './helpers';

const runner = new RhostRunner();

let sysObj: string;
let testPlayer: string;

runner.describe('Example — smoke tests', ({ it, beforeAll, afterAll }) => {

    beforeAll(async ({ client }) => {
        // Look up installed objects by name — never hardcode dbrefs.
        // Adjust the search() names to match your installer's @create commands.
        sysObj = (await client.eval('search(name=My System <sys>)')).trim();
        if (!sysObj || sysObj.startsWith('#-1')) {
            throw new Error('My System object not found — did the installer run?');
        }

        testPlayer = await createThing(client, 'ExampleTestObj');
    });

    afterAll(async ({ client }) => {
        if (testPlayer) await client.command(`@destroy/override ${testPlayer}`);
    });

    it('system object exists', async ({ expect }) => {
        await expect(`type(${sysObj})`).toBe('THING');
    });

    it('example UDF returns expected value', async ({ expect }) => {
        // Replace with real UDF calls once your src/ has softcode.
        await expect(`add(1,1)`).toBe('2');
    });

});

runner.run({
    host:     process.env.RHOST_HOST || 'localhost',
    port:     parseInt(process.env.RHOST_PORT || '4201', 10),
    username: process.env.RHOST_USER || 'Wizard',
    password: process.env.RHOST_PASS || '',
}).then(r => process.exit(r.failed > 0 ? 1 : 0))
  .catch(err => { console.error(err); process.exit(1); });
