// Only used by the isolated local load harness. Never deployed.
import worker from '../src/index';
import { refreshPublicFeedSnapshot } from '../src/services/feedSnapshot';
import type { Bindings } from '../src/types';

export default {
  fetch: worker.fetch,
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      refreshPublicFeedSnapshot(env, { force: true, strict: true })
    );
  },
};
