import { describe, it, expect } from 'vitest';
// Re-import the parser via a workaround: it isn't exported, so we
// exercise the public sampler via the synthetic path which calls it.
// What we *can* validate end-to-end here: after running one sample
// on the synthetic generator, the flow_* tables are populated.
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { flowTopClients, flowTopServices, flowTopDestinations, flowApps } from '../../server/src/db/schema';
import { startConntrackSampler, stopConntrackSampler } from '../../server/src/system/conntrack';

describe('conntrack sampler (synthetic mode)', () => {
  it('populates all four flow tables on the synthetic distribution', async () => {
    runMigrations();
    db.delete(flowTopClients).run();
    db.delete(flowTopServices).run();
    db.delete(flowTopDestinations).run();
    db.delete(flowApps).run();
    startConntrackSampler();
    // The first sample fires immediately. Give it a tick to land.
    await new Promise(r => setTimeout(r, 100));
    stopConntrackSampler();

    expect(db.select().from(flowTopClients).all().length).toBeGreaterThan(0);
    expect(db.select().from(flowTopServices).all().length).toBeGreaterThan(0);
    expect(db.select().from(flowTopDestinations).all().length).toBeGreaterThan(0);
    expect(db.select().from(flowApps).all().length).toBeGreaterThan(0);
  });
});
