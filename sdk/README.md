# @usebrisk/sdk

The zero-config browser SDK every [Brisk](https://github.com/tomperi/brisk)
site gets at `/brisk.js`. Browser-only: requests stay on the site's own origin
and the server already knows who you are — no config, no API keys.

Every deployed Brisk site serves it automatically:

```html
<script src="/brisk.js"></script>
<script>
  const posts = brisk.db.collection('posts');
  await posts.create({ title: 'Hello' });
</script>
```

Or import it from npm (for bundled apps and type checking):

```sh
npm install @usebrisk/sdk
```

```ts
import { db, me, channel } from '@usebrisk/sdk';

const user = await me();
const posts = db.collection('posts');
await posts.create({ title: 'Hello' });
```

Six primitives: `db`, identity (`me`), `ai`, files (`fs`), `channel`, hosting.
