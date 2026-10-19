import { createHandler, d1Adapter } from '../server/core.js';

export default {
  async fetch(request, env) {
    return createHandler({ db: d1Adapter(env.DB), env })(request);
  },
};
